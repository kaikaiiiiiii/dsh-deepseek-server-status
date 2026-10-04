import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { setImmediate } from 'node:timers/promises';

/**
 * 构造返回给 fetch 的页面。
 * 数据先 JSON 序列化一次，再作为字符串参数嵌进 push 调用，模拟真实页面的
 * 两层编码。
 */
function statusHtml() {
  const data = {
    page: { components: [{ component_id: 'api', name: 'API' }] },
    active_changes: [],
    changes: [],
    component_uptimes: [],
    initialDataUpdatedAt: 123,
  };
  return `<script>self.__next_f.push([1,${JSON.stringify(JSON.stringify(data))}])</script>`;
}

/**
 * 在 vm 上下文里执行宿主半，并记录它与 ctx 的交互。
 * 返回的句柄提供 response/tick/dispose，供各用例驱动插件。
 */
async function createHost({ fail = false } = {}) {
  const timers = new Set();
  const cleanup = [];
  let route;
  let fetchShouldFail = fail;

  // 定时器替身：只保存回调与延迟，由测试手动触发。
  const interval = (callback, delay) => {
    const timer = { callback, delay };
    timers.add(timer);
    return () => timers.delete(timer);
  };

  // 只提供插件实际用到的宿主服务；多调用会因属性不存在而报错。
  const ctx = {
    setInterval: interval,
    effect(callback) {
      const dispose = callback();
      if (typeof dispose === 'function') cleanup.push(dispose);
      return dispose;
    },
    webServer: {
      register(value) {
        route = value;
        return () => { route = null; };
      },
    },
    logger: { info() {}, warn() {} },
  };

  const context = vm.createContext({
    AbortSignal,
    fetch: async () => {
      if (fetchShouldFail) throw new Error('upstream unavailable');
      return { ok: true, text: async () => statusHtml() };
    },
  });

  const parser = new vm.SourceTextModule(
    await readFile(new URL('../lib/parser.js', import.meta.url), 'utf8'),
    { context },
  );
  const plugin = new vm.SourceTextModule(
    await readFile(new URL('../lib/index.js', import.meta.url), 'utf8'),
    { context },
  );

  // 链接器只放行解析器；出现其他导入说明插件依赖面变了。
  await plugin.link((specifier) => {
    if (specifier === './parser.js') return parser;
    throw new Error(`未预期的导入：${specifier}`);
  });
  await plugin.evaluate();
  plugin.namespace.apply(ctx);
  await setImmediate();

  return {
    timers,
    namespace: plugin.namespace,
    failFetch() { fetchShouldFail = true; },
    async tick() {
      [...timers][0].callback();
      await setImmediate();
    },
    async response() {
      let status;
      let body;
      assert.equal(route.path, '/deepseek-server-status/current');
      await route.handler({}, {
        writeHead(value) { status = value; },
        end(value) { body = JSON.parse(value); },
      });
      assert.equal(status, 200);
      return body;
    },
    dispose() {
      for (const dispose of cleanup.reverse()) dispose();
    },
  };
}

test('宿主半只依赖解析器，且不再暴露可编辑配置', async () => {
  const plugin = await createHost();
  assert.equal(plugin.namespace.Config, undefined, '不应再导出 Config');
  assert.deepEqual([...plugin.namespace.inject], ['webServer', 'timer']);
  assert.equal(plugin.timers.size, 1);
  plugin.dispose();
  assert.equal(plugin.timers.size, 0);
});

test('轮询间隔固定为 60 秒，首轮抓取后响应可读', async () => {
  const plugin = await createHost();
  assert.equal(plugin.timers.size, 1);
  assert.equal([...plugin.timers][0].delay, 60000);
  const body = await plugin.response();
  assert.equal(body.overall, 'operational');
  assert.equal(body.components[0].name, 'API');
  plugin.dispose();
});

test('上游失败时保留上一份快照并报告错误', async () => {
  const plugin = await createHost();
  const before = await plugin.response();
  plugin.failFetch();
  await plugin.tick();
  const after = await plugin.response();
  assert.equal(after.fetchedAt, before.fetchedAt);
  assert.deepEqual(after.components, before.components);
  assert.equal(after.error, 'upstream unavailable');
  plugin.dispose();
});

test('从未成功抓取时返回结构完整的占位响应', async () => {
  const plugin = await createHost({ fail: true });
  const body = await plugin.response();
  assert.equal(body.overall, 'unknown');
  assert.equal(body.fetchedAt, null);
  assert.deepEqual(body.components, []);
  assert.equal(body.error, 'upstream unavailable');
  plugin.dispose();
});

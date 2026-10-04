import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

/**
 * 启动浏览器入口。
 * 模块加载器与包内 chunk 都按真实加载方式模拟：入口调用 require.async 时，
 * 执行对应的 client.*.js 并取它注册的 factory。
 */
async function boot() {
  const out = {
    plugin: undefined,
    registrations: [],
    strings: undefined,
    locales: undefined,
    state: [],
  };
  let cursor = 0;
  let pendingChunk;

  // React 替身只实现四个 hook；useState 的结果存在 out.state，便于复用状态。
  const react = {
    createElement(type, props, ...children) {
      return typeof type === 'function' ? type({ ...props, children }) : { type, props, children };
    },
    useState(initial) {
      const key = cursor++;
      if (!(key in out.state)) out.state[key] = initial;
      return [out.state[key], (value) => {
        out.state[key] = typeof value === 'function' ? value(out.state[key]) : value;
      }];
    },
    useRef() { return { current: null }; },
    useEffect() {},
  };

  const requireStub = (name) => {
    if (name === 'react') return react;
    throw new Error('未预期的 require：' + name);
  };

  const context = vm.createContext({
    window: {
      __ModuleLoader__: {
        load(definition) {
          if (definition.chunk !== undefined) {
            pendingChunk = definition;
            return;
          }
          out.plugin = definition.factory(requireStub);
        },
      },
    },
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    setInterval: () => 1,
    clearInterval() {},
  });

  requireStub.async = async (specifier) => {
    if (typeof specifier !== 'string' || !specifier.startsWith('./')) {
      throw new Error('未预期的异步依赖：' + specifier);
    }
    const fileName = specifier.slice(2);
    const source = await readFile(new URL(`../lib/${fileName}`, import.meta.url), 'utf8');
    pendingChunk = undefined;
    vm.runInContext(source, context);
    if (pendingChunk === undefined) throw new Error('chunk 未注册：' + fileName);
    return pendingChunk.factory(requireStub);
  };

  vm.runInContext(await readFile(new URL('../lib/client.js', import.meta.url), 'utf8'), context);

  const ctx = {
    locale: {
      bind: () => (key) => out.strings[key],
      register(namespace, locales) { out.locales = locales; out.strings = locales.zh; return () => {}; },
    },
    effect: (callback) => callback(),
    slots: {
      inject(name, callback) { callback(); },
      register(slot, component) {
        out.registrations.push({ slot, component });
        return () => {};
      },
    },
  };

  return { ctx, out };
}

test('头部插槽能渲染，且不依赖设置相关服务', async () => {
  const { ctx, out } = await boot();
  await out.plugin.apply(ctx);

  // 只注册头部控件，不应再出现插件页配置卡片。
  assert.equal(out.registrations.length, 1);
  const widget = out.registrations.find((entry) => entry.slot.id === 'deepseek-server-status');
  assert.ok(widget, '头部小部件必须注册');
  assert.deepEqual([...out.plugin.inject], ['slots', 'locale']);

  widget.component({ t: (key) => out.strings[key] });
  const rendered = JSON.stringify(widget.component({ t: (key) => out.strings[key] }));
  assert.ok(rendered.includes('服务状态') || rendered.length > 0);
});

test('故障列表合并进行中与已恢复事件并最多显示三条', async () => {
  const { ctx, out } = await boot();
  await out.plugin.apply(ctx);
  const widget = out.registrations.find((entry) => entry.slot.id === 'deepseek-server-status');
  const t = (key) => out.strings[key];
  const startedAt = 1700000000;

  out.state[0] = {
    data: {
      overall: 'partial_outage',
      components: [],
      uptime: [],
      active: [
        {
          type: 'incident',
          title: '搜索服务异常',
          status: 'monitoring',
          startedAt,
          affected: [{ id: 'search', status: 'full_outage' }],
        },
        {
          type: 'incident',
          title: '接口延迟',
          status: 'monitoring',
          startedAt,
          affected: [{ id: 'api', status: 'degraded' }],
        },
      ],
      recentResolved: [
        { type: 'incident', title: '旧故障 1', startedAt, closedAt: startedAt + 60 },
        { type: 'incident', title: '旧故障 2', startedAt, closedAt: startedAt + 120 },
        { type: 'incident', title: '旧故障 3', startedAt, closedAt: startedAt + 180 },
      ],
      updatedAt: startedAt,
      fetchedAt: startedAt,
      error: null,
    },
    error: null,
  };
  out.state[1] = true;
  const rendered = JSON.stringify(widget.component({ t }));

  assert.ok(rendered.includes('故障列表'), '应只有一个合并后的故障列表');
  assert.ok(!rendered.includes('进行中的事件'));
  assert.ok(!rendered.includes('最近事件'));
  assert.equal((rendered.match(/"className":"__dss_fault"/g) ?? []).length, 3, '最多显示三条');
  assert.ok(rendered.includes('(故障中)'));
  assert.ok(rendered.includes('(已恢复)'));
  assert.ok(rendered.includes('__dss_faultDot __dss_outage'), '完全故障使用红色圆点');
  assert.ok(rendered.includes('__dss_faultDot __dss_degraded'), '降级事件使用黄色圆点');
  assert.ok(rendered.includes('__dss_faultDot __dss_ok'), '已恢复的事件使用绿色圆点');

  const date = new Date(startedAt * 1000);
  const pad = (value) => String(value).padStart(2, '0');
  const expectedTime = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  assert.ok(rendered.includes(expectedTime), '应显示具体时间而不是相对时间');
});

test('API 与网页服务状态分两行显示简写和提示', async () => {
  const { ctx, out } = await boot();
  await out.plugin.apply(ctx);
  const widget = out.registrations.find((entry) => entry.slot.id === 'deepseek-server-status');
  const t = (key) => out.strings[key];

  out.state[0] = {
    data: {
      overall: 'degraded',
      components: [
        { id: 'pro', name: 'DeepSeek V4 Pro API服务(API Service)', description: '', status: 'operational' },
        { id: 'flash', name: 'DeepSeek V4.1 Flash API服务(API Service)', description: '', status: 'degraded' },
        { id: 'chat', name: '对话服务(Chatservice)', description: '', status: 'operational' },
        { id: 'upload', name: '上传文件服务(File Upload Service)', description: '', status: 'operational' },
        { id: 'search', name: '搜索服务(Search Service)', description: '', status: 'operational' },
        { id: 'searchApi', name: '搜索API服务(Search API Service)', description: '', status: 'operational' },
        { id: 'fetchApi', name: '抓取API服务(Fetch API Service)', description: '', status: 'operational' },
        { id: 'future', name: '网页通知服务(Notification Service)', description: '', status: 'unknown' },
        { id: 'pay', name: 'Payment Gateway', description: '', status: 'operational' },
      ],
      uptime: [
        { id: 'pro', uptime: 99.95 },
        { id: 'flash', uptime: null },
      ],
      active: [],
      recentResolved: [],
      updatedAt: null,
      fetchedAt: null,
      error: null,
    },
    error: null,
  };
  out.state[1] = true;
  const rendered = JSON.stringify(widget.component({ t }));

  assert.ok(rendered.includes('__dss_chip __dss_ok'), '正常组件应为绿色圆角块');
  assert.ok(rendered.includes('__dss_chip __dss_degraded'), '异常组件应换用对应颜色');
  assert.ok(rendered.includes('__dss_chip __dss_unknown'), '未知状态使用灰色圆角块');
  assert.ok(rendered.includes('DeepSeek V4 Pro API服务(API Service) · 99.95%'), '悬停提示应包含完整服务名与可用率');
  assert.ok(rendered.includes('DeepSeek V4.1 Flash API服务(API Service) · 可用率未知'), '缺少可用率时也要给出提示');

  // 块内简写：已知服务查字典，未知服务走中文前两字 / 英文前四字符的兜底。
  for (const label of ['Pro', 'Flash', '聊天', '上传', '搜索', '抓取', '网页', 'Paym']) {
    assert.ok(rendered.includes(`"children":["${label}"]`), `色块应显示简写 “${label}”`);
  }
  assert.ok(!rendered.includes('"children":["搜索API"]'), 'API 行已简化为“搜索”');
  assert.ok(!rendered.includes('"children":["抓取API"]'), 'API 行已简化为“抓取”');

  // 按服务类型分成两行：API 在上，网页服务在下；标题各自独立。
  assert.ok(rendered.includes('API 状态'), 'API 分组标题应显示');
  assert.ok(rendered.includes('网页服务状态'), '网页服务分组标题应显示');
  assert.ok(!rendered.includes('组件状态'), '不应再出现旧的“组件状态”标题');
  assert.ok(rendered.indexOf('API 状态') < rendered.indexOf('网页服务状态'), 'API 标题应在上方');
  const rowStarts = [...rendered.matchAll(/"className":"__dss_chips"/g)].map((match) => match.index);
  assert.equal(rowStarts.length, 2, '应分成两行色块');
  const apiRow = rendered.slice(rowStarts[0], rowStarts[1]);
  const webRow = rendered.slice(rowStarts[1]);
  for (const label of ['Pro', 'Flash', '搜索', '抓取']) {
    assert.ok(apiRow.includes(`"children":["${label}"]`), `API 行应包含 “${label}”`);
  }
  for (const label of ['聊天', '上传', '搜索', '网页', 'Paym']) {
    assert.ok(webRow.includes(`"children":["${label}"]`), `网页服务行应包含 “${label}”`);
  }
  for (const label of ['聊天', '上传', '网页', 'Paym']) {
    assert.ok(!apiRow.includes(`"children":["${label}"]`), `API 行不应包含 “${label}”`);
  }
});

test('英文环境下状态块与标题使用英文简写', async () => {
  const { ctx, out } = await boot();
  await out.plugin.apply(ctx);
  const widget = out.registrations.find((entry) => entry.slot.id === 'deepseek-server-status');
  const t = (key) => out.locales.en[key];

  out.state[0] = {
    data: {
      overall: 'operational',
      components: [
        { id: 'pro', name: 'DeepSeek V4 Pro API服务(API Service)', description: '', status: 'operational' },
        { id: 'flash', name: 'DeepSeek V4.1 Flash API服务(API Service)', description: '', status: 'operational' },
        { id: 'chat', name: '对话服务(Chatservice)', description: '', status: 'operational' },
        { id: 'upload', name: '上传文件服务(File Upload Service)', description: '', status: 'operational' },
        { id: 'search', name: '搜索服务(Search Service)', description: '', status: 'operational' },
        { id: 'searchApi', name: '搜索API服务(Search API Service)', description: '', status: 'operational' },
        { id: 'fetchApi', name: '抓取API服务(Fetch API Service)', description: '', status: 'operational' },
      ],
      uptime: [],
      active: [],
      recentResolved: [],
      updatedAt: null,
      fetchedAt: null,
      error: null,
    },
    error: null,
  };
  out.state[1] = true;
  const rendered = JSON.stringify(widget.component({ t }));

  assert.ok(rendered.includes('API Status'));
  assert.ok(rendered.includes('Web Service Status'));
  for (const label of ['Pro', 'Flash', 'Chat', 'Upload', 'Fetch']) {
    assert.ok(rendered.includes(`"children":["${label}"]`), `英文色块应显示 “${label}”`);
  }
  assert.equal(
    (rendered.match(/"children":\["Search"\]/g) ?? []).length,
    2,
    'API 行与网页行各有一个 Search',
  );
});

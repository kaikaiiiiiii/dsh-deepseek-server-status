// 宿主进程的状态采集模块。
// 固定抓取 DeepSeek 官方状态页，解析后通过同源路由把快照提供给浏览器侧。
// 抓取失败时保留上一份成功快照，只把错误信息附带在响应里。
import { statusFromHtml } from "./parser.js";

/** 插件标识；Cordis 与配置条目都使用这个名字。 */
const PLUGIN_NAME = "dsh-deepseek-server-status";

/** 启动本插件所需的服务：路由需要 webServer，周期任务需要 timer。 */
const SERVICES = ["webServer", "timer"];

/** 浏览器侧读取快照的固定地址。 */
const SNAPSHOT_ENDPOINT = "/deepseek-server-status/current";

/** 抓取器参数：官方状态页、每次轮询间隔、超时时间。 */
const UPSTREAM = {
  statusPage: "https://status.deepseek.com/",
  interval: 60000,
  timeout: 15000,
};

/**
 * 创建抓取器：每次调用执行一轮抓取，并把快照或错误写入 store。
 * 成功时整体替换快照并清空错误；失败时只记录错误，旧快照继续服务。
 */
function makeFetcher(ctx, store) {
  return async function pull() {
    try {
      const response = await fetch(UPSTREAM.statusPage, {
        redirect: "follow",
        signal: AbortSignal.timeout(UPSTREAM.timeout),
        headers: { accept: "text/html,application/xhtml+xml" },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const html = await response.text();
      store.snapshot = { ...statusFromHtml(html), fetchedAt: Date.now(), error: null };
      store.failure = null;
    } catch (error) {
      store.failure = String(error?.message ?? error);
      ctx.logger?.warn?.(`${PLUGIN_NAME}: refresh failed: ${store.failure}`);
    }
  };
}

/** 创建轮询器：启动时先停掉旧定时器，保证任意时刻只有一个在跑。 */
function makeScheduler(ctx, pull) {
  let cancel = null;
  const halt = () => {
    if (cancel !== null) cancel();
    cancel = null;
  };
  const start = () => {
    halt();
    cancel = ctx.setInterval(() => { void pull(); }, UPSTREAM.interval);
  };
  return { start, halt };
}

/** 组装路由响应：有快照时复制并附带最新错误，否则返回同形的空数据。 */
function responseOf(store) {
  if (store.snapshot !== null) return { ...store.snapshot, error: store.failure };
  return {
    overall: "unknown",
    components: [],
    active: [],
    recentResolved: [],
    uptime: [],
    updatedAt: null,
    fetchedAt: null,
    error: store.failure ?? "no data yet",
  };
}

/**
 * 装配插件：建立状态存储、抓取器、轮询器和路由。
 * 所有可变状态都收在闭包内，apply 被调用多次时互不影响。
 */
function apply(ctx) {
  const store = { snapshot: null, failure: null };
  const pull = makeFetcher(ctx, store);
  const scheduler = makeScheduler(ctx, pull);

  // 启动流程：先补一次数据，再开始周期任务；effect 销毁时停止轮询。
  ctx.effect(() => {
    void pull();
    scheduler.start();
    return scheduler.halt;
  }, `${PLUGIN_NAME}: poller`);

  // 注册 JSON 路由。no-store 防止浏览器缓存旧快照。
  ctx.effect(() => ctx.webServer.register({
    kind: "exact",
    path: SNAPSHOT_ENDPOINT,
    handler: async (request, response) => {
      response.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      });
      response.end(JSON.stringify(responseOf(store)));
    },
  }), `${PLUGIN_NAME}: route`);

  ctx.logger?.info?.(`${PLUGIN_NAME}: polling ${UPSTREAM.statusPage} every ${UPSTREAM.interval}ms`);
}

export { apply, PLUGIN_NAME as name, SERVICES as inject };

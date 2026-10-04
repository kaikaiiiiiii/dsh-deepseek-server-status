/**
 * 浏览器侧入口。
 * 只负责会话头部状态控件的视图与注册；样式和文案分别从两个包内 chunk
 * 懒加载。模块导出 apply 与 inject，供页面加载器调用。
 */
window.__ModuleLoader__.load({
  id: "dsh-deepseek-server-status",
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const react = require("react");
    const node = react.createElement;

    /** 文案命名空间；同时参与头部插槽的 locale 声明。 */
    const LOCALE_NAMESPACE = "deepseek-server-status";

    /** 运行时需要的页面服务。 */
    const inject = ["slots", "locale"];

    /** 头部插槽地址。 */
    const HEADER_SLOT = "conversation.session.header.utilities";

    /** 浏览器读取宿主路由的间隔，与宿主抓取上游保持一致。 */
    const FEED_INTERVAL_MS = 60000;

    /** 状态到颜色类与文案键的映射。 */
    const STATUS_CATALOG = {
      operational: { color: "__dss_ok", title: "operational", brief: "shortOperational" },
      maintenance: { color: "__dss_maint", title: "maintenance", brief: "shortMaintenance" },
      degraded: { color: "__dss_degraded", title: "degraded", brief: "shortDegraded" },
      partial_outage: { color: "__dss_partial", title: "partialOutage", brief: "shortPartialOutage" },
      full_outage: { color: "__dss_outage", title: "fullOutage", brief: "shortFullOutage" },
      unknown: { color: "__dss_unknown", title: "unknown", brief: "shortUnknown" },
    };

    /** 未登记的状态统一按 unknown 展示。 */
    function appearanceOf(status) {
      return STATUS_CATALOG[status] || STATUS_CATALOG.unknown;
    }

    /**
     * 上游服务名到短标签的映射。
     * 名称里混有版本号与英文括注，因此按关键字包含匹配；具体规则排在前面，
     * 避免“搜索API”被更宽泛的“搜索”先命中。
     */
    const SERVICE_ALIASES = [
      { hints: ["Pro API"], key: "servicePro" },
      { hints: ["Flash API"], key: "serviceFlash" },
      { hints: ["搜索API", "Search API"], key: "serviceSearchApi" },
      { hints: ["抓取API", "Fetch API"], key: "serviceFetchApi" },
      { hints: ["对话", "Chat"], key: "serviceChat" },
      { hints: ["上传", "Upload"], key: "serviceUpload" },
      { hints: ["搜索", "Search"], key: "serviceSearch" },
    ];

    /** 取服务短标签；未命中时中文取前两字、英文取前四字符。 */
    function shortServiceName(name, translate) {
      const text = String(name ?? "");
      const compact = text.replace(/\s+/g, "").toLowerCase();
      for (const alias of SERVICE_ALIASES) {
        const hit = alias.hints.some(
          (hint) => compact.includes(hint.replace(/\s+/g, "").toLowerCase()),
        );
        if (hit) return translate(alias.key);
      }
      const chinese = [...text].filter((character) => /[\u3400-\u9fff]/.test(character));
      if (chinese.length > 0) return chinese.slice(0, 2).join("");
      return [...text].slice(0, 4).join("");
    }

    /** 状态圆点。 */
    function StatusMark({ status }) {
      return node("span", { className: "__dss_dot " + appearanceOf(status).color });
    }

    /** 毫秒时间戳转相对时间。 */
    function relativeClock(milliseconds, translate) {
      if (!milliseconds) return translate("unknownTime");
      const age = Date.now() - milliseconds;
      if (age < 60000) return translate("justNow");
      const minutes = Math.floor(age / 60000);
      if (minutes < 60) return translate("minutesAgo").replace("{n}", String(minutes));
      const hours = Math.floor(minutes / 60);
      if (hours < 24) return translate("hoursAgo").replace("{n}", String(hours));
      return translate("daysAgo").replace("{n}", String(Math.floor(hours / 24)));
    }

    /** 秒级时间戳转本地“年-月-日 时:分”。 */
    function absoluteClock(seconds, translate) {
      if (!seconds) return translate("unknownTime");
      const date = new Date(seconds * 1000);
      const pad = (value) => String(value).padStart(2, "0");
      return (
        date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate()) +
        " " + pad(date.getHours()) + ":" + pad(date.getMinutes())
      );
    }

    /** 合并进行中与已结束事件，取至多三条，并预先决定圆点颜色。 */
    function collectIncidents(snapshot) {
      const ongoing = (snapshot && snapshot.active ? snapshot.active : []).map((event) => ({
        ...event,
        isFinished: false,
        timestamp: event.startedAt,
        color: (event.affected ?? []).some((item) => item.status === "full_outage")
          ? "__dss_outage"
          : "__dss_degraded",
      }));
      const closed = (snapshot && snapshot.recentResolved ? snapshot.recentResolved : []).map((event) => ({
        ...event,
        isFinished: true,
        timestamp: event.closedAt ?? event.startedAt,
        color: "__dss_ok",
      }));
      return [...ongoing, ...closed].slice(0, 3);
    }

    /** 把快照整理成渲染需要的分组与事件。 */
    function describeSnapshot(data, translate) {
      const uptimes = {};
      (data && data.uptime ? data.uptime : []).forEach((entry) => {
        uptimes[entry.id] = entry.uptime;
      });

      const components = data && data.components ? data.components : [];
      const isApi = (component) => /api/i.test(component.name ?? "");
      const groups = [
        { title: translate("apiStatus"), entries: components.filter(isApi) },
        { title: translate("webStatus"), entries: components.filter((component) => !isApi(component)) },
      ].filter((group) => group.entries.length > 0);

      return {
        overall: data ? data.overall : "unknown",
        updatedAt: (data && (data.updatedAt || data.fetchedAt)) || null,
        groups,
        uptimes,
        incidents: collectIncidents(data),
      };
    }

    /** 轮询宿主路由；失败时保留上一份数据。 */
    function useSnapshotFeed(intervalMs) {
      const [feed, setFeed] = react.useState({ data: null, error: null });

      react.useEffect(() => {
        let alive = true;

        const request = () => {
          fetch("/deepseek-server-status/current", { cache: "no-store" })
            .then((response) => {
              if (!response.ok) throw new Error("HTTP " + response.status);
              return response.json();
            })
            .then((payload) => {
              if (alive) setFeed(() => ({ data: payload, error: payload.error || null }));
            })
            .catch((error) => {
              if (alive) setFeed((previous) => ({ data: previous.data, error: String(error) }));
            });
        };

        request();
        const timer = setInterval(request, intervalMs);
        return () => {
          alive = false;
          clearInterval(timer);
        };
      }, [intervalMs]);

      return feed;
    }

    /** 一组服务色块。 */
    function ServiceChips({ title, entries, uptimes, translate }) {
      return node(
        "div",
        { className: "__dss_chipGroup" },
        node("div", { className: "__dss_sect" }, title),
        node(
          "div",
          { className: "__dss_chips" },
          entries.map((component) => {
            const uptime = uptimes[component.id];
            const tooltip =
              component.name + " · " + (Number.isFinite(uptime) ? uptime.toFixed(2) + "%" : translate("uptimeUnknown"));
            return node("span", {
              className: "__dss_chip " + appearanceOf(component.status).color,
              title: tooltip,
              key: component.id || component.name,
            }, shortServiceName(component.name, translate));
          }),
        ),
      );
    }

    /** 合并后的故障列表；没有事件时显示占位文案。 */
    function IncidentList({ incidents, translate }) {
      if (incidents.length === 0) {
        return node("div", { className: "__dss_sub" }, translate("noFaults"));
      }
      return node(
        "ul",
        { className: "__dss_faults" },
        incidents.map((incident, index) =>
          node(
            "li",
            { className: "__dss_fault", key: "f" + index },
            node("span", { className: "__dss_faultDot " + incident.color }),
            node("span", { className: "__dss_faultState" }, "(" + translate(incident.isFinished ? "recovered" : "ongoing") + ")"),
            node("span", { className: "__dss_faultTitle", title: incident.title }, incident.title),
            node("span", { className: "__dss_faultTime" }, absoluteClock(incident.timestamp, translate)),
          ),
        ),
      );
    }

    /** 展开后的明细面板。 */
    function DetailsFlyout({ translate, data, error }) {
      const view = describeSnapshot(data, translate);
      return node(
        "div",
        { className: "__dss_panel" },
        node(
          "div",
          { className: "__dss_head" },
          node(StatusMark, { status: view.overall }),
          node("span", null, translate(appearanceOf(view.overall).title)),
          node(
            "a",
            {
              className: "__dss_link",
              href: "https://status.deepseek.com/",
              target: "_blank",
              rel: "noreferrer",
              style: { marginLeft: "auto" },
            },
            translate("openPage"),
          ),
        ),
        node("div", { className: "__dss_sub" }, translate("updated").replace("{time}", relativeClock(view.updatedAt, translate))),
        error ? node("div", { className: "__dss_err" }, translate("fetchError")) : null,
        ...view.groups.map((group) => node(ServiceChips, {
          key: group.title,
          title: group.title,
          entries: group.entries,
          uptimes: view.uptimes,
          translate,
        })),
        node("div", { className: "__dss_sect" }, translate("faultList")),
        node(IncidentList, { incidents: view.incidents, translate }),
      );
    }

    /** 头部按钮；展开时监听外部点击来收起。 */
    function HeaderStatus({ t: translate }) {
      const feed = useSnapshotFeed(FEED_INTERVAL_MS);
      const [expanded, setExpanded] = react.useState(false);
      const container = react.useRef(null);

      const data = feed.data;
      const overall = data ? data.overall : "unknown";
      const label = data ? translate(appearanceOf(overall).brief) : translate("shortUnknown");

      react.useEffect(() => {
        if (!expanded) return;
        const closeOnOutside = (event) => {
          if (container.current && !container.current.contains(event.target)) setExpanded(false);
        };
        document.addEventListener("mousedown", closeOnOutside);
        return () => { document.removeEventListener("mousedown", closeOnOutside); };
      }, [expanded]);

      return node(
        "div",
        { className: "__dss_root", ref: container },
        node(
          "button",
          {
            type: "button",
            className: "__dss_btn",
            title: translate("nav"),
            onClick: () => { setExpanded(!expanded); },
          },
          node(StatusMark, { status: overall }),
          node("span", { className: "__dss_label" }, label),
        ),
        expanded ? node(DetailsFlyout, { translate, data, error: feed.error }) : null,
      );
    }

    /** 把样式表插入页面，按 data-plugin-css 去重。 */
    function installStyles(sheet) {
      if (typeof document === "undefined") return;
      const selector = "style[data-plugin-css=" + JSON.stringify(sheet.SHEET_ID) + "]";
      if (document.querySelector(selector) !== null) return;
      const tag = document.createElement("style");
      tag.dataset.plugin = "dsh-deepseek-server-status";
      tag.dataset.pluginCss = sheet.SHEET_ID;
      tag.textContent = sheet.SHEET_TEXT;
      document.head.appendChild(tag);
    }

    /** 注册顺序：加载懒加载资源 → 样式 → 文案 → 头部控件。 */
    async function apply(ctx) {
      const [texts, sheet] = await Promise.all([
        require.async("./client.i18n.js"),
        require.async("./client.css.js"),
      ]);
      installStyles(sheet);
      ctx.effect(
        () => ctx.locale.register(LOCALE_NAMESPACE, texts.TRANSLATIONS),
        "dsh-deepseek-server-status: translations",
      );

      ctx.slots.inject(HEADER_SLOT, () =>
        ctx.slots.register({
          name: HEADER_SLOT,
          id: "deepseek-server-status",
          order: 30,
          locale: LOCALE_NAMESPACE,
        }, HeaderStatus),
      );
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});

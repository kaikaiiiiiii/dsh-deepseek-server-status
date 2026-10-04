// 状态页解析模块。
// 上游是 Next.js 服务端渲染页面，数据以转义字符串形式嵌在 flight 负载里。
// 本模块的处理顺序：还原负载文本 → 按字段名截取 JSON → 组装组件/事件/可用率。

/** 常见单字符转义到实际字符的映射。 */
const ESCAPES = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" };

/** 还原 JS 字符串字面量中的转义序列。 */
function reviveString(raw) {
  return raw.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (match, escaped) => {
    if (escaped[0] === "u") return String.fromCharCode(parseInt(escaped.slice(1), 16));
    return ESCAPES[escaped] ?? escaped;
  });
}

/** 收集页面里所有 flight 负载，解码后按行拼接。 */
export function collectFlight(html) {
  const pieces = [];
  for (const match of html.matchAll(/self\.__next_f\.push\(\[1,(.*?)\]\)<\/script>/gs)) {
    let payload = match[1].trim();
    if (payload.startsWith('"') && payload.endsWith('"')) payload = payload.slice(1, -1);
    pieces.push(reviveString(payload));
  }
  return pieces.join("\n");
}

/** 从起始括号扫描到配对的闭合括号，字符串内部的括号不计入层级。 */
function scanRegion(text, start) {
  const opening = text[start];
  const closing = opening === "{" ? "}" : "]";
  let level = 0;
  let quoted = false;
  let escaped = false;

  for (let index = start; index < text.length; index++) {
    const character = text[index];

    if (quoted) {
      if (escaped) { escaped = false; continue; }
      if (character === "\\") { escaped = true; continue; }
      if (character === '"') quoted = false;
      continue;
    }

    if (character === '"') { quoted = true; continue; }
    if (character === opening) { level += 1; continue; }
    if (character !== closing) continue;

    level -= 1;
    if (level === 0) return { raw: text.slice(start, index + 1), next: index + 1 };
  }

  return null;
}

/** 读取某个键名之后紧跟的值；缺失或非法时返回 null。 */
function readBehindKey(text, key) {
  const keyAt = text.indexOf(key);
  if (keyAt < 0) return null;

  let cursor = keyAt + key.length;
  while (cursor < text.length && /\s/.test(text[cursor])) cursor += 1;

  const first = text[cursor];
  if (first === "{" || first === "[") {
    const region = scanRegion(text, cursor);
    if (!region) return null;
    try { return JSON.parse(region.raw); } catch { return null; }
  }

  if (first === '"') {
    const closing = text.indexOf('"', cursor + 1);
    return closing < 0 ? null : text.slice(cursor + 1, closing);
  }

  const scalar = /^(-?\d+(?:\.\d+)?|true|false|null)/.exec(text.slice(cursor));
  if (!scalar) return null;
  if (scalar[1] === "null") return null;
  if (scalar[1] === "true") return true;
  if (scalar[1] === "false") return false;
  return Number(scalar[1]);
}

/** 各状态的严重程度，数字越大越严重。 */
const SEVERITY_ORDER = { operational: 0, maintenance: 1, degraded: 2, partial_outage: 3, full_outage: 4 };

/** 已结束的事件状态。 */
const CLOSED_STATUS = new Set(["resolved", "completed", "cancelled"]);

/** 只接受数字类型的秒级时间戳。 */
function asTimestamp(value) {
  return typeof value === "number" ? value : null;
}

/** 把页面组件转换成展示用列表。 */
function buildComponents(page, liveChanges) {
  return (page?.components ?? []).map((entry) => ({
    id: entry.component_id ?? "",
    name: entry.name ?? entry.component_id ?? "",
    description: entry.description ?? "",
    status: liveChanges === null ? "unknown" : "operational",
  }));
}

/** 把进行中的变更转换成事件条目。 */
function toIncident(change) {
  return {
    type: change.type === "maintenance" ? "maintenance" : "incident",
    title: change.title ?? "",
    status: change.status ?? "unknown",
    startedAt: asTimestamp(change.start_at_seconds),
    closedAt: asTimestamp(change.close_at_seconds),
    affected: (change.affected_components ?? []).map((item) => ({
      id: item.component_id ?? "",
      name: item.name ?? "",
      status: item.status ?? "unknown",
    })),
    latestDescription: change.updates?.at(-1)?.description ?? change.description ?? "",
  };
}

/** 把已结束的变更转换成简化的历史条目。 */
function toClosedIncident(change) {
  return {
    type: change.type === "maintenance" ? "maintenance" : "incident",
    title: change.title ?? "",
    startedAt: asTimestamp(change.start_at_seconds),
    closedAt: asTimestamp(change.close_at_seconds),
  };
}

/** 用进行中的事件抬高受影响组件的状态。 */
function applyLiveImpacts(components, liveChanges) {
  const byId = new Map(components.map((component) => [component.id, component]));
  for (const change of liveChanges ?? []) {
    const maintenance = change.type === "maintenance";
    for (const affected of change.affected_components ?? []) {
      const component = byId.get(affected.component_id);
      if (!component) continue;
      const next = maintenance && component.status === "operational" ? "maintenance" : affected.status;
      if ((SEVERITY_ORDER[next] ?? 0) > (SEVERITY_ORDER[component.status] ?? 0)) component.status = next;
    }
  }
}

/** 按严重程度聚合整体状态。 */
function aggregateStatus(components, liveChanges) {
  let overall = liveChanges === null ? "unknown" : "operational";
  for (const component of components) {
    if ((SEVERITY_ORDER[component.status] ?? 0) > (SEVERITY_ORDER[overall] ?? 0)) overall = component.status;
  }
  return overall;
}

/** 转换可用率列表。 */
function buildUptime(rows) {
  return (rows ?? []).map((row) => ({
    id: row.component_id ?? "",
    uptime: typeof row.uptime === "number" ? row.uptime : null,
  }));
}

/** 把截取到的原始区域组装成快照。 */
function assembleSnapshot(parts) {
  const components = buildComponents(parts.page, parts.liveChanges);
  if (parts.liveChanges !== null) applyLiveImpacts(components, parts.liveChanges);

  return {
    overall: aggregateStatus(components, parts.liveChanges),
    components,
    active: (parts.liveChanges ?? []).map(toIncident),
    recentResolved: (parts.history ?? [])
      .filter((change) => CLOSED_STATUS.has(change.status))
      .slice(0, 5)
      .map(toClosedIncident),
    uptime: buildUptime(parts.uptimes),
    updatedAt: parts.updatedAt ?? null,
  };
}

/** 对外入口：解析状态页 HTML，返回展示快照；解析失败时抛错。 */
export function statusFromHtml(html) {
  const flightText = collectFlight(html);
  if (!flightText) throw new Error("no flight payload found");

  const parts = {
    page: readBehindKey(flightText, '"page":'),
    liveChanges: readBehindKey(flightText, '"active_changes":'),
    history: readBehindKey(flightText, '"changes":'),
    uptimes: readBehindKey(flightText, '"component_uptimes":'),
    updatedAt: readBehindKey(flightText, '"initialDataUpdatedAt":'),
  };

  if (!parts.page) throw new Error("page object not found");
  return assembleSnapshot(parts);
}

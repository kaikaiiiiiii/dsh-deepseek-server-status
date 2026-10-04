# DeepSeek 服务状态（dsh-deepseek-server-status）

DeepSeek Harness 插件：在会话头部实时显示 DeepSeek 官方服务状态
（[status.deepseek.com](https://status.deepseek.com/)）。状态圆点与简短文案随
服务状态变化，点开后可以查看组件状态色块、合并后的故障列表以及最后更新时间。

## 功能

- 会话头部常驻状态指示：正常 / 维护中 / 降级 / 部分故障 / 严重故障 / 状态未知。
- 展开面板：整体状态、API 状态与网页服务状态两组色块（显示服务简写，悬停显示完整服务名与可用率）、故障列表（进行中与已恢复合计最多 3 条）、更新时间。
- 宿主侧固定每 60 秒抓取上游页面，通过同源路由提供 JSON；浏览器无需处理跨域。
- 代码端提供多语言方案。

## 安装

本插件是一个 DSH bundle，安装后会在宿主侧注册一个条目 id 为
`deepseek-server-status` 的插件行（见 `cordis.patch.yml`）。

1. 把本包装进目标 profile（例如通过 Harness 的插件安装流程
   `plugin_manager install_bundle`，或把包名加入 profile `package.json` 的
   `dsh.profile.bundles`）。
2. 重载 Harness 或重启对应 profile 后，插件开始轮询上游状态页。
3. 头部出现状态指示即安装成功；插件不会在设置页生成配置卡片。

> 注意：旧版本包的条目 id 与命名空间可能不同；升级到本版本时请先移除旧 bundle，
> 避免同时存在两行插件（两条轮询、两个头部小部件）。

## 界面

- **头部按钮**：状态圆点 + 简短文案（如“正常”“降级”），点击展开/收起面板。
- **面板**：顶部是整体状态与“访问 status.deepseek.com”链接；中间分两组：**「API 状态」**
  一行（Pro / Flash / 搜索 / 抓取），**「网页服务状态」**一行（聊天 / 上传 / 搜索），
  色块固定宽度、左对齐，块内显示服务简写（未收录的名字取中文前两字或英文前四
  字符），悬停显示完整服务名与可用率；下方是“故障列表”，把进行中的故障与已恢复
  的事件合并展示，最多 3 条，括号内标注“故障中”或“已恢复”，并显示具体时间。
  点击面板外部会自动收起。

## 工作原理

```text
status.deepseek.com
        │  HTTP GET（宿主，固定每 60 秒轮询）
        ▼
lib/index.js ── 抓取 HTML ──▶ lib/parser.js ── 解析 ──▶ 内存快照
        │                                                │
        └──────── GET /deepseek-server-status/current ◀───┘
                              │  同源 JSON（no-store）
                              ▼
                    lib/client.js（浏览器）
                    └─ 会话头部小部件（每 60 秒轮询路由）
```

- **宿主半**（`lib/index.js`）注入 `webServer`、`timer`：启动时立即抓取一次，
  然后按固定间隔轮询。抓取失败时保留上一份成功快照，只把错误信息随响应带给
  界面，避免面板整体变成“状态未知”。路由为精确匹配，响应禁止缓存。
- **解析器**（`lib/parser.js`）处理的是 Next.js 服务端渲染页面：完整状态以
  转义字符串的形式内嵌在 `self.__next_f.push([1,"..."])` 的 flight 负载里。
  解析器按字段名截取所需 JSON 片段，而不是整体反序列化，因此对页面局部结构
  变化更宽容。
- **浏览器半**（`lib/client.js`）是手写的 ModuleLoader 入口，没有构建步骤。
  它注册头部插槽，通过同源路由读取快照，并负责本地化与渲染。
  样式与文案分别放在 `lib/client.css.js`、`lib/client.i18n.js` 两个包内 chunk 中，
  由入口通过 `require.async` 懒加载后再注册界面。

### 响应数据结构

```json
{
  "overall": "operational",
  "components": [{ "id": "api", "name": "API", "description": "", "status": "operational" }],
  "active": [
    {
      "type": "incident",
      "title": "示例事件",
      "status": "monitoring",
      "startedAt": 1700000000,
      "closedAt": null,
      "affected": [{ "id": "api", "name": "API", "status": "degraded" }],
      "latestDescription": "最新进展"
    }
  ],
  "recentResolved": [{ "type": "incident", "title": "已解决事件", "startedAt": 1, "closedAt": 2 }],
  "uptime": [{ "id": "api", "uptime": 99.95 }],
  "updatedAt": 1700000123,
  "fetchedAt": 1700000124,
  "error": null
}
```

- `overall`：`operational` / `maintenance` / `degraded` / `partial_outage` /
  `full_outage` / `unknown`，由组件状态按严重程度聚合得出。
- `updatedAt`：上游页面自带的数据更新时间；`fetchedAt`：宿主最近一次成功抓取的时间。
- 宿主尚未拿到任何快照时，返回 `overall: "unknown"` 的占位结构，并带上
  `error: "no data yet"` 或最近一次失败原因。

## 开发

要求 Node.js >= 18。

```bash
npm test        # 运行全部测试（需要 --experimental-vm-modules，脚本已带上）
npm run check   # 语法检查 + 全部测试
npm run prepack # 发布前检查
```

- `lib/client.js` 是手写入口 bundle，修改视图逻辑后不需要构建，重载页面即可生效。
- `lib/client.css.js`、`lib/client.i18n.js` 是包内懒加载 chunk，文件名必须遵守
  加载器的 `client.*.js` 约定。由于 chunk 的缓存版本号来自入口 bundle，单独修改
  chunk 后建议同时保存一次 `lib/client.js`（更新 mtime），或重启 profile，避免
  浏览器继续使用旧的不可变缓存。

### 目录结构

```text
lib/
  index.js         宿主半：轮询、路由
  parser.js        状态页解析器
  client.js        浏览器入口：视图、资源加载
  client.css.js    懒加载样式 chunk（类名前缀 __dss_）
  client.i18n.js   懒加载中英文文案 chunk
test/
  host.test.mjs    宿主半：固定间隔、失败降级、占位响应
  client.test.mjs  浏览器半：插槽注册、故障列表、色块与英文简写
cordis.patch.yml  bundle patch：注册插件行
```

## 常见问题

- **界面显示“状态未知”**：宿主第一轮抓取尚未完成、上游不可达，或浏览器读取
  路由失败。查看宿主日志里 `dsh-deepseek-server-status: refresh failed` 的原因。
- **想改抓取地址或频率**：修改 `lib/index.js` 的 `UPSTREAM` 后重新安装/重载插件。

## 兼容性

面向 DSH 0.2 的插件机制：`webServer` / `timer` 注入、头部插槽按 key 注册、
`locale` 文案服务、包内 `client.*.js` 懒加载 chunk。

# AGENTS.md

面向在本仓库里工作的编码代理与维护者。开始改动前先读完本文，尤其是“外部契约”
一节：这些字符串同时被插件两端、DSH 页面和发布产物依赖，改动必须成组进行。

## 项目概览

`dsh-deepseek-server-status` 是 DeepSeek Harness（DSH）插件，由两半组成：

- **宿主半**（`lib/index.js`，Node ESM）：作为 Cordis 插件运行，固定每 60 秒抓取
  `status.deepseek.com`，解析后在现有 Web 服务器上暴露同源路由。
- **浏览器半**（`lib/client.js`，手写 ModuleLoader 入口）：在会话头部渲染状态
  小部件；样式与文案分别从 `lib/client.css.js`、`lib/client.i18n.js` 两个包内
  chunk 懒加载。

解析逻辑独立在 `lib/parser.js`。没有构建步骤和运行时依赖。

## 常用命令

```bash
npm test        # node --test（已带 --experimental-vm-modules）
npm run check   # 语法检查 + 全部测试
npm run prepack # npm 发布前会自动执行
```

要求 Node.js >= 18。测试里用 `node:vm` 的 `SourceTextModule` / `SyntheticModule`
装载源码，因此 `--experimental-vm-modules` 是必需的；不要把它从脚本里删掉。

## 架构与数据流

```text
上游状态页 ──HTTP（固定 60s）──▶ lib/index.js（抓取、缓存、路由）
                                    │
                                    ├── lib/parser.js（flight 负载 → 快照）
                                    ▼
                       GET /deepseek-server-status/current
                                    │
                                    ▼
                        lib/client.js（头部小部件）
```

- 宿主启动即抓取一次，随后 `ctx.setInterval` 按固定间隔轮询；失败保留旧快照，
  只更新 `error`。抓取地址、轮询间隔、超时为代码常量。
- 浏览器每 60 秒轮询宿主路由；不用处理跨域。

## 外部契约（不可随意改）

以下字符串要么被宿主与浏览器两端共同依赖，要么被 DSH 页面按精确值查找，要么
是对外可见的响应结构。重命名内部变量可以，这些必须保持一致：

| 契约 | 取值 | 出现在 |
| --- | --- | --- |
| 包名 / bundle 行 `name` / ModuleLoader id | `dsh-deepseek-server-status` | `package.json`、`cordis.patch.yml`、`lib/client.js` |
| profile 条目 id（命名空间） | `deepseek-server-status` | `cordis.patch.yml` 的 `id`、`lib/client.js` 的 `LOCALE_NAMESPACE` |
| 宿主路由 | `/deepseek-server-status/current` | `lib/index.js` 的 `SNAPSHOT_ENDPOINT`、`lib/client.js` 的 `fetch` |
| 头部插槽 | `conversation.session.header.utilities`，条目 `id: deepseek-server-status`，`order: 30` | `lib/client.js` |
| 固定抓取参数 | 地址 `https://status.deepseek.com/`、间隔 `60000`、超时 `15000` | `lib/index.js` 的 `UPSTREAM` |
| 模块导出 | `apply`、`inject`、`name`（宿主）；`apply`、`inject`（浏览器） | `lib/index.js`、`lib/client.js` |
| 注入服务 | `webServer`、`timer`；`slots`、`locale` | 两端 `inject` |
| 响应字段 | `overall`、`components`、`active`、`recentResolved`、`uptime`、`updatedAt`、`fetchedAt`、`error` | `lib/index.js`、`lib/client.js` |
| 状态枚举 | `operational`、`maintenance`、`degraded`、`partial_outage`、`full_outage`、`unknown` | 两端、解析器 |
| 日志片段 | `refresh failed` | `lib/index.js`、`test/host.test.mjs` |
| 包内懒加载 chunk | `client.css.js`、`client.i18n.js`；文件名必须匹配加载器的 `client.*.js` 规则，入口用 `require.async("./client.xxx.js")` 加载 | `lib/client.js`、两个 chunk 文件 |

`package.json` 的 `exports` 只公开 `"."`、`"./client"` 与 `"./package.json"`；
`lib/parser.js` 属于内部模块，可以改内部结构，但保持与 `lib/index.js` 的配合。

## 修改指南

### 改路由或命名空间

必须同时改：`cordis.patch.yml` 的 `id`、`lib/client.js` 的 `LOCALE_NAMESPACE`
与 `fetch` URL、`lib/index.js` 的 `SNAPSHOT_ENDPOINT`、两个测试文件里的断言。
现有测试只校验各自文件内的字符串，**不校验跨文件一致性**，所以改完要人工核对
（或先补一条跨文件守卫测试）。只改一半时测试可能依然全绿，但界面会一直
“状态未知”。

### 改浏览器半

- 入口保持 `window.__ModuleLoader__.load({ id, factory })` 形态，无构建步骤；
  `apply` 是异步函数：先 `require.async` 加载包内 chunk，再注册文案、样式和
  头部控件。
- 包内 chunk 必须命名为 `client.<name>.js`，本文件用
  `__ModuleLoader__.load({ id, chunk: "client.<name>.js", factory })` 注册，并由
  入口的 `require.async("./client.<name>.js")` 消费；不能改用同步相对 require。
- `require("react")` 是唯一的外部模块依赖。
- 不要新增运行时依赖；文案改动要同时覆盖 `zh` 与 `en` 两套字典。
- 样式类名前缀 `__dss_` 是页面内去重标签，不要和外层 UI 冲突。
- chunk 的浏览器缓存版本号来自入口 bundle：只改 chunk 时，同时更新一次
  `lib/client.js` 的 mtime（或重启 profile），否则旧缓存可能继续生效。

### 改解析器

- 解析依赖上游 flight 负载里的字段名（`"page":`、`"active_changes":` 等），
  页面大改时需要同步调整；解析失败应抛错，由宿主记录并保留旧快照。
- 状态聚合采用严重程度排序（operational < maintenance < degraded <
  partial_outage < full_outage），改动时要保持对外输出结构不变。

## 代码规范

- 注释一律使用中文，解释“为什么”而不是复述代码。
- 内部变量名可以使用英文；但先对照“外部契约”表，确认没有把契约字符串改名。
- 保持无运行时依赖、Node >= 18、浏览器侧无构建步骤。
- 修改后至少运行 `npm run check`。

## 测试说明

- `test/host.test.mjs`：用 vm 沙箱装载宿主半，覆盖固定 60 秒间隔、失败保留旧
  快照、从未成功时的占位响应，以及不再导出 `Config`。
- `test/client.test.mjs`：用 vm 沙箱与 React 替身装载浏览器入口，模拟包内 chunk
  加载，覆盖插槽注册、故障列表合并上限、API / 网页服务分组标题、色块简写与
  中英文文案。

测试通过不代表视觉正确；界面改动还需要在 Harness 里实际查看。

## 发布与升级

- `npm publish` 前会执行 `prepack`（`npm run check`）。
- `files` 字段只发布 `lib` 与 `cordis.patch.yml`；README 由 npm 自动包含。
- 发布新版本号后，已安装的 profile 需要重新安装/重载才会生效。

## 已知限制

- 测试不覆盖“路由路径 / 命名空间”这类跨文件契约，重命名时要人工检查。
- 解析器依赖上游页面结构；上游大改时可能返回“状态未知”，需要更新解析逻辑。
- 面板里的“访问 status.deepseek.com”链接固定指向 DeepSeek 官方页面。

# 01 · v0.1.1 范围与需求

> 适用项目：AISC_ISSUES 反馈站（v0.1.0 已上线 https://feedback.alanevergarden.xyz ）。
> 基线关系：v0.1.0 决策基线（docs/archive/v0.1.0/01~05）仍为事实基线；本文所列「v0.1.1 演进」点为经用户裁决的基线演进，将在 02-design.md 中固化为 v0.1.1 基线。工程约定见根目录 CLAUDE.md 与 develop_wiki.md。
> 读者：AI 编码代理与开发者。字段名、枚举值、API 路径、函数名均为执行口径。
> 本套规划共三份，交叉引用使用相对文件名：01-scope.md（本文，范围与需求）、02-design.md（架构与数据演进设计）、03-tasks.md（实施拆解与验收映射）。
> 动手前置阅读：docs/archive/v0.1.0/02-data-model.md、03-architecture.md；src/lib/ 现有实现（data.ts、rate-limit.ts、attachments.ts、feedback.ts、github-client.ts、admin.ts、markdown-utils.ts、upload-client.ts）。

---

## 1. 版本目标与背景

**一句话目标**：在 v0.1.0 上线运行的基础上，围绕「上传体验、存储稳健性、防滥用、管理效率、用户互动」做一轮不推翻基线的增量迭代。

**需求来源**：docs/todo.md「待改进 / 待开发」清单（2026-09-22 快照共 9 条），经用户裁决收敛为四个里程碑（M1–M4）与三项范围裁决（GATED / 裁剪 / schema 演进，见 §2）。**快照之后 todo.md 新增 2 条**（去除「1 分钟提交…3 个工作日内回复」等描述性文案；按编号查询增加模糊查询、按日期筛选），已由用户 2026-09-22 明示「docs/todo.md 即 v0.1.1 开发目标」纳入本期，与三项范围裁决（GATED / 裁剪 / schema 演进，见 §2）与 M5 新增裁决（见 §2 R4）一并生效。裁决已定，执行中不得擅自更改；对裁决有异议时在文档中以 `> ⚠️ 待确认：` 引用块标注，不擅改。

---

## 2. 范围裁决表

| # | 裁决 | 内容 | 理由 | 影响与基线关系 |
|---|---|---|---|---|
| R1 | 里程碑分期 | M1 体验与稳健性（上传进度、_pending 自动清理、Trees API 解除 1000 上限）；M2 防滥用与限流（Turnstile 开关实现、Upstash 限流）；M3 管理页增强（编辑/撤回回复、批量改状态、删除反馈）；M4 互动（投票） | 按「先稳、后防、再管理、后互动」排序：M1 直接改善现有用户路径且零外部依赖；M2 依赖外部服务，必须带开关与回退；M3 是纯增量管理能力；M4 涉及 frontmatter schema 演进，放最后以隔离数据面风险 | 每期独立可发布、可独立回滚；M2 两个子项默认行为与 v0.1.0 完全一致（默认关 / 未配置回退内存）；M4 引入唯一 schema 演进点（R4） |
| R4 | 文案基线演进【已拍板 2026-09-22】 | 移除全站 SLA/承诺类描述文案（「1 分钟提交，开发者会回复」「我们通常在 3 个工作日内回复」及同类），空态保留最小说明但不含时限承诺；CLAUDE.md「空态文案」约定与归档 01-product §8 对应验收项随 v0.1.1 同步修订 | **依据**：用户明示「docs/todo.md 即 v0.1.1 开发目标」，基线所有者的明示确认即基线演进；按 v0.1.1 演进③执行（M5-1） |
| R2 | 邮件通知【GATED】 | 本期只写设计预案（02 文档：通知文案草稿、触发时机、环境变量预留 `RESEND_API_KEY` + `NOTIFY_FROM`、大陆可达性评估），**不实现**邮箱采集、不实现发送链路 | **原因链**：v0.1.0 基线明确不采集任何联系方式（02-data-model.md §1 `contact` 字段与打码逻辑整体移除；03-architecture.md §8 安全清单「不采集联系方式」）→ 反馈库中不存在任何邮箱/手机号 → 回复送达、状态变更**无投递通道** → 实现通知的前置不是写代码，而是产品决策「恢复可选邮箱采集（仅用于通知、明示用途）」→ 该决策与冻结基线冲突，**须用户明示确认后才可开工**（见 §6 待确认 1） | 不影响现有 schema 与表单；预案中的环境变量仅在 .env.example 注释占位，不入代码逻辑；微信通知因大陆可达性与合规成本更高，连预案一并搁置 |
| R3 | 多产品支持【裁剪】 | 仅保证代码路径参数化就绪：`product` 相关常量与路径构造收口（`constants.ts` 的 `PRODUCT_ID` 升级为 `PRODUCT_IDS` 数组 + 当前产品；`feedback/{id}.md`、`feedback/assets/{id}/` 的路径拼接收口为 `feedbackPath(id)` / `assetsPath(id)` 函数），**不做任何 UI**（无表单产品选择器、无多产品列表） | 第二款软件的需求尚未出现，UI 与数据分流是纯成本；参数化收口保证未来加产品时改动收敛在常量与函数（02-data-model.md §5.4 已预留演进路径） | 对用户零可见变化；`PRODUCT_IDS` 扩容前一切行为与 v0.1.0 一致 |
| R4 | schema 增量与投票去重口径 | ①【v0.1.1 演进】frontmatter 新增 `affects`（正整数，默认 0；问题/功能两条路径通用，问题=「我也遇到」计数、功能=「我想要」计数）；② 投票去重按 IP 限频（1 次/小时）粗粒度去重，接受少量重复不精确（文档明示，见 M4-1） | `affects` 是投票功能的唯一持久化载体，无法绕开 schema；向后兼容设计（读取缺省 0、惰性写入、不迁移存量）使演进成本最小。去重若做到精确需账号体系或指纹（v1 非目标），按 IP 限频是当前架构下的合理折中 | **v0.1.1 基线演进点**：02-data-model.md（归档）的字段表为 12 字段，v0.1.1 起为 13 字段（`affects` 选填）；违反「不得擅改 schema」冻结条款的部分已由用户裁决背书，在 02-design.md 中显式声明。存量 v0.1.0 文件与读取器完全兼容（`parseFeedback` 不校验未知字段） |

**新增环境变量（v0.1.1 全量）**：

| 变量名 | 用途 | 归属 | 说明 |
|---|---|---|---|
| `CRON_SECRET` | `_pending` 清理任务鉴权 | M1-2（本期实现） | `openssl rand -hex 32`；配置后 Vercel Cron 自动以 `Authorization: Bearer ${CRON_SECRET}` 调用端点；仅 Vercel 服务端 |
| `RESEND_API_KEY` | 邮件发送密钥 | R2 GATED 预案（**本期不实现**） | 仅 .env.example 注释占位 |
| `NOTIFY_FROM` | 通知发件地址 | R2 GATED 预案（**本期不实现**） | 同上 |

沿用既有预留：`TURNSTILE_ENABLED` / `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY`（M2-1）、`UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`（M2-2）。

---

## 3. 里程碑需求条目

### M1 体验与稳健性

| 条目 | 用户故事 / 动机 | 详细需求（交互与文案） | 验收标准 |
|---|---|---|---|
| M1-1 上传进度细化（XHR 百分比 + 速度） | 「我上传一个 15MB 的日志，界面只显示 2/5 片，不知道是卡住了还是在传、还要等多久。」 | ① `src/lib/upload-client.ts` 的 `postForm` 由 fetch 实现整体改为 XMLHttpRequest 封装 `postFormXhr(fd, onProgress?)`（fetch 无法获取上传进度；直传、分片、finalize 全部表单提交统一走 XHR，02-design.md §2.1 口径）；对外 `uploadAttachment` / `uploadLargeFile` 函数名与返回类型 `UploadedRef` 不变，进度回调形状统一为 `UploadProgress { loaded, total, percent, bytesPerSecond, etaSeconds }`（02-design.md §2.1）。② 图片直传（≤4MB 单请求）：`xhr.upload.onprogress` 回调 `percent = loaded/total`；速度 `= loaded / 自 xhr 发起起的耗时`；文案「上传中 62%（1.8 MB/s）」。③ 分片上传：整体进度 `=（Σ已完成分片字节 + 当前片已传字节）/ 文件总字节`；速度用指数滑动平均（EMA，α=0.3）平滑；剩余时间 `=（总字节 − 已传字节）/ 速度`；文案「上传中 58%（2.4 MB/s，剩余约 6 秒）」；样本时长 <2 秒时不显示速度与剩余时间（防跳变，只显示百分比）。④ `onprogress` 的 `loaded` 含 multipart 开销（数百字节级），按近似值处理不修正。⑤ `screenshot-uploader.tsx` / `attachment-uploader.tsx` 每文件一行状态：等待「等待上传」→ 传输中（上述文案）→「上传完成」；失败「上传失败，可点击重试」；压缩（canvas 重绘）阶段按钮显示「处理图片中…」，不计入进度。进度条用现有 Tailwind 元素，不引入新依赖 | - [ ] 上传 >3.5MB 日志（走分片）时 UI 显示百分比 + 速度 + 剩余时间，数值随进度单调不减<br>- [ ] 图片直传（截图 tile）显示百分比，速度与剩余时间经 `title` 悬停 / 读屏可达（tile 空间小不常显速度，02-design.md §2.3）<br>- [ ] DevTools 节流 Slow 3G 下进度持续刷新，无 NaN / 负数 / ∞ / 速度跳变<br>- [ ] 上传失败与重试路径与 v0.1.0 一致（草稿与已上传 ref 不丢失）<br>- [ ] 进度/速度/剩余时间的纯计算函数有 node --test 单测；`npm run test` 全绿 |
| M1-2 `_pending` 孤儿自动清理（日期化目录 + Vercel Cron） | 「用户传了附件又放弃提交，暂存文件永久躺在私有仓库里，越积越多。」（todo：v1 不清理；可加定期脚本或 Vercel Cron 删 7 天以上暂存） | ① 【v0.1.1 演进】`_pending` 目录命名从 `{uuid4}` 改为 `{YYYYMMDD-HHmmss}-{uuid4}`（北京时间，与 id 时间段同格式）：`/api/attachment` 直传分支的服务端 `crypto.randomUUID()`、`upload-client.ts` 分片 `uploadId` 生成处均加日期前缀（客户端时钟偏差在 7 天余量下无实际影响，偏差需 >7 天才会误判）。② 兼容旧目录：`PENDING_REF_PATTERN`（src/lib/attachments.ts）及 validate.ts 引用校验的目录段改为可匹配 `(\d{8}-\d{6}-)?[0-9a-f-]{36}`，新旧引用都可提交归位。③ 新增 `GET /api/cron/cleanup`（`src/app/api/cron/cleanup/route.ts`，`runtime="nodejs"`、`maxDuration=60`）：鉴权校验 `Authorization: Bearer ${process.env.CRON_SECRET}`，未配置或不匹配一律 **404**（不暴露端点存在）；逻辑为 `githubListDir("feedback/assets/_pending")`（no-store）→ 目录名匹配 `^\d{8}-\d{6}-[0-9a-f-]{36}$` 且日期距今 **>7 天** → 列出目录内全部文件（含 `.part{i}` 分片）→ 逐文件 `githubGetFileMeta` 取 sha 后 `githubDeleteFile`，p-limit(3) 并发，404 视为已删；**旧格式纯 uuid 目录**在运行日期 ≥ 2026-09-29（= v0.1.0 上线日 + 7 天）时视为超龄一并删除，此前跳过；既非新格式也非旧 uuid 格式的目录名跳过并记日志（防误删）；响应 `{ok, scanned, deletedDirs, deletedFiles, failed}`。④ 【v0.1.1 演进②】新建 `vercel.json`：`{"crons":[{"path":"/api/cron/cleanup","schedule":"0 19 * * *"}]}`（UTC 19:00 = 北京时间次日 03:00 低峰；打破归档 03-architecture §11「无 cron、vercel.json 整个文件不需要创建」的冻结口径，登记于 02-design.md 附录 A ②）。⑤ `.env.example` 增补 `CRON_SECRET=` | - [ ] 新上传的 `_pending` 目录名形如 `20260922-143005-3f2a1b0c-…`（日期前缀 + uuid4）<br>- [ ] 含旧格式引用（无日期前缀）的表单提交仍能正常归位<br>- [ ] 无 / 错 `CRON_SECRET` 的请求得到 404，不执行任何删除<br>- [ ] 以正确 Bearer 手动调用：>7 天目录被删、≤7 天目录保留、`feedback/assets/{id}/` 正式附件与 `feedback/` md 不受影响<br>- [ ] vercel.json cron 每日触发一次，Vercel dashboard 可见执行记录<br>- [ ] 目录名解析（新/旧/非法三种）与 7 天阈值判定有单测 |
| M1-3 列表读取改 Git Trees API（解除 1000 条截断） | 「反馈量过千后，首页统计和列表会悄悄丢条目。」（todo：当前全量拉取派生，>1000 条需换 Git Trees API，见归档 03 待确认 2） | ① `github-client.ts` 新增 `githubListFeedbackMdPaths(revalidate?)`（02-design.md §4.1 为唯一实现口径，与 03-tasks.md T1.3 同步）：两步非递归——`GET /repos/{owner}/{repo}/git/trees/HEAD`（HEAD 解析为默认分支，免新增分支环境变量）取根树 → 在根树 entries 中定位 `path === "feedback"` 且 `type === "tree"` 的子树 sha → `GET /repos/{owner}/{repo}/git/trees/{该 sha}`（recursive=0，仅列该直接子层）→ 过滤 `type === "blob"` 且以 `.md` 结尾，返回 `feedback/{path}` 列表；刻意不用 `?recursive=1`（防大仓库 `truncated:true` 与响应体积失控），调用数恒为 2、与条目量无关。② 失败语义：Trees 调用 403/404/网络异常或 `truncated === true` → 抛 `GitHubApiError`；根树无 `feedback` 目录 → 返回 `[]`（空仓库属正常态）。③ `data.ts::fetchSummaries` 改造：`try githubListFeedbackMdPaths(REVALIDATE_SECONDS)` → catch 回退现有 `githubListDir("feedback")` 过滤 md（行为与 v0.1.0 一致）并 console.error；后续逐文件拉取流程不变。④ **不改变**：ISR `revalidate=300`、p-limit(8) 并发、/api/asset、限流；首页轻统计口径复核结论：三数字（累计反馈 / 已解决 / 平均首次回应天数）口径不变，本条目仅解除 1000 截断的数据源风险。配额影响：每次刷新 2 次 Trees 调用替代 1 次 Contents 调用，可忽略 | - [ ] 单测 mock 两步 Trees 响应返回 >1000 个 md 条目时，列表与统计完整、排序正确<br>- [ ] 根树无 feedback 目录（新仓库）时返回空列表，行为与 v0.1.0 一致<br>- [ ] ISR 生效：300 秒内重复渲染不重复请求 GitHub<br>- [ ] `githubListFeedbackMdPaths` 单测（两步路径拼装、根树无 feedback→[]、truncated→抛错回退信号、403/404→抛错回退，与 03-tasks.md §3.2 断言一致）通过 |

### M2 防滥用与限流

| 条目 | 用户故事 / 动机 | 详细需求（交互与文案） | 验收标准 |
|---|---|---|---|
| M2-1 Turnstile 人机验证（默认关） | 「公网无登录表单迟早被脚本灌水，但大陆加载 challenges.cloudflare.com 不稳，不能强制。」（todo：flag 已预留，前端挂载/服务端校验未实现） | ① 默认关：`TURNSTILE_ENABLED` 缺省或 `false` 时**零行为变化**，页面无任何对 challenges.cloudflare.com 的请求（维持归档 03 §9 零墙外依赖清单；开启即引用该清单中已预留的例外）。② 开启（`true` 且 `TURNSTILE_SITE_KEY`/`TURNSTILE_SECRET_KEY` 已配）：前端 `feedback-form.tsx` 在**首次提交时**动态注入 `<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer>`（懒加载，不常驻、不用 next/script 预载）；渲染 invisible widget，取得 token 后随 `POST /api/feedback` 请求体新增字段 `turnstileToken`，且每个附件上传请求（截图 / 日志、直传 / 分片 / finalize）同样随 FormData 携带 `turnstileToken`，`POST /api/attachment` 在 formData 解析后、内容校验前插桩同款校验（缺 token 降级放行 + console.warn，校验失败 400 同文案，02-design.md §5.4 附件面）。validate.ts 字段白名单**无条件**增加可选 `turnstileToken: string（≤2048）`（validate.ts 为纯函数不读 env），是否启用校验在路由层按开关判定（02-design.md §5.4 口径）。③ 前端失败降级：脚本加载超时 10 秒、widget 报错或取 token 失败 → **仍提交**（不带 token）并 console.warn，绝不阻断提交。④ 服务端：开关开启且请求带 `turnstileToken` → POST `https://challenges.cloudflare.com/turnstile/v0/siteverify`（`secret` + `response` + `remoteip`）；校验失败 400「人机验证未通过，请刷新页面重试」；开关开启但请求**缺** token（前端降级场景）→ 放行并 console.warn `[turnstile] 缺 token 降级放行`（日志可统计降级率）。⑤ 防重放：siteverify 的 token 一次性——校验成功后记入已用集合（内存 Map TTL 10 分钟；Upstash 启用时改 Redis `SET NX EX 600`），重复 token 直接 400 | - [ ] 未开启时 Network 面板无 challenges.cloudflare.com 请求，全站行为与 v0.1.0 一致<br>- [ ] 开启后脚本在首次提交时才加载，请求体含 `turnstileToken`<br>- [ ] 屏蔽 / 断开 challenges.cloudflare.com 时表单仍可提交（降级放行），服务端日志出现降级告警<br>- [ ] 开启后附件上传请求（直传 / 分片 / finalize）携带 turnstileToken；`POST /api/attachment` 缺 token 降级放行、伪造 token 400<br>- [ ] 伪造 token、已用 token（重放）均得 400 中文文案<br>- [ ] siteverify 校验路径单测（mock fetch：成功 / 失败 / 重放）通过 |
| M2-2 Upstash Redis 精确限流 | 「函数内存限流在每个冷启动实例上各自计数，多实例下阈值被动放大。」（todo 原文：接口已预留 UPSTASH_*） | ① `rate-limit.ts` 改造为双后端：`UPSTASH_REDIS_REST_URL` 与 `UPSTASH_REDIS_REST_TOKEN` **均非空 → Redis 后端**；否则原样走现有内存实现（完整保留为回退）。② REST 调用：后端接口按 02-design.md §6.1 `CounterBackend` 口径（**毫秒**单位）——`incr(key, windowMs)` 单次 `POST {URL}/pipeline` 发送 `[["INCR", key], ["PEXPIRE", key, windowMs, "NX"]]`（固定窗口计数），`setIfAbsent(key, windowMs)` 用 `[["SET", key, "1", "PX", windowMs, "NX"]]` 判返回 "OK"；`Authorization: Bearer ${TOKEN}`，超时 500ms（AbortController）。③ 覆盖场景与 key 命名（阈值/文案全部沿用 v0.1.0）：反馈提交 `rl:{ip}`（5 次/小时）+ 冷却 `rl:cd:{ip}`（60 秒）；附件上传 `rl:up:{ip}`（20 次/小时）；幂等键 `idem:{key}`（15 分钟）；投票 `vote:{ip}:{id}`（M4，按（IP, 反馈）1 次/小时）。④ Redis 故障（超时/非 2xx）→ 降级内存实现 + console.error 告警；取舍与 v0.1.0 一致：宁松勿断 | - [ ] 未配置 UPSTASH_* 时行为与 v0.1.0 完全一致，现有 rate-limit 单测全绿<br>- [ ] 配置后同 IP 第 6 次提交/小时得 429「提交太频繁了，请 1 小时后再试」（跨函数实例精确）<br>- [ ] 配错 / 断开 Redis 时提交仍成功（降级内存），日志有告警<br>- [ ] `rl:` / `rl:cd:` / `rl:up:` / `idem:` / `vote:` 五类 key 的窗口与 TTL 有单测（mock pipeline） |

### M3 管理页增强

现状：`/admin`（ADMIN_TOKEN 登录，httpOnly cookie）仅有「改状态 + 追加回复」（`POST /api/admin/update`）。M3 全部新路由沿用同一守卫链：`sameOrigin` + `adminEnabled` + `isAdmin`，统一 `{ok, error}` 中文错误。

| 条目 | 用户故事 / 动机 | 详细需求（交互与文案） | 验收标准 |
|---|---|---|---|
| M3-1 编辑 / 撤回已发送的回复 | 「回复里写错了版本号，只能去 GitHub 网页改 md。」 | ① `POST /api/admin/update` 扩展 action `"remove-last-reply"`（body `{id, action}`，无轮可撤 400「暂无可撤回的回复」）：移除「## 开发者回复」最后一轮 `### …` 小节；撤空后该分区恢复占位「（暂无）」；status 回退默认规则（见 §6 待确认 3）：当前为 `replied` 且撤空 → 回退 `submitted`，其余状态不动（操作者可在 UI 另行指定）；`updated_at` 必更（归档 02 §6.4 硬约定）；commit message `admin: 撤回回复 {id}`。② `POST /api/admin/update` 扩展 action `"edit-last-reply"`（body `{id, action, text}`，无轮可编辑 400 同上）：单次写入完成「移除最后一轮 + 以**原轮次时间戳**写回编辑后文本」（编辑视为修正内容而非新回复，不生成新时间戳）；status 不动；`updated_at` 必更；text 经 `cleanUserText` 转义、≤2000 字（与 update 的 reply 校验一致）；commit message `admin: 编辑回复 {id}`。③ `markdown-utils.ts` 新增纯函数 `removeLastDeveloperReply(raw)`（复用 `extractReplyRounds` 的分区定位；编辑 = 移除最后一轮后以原轮次时间戳 `appendDeveloperReply` 写回）。④ `/admin` UI：展开区新增「编辑回复」「撤回复」按钮（有回复轮次时才显示）；编辑为 textarea 预填最后一轮原文；撤回弹确认「撤回后用户将看不到这轮回复，确定？」 | - [ ] 撤回后详情页少最后一轮；全部撤空时显示既有空态文案「开发者还没有回复。…」<br>- [ ] 默认规则生效：replied 撤空 → submitted；resolved 等状态不被自动改<br>- [ ] 编辑保留原时间戳、内容更新、`#` 行首转义生效<br>- [ ] `removeLastDeveloperReply` 单测：多轮 / 单轮 / 无轮（幂等不崩）<br>- [ ] 未登录调用扩展 action 均 401「请先登录」 |
| M3-2 批量改状态 | 「清理一批垃圾反馈要逐条保存 20 次。」 | ① 新增 `POST /api/admin/bulk-status`（body `{ids: string[], status}`）：`ids ≤ 50`，逐条校验 `ID_PATTERN` 与 `STATUS_VALUES`；逐条独立执行「读最新 → `setFrontmatterField(status)` + `setFrontmatterField(updated_at)` → PUT（`withConflictRetry`）」，p-limit(3) 并发；单条失败不中断整批；响应 `{ok: true, results: [{id, ok: true} | {id, ok: false, error}]}`（部分失败也 200，02-design.md §7.3 唯一口径）。② `status: "duplicate"` 需配 `duplicate_of`（归档 02 §2.2 硬约定），批量入口不提供填写 → UI 中 duplicate 选项置灰，提示「标记重复请在单条操作中填写指向编号」。③ `/admin` 列表加复选框 + 顶部批量条：「已选 n 条」+ 状态下拉 + 「批量修改」按钮，二次确认文案「将 n 条改为「{状态中文}」？」；完成后按 `results` 逐条 ok 分色提示并刷新列表 | - [ ] 勾选 3 条改 wontfix：3 条 status 与 updated_at 均更新，列表徽章变更<br>- [ ] 混入 1 条不存在 id：该条在 `results` 中 `ok:false` 带 error、其余成功<br>- [ ] duplicate 在批量下拉中不可选<br>- [ ] ids >50 → 400「一次最多处理 50 条」<br>- [ ] 未登录 401 |
| M3-3 删除反馈 | 「垃圾反馈光隐藏不够，希望连 md 和附件一起彻底删掉，不用再开 GitHub 网页。」（todo：当前删除仍走 GitHub 网页） | ① 新增 `DELETE /api/admin/delete`（带 JSON body `{id, confirm}`）：`confirm` 必须与 `id` **完全相等**，否则 400「请输入完整编号以确认删除」。② 删除顺序（先附件后 md，保证不产生「有 md 无附件」死链）：`GET feedback/{id}.md` 确认存在 → `githubListDir("feedback/assets/{id}")` 逐附件 `githubGetFileMeta` 取 sha → `githubDeleteFile`（p-limit(3)，404 视为已删）→ 最后删 md；附件部分失败则**不删 md** 并返回 failed 清单；commit message `admin: 删除 {id}`。③ `/admin` 展开区加「删除反馈」红色按钮 → 弹窗内含输入框（非仅按钮）要求输入完整编号，文案「删除后无法恢复，附件将一并删除」 | - [ ] 删除后 `feedback/{id}.md` 与 `feedback/assets/{id}/` 全部文件消失，详情页 404<br>- [ ] confirm 与 id 不一致 → 400，不执行任何删除<br>- [ ] 构造附件删除失败：md 保留、响应含失败清单<br>- [ ] 未登录 401 |

### M4 互动（投票）

| 条目 | 用户故事 / 动机 | 详细需求（交互与文案） | 验收标准 |
|---|---|---|---|
| M4-1 「+1 我也遇到 / 我想要」投票 | 「同一个白屏问题七八个人都遇到了，但我只能看到一条反馈；功能需求有没有人要也无从判断。」（todo：+1 聚合投票；duplicate_of 已部分承接合并语义） | ① schema【v0.1.1 演进】：frontmatter 新增 `affects`（正整数，默认 0；两条路径通用：问题路径=「我也遇到」计数、功能路径=「我想要」计数）。存储为 YAML 裸数字 `affects: 3`（不加引号，与 `archived` 裸布尔同一口径——归档 02 §1「除 `archived` 外一律双引号字符串」约定的第二个例外，02-design.md §1.1 已显式声明）；读取经归一化（缺省 0，NaN / 负数回退 0）；`FeedbackFrontmatter`（src/types/feedback.ts）增补 `affects?: number`。旧文件不迁移，首次投票时由 markdown-utils 惰性写入（`status:` 行之后插入新行；新增 `setFrontmatterIntField` 支持字段不存在时插入）。② 投票**不更新** `updated_at`（避免热门反馈把回信区 / 列表反复顶起）；commit message `vote: {id} → {n}`。③ 新增 `POST /api/vote`（body `{id}`）：`sameOrigin` + `ID_PATTERN` 校验 + IP 限频 key `vote:{ip}:{id}`（1 次/小时，走 M2 限流抽象）→ 读 md → affects+1 → `withConflictRetry` PUT；`hidden` 条目按 404；成功 `{ok: true, affects: n}`；超频 429「感谢支持，同一反馈 1 小时内只能助力一次」。④ 前端详情页（/issue/[id]）正文区末尾按钮：问题路径「我也遇到（N）」/ 功能路径「我想要（N）」（N 初始取 affects，缺省 0）；点击乐观 +1 并禁用，成功后文案「已记录，谢谢反馈」；失败回滚并提示；localStorage 键 `aisc:voted:{id}` 客户端预置灰（服务端限频为准）。⑤ 管理页列表增加「影响」列（affects 值，缺省 0），供人工排序参考。⑥ **去重不精确声明（文档明示）**：按（IP, 反馈）每小时 1 次的粗粒度限频去重——同一人换网络 / 换 IP 或间隔 1 小时仍可重复投票；`affects` 是「去重不严格的影响面参考值」，不作为承诺性指标。此声明写入本文与 02-design.md，页面不加免责文案（保持界面简洁） | - [ ] 问题路径详情页显示「我也遇到（N）」、功能路径显示「我想要（N）」，初始 N 取 affects（缺省 0）<br>- [ ] 投票一次后 frontmatter 出现 `affects: N`（YAML 裸数字，不加引号）且 +1 正确；ISR 刷新后计数持久<br>- [ ] 同 IP 对同一条 1 小时内第二次 → 429 中文文案；对另一条不受影响<br>- [ ] 投票不改变 `updated_at`（回信区排序不动）<br>- [ ] 读取兼容旧文件（无字段→0）与脏数据（非数字→0）单测通过<br>- [ ] hidden 条目投票 → 404 |

---

| M5-1 文案精简（基线演进 R4） | 「页面上承诺类的话太多，不像个工具。」（todo：去掉「1 分钟提交…3 个工作日内回复」之类内容） | ① 移除：Hero 副标题「1 分钟提交，开发者会回复。」、Hero SLA 小字、首页回信区空态与详情页空回信文案中的 SLA 句、成功页页尾 SLA、页脚行 2 尾部 SLA 句、metadata description 中 SLA 句。② 空态替换（不含任何时限承诺）：回信区空态「还没有回复，过几天再来看看。」；详情页空回信「开发者还没有回复，过几天再来看看。」③ constants.ts 的 SLA_TEXT/EMPTY_REPLY_TEXT/NO_REPLY_DETAIL_TEXT 同步调整；**CLAUDE.md「空态文案」约定修订为「空态文案不含时限承诺」** | - [ ] 全站（首页/表单/成功页/详情页/页脚/metadata）grep 不到「1 分钟提交」与「3 个工作日」<br>- [ ] 空态仍保留一句无承诺的引导文案<br>- [ ] CLAUDE.md 已同步修订 |
| M5-2 查询增强 | 「编号记不全就查不了了。」（todo：按编号查询增加模糊查询、按日期筛选） | ① 首页「按编号查询」输入不匹配完整编号格式时不再报错，改为跳转 `/issues?q={输入}` 进入关键词搜索（完整编号仍直达详情页）；② /issues 列表页新增提交日期区间筛选（两个 date 输入，按 created_at 过滤）与关键词搜索联动，支持 URL 参数 `?q=&from=&to=` 直达筛选态 | - [ ] 首页输入「闪退」回车 → /issues?q=闪退 且列表过滤出标题含「闪退」的条目<br>- [ ] 输入完整编号 → 仍直达详情页<br>- [ ] 日期区间筛选正确（含边界日）<br>- [ ] 带 q/from/to 的 URL 直接打开即为筛选态 |

## 4. 非目标清单（本轮不做）

- **邮件 / 微信通知的实现**（GATED，见 §2 R2；本期仅设计预案与环境变量占位）。
- **多产品 UI 与数据分流**（仅参数化就绪，见 §2 R3；无表单选择器、无分产品列表）。
- **完整统计 / 数据看板**（趋势图、导出、分类型占比等；首页仍为三个聚合数字）。
- **账号体系 / 登录 / 用户主页**（v1 即非目标，维持无 cookie 会话形态；admin 的 ADMIN_TOKEN 门禁除外）。
- **反作弊强化**（浏览器指纹、强制人机验证、投票精确去重；M4 明示接受不精确）。
- **附件独立管理**（单独删除某张截图 / 某个日志；仅随 M3-3 整条删除）。
- **回复多轮任意编辑**（仅最后一轮编辑 / 撤回，历史轮次不可改，与归档 02 §6.1「不删除、不修改历史轮次」约定一致）。
- **投票之外的互动**（评论、追评、关注）。
- **通知退订流程、邮件模板系统**（依赖 R2 GATED 拍板）。
- 上述两条新增 todo 条目已纳入 M5（R4 文案基线演进 + 查询增强），不再挂起。

---

## 5. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| Turnstile 大陆可达性（challenges.cloudflare.com 加载不稳） | 开启后人机验证在大陆不可用，可能挡住真实用户 | 默认关闭；开启后懒加载 + 前端 10s 超时失败降级放行 + 服务端缺 token 放行并告警日志（可观察降级率再决策回退）；基线「零墙外依赖」仅在显式开启时突破（归档 03 §9 已预留该例外） |
| Vercel Cron 在 Hobby 计划的限制与配额 | Hobby 计划 cron 最低频率为每日一次、上限 2 个 cron，且每次触发计入函数调用 | 清理任务按「每日一次」设计正好合规；单次执行配额消耗极小（1 次列目录 + 少量删除调用）；若配额或频率受限，备选方案为 GitHub Actions schedule（PAT 权限不变，无需新增）；`CRON_SECRET` 未配置时端点自禁用（404），不产生未鉴权删除面 |
| Trees API 权限与行为差异 | Trees 属 Git Data API，需确认现有 PAT 可用 | fine-grained PAT 的 `Contents: Read and write` 权限已覆盖 `GET /git/trees` 读取，**无需新增权限**；根树无 `feedback` 目录 → 返回空列表；Trees 调用 403/404/异常或 `truncated === true` → 抛错由 `fetchSummaries` 回退现有 Contents 列目录（02-design.md §4.2） |
| 批量 / 删除操作的 GitHub API 配额消耗 | batch-status ≤50 条 ×（读+写）、delete 逐附件 DELETE，均按次计配额（认证 5000 次/小时） | 单批上限 50；p-limit(3) 并发；遇 403 secondary rate limit 指数退避重试并以中文报错；管理操作为低频人工行为，实际风险低 |
| `affects` 与旧数据 / 旧读取器兼容 | 旧文件无字段、脏数据非数字、v0.1.0 工具读到未知字段 | 读取缺省 0、NaN/负数回退 0；仅投票时惰性写入，无迁移脚本；`parseFeedback` 不校验未知字段，v0.1.0 读取器天然兼容；存储用 YAML 裸数字（js-yaml `JSON_SCHEMA` 解析为 number），读取层归一化容错 |
| 分片进度显示失真 | XHR `onprogress` 含 multipart 开销；极慢网络下 EMA 速度趋 0 引起困惑 | 开销按近似值不修正（误差 <1%）；样本 <2s 不显示速度与剩余时间 |
| 投票计数被刷高 | 限频仅（IP, id）/小时，可换 IP 刷 | 接受不精确并已在文档明示（§3 M4-1⑥）；后续如需收紧可叠加 Turnstile token（M2 已备）而不改 schema |

---

## 6. 待确认点（不阻塞 M1–M4 开工）

> ⚠️ 待确认 1（R2 GATED 的拍板入口）：是否恢复「可选邮箱采集（仅用于通知、明示用途）」以解锁回复送达通知？用户拍板前，邮件通知仅停留在 02 文档设计预案，不实现任何采集与发送代码。

✅ ~~待确认 2~~ **已拍板（2026-09-22）**：用户明示「docs/todo.md 即 v0.1.1 开发目标」，新增两条纳入本期 **M5 文案与查询优化**——① 文案精简按 R4 基线演进执行（M5-1，CLAUDE.md 同步修订）；② 模糊查询 + 日期筛选（M5-2，落在 /issues 列表页与首页编号查询联动）。原「与 CLAUDE.md 空态文案约定冲突」的标注就此解除：CLAUDE.md 属 M5-1 交付的同步修订对象。

> ⚠️ 待确认 3：M3-1 撤回回复后的状态回退默认规则（当前 `replied` 且撤空 → 回退 `submitted`，其余状态不动）为本文补充约定；如希望其他策略（如一律保持原状态、或撤回必回 `submitted`），请明示，否则按默认规则执行。

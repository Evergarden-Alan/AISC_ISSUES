# 03 任务分解与实施顺序（v0.1.1）

> 读者：AI 编码代理与开发者。本文把 01-scope.md 的范围裁决与 02-design.md 的设计落成可执行的任务分解、实施顺序、测试策略与发布回滚方案。与 v0.1.0 冻结基线冲突处一律显式标注「v0.1.1 演进」并说明兼容性；基线以 CLAUDE.md 与 docs/archive/v0.1.0/ 为准，不改归档文档。

## 0. 前置与引用约定

- 依赖文档：`01-scope.md`（范围与里程碑裁决）、`02-design.md`（设计，§11 为测试策略）；冻结基线 `docs/archive/v0.1.0/02-data-model.md`（下称 02 §n）、`03-architecture.md`（下称 03 §n）；工程约定见根目录 CLAUDE.md 与 develop_wiki.md。
- 任务编号 `T{n}.{k}`：里程碑 n 内第 k 个任务。「涉及文件」相对项目根，标注（新增）/（修改）。
- 现状锚点（任务描述均以此为基准）：上传客户端 `src/lib/upload-client.ts`（fetch 实现，`uploadLargeFile(file, onProgress?(done, total))`，分片 3.5MB）；附件落盘 `src/app/api/attachment/route.ts`（`ref = _pending/{uuid|uploadId}/{安全化名}`，finalize 合并分片）；目录枚举 `src/lib/github-client.ts::githubListDir` → `src/lib/data.ts::fetchSummaries`；限流 `src/lib/rate-limit.ts`（内存 Map：`hitRateLimit` 5 次/小时 + 60s 冷却、`hitUploadLimit` 20 次/小时、`checkIdempotency/finishIdempotency`）；管理写入口 `src/app/api/admin/update/route.ts`（单条 `{id, status?, reply?}`，`withConflictRetry` + `setFrontmatterField`/`appendDeveloperReply`）；frontmatter 改值 `src/lib/markdown-utils.ts::setFrontmatterField`（仅替换已存在字段，不新增）。
- v0.1.1 三处数据面演进（01-scope 已裁决，均为向后兼容）：
  1. **affects 字段**：frontmatter 新增 `affects`（正整数，默认 0，问题/功能两路径通用的「+1」计数）。旧文件读取缺省 0，无需迁移；首次投票时惰性写入数值**不带引号**——这是 02 §1「除 `archived` 外一律双引号字符串」约定的第二个例外（02-design §1.1 已显式声明）；创建反馈时模板不写入该字段（renderFeedbackMarkdown 零改动）。
  2. **_pending 日期化**：新上传目录名为 `feedback/assets/_pending/{YYYYMMDD-HHmmss}-{uuid4}/`（北京时间，与 id 时间段同格式；客户端 `makeUploadId()` 生成，服务端直传回退分支同样加前缀，01-scope M1-2 ①）。旧形态 `_pending/{uuid}/` 只出不进；`src/lib/attachments.ts` 的 `PENDING_REF_PATTERN` 两形态均放行（过渡期兼容在途引用）。
  3. **目录枚举改 Git Trees API**：解除 03 附录·待确认 2 标注的「Contents 列目录约 1000 条截断」风险；失败自动回退 `githubListDir`（03 附录·待确认 2 的既定升级路径落地）。

> ✅ 已对齐（原待确认 1）：本文对 01-scope.md / 02-design.md 的引用（M{n}-{k} 条目、R2/R3 裁决、02-design §1.1/§3.2/§5.1/§5.3/§5.4/§6.2/§7.1/§7.2/§7.3/§7.4/§8.1/§8.2/§9/§11 等）已在一致性校验中逐一核对对齐；后续任一文档改动须同步保持引用一致。

## 1. 里程碑任务分解

### M1 体验与稳健性（01-scope M1：上传进度 / _pending 清理 / Trees 读取）

| 任务 | 做什么 | 依赖 | 涉及文件 | 验收点 |
|---|---|---|---|---|
| T1.1 上传进度细化 | `upload-client.ts` 的 `postForm` 由 fetch 实现整体改为 XHR 封装 `postFormXhr(fd, onProgress?)`（`xhr.upload.onprogress` 取 `e.loaded/e.total`，响应仍解析 JSON；直传 / 分片 / finalize 全部表单提交统一走 XHR，02-design §2.1）；进度回调形状为 `UploadProgress {loaded, total, percent, bytesPerSecond, etaSeconds}`，分片跨片进度按字节聚合：`loaded = 已完成分片字节 + 当前片已传字节`、`total = file.size`（02-design §2.3 公式）；速度用指数滑动平均（EMA，α=0.3）平滑，样本 <2s 速度置 0。进度计算与格式化抽纯函数 `formatUploadProgress(p)`（落点 `upload-client.ts` 导出，**不新建 progress.ts**；KB/s、MB/s 中文文案）。前端 `attachment-uploader.tsx` 进度文案由「上传分片 x/y 片…」改为「上传中 45%（1.2 MB/s）」，截图直传（`screenshot-uploader.tsx`）用批次整体百分比 + `title` 悬停全量文案（02-design §2.3） | — | （修改）`src/lib/upload-client.ts`、`src/components/attachment-uploader.tsx`、`src/components/screenshot-uploader.tsx`；（新增）`tests/upload-progress.test.mjs` | 上传 20MB .zip（触发分片）进度 0%→100% 单调推进且显示速度；≤3.5MB 直传同样有百分比；失败重试提示不回退；`npm run test` 全绿 |
| T1.2 _pending 日期化 + Cron 自动清理 | ① `src/lib/upload-client.ts` 新增 `makeUploadId()` 返回 `{YYYYMMDD-HHmmss}-{uuid4}`（北京时间；直传随 FormData 携带 `uploadId`、分片沿用），`api/attachment/route.ts` 服务端 `crypto.randomUUID()` 回退分支同样加日期时间前缀，落盘目录为 `feedback/assets/_pending/{YYYYMMDD-HHmmss}-{uuid4}/{安全化名}`（`feedback.ts::relocateOne` 用 ref 原文拼路径，无需改动）；`PENDING_REF_PATTERN` 放行 `_pending/{YYYYMMDD-HHmmss}-{uuid}/` 与旧形态两种。② 新增清理路由 `GET /api/cron/cleanup`：`Authorization: Bearer ${CRON_SECRET}` 鉴权（`timingSafeEqual`，风格同 `admin.ts`；未配置或不匹配一律 404，不暴露端点存在，01-scope M1-2 ③）；列 `_pending` 下子目录，目录名匹配 `^\d{8}-\d{6}-[0-9a-f-]{36}$` 且日期时间距今 >7 天 → 逐文件 DELETE（列目录已含 sha，`p-limit(3)`）；旧形态裸 uuid 目录在运行日期 ≥ 2026-09-29（v0.1.0 上线日 + 7 天）时视为超龄一并删除，此前跳过并记日志。③ 新建 `vercel.json` 注册 cron（每日一次；【v0.1.1 演进】03-架构 §11 原定「无 cron、vercel.json 不需要创建」，此处打破，02-design §3.2 已标注） | T1.3（可复用树/列目录 helper，非硬依赖） | （修改）`src/app/api/attachment/route.ts`、`src/lib/attachments.ts`、`.env.example`；（新增）`src/app/api/cron/cleanup/route.ts`、`src/lib/pending-cleanup.ts`（纯函数：目录清单+截止日→待删清单）、`vercel.json`、`tests/pending-cleanup.test.mjs` | 新上传 ref 均含日期时间前缀；构造 8 天前目录清单时纯函数正确筛出、当日/7 天内不选；2026-09-29 前旧 uuid 目录跳过、其后视为超龄（有单测）；正确 CRON_SECRET 触发返回 `{ok, scanned, deletedDirs, deletedFiles, failed}`，错误/缺失一律 404；Vercel Settings→Cron Jobs 可见该任务 |
| T1.3 列表读取改 Git Trees API | `github-client.ts` 新增 `githubListFeedbackMdPaths(revalidate?)`（02-design §4.1 唯一口径，两步非递归）：① `GET /repos/{owner}/{repo}/git/trees/HEAD`（HEAD 解析为默认分支，免新增分支环境变量；fine-grained PAT 的 Contents: Read 权限覆盖 Git trees 端点）取根树；② 定位 `path==="feedback" && type==="tree"` 子树 sha → `GET /git/trees/{sha}`（recursive=0 仅列该层），过滤 `type==="blob"` 且以 `.md` 结尾，返回 `feedback/{path}` 清单（刻意不用 `?recursive=1`，防大仓库 `truncated:true` 与响应体积失控；调用数恒为 2、与条目量无关）。失败语义：403/404/网络异常或 `truncated===true` → 抛 `GitHubApiError`；根树无 feedback 目录 → 返回 `[]`。`data.ts::fetchSummaries` 的文件清单改为：`try githubListFeedbackMdPaths(REVALIDATE_SECONDS) catch → 回退 githubListDir("feedback")` 过滤 md，逐文件 GET 与 `p-limit(8)`、ISR 300s 不变；首页轻统计与列表口径不变 | — | （修改）`src/lib/github-client.ts`、`src/lib/data.ts`；（新增）`tests/github-tree.test.mjs` | 两步调用：根树含 assets 子树/无关文件时仅返回 feedback 直接子层 md（blob 过滤）；`truncated=true` 或 403/404 → 抛错并由 fetchSummaries 回退 `githubListDir`（mock 两态断言）；根树无 feedback 目录返回空列表；现有首页/列表/管理列表渲染与 v0.1.0 一致；03 附录·待确认 2 风险解除（目录枚举不再受约 1000 条截断） |

### M2 防滥用与限流（01-scope M2：Turnstile 默认关 / Upstash 精确限流）

| 任务 | 做什么 | 依赖 | 涉及文件 | 验收点 |
|---|---|---|---|---|
| T2.1 Turnstile 人机验证（默认关） | ① 新增 `src/lib/turnstile.ts`：`turnstileEnabled()`（三值齐备：`TURNSTILE_ENABLED==="true"` 且 `TURNSTILE_SECRET_KEY`、`TURNSTILE_SITE_KEY` 均非空，缺一整体关闭，02-design §5.1）、`verifyTurnstileToken(token, ip)`：POST `https://challenges.cloudflare.com/turnstile/v0/siteverify`（`AbortSignal.timeout(5000)`，no-store；防重放：校验成功后 token 记入已用集合（内存 Map TTL 10 分钟 / Upstash 启用时 Redis `SET NX EX 600`，重复按失败，01-scope M2-1 ⑤）；fail-closed：服务不可达按失败处理，文案「人机验证未通过，请刷新页面重试」）。② `api/feedback/route.ts` 在限频之后、`validateSubmission` 之前插入校验：读请求体字段 `turnstileToken`（validate.ts 白名单**无条件**增加可选 `turnstileToken: string（≤2048）`，开关判定在路由层——validate.ts 为纯函数不读 env，02-design §5.4）；开关开启但缺 token（前端降级场景）→ 放行并 console.warn `[turnstile] 缺 token 降级放行`；校验失败 400「人机验证未通过，请刷新页面重试」；开关关闭时零开销直过。③ `api/attachment/route.ts` 在 `readLimitedBody` + formData 解析之后、内容校验之前插桩同款校验（FormData 字段 `turnstileToken`，02-design §5.4 附件面）：开关开启且带 token → `verifyTurnstileToken`；缺 token（前端降级）→ 放行并 console.warn `[turnstile] 缺 token 降级放行`；校验失败 400「人机验证未通过，请刷新页面重试」；开关关闭时零开销直过。④ 前端 `/submit` 服务端组件读 `TURNSTILE_SITE_KEY` 经 props `siteKey` 下发（**不引入任何 NEXT_PUBLIC_ 变量**，02-design §5.3）；`feedback-form.tsx` 首次提交时动态注入 `turnstile-widget.tsx` 脚本（不常驻、不用 next/script 预载，01-scope M2-1 ②），拿 token 随请求体提交；脚本加载失败按降级口径不带 token 仍提交，绝不阻断，token 过期自动刷新 | — | （新增）`src/lib/turnstile.ts`、`src/components/turnstile-widget.tsx`、`tests/turnstile.test.mjs`；（修改）`src/app/api/feedback/route.ts`、`src/app/api/attachment/route.ts`、`src/components/feedback-form.tsx`、`.env.example`（注释更新） | 关态（默认）：全链路与现状一致，Network 面板无 cloudflare 请求（回归项）；开态：伪造 token / 重放 token 400「人机验证未通过，请刷新页面重试」、缺 token 降级放行且日志出现降级告警、siteverify mock 通过后正常入库；附件面（直传 / 分片 / finalize）同样携带 turnstileToken：`POST /api/attachment` 缺 token 降级放行、伪造 token 400（02-design §5.4）；`tests/turnstile.test.mjs` 覆盖 enabled 三值矩阵与 verify 成功/失败/重放 |
| T2.2 Upstash Redis 精确限流 | `rate-limit.ts` 重构为「Store 抽象 + 双后端」：`UPSTASH_REDIS_REST_URL/TOKEN` 均非空 → 裸 fetch 调 Upstash REST pipeline（不新增 npm 依赖），键设计（01-scope M2-2 ③ / 02-design §6.2 口径）：`rl:{ip}`（INCR + PEXPIRE NX 3600000）、`rl:cd:{ip}`（SET NX PX 60000）、`rl:up:{ip}`、幂等键 `idem:{key}`（TTL 15 分钟，`checkIdempotency/finishIdempotency` 跨实例精确化，故障降级内存）；单请求 `AbortSignal.timeout(500)`，任何异常（网络/非 2xx/超时）→ `console.error("[rate-limit] Redis 降级")` 并走既有内存 Map 路径（行为=v0.1.0）。两后端判定/降级逻辑抽纯函数便于注入 mock fetch 测试 | — | （修改）`src/lib/rate-limit.ts`、`.env.example`（注释更新）；（新增）`tests/rate-limit-upstash.test.mjs` | 无 UPSTASH_*：现有 `tests/rate-limit.test.mjs` 全绿（行为不变）；有配置：mock 断言 pipeline 请求体与计数递增；mock 抛错/超时：自动回退内存且放行判定正确；冷却与小时窗翻转语义两后端一致 |

### M3 管理页增强（01-scope M3：编辑/撤回回复 / 批量改状态 / 删除反馈）

现状锚点：`/api/admin/update` 仅支持单条 `{id, status?, reply?}`；管理页 `src/app/admin/page.tsx` 的 `AdminItem/DraftRow/save()` 即改造基线。

| 任务 | 做什么 | 依赖 | 涉及文件 | 验收点 |
|---|---|---|---|---|
| T3.1 编辑/撤回已发送回复 | ① `markdown-utils.ts` 新增 `removeLastDeveloperReply(raw)`（02-design §7.1）：定位「## 开发者回复」分区移除最后一个 `### ` 小节（仅最后一轮可编辑/撤回，01-scope 非目标「多轮任意编辑」不动摇），删空后恢复「（暂无）」占位，返回被移除轮次（time/text）供编辑复用原时间戳；不触碰 frontmatter（含 `affects` 行）。② `/api/admin/update` 扩展 action 形态（02-design §7.2）：`{id, action:"remove-last-reply"\|"edit-last-reply", text?}`（action 出现时忽略 `reply`，两者互斥）；编辑 = 移除最后一轮 + `appendDeveloperReply` 以**原轮次时间戳**写回（`cleanUserText` 清洗，≤2000 字）；撤空且 status==="replied" → 自动回退 submitted（01-scope M3-1 默认规则），其余状态不动；同次写必须 `setFrontmatterField(raw,"updated_at",…)`（02 §6.4 硬约定），沿用 `withConflictRetry` 重读 sha。③ `admin/page.tsx` 行内展开「回复管理」：最后一轮原文回填编辑框 + 撤回按钮（确认文案「撤回后用户将看不到这轮回复，确定？」），无回复轮时按钮禁用（管理列表已含回复摘要可判空） | — | （修改）`src/lib/markdown-utils.ts`、`src/app/api/admin/update/route.ts`、`src/app/admin/page.tsx`；（新增）`tests/reply-edit.test.mjs` | 编辑最后一轮仅该轮变化、其余轮次与时间戳不动；撤回唯一一轮后正文回「（暂无）」、replied 撤空自动回退 submitted、回信区该条 ≤5 分钟（ISR）不再收录；无轮可编辑/撤回 400；未登录/无 cookie 401 |
| T3.2 批量改状态 | 新增 `POST /api/admin/bulk-status`（body `{ids: string[], status}`，02-design §7.3）：`ids` 1–50（超限 400「一次最多处理 50 条」，01-scope M3-2 口径）；`duplicate` 禁止批量（必须单条配 `duplicate_of`，返回中文提示）；逐条走与单条相同的 `withConflictRetry` 写路径（`p-limit(3)`），部分失败不中断，响应 `{ok:true, results:[{id, ok, error?}]}`。管理页列表加复选框 + 批量操作栏（状态选择、执行、结果摘要「成功 n / 失败 m」） | — | （新增）`src/app/api/admin/bulk-status/route.ts`；（修改）`src/app/admin/page.tsx` | 3 条批改 resolved 后逐条 `updated_at` 同步更新、结果数组逐条正确；含不存在 id 时该条 error 其余成功；ids>50 与 duplicate 批量被拒；未登录 401 |
| T3.3 删除反馈 | 新增 `DELETE /api/admin/delete`（带 JSON body `{id, confirm}`，02-design §7.4）：`confirm` 必须与 `id` 完全相等，否则 400「请输入完整编号以确认删除」（01-scope M3-3）；先列 `feedback/assets/{id}/`（`githubListDir` 列表自带 sha）→ `p-limit(3)` 逐文件 DELETE（404 视为已删）→ 附件全部成功后最后删 `feedback/{id}.md`（sha 经 `githubGetFileMeta`）；附件删失败时返回部分成功明细且 md 保留（md 是存在性锚点，可重试）。管理页删除按钮 Dialog 显示「将同时删除 N 个附件，不可恢复（Git 历史可找回）」，要求完整输入编号确认（输入值 === id 才激活） | 可复用 T1.3（非硬依赖） | （新增）`src/app/api/admin/delete/route.ts`；（修改）`src/app/admin/page.tsx` | 删除后详情页 404、`/api/asset` 404、列表 ≤5 分钟消失；GitHub 仓库 `feedback/{id}.md` 与 `feedback/assets/{id}/` 均消失；附件部分失败时 md 未被误删且可重试；confirm 与 id 不一致 400 不执行 |

### M4 互动（01-scope M4：「+1 我也遇到 / 我想要」聚合投票）

| 任务 | 做什么 | 依赖 | 涉及文件 | 验收点 |
|---|---|---|---|---|
| T4.1 affects schema 与展示 | `src/types/feedback.ts::FeedbackFrontmatter` 增 `affects?: number`（缺省视 0）；`markdown-utils.ts` 新增 `affectsOf(fm)` 归一化（非数字/缺省按 0），**`renderFeedbackMarkdown` 模板零改动（创建时不写入，02-design §1.1 惰性写入）**；`data.ts` 的 `SummaryItem/ListItem` 增 `affects`（数据层预留，列表 UI 不展示——02-design §8.2）；`/issue/[id]/page.tsx` 详情把 `affectsOf(fm)` 传给投票按钮（T4.3）；管理页列表加「影响」列（affects 值，缺省 0，01-scope M4-1 ⑤） | — | （修改）`src/types/feedback.ts`、`src/lib/markdown-utils.ts`、`src/lib/data.ts`、`src/app/issue/[id]/page.tsx`、`src/app/admin/page.tsx` | 旧文件（无 affects）全站正常按 0 展示；新提交文件 frontmatter 不含 affects 行（首投后才出现）；两路径计数文案正确；现有 markdown-utils 单测全绿（渲染断言不变） |
| T4.2 投票 API | 新增 `POST /api/vote`：body `{id}`；`sameOrigin` → `rate-limit.ts` 新增 `hitVoteLimit(ip, id)`（同（IP, 反馈）1 次/小时，键 `vote:{ip}:{id}`，02-design §6.2；按 IP 粗粒度去重，01-scope 已明示接受少量重复不精确）→ `ID_PATTERN` → GET md（404/hidden 均 404）→ `affects = min(affectsOf(fm) + 1, 999999)` → `markdown-utils.ts` 新增 `setFrontmatterIntField(raw,"affects",n)`（与 `setFrontmatterField` 的关键差异：整型裸数字写入，字段不存在时在 `status:` 行后**插入**该行——兼容存量无 affects 的文件，02-design §1.1）→ `withConflictRetry` PUT。**不更新 updated_at**（见待确认 3） | T4.1 | （新增）`src/app/api/vote/route.ts`、`tests/vote.test.mjs`；（修改）`src/lib/rate-limit.ts`、`src/lib/markdown-utils.ts` | 投票后 affects+1 且 updated_at 不变；同（IP, 反馈）1 小时内二次 429「感谢支持，同一反馈 1 小时内只能助力一次」（另一条不受影响）；hidden 404；存量文件首投 0→1；幂等重试与冲突重掷正确（单测注入 now） |
| T4.3 投票前端 | `/issue/[id]` 详情页正文区末尾加「我也遇到（N）」（issue）/「我想要（N）」（feature）按钮（01-scope M4-1 ④；仅详情页，列表不加——02-design §8.2）：点击乐观 +1，失败回滚并提示；localStorage 键 `aisc:voted:{id}` 仅用于按钮置灰提示（服务端不依赖它判定） | T4.1、T4.2 | （修改）`src/app/issue/[id]/page.tsx`（或 `issue-detail-body.tsx`）；（新增）`src/components/vote-button.tsx`（02-design §8.1） | 投票后按钮计数 +1（详情页即时，ISR 刷新后持久）；429 提示正确不重复计数；微信内置浏览器可点（§3.3 回归项） |

### 附：裁剪与 GATED 项（01-scope 裁剪/GATED 裁决，不产出用户可见功能）

| 任务 | 做什么 | 依赖 | 涉及文件 | 验收点 |
|---|---|---|---|---|
| T5.1 多产品参数化就绪（最小收口改造） | 按 01-scope §2 R3 / 02-design §1.4 执行：① `constants.ts` 将 `PRODUCT_ID` 升级为 `PRODUCT_IDS: readonly string[]`（当前仅含 `"aisc-issues"`）+ 派生 `CURRENT_PRODUCT = PRODUCT_IDS[0]`，全代码引用改指 `CURRENT_PRODUCT`（`PRODUCT_IDS` 此前仅存在于归档 02 §1 TS 草图、从未落码）；② 新增收口函数 `feedbackPath(id)` → `feedback/${id}.md`、`assetsPath(id)` → `feedback/assets/${id}`（落点 `constants.ts`），替换 `feedback.ts`、`data.ts`、`api/attachment`、`api/asset`、`api/admin/update` 中两类路径的模板串散点（`_pending` 路径与 md 正文链接不动）；③ `renderFeedbackMarkdown` 保持无产品分支。**不做 UI、不加第二款产品** | 建议 T1.3 后顺手做 | （修改）`src/lib/constants.ts`；（修改，视散点清点）`src/lib/data.ts`、`src/lib/feedback.ts`、`src/app/api/attachment/route.ts`、`src/app/api/asset/route.ts`、`src/app/api/admin/update/route.ts` | `grep -rn "feedback/" src/lib src/app` 清点：仓库 API 路径散点均经 `feedbackPath`/`assetsPath` 收口（`_pending` 与正文链接除外）；`PRODUCT_IDS` 含且仅含 `aisc-issues`，无任何功能与 UI 变化；现有单测全绿 |
| G5 邮件通知预案（GATED，不实现） | 只落 02-design §9 通知预案：恢复可选邮箱的产品决策项、`RESEND_API_KEY`/`NOTIFY_FROM` 用途、大陆可达性评估；代码零改动 | 用户决策（待确认 5） | （修改）`.env.example`（注释占位，标「GATED：勿配置」） | 无实现代码合入；`.env.example` 出现被注释的 GATED 段 |

## 2. 实施顺序

总原则：先纯函数与单测 → API → 前端 → Cron → 开关类 feature flag 最后开启。

1. **纯函数与单测**（每步完成即补测、`npm run test` 全绿再进下一步）：`upload-client.ts` 纯函数（T1.1：`makeUploadId`、`formatUploadProgress`、UploadProgress 计算）→ `pending-cleanup.ts` 与 `githubListFeedbackMdPaths`（T1.2/T1.3）→ `markdown-utils.ts` 扩展（T4.1 `affectsOf` 容错、`setFrontmatterIntField`；T3.1 `removeLastDeveloperReply`）→ `rate-limit.ts` Store 抽象 + `hitVoteLimit`（T2.2/T4.2）→ `turnstile.ts` 判定纯函数（T2.1）。
2. **API 层**：`/api/vote`（T4.2）→ `/api/admin/update` 扩展（T3.1）→ `/api/admin/bulk-status`（T3.2）→ `/api/admin/delete`（T3.3）→ `/api/attachment` 日期化（T1.2①）→ `/api/feedback` Turnstile 插桩（T2.1，默认关）→ `/api/cron/cleanup`（T1.2②）。
3. **前端**：上传进度（T1.1）→ 投票按钮（T4.3）→ 管理页 UI（T3.1/T3.2/T3.3）→ Turnstile 挂载（T2.1，默认不渲染）。
4. **Cron 合入**：`vercel.json` 提交 + Vercel 配 `CRON_SECRET`；先 Preview 环境 curl 手动触发验证，再观察 Production（§4/§5）。
5. **开关类最后开启**：`UPSTASH_*` 先配（有内存回退，风险低，观察 24h 降级日志）→ `TURNSTILE_ENABLED` 最后按 §5 灰度开启。
6. 依赖图：T1.3 → T1.2（树 helper 可选复用）；T4.1 → T4.2 → T4.3；T3.3 软依赖 T1.3；T2.1/T2.2 与其余任务无耦合，可并行穿插。

## 3. 测试策略（新增单测对应 02-design §11）

### 3.1 现有 55 项单测必须保持全绿
- 存量：`tests/{attachments, constants, id, markdown-utils, rate-limit, token, validate}.test.mjs` 共 7 文件 55 项（`npm run test` = `node --test --experimental-strip-types tests/`）。
- 波及点同步（改用例不改行为）：`validate.test.mjs` 增补新形态 `_pending/{YYYYMMDD-HHmmss}-{uuid}/` ref 用例（旧形态用例保留＝过渡兼容断言）；`markdown-utils.test.mjs` 渲染断言不变（创建模板零改动、不写 affects）；`rate-limit.test.mjs` 语义不变（内存路径为默认路径继续生效）。

### 3.2 新增单测清单
| 新增文件 | 任务 | 核心断言 |
|---|---|---|
| `tests/upload-progress.test.mjs` | T1.1 | percent 边界（0 与 100）、`formatUploadProgress` 进位（999 KB/s / 1.2 MB/s）、速度为 0 仅显示百分比、EMA 平滑（α=0.3）与样本 <2s 不显示速度、分片跨片按字节聚合进度公式（02-design §11 同口径） |
| `tests/pending-cleanup.test.mjs` | T1.2 | 截止筛选（8 天前选删、7 天内与当日保留）、非法目录名跳过、空清单安全返回、2026-09-29 前后旧 uuid 目录两态 |
| `tests/github-tree.test.mjs` | T1.3 | 两步路径拼装（根树定位 feedback 子树 sha → 子树列层）、blob 过滤仅取 feedback 直接子层 md（排除 `assets/` 子树）、`truncated=true`→抛错回退信号、403/404→抛错回退、根树无 feedback→[]（02-design §4.1/§11 同口径） |
| `tests/turnstile.test.mjs` | T2.1 | `turnstileEnabled()` 三值矩阵（开关关/开但缺密钥/全配）、verify 成功/失败/重放/超时（mock fetch） |
| `tests/rate-limit-upstash.test.mjs` | T2.2 | 有配置走 REST pipeline（断言 URL 与命令体）、异常/超时自动回退内存、冷却与小时窗语义两后端一致 |
| `tests/reply-edit.test.mjs` | T3.1 | 移除最后一轮（单轮/多轮/无轮幂等不崩）、编辑保留原轮次时间戳、删空恢复「（暂无）」、正文 `#` 标题注入被转义、不触碰 frontmatter（含 affects 行） |
| `tests/vote.test.mjs` | T4.2 | 0→1 递增、缺省容错、999999 封顶、hidden 拒绝、同（IP, 反馈）1/h 第二次拒绝、换一条不受影响（注入 now）、updated_at 保持不变 |

### 3.3 手动验收清单
1. 微信内置浏览器回归：双路径各提交一条（含 20MB .zip 分片附件，核对百分比 + 速度文案）→ 成功页 → 详情页 → +1 投票。
2. Turnstile 开/关两态：关（默认）Network 面板无任何 cloudflare 请求且提交成功；开（Preview）伪造/重放 token 400、缺 token 降级放行、通过后成功、token 过期可重新挑战。
3. Upstash 有/无两态：本地 `.env.local` 配置/留空各跑一次提交与限频触发（连续提交验证 429 文案与 v0.1.0 一致）。
4. 批量操作配额：管理页一次批改 50 条成功；第 51 条被拒；观察 Vercel 日志无 GitHub API 429（Contents 写配额 5000/h）。
5. Cron：`curl -H "Authorization: Bearer <CRON_SECRET>" https://<域名>/api/cron/cleanup` 手动触发返回 `{ok, scanned, deletedDirs, deletedFiles, failed}`；错误 secret 与未配置环境均 404；Vercel Settings→Cron Jobs 可见。
6. 删除反馈三处 404：`/issue/{id}`、`/api/asset?path=feedback/assets/{id}/…`、列表页（ISR ≤5 分钟后）。
7. 编辑/撤回回复：管理页编辑第 2 轮 → 详情页对应轮更新；撤回唯一轮 → 回信区该条 ≤5 分钟消失。
8. 投票双文案与去重：问题「我也遇到（N）」/ 功能「我想要（N）」；同（IP, 反馈）二次投票 429 提示且计数不涨，另一条不受影响。
9. 上线后 24h 观察项：Turnstile 400 率、Upstash 降级日志条数、cron 执行记录、GitHub API 用量（Vercel Functions 日志）。

## 4. 环境变量与配置变更清单

### 4.1 .env.example 增量
新增/调整注释如下（既有 `TURNSTILE_*`、`UPSTASH_*`、`ADMIN_TOKEN` 键名不变，只更新注释）：

```
# v0.1.1 新增：cron 清理 _pending 的鉴权密钥（openssl rand -hex 32）
# 不配置则 /api/cron/cleanup 停用（404）＝仅失去自动清理，其余功能不受影响
CRON_SECRET=

# ===== GATED（v0.1.1 仅预案不实现；用户确认邮箱采集决策前勿配置）=====
# RESEND_API_KEY=
# NOTIFY_FROM=
```

- `TURNSTILE_*` 注释更新为：「v0.1.1 已实现。开启＝加载 Cloudflare 墙外脚本，属安全红线例外，须用户确认后按 docs/plans/v0.1.1/03-tasks.md §5 灰度开启」。
- `UPSTASH_*` 注释更新为：「v0.1.1 已实现。留空＝自动回退函数内存限流（v0.1.0 行为）」。

### 4.2 Vercel 配置步骤
1. 新增仓库根 `vercel.json`（随 T1.2 合入）：
```json
{
  "crons": [{ "path": "/api/cron/cleanup", "schedule": "0 19 * * *" }]
}
```
说明：Vercel cron 用 UTC，`0 19 * * *`＝UTC 19:00＝北京次日 03:00（低峰；与 01-scope M1-2 ④、02-design §3.2 一致）；Hobby 计划 cron 限 2 个、每日最多触发 1 次——每日一次清理符合限制。git 提交后 Vercel 自动注册（Settings→Cron Jobs 可见）；删除该文件或数组项即注销，无需面板操作。
2. Production 与 Preview 均配 `CRON_SECRET`（Vercel cron 触发时自动附带 `Authorization: Bearer <CRON_SECRET>` 头，与路由校验天然匹配）。
3. 函数区域 hkg1 不变；`/api/cron/cleanup/route.ts` 内 `export const runtime = "nodejs"; export const maxDuration = 60;`（孤儿文件多时一次删不完，次日继续，操作幂等）。
4. 可选 `ADMIN_TOKEN` 提醒：v0.1.1 起管理页具备批量改状态与**不可恢复删除**能力（仅 Git 历史可找回）——务必用 32 字节强随机值；避免公共设备登录（cookie 为会话级 httpOnly，关闭浏览器即失效）；疑似泄露立即换值（旧会话即时全部失效）。
5. 旧形态 `_pending/{uuid}/` 残留：无需人工清理——cron 在运行日期 ≥ 2026-09-29（v0.1.0 上线日 + 7 天）后自动按超龄删除，此前跳过并记日志（01-scope M1-2 ③ 口径）。

## 5. 发布与回滚

**部署顺序（先合 Cron + 清理，再开 flag）**：
1. M1 代码（含 `vercel.json` 与 cron 路由）合入 → Preview 手动 curl 触发验证 → Production 配 `CRON_SECRET` → 观察首轮执行日志。
2. M2/M3/M4 代码合入（`TURNSTILE_ENABLED` 保持 false；`package.json` version 0.1.1）。
3. 配置 `UPSTASH_*`（有内存回退，观察 24h 降级日志；异常即置空回滚）。
4. Turnstile 最后开启，灰度流程：前提＝待确认 2 获用户明示确认 → Preview 开 24h 看提交成功率 → Production 开启 → 管理页与 Vercel Logs 盯 24–48h（400 率、siteverify 超时）→ 异常即改 `TURNSTILE_ENABLED=false`（环境变量即时生效，无需回滚代码）。

**回滚方案（全部可关，无需回滚数据）**：
- feature flag：`TURNSTILE_ENABLED=false`；`UPSTASH_*` 置空（即时回内存限流）。
- Cron：Vercel 面板禁用或删 `vercel.json` 的 crons 项；`CRON_SECRET` 置空使路由 404。
- 数据面演进回滚兼容性：旧代码读新文件——`affects` 为未知键，`parseFeedback` 容错忽略，无影响；日期化 `_pending` 在途引用（回滚窗口内已上传未提交的附件）会被旧 `PENDING_REF_PATTERN` 拒绝 → 用户删附件重传即可（分钟级窗口，见 §7 第 8 行）；Trees 改动为纯读取、回退逻辑内置，无回滚面。

## 6. 完成定义（DoD）

1. `docs/todo.md` 按「做完一条删一条」处理：**删除 7 项**——上传进度细化、`_pending` 孤儿文件自动清理、首页轻统计口径复核、管理页增强、Turnstile 人机验证、Upstash Redis 精确限流、功能需求「+1」聚合投票；**保留 2 项**——「回复送达通知」（GATED 未做，指向 02-design §9 预案）与「多产品支持」（仅 T5.1 参数化、无 UI，旁注「代码路径已参数化，待第二款产品立项」）；其余 2 条（文案精简、查询增强）已由用户 2026-09-22 明示纳入（M5，01-scope R4/待确认 2 已闭环）→ 一并删除（M5 完工时）。
2. 三份计划文档一并 `git mv docs/plans/v0.1.1 docs/archive/v0.1.1`（01/02/03 同批归档）。
3. `develop_wiki.md` §九 版本历史表追加一行：`| v0.1.1 | <上线日> | M1 上传进度/Trees 读取/_pending 自动清理；M2 Turnstile（默认关）/Upstash 限流；M3 管理页增强；M4 +1 投票；schema 演进 affects | docs/archive/v0.1.1/ |`。
4. `npm run test` 全绿（55 项存量 + §3.2 新增全数）；§3.3 手动验收清单逐项通过；生产冒烟：一条含 20MB 附件的反馈全链路 + 一条投票 + 一次 cron 触发。
5. CLAUDE.md 冻结基线段补写 `affects` 与 `_pending` 日期化两处演进——按 CLAUDE.md「改动须用户明示确认」要求，待确认 4 获用户确认后才可提交该项变更。

## 7. 风险与止损表

| 风险 | 触发/观测信号 | 止损方案 |
|---|---|---|
| Turnstile 大陆不可达/加载慢 | 开启后提交转化骤降、widget 超时率升高 | 默认关闭；仅按 §5 灰度开启；异常改环境变量即时关闭，代码零回滚 |
| Upstash 故障/延迟 | Redis 往返超 500ms 或返回 5xx | `AbortSignal.timeout(500)` + 自动回退内存限流（＝v0.1.0 行为）；`console.error` 降级日志可观测 |
| Vercel Cron 配额超限/未触发 | Settings→Cron Jobs 显示 skipped | Hobby 每日 1 次已满足；仍受限→改外部 cron（GitHub Actions 或本地计划任务 curl 同一路由），`CRON_SECRET` 鉴权不变、代码不动 |
| Trees API 权限不足/响应截断 | 403/404 或 `truncated=true` | 自动回退 `githubListDir` 列目录（v0.1.0 行为，上限回到约 1000 条，当前量级远未达）；单测覆盖两态 |
| 逐文件 GET 配额（Trees 只替换枚举层） | 条数增长后每次 ISR 全量刷新逼近 5000/h | 维持 `p-limit(8)` + ISR 300s；超过约 3000 条时立项列表分页/归档前缀（超出 v0.1.1 范围，触发即立项） |
| 批量/删除误操作 | 管理页一次影响多条 | 批量上限 50、`duplicate` 禁止批量、删除需完整输入编号确认（confirm === id）；md 与附件均有 Git 历史，可从仓库历史恢复 |
| 投票并发丢计数 | `withConflictRetry` 重试后仍 409 | 接受少量丢失（IP 粗粒度去重本就不精确，01-scope 已明示该口径） |
| 回滚窗口内 `_pending` 新形态在途 | 旧代码不识别新 ref → 提交返回 400 | 分钟级窗口；用户删除该附件重新上传即可（服务端始终以自己的上传响应 ref 为准） |

> ⚠️ 待确认 2：开启 Turnstile 需从 `challenges.cloudflare.com` 动态加载脚本，与安全红线「禁止任何墙外资源」冲突。默认关闭时代码不加载任何外部脚本，不构成违反；置 `TURNSTILE_ENABLED=true` 属红线例外，须用户明示确认后方可执行 §5 的灰度开启。
>
> ✅ 已对齐（原待确认 3）：T4.2「投票不更新 `updated_at`」与 02-design §1.1「排序影响」/§1.3「要点」同口径（投票只动 `affects` 一行，`updated_at` 语义收窄为内容编辑时刻，防投票刷乱回信区排序），两文一致，`tests/vote.test.mjs` 断言无需修订。
>
> ⚠️ 待确认 4：CLAUDE.md 冻结基线段是否补写 `affects`/日期化目录两处演进，按 CLAUDE.md「改动须用户明示确认」要求挂起（对应 DoD 第 5 项）。
>
> ⚠️ 待确认 5：回复送达通知（邮件/微信）整体 GATED：依赖「恢复可选邮箱（仅用于通知、明示用途）」的产品决策。确认前本期仅保留 02-design 预案与 `.env.example` 注释占位（G5），不写任何实现代码；确认后另立版本实施。

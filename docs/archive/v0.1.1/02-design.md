# 02 · 技术设计（v0.1.1）

> 适用项目：AISC_ISSUES 反馈站（https://feedback.alanevergarden.xyz ，v0.1.0 已上线）。本文为 v0.1.1 的技术设计，与 01-scope.md 的条目一一对应（对应表见 §0）；范围裁决以 01-scope.md 为准，本文不重设范围。
> 读者为 AI 编码代理与开发者：本文字段名、路径、函数名、请求/响应 JSON 均为最终实现口径，可直接执行。
> 与 v0.1.0 冻结基线（CLAUDE.md、docs/archive/v0.1.0/02-data-model.md、03-architecture.md，下称 02-数据 / 03-架构）冲突之处，一律显式标注「**v0.1.1 演进**」并说明兼容性，汇总见文末附录 A。归档文档不修改。
> 交叉引用使用相对文件名：01-scope.md（本期范围）、03-tasks.md（本期实施拆解与验收映射）、02-数据 / 03-架构（v0.1.0 基线）。

---

## 0. 01-scope.md 条目对应表

| 01-scope.md 条目 | 本文落点 |
|---|---|
| M1-1 上传进度细化（百分比 + 速度） | §2 |
| M1-2 _pending 日期化目录 + Vercel Cron 自动清理 | §1.2、§3 |
| M1-3 列表读取改 Git Trees API（解除 1000 条上限，含首页轻统计口径） | §4 |
| M2-1 Turnstile 人机验证（开关实现，默认关） | §5 |
| M2-2 Upstash Redis 精确限流（无配置回退内存） | §6 |
| M3-1 编辑 / 撤回已发送回复 | §7.1、§7.2 |
| M3-2 批量改状态 | §7.3 |
| M3-3 删除反馈（md + 附件） | §7.4 |
| M4-1 「+1 我也遇到 / 我想要」投票 | §1.1、§1.3、§8 |
| R3 多产品支持（裁剪：仅参数化就绪） | §1.4 |
| R2 回复送达邮件通知（GATED 预案，不实现） | §9 |

> 编号以 01-scope.md 实际条目为准；若编号有出入，以条目描述对齐，本文章节名不变。

---

## 1. 数据与协议增量

### 1.1 frontmatter 新增 `affects` 字段【v0.1.1 演进 ①】

**演进声明**：CLAUDE.md 冻结约定「frontmatter schema 与枚举不得擅改」。`affects` 为 v0.1.1 范围裁决明示的基线演进点（唯一新增字段），不是擅改；02-数据 §1 的 12 字段表由此扩展为 13 字段（第 13 个为可选）。

| 属性 | 规定 |
|---|---|
| 字段名 | `affects` |
| 类型 | 正整数（YAML 裸数字，**不加引号**——与 `archived` 裸布尔同一口径；js-yaml `JSON_SCHEMA` 解析为 number） |
| 语义 | 「我也遇到 / 我想要」累计投票数，问题与功能两条路径通用 |
| 写入时机 | **创建反馈时不写入**（`renderFeedbackMarkdown` 的 frontmatter 模板零改动）；首次收到投票时由 `POST /api/vote` 写入 |
| 读取缺省 | 旧文件无该字段 → 按 0 处理（归一化函数见下）；**无任何迁移**，向后完全兼容 |
| 上限 | 服务端写入时钳制 `≤ 999_999`（防异常值；正常量级远不可达） |
| 排序影响 | **不改 `updated_at`**：投票只动 `affects` 一行。02-数据 §6.4 硬约定「改 status 必须同步 updated_at」仅约束 status，投票不触碰，回信区 / 列表排序不受投票刷屏影响 |

类型与纯函数增量（`src/types/feedback.ts`、`src/lib/markdown-utils.ts`）：

```ts
// src/types/feedback.ts —— FeedbackFrontmatter 增加一行
export interface FeedbackFrontmatter {
  // …现有 12 字段不变…
  affects?: number; // v0.1.1 新增：投票计数，缺省视为 0（读取层归一化）
}

// src/lib/markdown-utils.ts —— 新增两个纯函数
/** 读取层归一化：非正整数一律按 0（含 undefined / 脏数据） */
export function affectsOf(fm: FeedbackFrontmatter): number;

/**
 * 设置 frontmatter 的整型字段（vote 专用）。
 * 行为：字段已存在 → 整行替换为 `affects: N`（裸数字）；
 *      不存在 → 插入到 `status: "..."` 行之后（status 必有且唯一，作为稳定锚点）；
 *      raw 无合法 frontmatter → 原样返回。
 * 注：现有 setFrontmatterField 只做「已存在行的整行替换且值为双引号字符串」，无法新增字段，
 * 故另立整型版；两者共用「定位 frontmatter 区块」的私有辅助函数。
 */
export function setFrontmatterIntField(raw: string, field: string, value: number): string;
```

gray-matter 兼容性：`MATTER_OPTS` 的 `JSON_SCHEMA` 原样解析 `affects: 3` 为 number、旧文件无此键时为 undefined，解析路径零改动；`parseFeedback` 的必填类型守卫不含 `affects`，脏数据不致整条读取失败。

fixtures 增量：`tests/fixtures/feedback/` 增补一份含 `affects: 7` 的样例（可基于 02-数据 §4.2 样例加一行），与既有无 `affects` 样例共同覆盖缺省分支。

### 1.2 `_pending` 目录日期化【v0.1.1 演进 ⑥】

**演进声明**：02-数据 §0 布局为 `_pending/{uuid}/`。v0.1.1 起目录名改为 **`{YYYYMMDD-HHmmss}-{uuid4}`**（北京时间，与 id 时间段同格式），例：`feedback/assets/_pending/20260922-143005-3f2a1b0c-9d8e-4f7a-b6c5-d4e5f6071829/aisc-debug.log`。这是自动清理（§3）的前提：清理任务靠目录名前缀判龄，不依赖 commit 历史（fine-grained PAT 只有 Contents 权限，不宜为此扩权）。

**生成方式（关键设计：服务端 attachment 路由的 `uploadId` 生成行与 use-draft 均零改动）**：

- 客户端 `src/lib/upload-client.ts` 新增 `makeUploadId(): string`，返回 `` `${YYYYMMDD-HHmmss}-${uuid4}` ``（日期时间用 `Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", … })` 计算，与 src/lib/id.ts 同款手法；uuid 复用 use-draft 的 `makeUuidV4` 逻辑；客户端时钟偏差需 >7 天才会误判，在 7 天清理余量下无实际影响）。
- `uploadAttachment`（直传，截图与 ≤3.5MB 文件）**也随 FormData 携带 `uploadId` 字段**。attachment 路由现有行 `const dir = uploadId || crypto.randomUUID();` 语义不变：客户端带 uploadId 就直接用作目录名——因此日期前缀由客户端一次性生成、整次上传（直传或分片 + finalize）恒定，不存在跨日分片散落两个目录的问题；服务端生成（旧版客户端直传）的裸 uuid 目录同样被新校验放行。
- attachment 路由**唯一改动**：`const UUID_RE = /^[0-9a-f-]{36}$/` 放宽为

  ```ts
  const UPLOAD_ID_RE = /^(\d{8}-\d{6}-[0-9a-f-]{36}|[0-9a-f-]{36})$/; // 新格式优先，旧格式兼容一个版本周期
  ```

- `src/hooks/use-draft.ts` 零改动：草稿只把 `ref` 当不透明字符串存储；旧草稿中的 `_pending/{uuid}/…` 引用继续合法。
- `src/lib/attachments.ts` 的 `PENDING_REF_PATTERN` 放宽为双格式兼容：

  ```ts
  export const PENDING_REF_PATTERN =
    /^_pending\/(\d{8}-\d{6}-[0-9a-f-]{36}|[0-9a-f-]{36})\/[A-Za-z0-9一-龥._-]+$/;
  ```

- 新增纯函数（落点 `src/lib/attachments.ts`，供 §3 清理与测试用）：

  ```ts
  /** 目录名前 15 位日期时间（北京时间）→ epoch ms；无日期前缀（v0.1.0 遗留）→ null */
  export function pendingDirDateMs(dirName: string): number | null;
  ```

### 1.3 投票 API：`POST /api/vote`

新路由 `src/app/api/vote/route.ts`（薄控制器，`export const runtime = "nodejs"`、`export const maxDuration = 30`）。

**请求**（`Content-Type: application/json`）：

```json
{ "id": "20260921-143005-a1b2c3" }
```

**校验表**（顺序执行）：

| # | 校验项 | 规则 | 失败响应 |
|---|---|---|---|
| ① | Origin | `sameOrigin(req)`（guards.ts 现有函数） | 403 `"请通过本网站提交"` |
| ② | 请求体 | JSON 对象，白名单仅 `id`（string） | 400 `"请求格式不正确"` |
| ③ | 编号格式 | `ID_PATTERN.test(id)`（constants.ts 现有常量） | 400 `"反馈编号格式不正确"` |
| ④ | IP 限频 | `hitVoteLimit(clientIp(req), id)`：同（IP, 反馈）**1 次/小时**（§6 新增；去重口径为粗粒度 IP 限频，接受少量重复不精确——01-scope.md 已明示） | 429 `"感谢支持，同一反馈 1 小时内只能助力一次"` |
| ⑤ | 存在性 | `githubGetFile("feedback/{id}.md")` 为 null | 404 `"该反馈不存在"` |
| ⑥ | 可见性 | `parseFeedback` 失败 → 404；`status === "hidden"` → 404 | 404 `"该反馈不存在"`（`archived` 条目详情页仍可访问，允许投票） |

**`affects + 1` 的读改写**（编辑冲突走现有重试壳）：

```pseudo
POST /api/vote 主流程（⑤⑥之后）:
  result = await withConflictRetry(async () => {          // github-client.ts 现有导出，重跑整个闭包
    file  = await githubGetFile(`feedback/${id}.md`)       // 无 revalidate：写路径要最新 content + sha
    raw   = decodeBase64Utf8(file.content)
    fm    = parseFeedback(raw).fm
    next  = affectsOf(fm) + 1                              // §1.1 归一化（旧文件缺省 0）
    next  = min(next, 999_999)                             // 钳制上限
    md    = setFrontmatterIntField(raw, "affects", next)   // §1.1 新纯函数
    await githubPutFileBytes(path, Buffer.from(md), `vote: ${id} → ${next}`, file.sha)  // PUT 带 sha
    return next
  })
  200 { "ok": true, "affects": result }
```

要点：只改 `affects` 一行，`updated_at`、`status`、正文一概不动（§1.1 排序口径）；sha 冲突由 `withConflictRetry` 重读重写；最终失败 → 500 `"提交没有成功，请稍后重试"`（错误脱敏口径同 03-架构 §3 统一约定）。无蜜罐（无表单字段可埋，Origin + 限频 + 编号不可枚举性已足）。

### 1.4 多产品参数化就绪【R3，裁剪项】

不做任何 UI、不加第二款产品、不改目录布局。**现状澄清**：`src/lib/constants.ts` 现仅有 `PRODUCT_ID = "aisc-issues"` 单常量（`src/lib/markdown-utils.ts` 渲染 frontmatter 时引用）；`PRODUCT_IDS` 仅出现在归档 02-数据 §1 的 TS 草图中、从未落码。故按 01-scope.md §2 R3 做最小收口改造（本期**有**代码改动，任务见 03-tasks.md T5.1）：

1. `constants.ts`：`PRODUCT_ID` 升级为 `PRODUCT_IDS: readonly string[]`（当前仅含 `"aisc-issues"`）+ 派生导出 `CURRENT_PRODUCT = PRODUCT_IDS[0]`；全代码引用随收口改指 `CURRENT_PRODUCT`（单一事实来源，禁止散落硬编码产品字面量）；
2. 新增路径收口函数（落点 `constants.ts`）：`feedbackPath(id)` → `` `feedback/${id}.md` ``、`assetsPath(id)` → `` `feedback/assets/${id}` ``（目录前缀，调用方再拼 `/文件名`）；替换 `src/lib/feedback.ts`、`src/lib/data.ts`、`src/app/api/attachment/route.ts`、`src/app/api/asset/route.ts`、`src/app/api/admin/update/route.ts` 中 `feedback/{id}.md`、`feedback/assets/{id}` 两类模板串散点。`_pending` 相关路径与 md 正文内的 `![…](feedback/assets/…)` 链接**不动**（前者由 §1.2 的 ref 规则约束，后者是文档正文而非仓库 API 路径）。本条收口与 §3.3「feedback.ts 零改动」不冲突：§3.3 指 M1-2 日期化不改归位逻辑，本条仅把路径字面量换成收口函数；
3. `renderFeedbackMarkdown` 不含按产品分支的模板逻辑（现状保持）。

加第二款产品时再扩 `PRODUCT_IDS` + 表单选择器 + 在收口函数内做目录切分（02-数据 §5.4 演进路径不变）。

---

## 2. 上传进度细化（M1-1）

### 2.1 `src/lib/upload-client.ts`：fetch → XHR

导出的 `uploadAttachment` / `uploadLargeFile` 函数名、返回类型 `UploadedRef` 不变（调用方仅追加可选参数），内部 `postForm` 改为 XHR 实现 `postFormXhr`：

```ts
export interface UploadProgress {
  loaded: number;          // 已发送字节（含当前分片内进度）
  total: number;           // 总字节（直传 = 文件大小；分片 = 整个文件大小）
  percent: number;         // 0–100 整数
  bytesPerSecond: number;  // EMA 平滑速度（B/s）；首样本前 / 样本时长 <2s 为 0
  etaSeconds: number;      // 剩余时间（秒）；速度为 0 时为 -1（UI 不显示）
}
export type ProgressCb = (p: UploadProgress) => void;

/** XHR 版表单提交：xhr.upload.onprogress 驱动回调；响应 JSON 解析口径与原 fetch 版一致 */
function postFormXhr(fd: FormData, onProgress?: ProgressCb): Promise<{ ok: boolean; ref?: string; originalName?: string; error?: string }>;
```

实现要点：

- **进度**：`xhr.upload.onprogress` 中 `e.lengthComputable` 才计算；`percent = Math.floor(loaded / total * 100)`（钳 0–100）。multipart 封装开销使真实发送量略大于文件体，`total` 以文件字节数为准（进度到 100% 后仍有等待响应的尾巴，属可接受误差，UI 到 99% 后显示「处理中」由调用方文案兜底）。
- **速度**：指数滑动平均（EMA，α=0.3）平滑（01-scope.md M1-1 ③ 口径）；样本时长 <2 秒时返回 0（UI 据此只显示百分比，防跳变）。剩余时间 `etaSeconds =（total − loaded）/ bytesPerSecond`，速度为 0 时置 −1。
- `xhr.onerror / ontimeout` → 按现有 fetch 失败路径抛错（文案 `"上传失败，请稍后重试"`）；超时 60s；不带取消能力（本期非目标）。
- `makeUploadId()`（§1.2）同文件实现；直传路径 `fd.append("uploadId", makeUploadId())`。

### 2.2 速度与进度显示文案规范（用户可见，一律简体中文）

新增纯函数 `formatUploadProgress(p: UploadProgress): string`（放 upload-client.ts，导出供测试）：

- 百分比：`p.percent` 整数直接显示；
- 速度：`bytesPerSecond < 1MB/s` → `${Math.round(bps / 1024)} KB/s`（四舍五入整数，0 时省略速度段）；`≥ 1MB/s` → `${(bps / 1048576).toFixed(1)} MB/s`（一位小数）；
- 拼装：`45%（812 KB/s）` / `78%（1.4 MB/s，剩余约 6 秒）`（`etaSeconds ≥ 2` 才附剩余段）；速度为 0 → 仅 `45%`。

### 2.3 组件 UI 状态

**`src/components/attachment-uploader.tsx`**（问题路径日志区）：

- `progress: string` state 保留（存格式化文案），`uploadOne` 内回调改为：
  - 直传：`setProgress(\`上传中 ${formatUploadProgress(p)}\`)`；
  - 分片（`uploadLargeFile` 的新签名 `uploadLargeFile(file, onProgress?: (p: UploadProgress, chunkIndex: number, chunkTotal: number) => void)`）：按字节聚合——

    ```ts
    const uploadedBefore = i * CHUNK_SIZE;                 // 已完成分片字节数
    onProgress?.({ ...p, loaded: uploadedBefore + p.loaded, total: file.size, percent: … }, i + 1, total);
    // UI：setProgress(`上传中 ${percent}%（${speed}，第 ${i + 1}/${total} 片）`)
    ```

    速度取当前分片的滑动窗口值（跨分片不累计，近似即可）；
  - finalize 阶段固定文案 `正在合并分片…`；
- 替换现状「上传分片 2/6…」的纯计数文案；错误与删除交互不变。

**`src/components/screenshot-uploader.tsx`**（≤10 张，并发 2）：

- 并发上传无逐张精确归属，采用**批次整体进度**：`batchProgress = (已完成张数 + 当前在传张的 percent/100) / 本批张数 × 100`；添加截图的虚线 tile 在 `uploading` 时显示 `上传中 {整批百分比}%`（tile 空间小，不显示速度；`title` 属性携带 `formatUploadProgress` 全量文案供悬停 / 读屏）；
- 单张直传的 `uploadAttachment(jpg, "image", onProgress)` 回调仅用于刷新该整批百分比。

`use-draft.ts` 零改动（进度是纯 UI 态，不入草稿）。

---

## 3. `_pending` 孤儿自动清理（M1-2）

### 3.1 新路由 `src/app/api/cron/cleanup/route.ts`

`export const runtime = "nodejs"; export const maxDuration = 60;`，仅 `GET`。

```pseudo
GET /api/cron/cleanup：
  ① 鉴权：header Authorization 必须严格等于 `Bearer ${process.env.CRON_SECRET}`
     （timingSafeEqual 比对，admin.ts 同款手法）；CRON_SECRET 未配置或不匹配 → 一律 404
     （不暴露端点存在，01-scope M1-2 ③ 口径）
  ② githubListDir("feedback/assets/_pending")（不传 revalidate → no-store，读最新）
     → 404（目录不存在）视为无事可做，直接返回 { ok, scanned: 0, deletedDirs: 0, deletedFiles: 0, failed: 0 }
  ③ 对每个 type==="dir" 的子目录：
     d = pendingDirDateMs(dir.name)            // §1.2 新纯函数
     d === null（v0.1.0 遗留裸 uuid 目录，目录名无法判龄）→
       运行日期 ≥ 2026-09-29（= v0.1.0 上线日 + 7 天）时视为超龄一并删除，
       此前跳过并记日志（01-scope M1-2 ③ 口径）
     目录名日期时间距今 > 7 天（7 × 86_400_000，日粒度近似：
       当天上传的目录最长存活约 8 个自然日，属预期粒度）→ 进入删除
  ④ 删除目录：githubListDir(dir.path) 列出文件（ContentsItem 自带 sha）；
     每个文件 githubDeleteFile(path, entry.sha ?? (await githubGetFileMeta(path)).sha, "cron: cleanup pending")；
     p-limit(3) 并发；Git 无空目录，文件删空即目录消失
  ⑤ 单次运行删除上限 200 个文件（防 60s 超时；幂等，剩余次日继续）
  ⑥ 200 { ok, scanned, deletedDirs, deletedFiles, failed }   // 01-scope M1-2 ③ 响应口径
```

- **幂等**：`githubDeleteFile` 对 404 已静默视作成功（github-client.ts 现状），重复运行安全；中断重跑无副作用。
- **GitHub API 配额估算**：日常空跑 = 1 次调用；有孤儿时 ≈ 1 + 目录数 + 文件删除数（100 目录 × 平均 4 文件 ≈ 501 次，仍在认证 5000 次/小时配额内，且 cron 每日仅触发一次）。
- 不做 `sameOrigin`（cron 调用无 Origin 头），鉴权完全由 Bearer CRON_SECRET 承担；错误一律脱敏为 `{ ok:false, error:"<中文>" }`。

### 3.2 `vercel.json`（新建）【v0.1.1 演进 ②】

**演进声明**：03-架构 §11 明确「无 cron：v1 不配置任何 Vercel Cron，`vercel.json` 整个文件不需要创建」。v0.1.1 打破该条：新建仓库根 `vercel.json`：

```json
{
  "crons": [
    { "path": "/api/cron/cleanup", "schedule": "0 19 * * *" }
  ]
}
```

- schedule 为 UTC（Vercel cron 语义）：`0 19 * * *` = 每日 UTC 19:00 = 北京时间次日 03:00（低峰；与 01-scope.md M1-2 ④、03-tasks.md §4.2 一致）；Hobby 计划 cron 最短每日一次，与 7 天阈值粒度匹配。
- Vercel 约定：配置了 `CRON_SECRET` 环境变量后，cron 触发请求自动附带 `Authorization: Bearer <CRON_SECRET>`，与 §3.1 ① 的校验闭环；手动验证：

  ```bash
  curl -H "Authorization: Bearer $CRON_SECRET" https://feedback.alanevergarden.xyz/api/cron/cleanup
  ```

- 回信区 ISR 300s 的被动刷新机制不变，cron 只做清理、不碰任何读取面。

### 3.3 无需改动的面（显式清单）

- `src/app/api/attachment/route.ts` 的 `const dir = uploadId || crypto.randomUUID();` 生成行与分片 / finalize 的路径拼装逻辑：零改动（日期前缀由客户端 uploadId 携带，§1.2）；仅 `UUID_RE` 常量放宽为 `UPLOAD_ID_RE`。
- `src/hooks/use-draft.ts`：零改动（ref 不透明存储，旧草稿兼容）。
- `GET /api/asset` 白名单 `ASSET_PATH_PATTERN`：天然排除 `_pending`，零改动。
- 附件归位链路 `src/lib/feedback.ts`：零改动（`relocateOne` 按 ref 逐段取 basename，目录名格式变化不影响）。

---

## 4. 列表读取改 Git Trees API（M1-3）

解除 GitHub Contents API 单目录列表约 1000 条截断（03-架构 附录「待确认 2」预告的升级路径），同时覆盖首页轻统计口径（`getHomeData` 的 total/resolved/avg 全量派生依赖完整清单——同一改动一并解除）。

### 4.1 `src/lib/github-client.ts` 新增 `githubListFeedbackMdPaths()`

```ts
export interface TreeEntry { path: string; type: "blob" | "tree"; sha: string; size?: number }

/**
 * 两步非递归取 feedback/ 下全部 .md 路径（绕开 Contents 列目录 1000 条截断）：
 * ① GET /repos/{owner}/{repo}/git/trees/HEAD        → 根树（HEAD 解析为默认分支，免新增分支环境变量）
 * ② 找 path==="feedback" && type==="tree" 的子树 sha → GET /repos/{owner}/{repo}/git/trees/{sha}（recursive=0，
 *    只列该层：*.md blob + assets 子树，不递归 assets）
 * 返回 `feedback/{entry.path}` 列表（子树条目的 path 相对子树，需拼前缀）。
 * 失败（含 truncated===true、根树无 feedback 目录以外的异常）抛 GitHubApiError；
 * 根树无 feedback 目录 → 返回 []（空仓库属正常态）。
 * 读路径可传 revalidate（与 ISR 300s 对齐），复用 githubJson。
 */
export async function githubListFeedbackMdPaths(revalidate?: number): Promise<string[]>;
```

要点：刻意**不用** `?recursive=1`（大仓库响应会置 `truncated:true` 且体积失控），两步非递归调用数恒为 2、与条目量无关；`HEAD` 失败由 §4.2 的回退兜底（不为此新增环境变量）。

### 4.2 `src/lib/data.ts::fetchSummaries` 改造

```ts
// 现状：const entries = await githubListDir("feedback", REVALIDATE_SECONDS);
//      files = entries.filter(file && .md).map(name)
// 改为：
let files: string[];
try {
  files = await githubListFeedbackMdPaths(REVALIDATE_SECONDS);
} catch (e) {
  console.error("[data] Trees API 读取失败，回退 Contents 列目录：", e instanceof GitHubApiError ? e.status : e);
  const entries = await githubListDir("feedback", REVALIDATE_SECONDS);  // 现有函数保留导出
  files = (entries ?? []).filter((x) => x.type === "file" && x.name.endsWith(".md")).map((x) => `feedback/${x.name}`);
}
// 后续逐文件 githubGetFile + parseFeedback 的 p-limit(8) 并发逻辑不变
```

- 兼容回退：Trees 失败（含 truncated）→ 原 Contents 路径，行为与 v0.1.0 完全一致（<1000 条时两者结果等价）；`githubListDir` 保留（回退 + §3 清理仍在用）。
- 逐文件 frontmatter 拉取的调用量与条目数线性相关，这是既有取舍（ISR 300s + p-limit(8)），本条不改；条目过千后若需再优化属下期。
- 读取面其余函数（`getIssue`、`getAdminList`、`getIssuesForList`、`getHomeData`）经 `fetchSummaries` 自动受益，零改动。

---

## 5. Turnstile 人机验证（M2-1，默认关）

### 5.1 环境变量三值语义（均已预留，本期落地生效逻辑）

| 变量 | 语义 |
|---|---|
| `TURNSTILE_ENABLED` | 仅当值严格等于 `"true"` 时启用；其余值（`"false"` / 未配置）一律视为关闭 |
| `TURNSTILE_SECRET_KEY` | 服务端 siteverify 密钥；仅服务端 |
| `TURNSTILE_SITE_KEY` | 前端挂载 key；**不新增 NEXT_PUBLIC_ 前缀变量**，由服务端组件读取后经 props 下发（见 §5.3） |

**启用判定**：`ENABLED === "true" && SECRET_KEY && SITE_KEY` 三者同时成立，缺一即整体关闭（`.env.example` 注释同步说明）。默认关闭的动机与 01-scope.md 一致：大陆加载 `challenges.cloudflare.com` 不稳。

### 5.2 服务端 `src/lib/turnstile.ts`（新文件）

```ts
/** 三值齐备且 ENABLED==="true"（§5.1）；管理页/路由统一入口 */
export function turnstileEnabled(): boolean;

/**
 * 一次性 token 校验：POST https://challenges.cloudflare.com/turnstile/v0/siteverify
 * body（application/x-www-form-urlencoded）：secret / response=<token> / remoteip=<clientIp>
 * AbortSignal.timeout(5000)；判定 data.success === true。防重放：校验成功后将 token 记入已用集合
 * （内存 Map TTL 10 分钟；Upstash 启用时改 Redis `SET NX EX 600`），重复 token 直接按失败处理
 * （01-scope.md M2-1 ⑤ 口径）。网络异常 / 超时 / 非 JSON → 返回 false（fail-closed：宁可拒绝也不放行）。
 */
export async function verifyTurnstileToken(token: string, ip: string): Promise<boolean>;
```

### 5.3 前端 `src/components/turnstile-widget.tsx`（新文件）

- **挂载条件**：`/submit` 页为 Server Component 容器，服务端读 `turnstileEnabled() && TURNSTILE_SITE_KEY`，以 prop `siteKey` 下传给表单；关闭时不渲染任何脚本与容器（默认部署零墙外请求，与 03-架构 §9 清单一致）。v0.1.0 03-架构 §10 曾把 `TURNSTILE_SITE_KEY` 标注为「唯一允许的 NEXT_PUBLIC_」，但实际 `.env.example` 未加前缀且客户端不可读——**v0.1.1 统一为「服务端读原值经 props 下发」**，不引入任何 `NEXT_PUBLIC_` 变量（该差异在附录 A 登记，不构成冲突，属口径修齐）。
- **脚本加载**：**首次提交时动态注入** `<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" async defer>`（懒加载，不常驻、不用 next/script 预载——01-scope.md M2-1 ② 口径），仅 `siteKey` 存在时注入；脚本加载超时 10 秒 / 注入失败 → `console.warn("[turnstile] 脚本加载失败")`，按降级口径**不带 token 仍提交**（§5.4），绝不阻断提交。
- **explicit 渲染**：`window.turnstile.render(el, { sitekey, callback, "expired-callback", "error-callback" })`；`callback` 缓存 token，`expired-callback` 清空 token（过期即失效），`error-callback` console.warn。
- **对外 API（token 泵，解决 Turnstile token 一次性与多附件请求的矛盾）**：

  ```ts
  export interface TurnstileHandle { consumeToken(): Promise<string>; }
  // forwardRef 暴露；行为：取当前 token → 立即 reset(widgetId) 铸下一枚；
  // 当前无 token → 等待 callback（≤3s 超时）；超时/未启用/脚本未就绪 → resolve "" 并 console.warn。
  ```

  `feedback-form.tsx` 集成：表单提交前 `await handle.consumeToken()` → `body.turnstileToken`；每个附件请求（截图 / 日志、直传 / 分片 / finalize）前各 `consumeToken()` 一次 → FormData 字段 `turnstileToken`；关闭时组件未挂载、恒得 `""`。

### 5.4 服务端校验插入点（enabled 时才执行，两处）

| 路由 | 插入位置 | 行为 |
|---|---|---|
| `POST /api/feedback` | ④ 限频之后、⑥ `validateSubmission` 之前（蜜罐 ③ 命中已 return，不消耗验证） | `body.turnstileToken` 缺失（前端降级场景）→ **放行**并 console.warn `[turnstile] 缺 token 降级放行`（日志可统计降级率，01-scope.md M2-1 ④ 口径）；`verifyTurnstileToken` 返回 false → 400 `"人机验证未通过，请刷新页面重试"`。`validate.ts` 字段白名单增加可选 `turnstileToken: string（≤2048）` |
| `POST /api/attachment` | `readLimitedBody` + formData 解析之后、内容校验之前 | FormData 字段 `turnstileToken` 缺失 → 降级放行并 console.warn；校验失败 → 400 同上文案 |

**与 03-架构 §9 零墙外清单的冲突标注【v0.1.1 演进 ④】**：§9 表格「脚本：无任何第三方 `<script>`」。演进口径：**仅当 `TURNSTILE_ENABLED=true` 时**页面引入 `challenges.cloudflare.com` 脚本（该表「验证」行本已预留此例外并注明大陆可达性）；默认关闭时零墙外清单逐项不变。上线前 Network 面板检查应以「默认配置」为验收态。

---

## 6. Upstash Redis 精确限流（M2-2）

### 6.1 provider 抽象（`src/lib/rate-limit.ts` 改造）

```
模块加载时（惰性，首次调用时判定）：
  UPSTASH_REDIS_REST_URL 与 UPSTASH_REDIS_REST_TOKEN 均非空 → RedisBackend（裸 fetch 直调 Upstash REST pipeline，不新增 npm 依赖——01-scope.md M2-2 ② 口径）
  否则 → MemoryBackend（现有 Map 逻辑原样封装，含 sweep / MAX_MAP_SIZE 防膨胀）
```

后端接口（模块内私有，供测试注入）：

```ts
interface CounterBackend {
  /** 窗口计数：INCR key；首次（返回 1）时 PEXPIRE key windowMs。返回窗口内当前计数 */
  incr(key: string, windowMs: number): Promise<number>;
  /** 冷却闸门：SET key 1 PX windowMs NX，置入成功（此前不存在）→ true */
  setIfAbsent(key: string, windowMs: number): Promise<boolean>;
}
export function createRateLimiter(backend: CounterBackend): RateLimiter;  // 测试注入用工厂
```

Redis 后端实现要点：单次 `POST ${UPSTASH_REDIS_REST_URL}/pipeline`（`Authorization: Bearer ${TOKEN}`，超时 500ms AbortController）发送 `[["INCR", key], ["PEXPIRE", key, windowMs, "NX"]]`（固定窗口计数，`PEXPIRE … NX` 保证已设 TTL 不被覆盖；INCR 与 PEXPIRE 间隙崩溃致 key 永生的概率极低，且窗口错乱只影响单 IP 单 key，可接受，不为此引入事务）；`setIfAbsent` 用 `[["SET", key, "1", "PX", windowMs, "NX"]]` 判返回值 `"OK"`。

### 6.2 导出函数语义不变，签名变 async

| 函数 | 语义（与 03-架构 §7.1 完全一致） | 新签名 |
|---|---|---|
| `hitRateLimit(ip, now?)` | 5 次/小时 + 60s 冷却；`RateVerdict` 形状不变（cooldown 判定 = `setIfAbsent("rl:cd:{ip}", 60_000)` 为 false；小时判定 = `incr("rl:{ip}", 3_600_000) > 5`） | `Promise<RateVerdict>` |
| `hitUploadLimit(ip, now?)` | 20 次/小时，无冷却（`incr("rl:up:{ip}", 3_600_000) > 20`） | `Promise<boolean>` |
| `hitVoteLimit(ip, id, now?)` | **新增**：按（IP, 反馈）1 次/小时（`incr("vote:{ip}:{id}", 3_600_000) > 1`），§1.3 投票去重口径 | `Promise<boolean>` |

- 调用点改动：`/api/feedback`、`/api/attachment`（现有两处）改 `await`；`/api/vote` 新增一处。`now?` 参数保留（仅 Memory 后端使用，测试注入时钟）。
- **失效模式**：RedisBackend 任何异常 → `console.error("[rate-limit] Redis 不可用，本次降级内存计数")`，当次调用改走 MemoryBackend（可用性优先，限流偏松优于全站不可用）。
- **幂等键入 Redis**（key `idem:{key}`，TTL 15 分钟——01-scope.md M2-2 ③ 口径）：`checkIdempotency` / `finishIdempotency` 语义不变（防双击 / 断网重发，03-架构 §6.1 两层叠加语义），仅计数面从函数内存换为 Redis；未配置 `UPSTASH_*` 或 Redis 故障时降级回现有内存实现。

### 6.3 依赖

**零新增依赖**：Redis 后端用裸 `fetch` 直调 Upstash REST pipeline 端点（与 01-scope.md M2-2 ② `CounterBackend`（`incr` / `setIfAbsent`，毫秒窗口）单次 POST pipeline 口径一致）；`package.json` 无任何改动，`npm i @upstash/redis` 不执行。

---

## 7. 管理页增强（M3）

【v0.1.1 演进 ⑤】02-数据 §2.2 规定「v1 不建管理后台，站点无任何 status 写入口」；v0.1.0 实际已交付可选 `/admin`（改状态 + 追加回复，见 src/app/admin/page.tsx 与 /api/admin/update）。v0.1.1 正式把管理面扩展为：编辑 / 撤回回复、批量改状态、删除反馈。硬约定（02-数据 §6.4）继续生效：任何写操作必更 `updated_at`；`duplicate` 必配 `duplicate_of`（删除目标被引用时不做级联改写，见 §7.4 注意）。

### 7.1 `markdown-utils.ts` 新增 `removeLastDeveloperReply(raw)`

```ts
export function removeLastDeveloperReply(raw: string): {
  removed: boolean;                       // 是否移除成功
  raw: string;                            // 移除后的完整 md；未移除时原样返回
  round: { time: string; text: string } | null;  // 被移除的最后一轮（供「编辑」复用原时间戳）
};
```

行为：定位「## 开发者回复」分区（复用 `extractReplyRounds` 的分区切分手法）；移除最后一个 `### ` 小节（含其尾部空白）；移除后分区为空 → 写回占位 `（暂无）`（与 `appendDeveloperReply` 首轮删占位逻辑对偶）；无分区 / 无轮次 / 分区仍为占位 → `{ removed: false, raw, round: null }`。**该函数不触碰 frontmatter 与其他分区**（对 §1.1 的 `affects` 行无影响）。

### 7.2 `POST /api/admin/update` 扩展 `action` 字段

请求体在现有 `{ id, status?, reply? }` 之上新增可选 `action`；**不带 action = 现行为**（改状态 / 追加回复），完全向后兼容：

| action | 附加字段 | 行为（均在 `withConflictRetry` 闭包内：GET → 变换 → PUT sha） |
|---|---|---|
| （缺省） | `status?` / `reply?` | 现状不变：改状态 / 追加回复 + 必更 `updated_at` |
| `"remove-last-reply"` | `status?`（可选，复用现有字段） | `removeLastDeveloperReply` → `removed === false` → 400 `"暂无可撤回的回复"`；移除后 `updated_at` 必更；状态回退默认规则（01-scope.md M3-1 ① / §6 待确认 3）：当前为 `replied` 且撤空 → 自动回退 `submitted`，其余状态不动（管理员可同次显式传 `status` 覆盖） |
| `"edit-last-reply"` | `text`（必填，trim 后 1–2000 字）+ `status?`（可选） | `removeLastDeveloperReply` → `appendDeveloperReply(raw2, round.time, text)`（**保留原轮次时间戳**，时间线不失真）→ `updated_at` 必更；无轮可编辑 → 400 同上 |

白名单校验：`action` 出现时忽略请求体中的 `reply` 字段（两者互斥，`reply` 非空且 action 存在 → 400 `"请求参数不正确"`）；`text` 长度校验复用现有 reply 的 2000 字口径。

### 7.3 批量改状态 `POST /api/admin/bulk-status`

新路由 `src/app/api/admin/bulk-status/route.ts`（`runtime nodejs`、`maxDuration 60`；`sameOrigin` + `adminEnabled` + `isAdmin` 三重门禁同 /api/admin/update）。

- 请求：`{ "ids": ["20260921-143005-a1b2c3", …], "status": "replied" }`。
- 校验：`ids` 为数组、1–50 个、逐个 `ID_PATTERN`（任一不合格整体 400 `"反馈编号格式不正确"`）；`status` 命中 `STATUS_VALUES`（400 `"状态值不合法"`）；`status === "duplicate"` 拒绝（需配 `duplicate_of`，批量场景不采集，400 `"重复状态请在单条编辑中设置"`）。
- 执行：`pLimit(3)` 并发，逐条执行与单条 update 相同的变换（GET → `setFrontmatterField(status)` + `setFrontmatterField(updated_at)` → PUT sha，单条内 `withConflictRetry`）；单条失败不中断其余。
- 响应（部分失败也返回 200）：`{ "ok": true, "results": [{ "id": "…", "ok": true } | { "id": "…", "ok": false, "error": "未找到该反馈" }] }`。

### 7.4 删除反馈 `DELETE /api/admin/delete`

新路由 `src/app/api/admin/delete/route.ts`（`maxDuration 60`；三重门禁同上；HTTP 方法为 `DELETE`，带 JSON body——`fetch` 与 Route Handler 的 `export async function DELETE` 均支持）。

- 请求：`{ "id": "20260921-143005-a1b2c3", "confirm": "20260921-143005-a1b2c3" }`；**`confirm` 必须严格等于 `id`**（防误触，UI 侧要求管理员完整输入编号），不等 → 400 `"请输入完整编号以确认删除"`。
- 执行顺序（**先附件后 md**，保证不产生「有 md 无附件」死链——01-scope.md M3-3 ② 与 03-tasks.md T3.3 口径）：
  1. `githubGetFileMeta("feedback/{id}.md")` 确认存在（不存在则跳过删 md、直接清残留附件，支持重试清理）；
  2. 列 `githubListDir("feedback/assets/{id}")` → 逐文件 `githubDeleteFile(path, entry.sha ?? (await githubGetFileMeta(path)).sha)`，`pLimit(3)`，404 视为已删；单文件失败计入失败清单、不回滚、不阻断其余，且**不删 md**（md 是存在性锚点，幂等可重试：对同 id 再次调用即续删）；
  3. 附件全部删除成功后最后删 md（`githubGetFileMeta` 取 sha → `githubDeleteFile`）。
- 响应：`{ "ok": true, "deletedMd": true, "deletedAssets": 3, "failedAssets": ["a1-debug.log"] }`（`failedAssets` 为空时省略）。
- 注意：不做 `duplicate_of` 反向引用改写——删除被指向条目前由 UI 提示「该编号被其他反馈标记为重复」（管理列表数据已含 `duplicate_of`? 如列表未含则跳过该提示，仅文档注明人工留意）；`hidden` 与删除的区别（02-数据 §2.2 硬约定 4：hidden 不删文件可恢复）在 UI 文案中明示「删除不可恢复」。

### 7.5 `src/app/admin/page.tsx` UI 状态机增量

现有 `Phase = "checking" | "login" | "ready" | "disabled"` 与 `DraftRow` 保留，增量：

- **勾选框**：`selected: Set<string>`；每条标题左侧 checkbox；「全选当前列表」复用现有过滤视图（showHidden）。
- **批量条**（`selected.size > 0` 时顶部浮现）：`已选 {n} 条` + 状态下拉（复用 `STATUS_VALUES`，`duplicate` 禁用）+ 「批量应用」按钮 + 结果摘要 `成功 {n} / 失败 {m}`（逐条 error 以 title 悬停展示）；执行中禁用并显示进度 `处理中 {i}/{n}`。
- **每条操作按钮组**（保存按钮旁）：
  - 「编辑回复」：把最后一轮文本回填本行 Textarea、行内态 `editingReply: true`，保存走 `action:"edit-last-reply"`；无回复轮时按钮禁用（管理列表接口已含回复摘要，可判空）；
  - 「撤回回复」：行内确认（「撤回后用户将看不到这轮回复，确定？」——01-scope.md M3-1 ④ 文案）→ `action:"remove-last-reply"`；
  - 「删除」：红色（`text-red-600` / `border-red-300`），点击展开行内危险确认区，要求**完整输入编号**（输入值 === id 才激活删除按钮）→ `DELETE /api/admin/delete`；成功后从列表移除。
- 所有写操作完成后沿用现有「✓ 已保存（线上 ≤5 分钟可见）」提示语义；失败沿用红色 error 文案；管理页本身仍无 ISR 强刷需求（读取经 `/api/admin/list`）。

---

## 8. 投票前端与数据层（M4-1）

### 8.1 `src/components/vote-button.tsx`（新文件，详情页）

```tsx
export function VoteButton(props: {
  id: string;
  category: "issue" | "feature";
  initialAffects: number;
}): JSX.Element;
```

- 文案：`category === "issue"` → 「我也遇到」；`"feature"` → 「我想要」；计数随行：`我也遇到（7）` / `我想要（7）`（01-scope.md M4-1 ④ 口径）。
- **乐观更新**：点击 → 立即 `affects+1` 并切换 `已记录，谢谢反馈`（禁用态，保留新计数；与 01-scope.md M4-1 ④ 唯一定稿文案一致）；随后 `POST /api/vote`；成功 → 以响应 `affects` 校正；失败 → 回滚计数并恢复按钮，错误文案：429 → `"感谢支持，同一反馈 1 小时内只能助力一次"`（服务端同文案，直接展示 `error` 字段）；404 → `"该反馈不存在"`；其余 → `"提交没有成功，请稍后重试"`。
- **客户端软去重**：投票成功后 `localStorage["aisc:voted:{id}"] = "1"`；挂载时已存在则直接渲染禁用态（同一浏览器避免重复引导；**去重以服务端 IP 限频为准**，本地标记仅体验优化，清缓存后可再见投票态）。
- `hidden` 条目详情页整页为隐藏提示（现状），不渲染本组件。

### 8.2 数据层增量（`src/lib/data.ts`）

- `ListItem` 增加字段 `affects: number`（`fetchSummaries` 内 `affectsOf(fm)` 归一化；`SummaryItem` 同步）；`getIssuesForList` / `getAdminList` / `getHomeData` 的解构透传自动带上。
- `IssueDetail.fm` 经 `FeedbackFrontmatter.affects?: number`（§1.1）自然携带，`/issue/[id]` 页面把 `affectsOf(fm)` 传给 `VoteButton`。
- 展示口径：本期**仅详情页展示**投票入口与计数；回信区（`ReplyItem`）与列表页 UI 不展示 `affects`（数据已在 `ListItem` 预留，列表排序也不使用它）。

---

## 9. 邮件通知预案【R2，GATED——本期只设计不实现】

> **状态：GATED。** v0.1.0 明确「不采集任何联系方式」（03-架构 §8 安全清单）。主动通知依赖「恢复可选邮箱（仅用于通知、明示用途）」这一**产品决策**，须用户明示确认后才可进入下一版（v0.1.2+）实施；本期不写任何代码、不加依赖、不配环境变量（`RESEND_API_KEY` / `NOTIFY_FROM` 仅在 §10 登记占位）。

预案要点（供确认后展开为正式设计）：

1. **通道**：Resend（`https://api.resend.com/emails`，HTTP API，Vercel hkg1 函数出站可达；发信域名用自有域名子域如 `notify.feedback.alanevergarden.xyz`，配 SPF/DKIM）。QQ/163 收信可达性：Resend 海外 IP 对国内主流邮箱投递通常可达，但**可能进垃圾箱**，需实测样本；不可达性风险是「谨慎评估」结论的一部分。
2. **可选邮箱字段草案**：frontmatter 新增 `contact_email`（GATED 字段，本期不实施）；表单选填、明示文案「仅用于接收处理结果通知，不会公开展示」；校验：邮箱正则 + ≤254 字符；私有仓库原文存储（同 nickname 口径），前端详情页打码展示（`a***@qq.com`）。
3. **触发点**：开发者**首次回复**时（`/api/admin/update` 中 `appendDeveloperReply` 且该条此前 `extractReplyRounds(body).length === 0`）发送一封纯文本中文通知（标题 + 首轮回复摘要 + 详情页专属链接 `/issue/{id}?t={token}`——token 由服务端以 `makeIssueToken` 现有函数重算）；发信失败**不阻断**保存（console.error 留痕，补发走 Resend 控制台或人工）。

> ⚠️ 待确认 1：是否恢复「可选邮箱采集（仅通知用途、明示文案、详情页打码）」？确认后本节升级为正式设计并进入下一版实施；在此之前任何代码不得引入 `contact_email`、`src/lib/notify.ts` 与 Resend 依赖。

---

## 10. 环境变量与 Vercel 配置增量

### 10.1 环境变量增量表（在 v0.1.0 03-架构 §10 基础上）

| 变量名 | 状态 | 用途 | 说明 |
|---|---|---|---|
| `CRON_SECRET` | **新增**（启用 cron 则必配） | `/api/cron/cleanup` 的 Bearer 鉴权 | `openssl rand -hex 32` 产物；Production 与 Preview 均配置（cron 仅在生产自动触发，但 Preview 配置后便于手动 curl 验证——03-tasks.md §4.2 第 2 条口径）；未配置或不匹配时该路由一律 404（01-scope.md M1-2 ③ 口径） |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | 已预留 → **本期生效** | 非空即启用 Redis 限流（§6） | 留空 = 函数内存近似限流（现状默认不变） |
| `TURNSTILE_ENABLED` / `TURNSTILE_SECRET_KEY` / `TURNSTILE_SITE_KEY` | 已预留 → **本期生效** | 三值语义见 §5.1 | 默认 `false`；`SITE_KEY` 不加 `NEXT_PUBLIC_` 前缀（§5.3） |
| `RESEND_API_KEY` / `NOTIFY_FROM` | **GATED 登记，本期不配置** | 邮件通知预案（§9） | 用户确认 §9 待确认 1 后才启用 |

`.env.example` 同步：新增 `CRON_SECRET=` 空行 + 注释（「Vercel Cron 清理任务鉴权；不配则 /api/cron/cleanup 返回 404 自禁用」）；`UPSTASH_*` / `TURNSTILE_*` 注释由「预留」改为「非空/三值即启用」；文末追加 GATED 注释段（RESEND 两项，标注「暂不使用」）。

### 10.2 Vercel / 依赖配置增量

- **`vercel.json` 新建**（内容见 §3.2）【v0.1.1 演进 ②】。
- **依赖**：**零新增**（Upstash 走裸 fetch REST，§6.3）；`package.json` 不变；`test` script 不变。
- 函数区域（hkg1）、`maxDuration` 约定、Root Directory 等其余 Vercel 配置沿 v0.1.0 03-架构 §11 不变；新增路由的 `maxDuration`：cleanup 60、vote 30、bulk-status 60、delete 60。

---

## 11. 测试增量（`node --test --experimental-strip-types`，`npm run test`）

纯函数单测全部不访问网络；fixtures 约定沿 04-implementation §7.4。

| 测试文件 | 新增用例 |
|---|---|
| `tests/markdown-utils.test.mjs` | `setFrontmatterIntField`：已有字段裸数字替换 / 缺省时插入 status 行后 / 无 frontmatter 原样返回；`affectsOf`：缺省 0 / 正常值 / 脏数据（字符串、负数、小数）归 0（`removeLastDeveloperReply` 用例移入新文件 tests/reply-edit.test.mjs，落点与 03-tasks.md §3.2 一致） |
| `tests/reply-edit.test.mjs`（新） | `removeLastDeveloperReply`：单轮移除并回写占位 / 多轮只移最后一轮且返回 round / 无轮与占位态返回 removed:false / 不触碰 frontmatter（含 affects 行）与相邻分区（落点与 03-tasks.md §3.2 一致） |
| `tests/pending-cleanup.test.mjs`（新） | 新 `PENDING_REF_PATTERN`：`_pending/{YYYYMMDD-HHmmss}-{uuid}/file` 合法、旧 `_pending/{uuid}/file` 仍合法、日期时间段非法（非 8 位日期 + 6 位时间）拒绝；`pendingDirDateMs`：合法目录返回目录名时间戳 epoch、裸 uuid 返回 null、>7 天判定（手动注入 now）；截止筛选：8 天前选删、7 天内与当日保留、非法目录名跳过、空清单安全返回、2026-09-29 前后旧 uuid 目录两态（落点与 03-tasks.md §3.2 一致） |
| `tests/upload-progress.test.mjs`（新） | M1-1 | `formatUploadProgress`：百分比边界、KB/s→MB/s 进位、速度为 0 仅显示百分比；EMA 速度平滑（α=0.3）与样本 <2s 不显示速度；分片跨片聚合进度公式 |
| `tests/vote.test.mjs`（新） | `POST /api/vote` 校验纯函数：ID_PATTERN 复用边界（缺段 / 大写 / 超长拒绝）；`hitVoteLimit` 窗口：同 IP 第 1 次允许、第 2 次 429、跨窗口重置（注入 now）；读改写编排用 mock github 函数验证 `affects+1` 且 `updated_at` 字符串不变、PUT 携带 GET 所得 sha |
| `tests/turnstile.test.mjs`（新） | mock `global.fetch`：`success:true` 通过 / `success:false` 拒绝 / 网络异常与超时返回 false（fail-closed）；`turnstileEnabled` 三值矩阵（ENABLED 大小写与假值、缺 SECRET、缺 SITE） |
| `tests/rate-limit.test.mjs` | provider 切换：`createRateLimiter(fakeBackend)` 注入假计数器验证 5 次/小时 + 60s 冷却 / 20 次上传 / 1 次投票判定逻辑与 key 命名（`rl:` / `rl:cd:` / `rl:up:` / `vote:`）；假后端抛错 → 降级内存路径仍给出判定；现有内存窗口用例全部保留 |
| `tests/fixtures/feedback/` | 增补含 `affects: 7` 样例（§1.1）；既有四份样例（20260919-091512、20260920-155801、20260921-143025、20260921-143026-dup001）不动 |

手测项（不入自动化，登记于 03-tasks.md §3.3 验收清单）：XHR 进度（DevTools 网络限速下观察百分比与速度文案、分片聚合与「正在合并分片…」）；`curl -H "Authorization: Bearer …" /api/cron/cleanup` 空跑与造 8 天前日期目录的删除；Trees 回退（临时改错分支名 / 断网模拟仅看日志）；Turnstile 在 Preview 环境三值开启的完整链路与默认关闭时 Network 面板零 `cloudflare` 请求；管理页批量 / 撤回 / 编辑 / 删除（含 confirm 校验与红色确认）；投票 429 与 localStorage 已投态。

---

## 附录 A：与 v0.1.0 基线的差异登记（演进清单）

| # | 演进点 | 冲突的基线条目 | 兼容性说明 |
|---|---|---|---|
| ① | frontmatter 新增可选 `affects`（缺省 0） | CLAUDE.md「schema 不得擅改」、02-数据 §1 | 范围裁决明示的基线演进；读取缺省 0，无迁移，旧文件 / 旧代码路径不受影响 |
| ② | 新建 `vercel.json` 配 cron | 03-架构 §11「无 cron、vercel.json 不需要创建」 | 仅新增清理任务，不动读取面与 ISR；`CRON_SECRET` 未配或不匹配则路由 404 自禁用（可安全不启用） |
| ③ | 列表枚举改 Git Trees API | 02-数据 §5.3「一次列目录」的实现口径、03-架构「待确认 2」 | 数据布局（扁平目录）不变；失败自动回退 Contents，<1000 条时行为等价 |
| ④ | Turnstile 开启时引入 `challenges.cloudflare.com` 脚本 | 03-架构 §9「无任何第三方 script」（该表「验证」行已预留例外） | 默认关闭时零墙外清单不变；开启属运维决策，代码侧三值门控 |
| ⑤ | 管理页扩展撤回 / 编辑 / 批量 / 删除 | 02-数据 §2.2「站点无任何 status 写入口」（v0.1.0 已由可选 /admin 部分突破） | 正式演进；写操作仍受 ADMIN_TOKEN 三重门禁，硬约定（updated_at、duplicate_of）不破 |
| ⑥ | `_pending` 目录名 `{YYYYMMDD-HHmmss}-{uuid4}` | 02-数据 §0 布局 `{uuid}` | 正则与清理逻辑双格式兼容，旧引用 / 旧草稿 / 在途分片不受影响；遗留裸 uuid 目录自 2026-09-29 起按超龄删除（§3.1 ③） |
| ⑦ | 限流签名 async 化 + Upstash 后端 | 03-架构 §7.2「v1 选函数内存（Upstash 预留）」 | 预留项落地；不配 `UPSTASH_*` 时行为与 v0.1.0 完全一致 |

## 附录 B：待确认清单

> ⚠️ 待确认 1（§9）：是否恢复「可选邮箱采集（仅通知用途、明示文案、详情页打码）」以解锁邮件通知实施？确认前 `contact_email` / `src/lib/notify.ts` / Resend 依赖一律不得出现。

> ✅ 已裁决（对齐 01-scope.md M1-2 ③）：v0.1.0 遗留的无日期前缀 `_pending/{uuid}` 目录采用全自动口径——运行日期 ≥ 2026-09-29（= v0.1.0 上线日 + 7 天）时视为超龄一并删除，此前跳过并记日志；三份文档口径一致（见 §3.1 ③、03-tasks.md T1.2 ②）。


## 12. M5 文案与查询优化（设计）

### 12.1 文案精简（对应 01-scope M5-1 / R4）

- 文案常量收敛在 `src/lib/constants.ts`：删除 `SLA_TEXT`、`EMPTY_REPLY_TEXT`（改「还没有回复，过几天再来看看。」）、`NO_REPLY_DETAIL_TEXT`（改「开发者还没有回复，过几天再来看看。」）；引用点：首页 page.tsx（Hero 副标题/SLA 小字/空态/页脚）、layout.tsx metadata.description、reply-tabs 空态、issue-detail 空回信态、submit/success 页尾。
- 验证：`grep -rn "1 分钟提交|3 个工作日" src/ docs/plans/..` 在 src/ 零命中；CLAUDE.md「空态文案」条目改为「空态文案不含时限承诺」。

### 12.2 查询增强（对应 01-scope M5-2）

- `/issues` 列表页（client IssuesBrowser）新增状态：dateFrom/dateTo（`<input type="date">`），过滤 `createdAt.slice(0,10)` 落区间（含边界）；初始化读 `useSearchParams` 的 q/from/to；筛选变更以 `router.replace(`/issues?q=…&from=…&to=…`)` 同步 URL（scroll 不跳顶）。
- 首页 IdLookup：输入匹配 `ID_PATTERN` → 直达 `/issue/{id}`；否则 → `/issues?q={输入}`。原「没找到这个编号」错误文案删除（模糊搜索兜底后无死路）。

### 12.3 涉及文件

（修改）src/lib/constants.ts、src/app/page.tsx、src/app/layout.tsx、src/components/{reply-tabs,issue-detail(空回信),id-lookup,issues-browser}.tsx、src/app/submit/success/page.tsx、CLAUDE.md；（新增）tests 可选（文案为常量断言，不强制）。

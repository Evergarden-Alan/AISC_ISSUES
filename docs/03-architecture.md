# 03 · 技术架构设计

> 适用项目：AISC_ISSUES 反馈站（下称"本站"）。本文档遵循已冻结决策基线 v0.1.0（双路径表单/双 Tab 回信区/状态双映射），所有设计与其一致；读者为 AI 编码代理与开发者，规格具体到字段名、枚举值、路径与文件名，可直接照此实现。数据模型细节以 docs/02-data-model.md 为准。
>
> 约定：正文所有"必须/禁止"均为硬性要求。参考项目指 `_reference/Inspirations-Farm-App/inspirations-farm-app/`（只读，不得修改）。

---

## 1. 数据流图

### 1.1 提交链路（写）

```
┌──────────────┐
│ 用户浏览器    │  填写表单，草稿实时存 localStorage（键 aisc:draft）
│ (中国大陆)    │  截图先经 canvas 重绘压缩 ≤4MB 并剥 EXIF
└──────┬───────┘
       │ ① 附件逐个分传（绕开 Vercel 4.5MB 请求体限制）
       │ POST /api/attachment  multipart/form-data, 单文件
       ▼
┌──────────────────────────────┐   PUT /repos/{owner}/{repo}/contents/
│ Vercel Route Handler          │ ──────────────────────────────────► ┐
│ src/app/api/attachment/route.ts│   feedback/assets/_pending/{uuid}/ │
│ · readLimitedBody 大小封顶     │   {安全化原文件名}                  │
│ · 图片魔数嗅闻 / 附件扩展名白名单│                                     ▼
│ · 限流 / 蜜罐无关               │                        ┌────────────────────┐
└──────────────────────────────┘                        │ 私有 GitHub 反馈仓库 │
       │ ② 返回 {ok,ref} 引用                              │ (与网站代码仓库分离) │
       ▼                                                 │ feedback/           │
┌──────────────────────────────┐   PUT feedback/{id}.md  │   {id}.md           │
│ POST /api/feedback            │ ──────────────────────►│   assets/{id}/...   │
│ src/app/api/feedback/route.ts │   (id/路径/校验全服务端) │   assets/_pending/… │
│ · 蜜罐非空 → 静默丢弃          │                        └────────────────────┘
│ · 同 IP 限流 5 次/时 + 60s 冷却│   附件归位（GET+PUT+DELETE，p-limit 并发 3）：
│ · 字段白名单/枚举/长度校验     │   _pending/{uuid}/{安全化原名} → assets/{id}/{s|a}{n}-{安全化原名}
│ · 幂等键查重（函数内存）       │
│ · 409/422 → 换随机串重试 ≤3    │
└──────┬───────────────────────┘
       │ ③ {ok:true, id, token, url}
       ▼
成功页：展示编号 id + 专属链接 /issue/{id}?t={token}（提示收藏/截图保存）
```

### 1.2 读取链路（读，回信区 / 详情页 / 列表页）

```
┌──────────┐  GET /                     ┌───────────────────────────────┐
│ 访客浏览器 │ ─────────────────────────► │ Next.js Server Component       │
│ (不直连   │  HTML（回信区已服务端渲染） │ src/app/page.tsx               │
│  GitHub)  │ ◄───────────────────────── │ export const revalidate = 300  │
└──────────┘                            └──────────────┬────────────────┘
                                                       │ ISR 过期后于请求期执行
                                                       ▼
                                        ┌───────────────────────────────┐
                                        │ src/lib/data.ts（服务端读层）    │
                                        │ getRepliedIssues() / getIssue()│
                                        └──────────────┬────────────────┘
                                                       │ fetch(Bearer GITHUB_PAT,
                                                       │       next:{revalidate:300})
                                                       ▼
                                        ┌───────────────────────────────┐
                                        │ src/lib/github-client.ts       │
                                        │ REST Contents API GET          │
                                        │ /repos/{owner}/{repo}/contents │
                                        └──────────────┬────────────────┘
                                                       ▼
                                        私有仓库 feedback/*.md
                                        → markdown-utils 解析 frontmatter/正文
                                        → 回信区双 Tab（问题/功能建议）各 10 条
                                          （updated_at 倒序，状态中文双映射）
```

### 1.3 资源访问链路（图片 / 附件）

```
浏览器 <img src="/api/asset?path=..."> → GET /api/asset → githubFetchRaw
→ 私有仓库 feedback/assets/ 内字节 → 代理回传（大陆不依赖 GitHub raw 域名）
```

---

## 2. 项目目录结构

网站代码仓库（新建，与私有反馈仓库分离）根目录即 Next.js 应用根，Vercel Root Directory 用默认值（仓库根）。结构如下：

```
.
├── docs/
│   ├── 01-product.md             # 产品与交互规格
│   ├── 02-data-model.md          # 数据模型与协议
│   ├── 03-architecture.md        # 本文档
│   └── 04-implementation.md      # 实施计划
├── public/
│   └── favicon.ico
├── src/
│   ├── app/
│   │   ├── layout.tsx            # 根布局：简体中文 lang="zh-CN"、viewport 配置、自托管字体
│   │   ├── globals.css           # Tailwind v4 CSS-first 配置 + prose 样式
│   │   ├── page.tsx              # 首页：SLA 文案 + 提交入口 + 按编号查询 + 回信区双 Tab（Server Component, revalidate=300）
│   │   ├── error.tsx             # 全局错误边界（纯中文文案）
│   │   ├── not-found.tsx
│   │   ├── submit/
│   │   │   ├── page.tsx          # 反馈表单页（Client Component 容器；第一步双路径二选一）
│   │   │   └── success/page.tsx  # 成功页：读 sessionStorage aisc:last-submit 展示编号+链接
│   │   ├── issue/
│   │   │   └── [id]/page.tsx     # 专属详情页：公开可访问（?t= 为提交者凭证，不强制拦截）
│   │   ├── issues/
│   │   │   └── page.tsx          # 列表页（M3）：状态/类型筛选（含 问题/功能 维度）+ 关键词搜索
│   │   └── api/
│   │       ├── feedback/route.ts     # POST 提交反馈（薄控制器，maxDuration=60）
│   │       ├── attachment/route.ts   # POST 附件分传（薄控制器，maxDuration=60）
│   │       └── asset/route.ts        # GET 资源代理（薄控制器）
│   ├── components/
│   │   ├── ui/                   # shadcn/ui 生成件：button.tsx card.tsx input.tsx textarea.tsx label.tsx select.tsx（自托管，无外部请求）
│   │   ├── feedback-form.tsx     # 表单主体（双路径、问题路径两档、草稿、幂等键、提交重试）
│   │   ├── path-select.tsx       # 第一步双路径二选一大卡片：「我遇到了问题」/「我想要新功能」
│   │   ├── type-card-select.tsx  # 问题类型大卡片单选（问题路径 4 类：bug/ux/question/other）
│   │   ├── severity-select.tsx   # 口语化三档（仅问题路径）："完全没法用了/能用但别扭/小问题"
│   │   ├── screenshot-uploader.tsx # 截图选择+压缩+EXIF 剥离+上传（≤3 张）
│   │   ├── attachment-uploader.tsx # 问题路径折叠区"上传软件日志等辅助材料（可选）"
│   │   ├── honeypot-field.tsx    # 隐藏蜜罐字段
│   │   ├── reply-list.tsx        # 回信区条目列表（10 条 + 查看全部）
│   │   ├── reply-card.tsx        # 单条：标题+类型/状态标签+摘要约100字+更新时间
│   │   ├── issue-detail.tsx      # 详情页正文渲染（react-markdown）
│   │   ├── status-badge.tsx      # status 中文标签
│   │   ├── type-badge.tsx        # type 中文标签
│   │   └── id-lookup.tsx         # 首页"按编号查询"输入框
│   ├── hooks/
│   │   └── use-draft.ts          # localStorage 草稿实时保存/恢复
│   ├── lib/
│   │   ├── github-client.ts      # 纯 HTTP：鉴权/409 映射/base64/错误脱敏（第 4 节）
│   │   ├── markdown-utils.ts     # 纯函数：frontmatter 解析生成、正文模板、回信追加、摘要
│   │   ├── feedback.ts           # 编排层：createFeedback/listFeedback/getFeedback/relocateAssets
│   │   ├── data.ts               # 服务端读层（供 Server Component，ISR 配套）
│   │   ├── attachments.ts        # 附件校验常量+魔数嗅闻+readLimitedBody（自参考项目改造）
│   │   ├── rate-limit.ts         # 同 IP 限频（函数内存近似实现，第 7 节）
│   │   ├── validate.ts           # 请求体字段白名单/枚举/长度校验（schema 常量在此）
│   │   ├── id.ts                 # id 生成：YYYYMMDD-HHmmss-{6 位随机小写字母数字}
│   │   ├── token.ts              # 详情页 token：HMAC-SHA256 派生（详情页公开可访问，token 不强制拦截）
│   │   ├── beijing-time.ts       # +08:00 时间工具（ISO 8601 格式化）
│   │   ├── constants.ts          # 全部枚举、中文映射、路径常量（单一事实来源）
│   │   ├── markdown-config.ts    # remark-gfm + rehype-sanitize 配置（含协议白名单）
│   │   └── utils.ts              # cn() 等
│   └── types/
│       └── feedback.ts           # FeedbackFrontmatter / FeedbackInput / ApiError 等 TS 类型
├── tests/                        # node --test + --experimental-strip-types（沿用参考项目测试跑法）
│   ├── id.test.mjs
│   ├── frontmatter.test.mjs
│   ├── validate.test.mjs
│   ├── rate-limit.test.mjs
│   └── token.test.mjs
├── CLAUDE.md                     # AI 编码代理工作约定
├── .env.example
├── next.config.ts
├── package.json
├── tsconfig.json                 # strict: true
└── README.md
```

里程碑对应：M1 缺省不建 `issues/`、`issue/[id]/`、`attachment-uploader.tsx`；M2 补齐；M3 补 `issues/`。

---

## 3. API 设计

三个端点。统一约定：

- 成功响应 `200`，形如 `{ "ok": true, ... }`；
- **一切错误响应统一为** `Response.json({ ok: false, error: "<中文消息>" }, { status })`，`error` 一律中文、面向不懂编程的用户，绝不包含堆栈、PAT、GitHub 原始报错或内部路径；
- 写端点先做 `Origin` 头同源校验（等于部署域名，否则 403）；
- 路由文件保持"薄控制器"：解析 → 调 lib → 组装响应，不含业务规则。

### 3.1 POST /api/feedback

**请求**（`Content-Type: application/json`，正文仅 KB 级——附件只带引用）。路径由 `type` 值区分：`type=feature` ⇒ 功能（需求反馈）路径；`type ∈ {bug,ux,question,other}` ⇒ 问题反馈路径。功能路径请求体差异：无 `severity`（服务端覆写 `normal`）、无 `steps`/`expected`/`actual`、无 `attachments`（出现附件引用即 400——日志上传仅问题路径提供）、新增 `scenario`（使用场景）与 `workaround`（现状的替代办法）两个可选文本字段；`description` 语义为"想解决什么问题、希望怎么用"。下例为问题路径（bug）：

```json
{
  "idempotencyKey": "0f1e2d3c-4b5a-4678-9abc-def012345678",
  "website": "",
  "type": "bug",
  "severity": "normal",
  "title": "导出报告时按钮点不动",
  "description": "点击导出按钮后没有任何反应，重启软件也一样。",
  "steps": "1. 打开报告页\n2. 点导出",
  "expected": "弹出保存对话框",
  "actual": "无任何反应，日志里有报错",
  "nickname": "阿明",
  "screenshots": [
    { "ref": "_pending/3f2a1b0c-9d8e-4f7a-b6c5-d4e5f6071829/屏幕截图.png", "originalName": "屏幕截图 2026-09-21.png" }
  ],
  "attachments": [
    { "ref": "_pending/8a7b6c5d-4e3f-4a2b-1c0d-9e8f7a6b5c4d/aisc-debug.log", "originalName": "aisc-debug.log" }
  ],
  "env": {
    "ua": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) ...",
    "platform": "Win32",
    "url": "https://反馈站域名/submit"
  }
}
```

**成功响应** `200`：

```json
{
  "ok": true,
  "id": "20260921-143005-a1b2c3",
  "token": "9f8e7d6c5b4a3210",
  "url": "/issue/20260921-143005-a1b2c3?t=9f8e7d6c5b4a3210"
}
```

**校验规则**（全部在 `src/lib/validate.ts` 中以常量表实现，服务端执行；前端用同一张表做即时提示）：

| 字段 | 规则 | 失败响应 |
|---|---|---|
| `idempotencyKey` | 必填，UUID v4 格式；同时写入请求头 `x-idempotency-key`，两者必须一致 | 400 `"提交标识缺失，请刷新页面重试"` |
| `website`（蜜罐） | 正常用户恒为空串；**非空 → 不写仓库，仍返回 200 假成功**（伪造合法 id，第 7.3 节） | — |
| `type` | 必填，枚举 `bug / feature / ux / question / other`（小写）；`feature` ⇒ 功能路径，其余四值 ⇒ 问题路径（问题路径收到 `feature` 即 400，功能路径强制 `feature`） | 400 `"请选择问题类型"` |
| `severity` | **仅问题路径必填**，枚举 `blocker / normal / low`；功能路径忽略客户端传入值，服务端覆写 `"normal"` | 400 `"请选择影响程度"` |
| `title`（一句话概括） | 必填，trim 后 1–50 字；问题路径 = "一句话概括"，功能路径 = "一句话概括想要的功能" | 400 `"请用一句话概括（50 字以内）"` |
| `description`（详细描述） | 必填，1–2000 字；功能路径语义为"想解决什么问题、希望怎么用"，写入 `## 想要的功能` 分区 | 400 `"请填写详细描述（2000 字以内）"` |
| `steps` | 可选，≤2000 字；仅问题路径且 `type=bug` 时写入 `## 复现步骤` 分区 | 400 超长文案 |
| `expected` / `actual` | 可选，各 ≤1000 字；仅问题路径 | 同上 |
| `scenario`（使用场景） | 可选，≤500 字；仅功能路径写入 `## 使用场景`，问题路径忽略 | 同上 |
| `workaround`（现状的替代办法） | 可选，≤500 字；仅功能路径写入 `## 现状的替代办法`，问题路径忽略 | 同上 |
| `nickname` | 可选，≤20 字；两条路径均选填；原文入库与展示（v0.1.0 起不采集任何联系方式，无需打码） | 400 `"称呼过长"` |
| `screenshots` | 数组 ≤3（两条路径均可传）；每项 `ref` 匹配 `^_pending/[0-9a-f-]{36}/[A-Za-z0-9一-龥._-]+$` 且扩展名 ∈ jpg/png/webp；服务端逐一验证 pending 文件真实存在 | 400 `"截图上传已过期，请删除后重新上传"` |
| `attachments` | 数组 ≤3；**仅问题路径**（功能路径请求体出现附件引用即 400——日志上传仅问题路径提供）；每项 `ref` 匹配同上正则且扩展名 ∈ log/txt/json/zip；同样验存在 | 同上 |
| `env.ua / env.platform / env.url` | 可选；服务端截断 ua≤300、platform≤50、url≤500；功能路径仅采集 ua 与提交时间 | — |
| **其余任何字段** | 一律拒绝（白名单外的键出现即整体 400 `"提交内容格式不正确"`） | 400 |

**服务端生成、客户端不信任的值**：`id`、`product`（恒 `"aisc-issues"`）、`status`（恒 `"submitted"`）、`severity`（功能路径覆写 `"normal"`）、`tier`（服务端推导：问题路径 `attachments` 非空 ⇒ `detailed`，否则 `basic`；功能路径固定 `basic`；客户端不传该字段，传了也忽略）、`created_at / updated_at`、文件路径 `feedback/{id}.md`、全部附件归位路径。校验规则按路径区分，与 02 文档 §1 的服务端校验 5 条一致。

**错误响应示例**（限流触发，`429`）：

```json
{ "ok": false, "error": "提交太频繁了，请 1 小时后再试" }
```

### 3.2 POST /api/attachment

单文件、`multipart/form-data`，字段 `file` 与 `kind`（`kind` ∈ `image | file`）。先 `readLimitedBody`（参考项目同名函数，封顶 `MAX_BODY_BYTES = 5MB`，超限 413）再解析 multipart。

**校验**：

| kind | 扩展名 | 魔数/内容校验 | 大小上限 |
|---|---|---|---|
| `image`（截图） | `.jpg / .png / .webp` | 忽略客户端声明 MIME 与文件名，仅认魔数：`FF D8 FF`=jpeg、`89 50 4E 47`=png、`RIFF…WEBP`=webp；**不支持 gif/svg** | 4MB（客户端已压缩至此后再传） |
| `file`（日志等） | `.log / .txt / .json` | 必须能以 UTF-8 无致命错误解码（`TextDecoder("utf-8",{fatal:true})`，失败 415 `"该文件不是文本文件"`）；`.json` 额外 `JSON.parse` 成功 | 3MB |
| `file`（压缩包） | `.zip` | 首 4 字节 `50 4B 03 04` | 3MB |

**落盘路径**：服务端生成，`feedback/assets/_pending/{uuid4}/{安全化原文件名}`（UUID 来自 `crypto.randomUUID()`；安全化函数与 02 文档 §7.1 一致：保留汉字/字母/数字/`_`/`-`/`.`，替换空白与 `\/:*?"<>|`，扩展名转小写，主名 ≤80 字符，空名回退 `file`）。422（路径已存在）换新 uuid 重试 ≤3 次。表单正式提交时服务端改名归位到 `feedback/assets/{id}/{s|a}{n}-{安全化原文件名}`（截图 `s{n}-` 前缀、日志附件 `a{n}-` 前缀，见 02 文档 §7.1）。`originalName`（sanitize：去路径分隔符与控制字符、≤100 字）在响应中作显示用。

**成功响应** `200`：

```json
{
  "ok": true,
  "ref": "_pending/8a7b6c5d-4e3f-4a2b-1c0d-9e8f7a6b5c4d/aisc-debug.log",
  "originalName": "aisc-debug.log",
  "size": 582912
}
```

**典型错误**：413 `"文件过大（图片上限 4MB / 文件上限 20MB）"`；415 `"不支持的文件格式"`；429 `"上传太频繁，请稍后再试"`（限流见第 7 节）。

### 3.3 GET /api/asset

`GET /api/asset?path=feedback/assets/20260921-143005-a1b2c3/s1-导出闪退.png`（`path` 需 encodeURIComponent）

**路径白名单**（`src/lib/attachments.ts` 内正则，先于任何网络调用执行，与 02 文档 §7.3 一致）：

```
^feedback/assets/[0-9]{8}-[0-9]{6}-[a-z0-9]{6}/[A-Za-z0-9一-龥._-]+$
```

规则要点：必须以 `feedback/assets/` 开头；目录段必须匹配 id 格式；**拒绝** `..`、二次编码 `%2e%2e`、以 `/` 开头、反斜杠、`\0`、任何 `.github` 前缀、以及 `_pending`（未提交完成的临时文件不可访问——上面正则天然排除，因目录段只匹配 id 形态）；扩展名必须 ∈ jpg/png/webp/log/txt/json/zip。另校验所属反馈 md 的 `status ≠ hidden`，否则按 404 处理。

**成功响应**：经 `githubFetchRaw`（`Accept: application/vnd.github.raw`）取私有仓库字节后代理回传：

- `Content-Type`：按扩展名映射（`image/jpeg` / `image/png` / `image/webp` / `text/plain; charset=utf-8` / `application/json` / `application/zip`）；
- `Content-Disposition`：图片 `inline`，其余 `attachment`（防止浏览器直接渲染日志文本中的可疑内容）；
- `Cache-Control: public, max-age=300, immutable`（文件内容不可变，路径含 id 与随机成分；与 ISR 300s 口径一致）；
- `X-Content-Type-Options: nosniff`。

**错误**：404 → `{ "ok": false, "error": "附件不存在" }`；400 → `"文件路径不合法"`；其余 → 500 `"暂时无法读取附件，请稍后重试"`。

### 3.4 md 文件模板（服务端生成，供第 4 节引用；完整模板与示例以 02 文档 §3/§4 为准）

`feedback/{id}.md` 首次写入的内容（frontmatter 值由 `js-yaml JSON_SCHEMA` 序列化，日期带引号）。问题路径模板（8 分区）：

```markdown
---
id: "20260921-143005-a1b2c3"
product: "aisc-issues"
title: "导出报告时按钮点不动"
type: "bug"
severity: "normal"
status: "submitted"
tier: "basic"
created_at: "2026-09-21T14:30:05+08:00"
updated_at: "2026-09-21T14:30:05+08:00"
nickname: "阿明"
archived: false
---

## 问题描述

（用户描述）

## 复现步骤

（仅 type=bug 时出现本分区）

## 期望结果

## 实际结果

## 环境信息

- 浏览器 UA：Mozilla/5.0 (Windows NT 10.0; Win64; x64) ...
- 操作系统：{由 UA 推断，如 Windows 10}
- 页面地址：https://反馈站域名/submit
- 提交时间：2026-09-21 14:30:05（北京时间）

## 截图

![截图 1](feedback/assets/20260921-143005-a1b2c3/s1-屏幕截图.png)

## 附件

[aisc-debug.log](feedback/assets/20260921-143005-a1b2c3/a1-aisc-debug.log)

## 开发者回复

（暂无）
```

功能路径模板（7 分区，`type: "feature"`、`severity: "normal"`、`tier: "basic"` 服务端固定写入）：`## 想要的功能` / `## 想解决的问题` / `## 使用场景` / `## 现状的替代办法` / `## 环境信息`（仅浏览器 UA 与提交时间两项）/ `## 截图` / `## 开发者回复`——分区名与顺序见 02 文档 §3.2；**无 `## 附件` 分区**（功能路径不接受日志附件）。

md 内图片与附件一律写**仓库相对路径**（`feedback/assets/{id}/...`，GitHub 原生可看）；前端渲染时由 `issue-detail.tsx` 重写为 `/api/asset?path=...`（见 02 文档 §7.3 与第 8 节 XSS 条目）。

可选字段缺省不写入：`nickname` 为空则整行省略；`duplicate_of` 仅在标记重复时由开发者手工加入。回信协议：开发者在 `## 开发者回复` 下追加 `### 2026-09-22 10:15 开发者` 小节（支持多轮），同时把 frontmatter 的 `status` 改为 `replied`（或终态）并更新 `updated_at`；v1 开发者直接在 GitHub 网页编辑，本站不建管理后台。

---

## 4. lib 分层

与参考项目同一分层思想（纯 HTTP → 纯函数 → 编排 → 薄控制器 → 服务端读层），依赖方向单向向下：

```
src/app/api/*/route.ts        薄控制器：解析请求、调 lib、组装响应（无业务规则）
        │
src/lib/feedback.ts           编排层（对应参考项目 github.ts 的角色）：
        │                     createFeedback / listFeedback / getFeedback / relocatePendingAssets
src/lib/data.ts               服务端读层（对应参考项目 data.ts）：供 Server Component 调用
        │
        ├────────────────────────────────────────┐
src/lib/github-client.ts                       src/lib/markdown-utils.ts
纯 HTTP（自参考项目整层搬用）：                  纯函数（自参考项目精简改造）：
· getConfig() 读 GITHUB_PAT/REPO_OWNER/REPO_NAME · MATTER_OPTS（js-yaml JSON_SCHEMA）
· githubFetch / githubFetchRaw（Bearer 鉴权、     · parseFrontmatter / setFrontmatterField
  错误脱敏为 "GitHub API error {status}"、        · renderFeedbackMarkdown（正文分区模板）
  409 → GitHubConflictError）                     · appendDeveloperReply（回信追加）
· withConflictRetry（409 重试壳，更新场景）        · extractReplyExcerpt（回复摘要约100字）
· encodeBase64 / decodeBase64 / encodeBase64Bytes · extractSections / extractTitle
· GitHubApiError / GitHubConflictError            （日期类值经 JSON_SCHEMA 保持字符串，
                                                    +08:00 不被改写为 UTC）
```

**与参考项目的差异（必须改造处）**：

1. `github-client.ts` 基本原样搬用；鉴权从 classic PAT（`ghp_`）换为 **fine-grained PAT**（`github_pat_`）——`Authorization: Bearer` 写法不变，仅环境变量取值不同；`githubFetch` 增加 `cache` 参数（读路径传 `next: { revalidate: 300 }`，写路径保持 `no-store`）。
2. 参考项目 `github.ts` 的业务（灵感/日记 CRUD）全部不搬；`feedback.ts` 只实现本站编排：生成 id → 渲染 md → PUT 创建 → 附件归位（`GET pending 原始字节 → PUT assets/{id}/ → DELETE pending`，`p-limit(3)` 控并发，DELETE 失败不阻断——孤儿文件 v1 不清理）。
3. `auth.ts`（PIN 锁）**删除**，替换为 `rate-limit.ts` + 蜜罐 + Origin 校验。
4. `api.ts`（客户端 `apiFetch` 附 `x-app-pin` 头）改为无鉴权头版本，内置于表单组件。
5. `data.ts` 从"每次实时 `no-store`"改为 **ISR `revalidate=300`**（第 5 节）。
6. 渲染端 markdown 配置去掉 katex/mermaid/highlight（反馈站用不到），保留 `remark-gfm` + `rehype-sanitize` 并收紧 schema（第 8 节）。

---

## 5. 读取与刷新（ISR）

**实现**：

- 读页面（`/`、`/issues`）在 `page.tsx` 导出 `export const revalidate = 300;`（秒）；
- `data.ts` 内所有读取经 `githubFetch(path, { next: { revalidate: 300 } })`，与页面级 revalidate 对齐；回信区双 Tab（「问题」/「功能建议」）各取最多 10 条有回复条目，按 `updated_at` 倒序，状态中文用双映射；
- `/issue/[id]` 详情页公开可访问（编号 6 位随机串已提供不可枚举性，`?t=` token 作为提交者凭证随专属链接携带但**不作强制拦截**，与 01/02 文档口径一致），同样走 ISR `revalidate = 300`，仅对 `status=hidden` 的条目整页显示隐藏提示；
- 成功页 `/submit/success` 为纯客户端页（读 sessionStorage），无数据获取。

**为什么禁止构建期拉取**（`generateStaticParams`、顶层 await、无 revalidate 的静态化一律禁止）：

1. 构建期拉取要求 `GITHUB_PAT` 在 Build 环境变量中可用，凭据暴露面从运行时扩大到 CI 构建环境；
2. GitHub 慢或限流时 `next build` 直接失败，反馈站整体发不出去；
3. 每次部署额外消耗 API 配额，且构建产物在下次部署前一直陈旧——与"3 个工作日内回复"的时效承诺冲突。

**为什么禁止浏览器直连 GitHub API**：

1. 未认证 REST 限流 **60 次/小时/ IP**，几十个访客就把整站配额打光；而服务端持 PAT 为 **5000 次/小时**——差 83 倍；
2. 要在浏览器直连私有仓库就必须把 PAT 以 `NEXT_PUBLIC_*` 形式下发，直接违反基线"凭据只存服务端"；
3. 大陆网络不可达 `api.github.com` 与 `raw.githubusercontent.com`，浏览器直连必然超时。

结论：所有 GitHub 访问收敛在 Vercel 服务端函数 + ISR 缓存之内。

---

## 6. 幂等与冲突重试

### 6.1 幂等键（防重复提交）

```
表单挂载（use-draft）
  → idempotencyKey = crypto.randomUUID()（随草稿一起存 localStorage 键 aisc:draft）
提交（即使失败重试，键不变）
  → POST /api/feedback，body.idempotencyKey === header x-idempotency-key
服务端（src/lib/rate-limit.ts 同文件的内存 Map，TTL 15 分钟）
  key 已有 done 结果 → 原样返回缓存结果（不再写仓库）
  key 处理中        → 409 { "ok":false, "error":"正在提交，请稍候…" }（客户端不重试此错误）
  否则             → 登记 in-flight → 执行 → 结果写回 Map
成功后（客户端）
  → sessionStorage 写 aisc:last-submit={id,token,url}，清空草稿与幂等键，禁用提交按钮
```

第二道防线：提交按钮点击即置 `submitting` 态、网络层超时 30s。内存 Map 在 Serverless 冷启动/多实例下是**尽力而为**，两层叠加后误重复概率可忽略；此为 v1 接受的取舍（与第 7 节限流选型一致）。

### 6.2 409/422 冲突换随机串重试（`src/lib/feedback.ts`）

创建 `feedback/{id}.md` 走 PUT 无 SHA；路径已存在（同秒 + 同随机串撞车，或 GitHub 读副本抖动）会得到 422/409。算法：

```pseudo
async function createFeedback(input):
    stamp = beijingStamp()                 # "20260921-143005"，+08:00
    for attempt in 0..3:                    # 最多 4 次尝试 = 首次 + 重试 ≤3
        suffix = randomLowerAlnum(6)        # 每次尝试都重新生成 6 位随机串
        id = stamp + "-" + suffix
        try:
            md = renderFeedbackMarkdown(input, id)        # 纯函数，含 frontmatter
            return await githubPutFile("feedback/" + id + ".md", md)   # 无 SHA 创建
        catch e:
            if (e.status == 409 or e.status == 422) and attempt < 3:
                await sleep(500 * 2 ** attempt)            # 500ms → 1000ms → 2000ms 指数退避
                continue
            throw e                        # 交由 route 层脱敏为中文 500 文案
    # 4 次仍失败：返回 500 "提交暂时失败，内容已保留，请稍后重试"
```

附件归位 `_pending → assets/{id}` 的 PUT 同样适用此重试（换文件内随机串不适用时，退化为整条 500 重试）。`withConflictRetry`（GET 新 SHA 再 PUT）保留在 github-client，供未来更新场景。

### 6.3 客户端降级三层（与基线一致）

1. 填写过程中：草稿实时存 `localStorage`（含幂等键与已上传附件 ref），刷新/断网可恢复；
2. 提交失败：服务端重试 ≤3（上述算法），期间表单内容不动；
3. 仍失败：停留失败态，展示"内容已全部保留，请稍后点'重新提交'"，不跳转、不清空。

---

## 7. 限流与蜜罐

### 7.1 规则

- `POST /api/feedback`：同 IP **5 次/小时** + 两次提交间隔 **60 秒冷却**；超限 429 `"提交太频繁了，请 1 小时后再试"` / `"刚提交过，请 1 分钟后再试"`。
- `POST /api/attachment`：同 IP 20 次/小时（设计补充值，防刷存储；基线未规定，取反馈配额的 4 倍）。
- IP 取值：`request.headers.get("x-forwarded-for")` 首段，去掉端口；取不到时按 `unknown` 合并计数（宁可误伤也不放行）。

### 7.2 两方案对比与 v1 选型

| | Upstash Redis | 函数内存近似（`Map<ip, {count, windowStart, lastAt}>`） |
|---|---|---|
| 精度 | 跨实例精确全局计数 | 每个热实例各自计数，冷启动清零（限流近似偏松） |
| 依赖 | 需注册第三方账号、2 个环境变量、一次 REST 往返（≈50ms） | 零依赖、零延迟、零成本 |
| 失效模式 | Redis 不可用时需降级逻辑 | Serverless 扩容多实例时阈值被动放大 |
| v1 | 预留：环境变量 `UPSTASH_REDIS_REST_URL/TOKEN` 非空即自动启用 | **v1 选用** |

**v1 选函数内存**，理由：反馈站流量极小，单热实例即可承载，近似限流足以拦住脚本灌水（蜜罐 + 字段白名单兜底）；不引入需要境外注册的第三方服务，与"大陆优先、零墙外依赖"一致。实现要点：模块级 `Map` + 惰性清理（每次写入时删除过期项，Map 超 10000 键整体重置防内存膨胀）。

### 7.3 蜜罐字段

`honeypot-field.tsx` 渲染隐藏输入 `name="website"`：`position:absolute; left:-9999px; opacity:0`、`tabIndex={-1}`、`autoComplete="off"`、`aria-hidden="true"`，置于表单首字段之前。真人（含读屏用户跳过）不会填；机器人常填。服务端：`website` 非空 → **不写仓库、不计入限流、返回 200 伪成功**（响应体带合法格式的假 id），避免向攻击者泄露判定结果。

---

## 8. 安全清单（逐项可勾选）

- [ ] **PAT 最小权限**：fine-grained PAT，Repository access 仅勾选私有反馈仓库（不含网站代码仓库）；Permissions 仅 `Contents: Read and write`，其余（Issues/Pull requests/Metadata 外的一切）保持 No access；每 90 天轮换（TODO-USER 日历提醒）。
- [ ] **token 仅服务端**：`GITHUB_PAT / FEEDBACK_TOKEN_SECRET` 只配在 Vercel Environment Variables（Production 与 Preview 都配）；CI 检查：`grep -rn "NEXT_PUBLIC" src/` 不得命中任何敏感变量；代码中 PAT 只出现在 `github-client.ts::getConfig()`。
- [ ] **路径穿越防护**：`/api/asset` 的 `path` 必须整串匹配第 3.3 节白名单正则（天然拒绝 `../`、前导 `/`、反斜杠、`\0`）；lib 层 `githubPutFile / getFileContent / getRawFile` 均沿用参考项目的双保险断言：`path.includes("..") || path.startsWith("/")` → 抛错；写入路径额外拒绝 `.github/` 前缀（保护仓库工作流配置）。
- [ ] **XSS**：详情页/回复渲染统一 `react-markdown` + `remark-gfm` + `rehype-sanitize`；sanitize schema 显式设置 `protocols: { href: ["http", "https", "mailto"] }`，`javascript:` 等协议链接被剥离；默认 schema 不放行原始 HTML 与 `<script>`；图片只允许 `/api/asset` 相对路径（渲染组件再过滤一层非 `/api/asset` 开头的 src）。
- [ ] **字段白名单与长度上限**：第 3.1 节校验表为唯一入口（按路径区分），白名单外字段整体 400；`title≤50 / description≤2000 / steps≤2000 / expected、actual≤1000 / scenario、workaround≤500 / nickname≤20 / ua≤300`；功能路径请求体带 `attachments` 引用即 400。
- [ ] **服务端错误脱敏**：`githubFetch` 对外只抛 `GitHub API error {status}`；响应 `error` 字段只写预设中文文案；`console.error` 记录详情（截 500 字）供 Vercel 日志排查，绝不含 PAT。
- [ ] **EXIF 剥离**：客户端上传前 canvas 重绘导出 jpeg/webp（重编码即丢 EXIF/GPS）；服务端不解析图片元数据、忽略客户端 MIME 声明只认魔数；`.jpg/.png/.webp` 之外（尤其 svg、gif）一律 415。
- [ ] **不采集联系方式**：v0.1.0 起 `contact` 字段、`mask.ts` 与打码逻辑整体移除；仅保留选填 `nickname`（≤20 字）原文展示（私有仓库，无需打码）；字段白名单（§3.1）不含 `contact`。
- [ ] **蜜罐 + 限流**：第 7 节；`status: hidden` 供人工在 GitHub 网页隐藏垃圾条目（读层过滤 `status != hidden` 且 `archived != true`）。
- [ ] **Origin 校验**：三个 API 路由校验 `Origin` 头等于部署域名（不等或缺失的 POST → 403 `"请通过本网站提交"`）。
- [ ] **上传内容不回显为 HTML**：`/api/asset` 对非图片强制 `Content-Disposition: attachment` + `X-Content-Type-Options: nosniff`。
- [ ] **不做登录**：无 cookie、无 session、无账号体系（v1 非目标），攻击面相应收敛。

---

## 9. 大陆可达性方案

- **自定义域名（TODO-USER）**：购买域名 → DNS 添加 CNAME（或 A）记录指向 Vercel → Vercel 项目 Settings → Domains 绑定 → 等 SSL 签发。默认 `*.vercel.app` 在大陆解析/访问不稳定，**自定义域名是上线前置条件**。代码侧配合：`NEXT_PUBLIC_SITE_URL` 配置最终域名（用于 Origin 校验与成功页链接）。
- **资源全代理**：截图、日志一律走 `GET /api/asset`（服务端持 PAT 读私有仓库），页面零 `raw.githubusercontent.com` / `github.com` 直链。
- **零墙外依赖清单**（上线前逐项检查页面 Network 面板）：

| 类别 | 要求 |
|---|---|
| 字体 | 自托管 woff2 放 `public/fonts/` 经 `next/font/local` 引入，或直接用系统字体栈；**禁止** `fonts.googleapis.com` / `fonts.gstatic.com` |
| 图标 | `lucide-react`（编译为内联 SVG，无运行时请求） |
| UI 组件 | shadcn/ui 源码生成到 `src/components/ui/`，本地打包 |
| 脚本 | 无任何第三方 `<script>`（无统计、无 Sentry、无 CDN polyfill） |
| 图片 | 仅 `/api/asset` 与自托管静态资源 |
| 验证 | Turnstile 默认关闭（feature flag `TURNSTILE_ENABLED=false`）；如将来开启，`challenges.cloudflare.com` 大陆可达，且仅在服务端校验 token |

---

## 10. 环境变量表

| 变量名 | 用途 | 示例值 | Production / Preview 说明 |
|---|---|---|---|
| `GITHUB_PAT` | fine-grained PAT，私有反馈仓库 Contents 读写 | `github_pat_11AB…` | 两环境都配；仅该仓库、仅 Contents: Read and Write；90 天轮换 |
| `REPO_OWNER` | 反馈仓库所有者 | `aisc-team` | 两环境同值（沿用参考项目变量名，便于搬码） |
| `REPO_NAME` | 反馈仓库名（**不是**网站代码仓库） | `aisc-issues-feedback` | 两环境同值；仓库必须为 Private |
| `FEEDBACK_TOKEN_SECRET` | 详情页 token 的 HMAC 密钥 | `openssl rand -hex 32` 产物 | 两环境都配、值不同也可（token 随之失效，属可接受）；仅服务端 |
| `NEXT_PUBLIC_SITE_URL` | 站点对外域名（Origin 校验、链接拼接） | `https://feedback.example.cn` | Preview 配 Vercel 分发域名 |
| `TURNSTILE_ENABLED` | 人机验证开关（默认关） | `false` | 两环境默认 `false`；开启需同时配下面两项 |
| `TURNSTILE_SECRET_KEY` | Turnstile 服务端校验密钥 | `0x4AAA…` | 仅 `TURNSTILE_ENABLED=true` 时需要 |
| `TURNSTILE_SITE_KEY` | Turnstile 前端挂载 key（唯一允许的 NEXT_PUBLIC_） | `0x4AAA…` | 同上 |
| `ADMIN_TOKEN` | 可选：/admin 管理页登录令牌（不配置则管理页停用） | `openssl rand -hex 32` 产物 | 不配置即停用；仅服务端 |
| `UPSTASH_REDIS_REST_URL` | 可选：Redis 限流（v2 预留） | `https://xxx.upstash.io` | 留空 = 函数内存限流（v1） |
| `UPSTASH_REDIS_REST_TOKEN` | 同上 | `AXX…` | 留空 |

本地开发：`cp .env.example .env.local` 填齐前四项即可 `next dev`。

---

## 11. Vercel 配置

- **maxDuration**：`/api/feedback` 与 `/api/attachment` 的 `route.ts` 内 `export const maxDuration = 60;`（Hobby 计划上限；feedback 需完成 md PUT + 最多 6 个附件的 GET/PUT/DELETE 归位，attachment 需 4MB base64 上行）；`/api/asset` 不设（默认 10s 足够）。
- **请求体 4.5MB 限制与附件分传**：Vercel Serverless Functions 请求体上限 4.5MB，因此：表单 JSON 只传引用（KB 级）；每个附件单独 `POST /api/attachment`（图片 ≤4MB + multipart 开销 < 4.5MB；日志 ≤3MB）；`readLimitedBody` 在解析前再以 5MB 流式封顶，超限即断流返回 413，不进解析器。响应侧：`/api/asset` 回传单文件 ≤4MB，在限制内。
- **Root Directory**：单应用仓库，项目根即应用根，Vercel 项目设置保持默认（`.`），无需 monorepo 配置。
- **无 cron**：v1 不配置任何 Vercel Cron / 定时任务——回信区靠 ISR 被动刷新（300s），无需后台轮询；`vercel.json` 整个文件不需要创建。
- 构建命令 `next build`、Node 运行时 20.x（默认），无其他覆写。
- **函数区域（上传提速关键）**：Vercel 项目 Settings → Functions → Function Region 选 **Hong Kong (hkg1)**——大陆用户上传链路从「客户端→美东→GitHub」缩短为「客户端→香港→GitHub」，延迟显著下降。
- **大文件分片上传**：>3.5MB 的日志文件由客户端按 3.5MB 切片（uploadId/index/total），全部写完调 finalize 由服务端按序合并并做内容校验，绕开单请求 4.5MB 限制；合并/归位读取一律用 raw 方式（Contents API JSON 读 >1MB 文件不返回 content）。

---

## 12. 参考项目文件映射表

参考项目根：`_reference/Inspirations-Farm-App/inspirations-farm-app/`

### 可直接搬用（含改造说明）

| 参考路径 | 去向 | 改造说明 |
|---|---|---|
| `src/lib/github-client.ts` | `src/lib/github-client.ts` | 几乎原样：PAT 换 fine-grained（仅换环境变量值）；`githubFetch` 增加 cache 参数（读传 `next:{revalidate:300}`，写保持 `no-store`） |
| `src/lib/markdown-utils.ts`（`MATTER_OPTS/parseFrontmatter/setFrontmatterField/parseMarkdown/extractTitle`） | `src/lib/markdown-utils.ts` | 保留 frontmatter 纯函数（JSON_SCHEMA 日期安全）；删任务/笔记/焦点系列；新增 `renderFeedbackMarkdown / appendDeveloperReply / extractReplyExcerpt` |
| `src/lib/attachments.ts`（`sniffImageType/readLimitedBody/RequestBodyTooLargeError`） | `src/lib/attachments.ts` | `sniffImageType` 删 gif 分支；新增 `.log/.txt/.json` UTF-8 校验与 `.zip` 魔数；路径常量改 `feedback/assets/_pending` |
| `src/app/api/attachment/route.ts` | `src/app/api/attachment/route.ts` | 删 `validatePin`；改 `_pending/{uuid}` 落盘；加 `kind` 分支与文本/zip 校验；GET 部分独立为 `/api/asset` |
| `src/lib/beijing-time.ts` | `src/lib/beijing-time.ts` | 原样；新增 `getBeijingIso()` 输出 `2026-09-21T14:30:05+08:00` |
| `src/lib/image-compress.ts` | `screenshot-uploader.tsx` 内引用 | 阈值对齐 ≤4MB；删 gif 直通（基线仅 jpg/png/webp，超限统一重编码为 jpeg）；canvas 重绘即 EXIF 剥离 |
| `src/components/markdown-renderer.tsx` + `src/lib/markdown-config.ts` | `src/components/issue-detail.tsx` + `src/lib/markdown-config.ts` | 删 katex/mermaid/highlight；`rehype-sanitize` schema 加 `protocols: http/https/mailto` |
| `src/components/ui/{button,card,input,textarea}.tsx`、`src/lib/utils.ts` | 同路径 | shadcn 组件原样（用 CLI 重新生成亦可） |
| `src/app/layout.tsx` 的 viewport/manifest 配置、`src/app/capture-fab.tsx`（移动端 FAB/抽屉） | `src/app/layout.tsx`、表单页 | 原样搬用交互骨架 |
| `package.json` 的 `test` script（node --test + strip-types） | `package.json` | 同款跑法；依赖表大幅精简（去 katex/mermaid/highlight/virtual/framer 等可选） |

### 需改造后使用

| 参考路径 | 说明 |
|---|---|
| `src/lib/github.ts` | 不整体搬：以它的"编排层"骨架（getConfig+markdown-utils+PUT/409 模式）重写为 `src/lib/feedback.ts` |
| `src/lib/data.ts` | 结构保留，读取从 `no-store` 实时改为 ISR `revalidate=300`，函数换成 `getRepliedIssues/getIssue` |
| `src/app/api/github/route.ts` | 只借鉴"薄控制器 + 统一 `{ok,error}` + 中文错误"模式，端点逻辑全部新写 |
| `src/lib/api.ts` | 去掉 `x-app-pin` 头逻辑，改为普通 fetch 封装（含 30s 超时与幂等键头注入） |

### 不搬

`src/lib/auth.ts`（PIN，被限流+蜜罐替代）、`src/app/lock-screen.tsx`、`src/lib/{sentry,bilibili,cascade,focus-*,time}.ts`、`src/app/{daily-dashboard,inspiration-feed,jottings-card,focus-*,settings,tab-layout,dashboard-*}.tsx`、`src/components/{virtualized-list,mermaid-diagram,priority-picker,proxied-image}.tsx`、`public/sw.js`、`scripts/verify-*`、Sentry/relay 相关全部环境变量。

---

## 附：与基线的差异标注

> ⚠️ 待确认 1：基线给出成功链接 `/issue/{id}?t={token}` 但未定义 token 的生成与存储。本方案采用**无状态 HMAC**：`token = HMAC-SHA256(FEEDBACK_TOKEN_SECRET, id)` 取前 16 位十六进制小写；不落库、不进 frontmatter（不改动已冻结 schema）。详情页公开可访问，`t` 随专属链接携带但**不作强制拦截**（与 01 文档待确认 ②、02 文档 §8 补充口径一致）；若要求强制校验，属基线变更，需用户确认并同步修改 01/02 文档。
>
> ✅ **已拍板（2026-09-22）：按本文方案执行，即为定稿。**

> ⚠️ 待确认 2：基线冻结"扁平目录、不做年月子目录"。注意 GitHub Contents API 单目录列表在约 1000 个文件后会被截断——当 `feedback/*.md` 累计接近 1000 条时，回信区/列表读取需改用 Git Trees API 或引入归档前缀目录。v1 量级远达不到，仅预先标注风险，不改变基线。
>
> ✅ **已拍板（2026-09-22）：v1 接受此风险（触发条件与升级路径如上），即为定稿。**

> ⚠️ 待确认 3：基线规定 `/api/asset` 仅做路径白名单、未要求 token。这意味着知道完整附件 URL（含 id 与 8 位随机文件名，不可枚举）的任何人都可查看该截图/日志，且详情页图片会以该 URL 渲染。v1 按基线实现（无 token 门禁），若认为需要更强隔离，请在后续版本确认。
>
> ✅ **已拍板（2026-09-22）：v1 按"无 token 门禁"实现（路径含随机 id 不可枚举、hidden 条目 404），即为定稿。**

# 02 · 数据模型与协议

> 适用项目：AISC_ISSUES 反馈站（为软件 AISC_ISSUES 收集问题反馈与功能需求，GitHub Issues 的平民化前端，部署 Vercel）
> 决策基线：**v0.1.0（已冻结）**。本文一切定义与基线冲突时，以基线为准。本文对基线未覆盖的细节做了最小必要补充：影响数据面、需要用户拍板的补充以「⚠️ 待确认」引用块标注（全文共 3 处，均已由用户于 2026-09-22 拍板：按推荐方案执行），纯实现层细节（转义、校验顺序等）直接给出。
> 读者：AI 编码代理与开发者。本文字段名、枚举值、路径、文件名均为最终实现口径，可直接执行。

---

## 0. 存储布局总览

存储 = 一个新建的**私有** GitHub 反馈仓库（与网站代码仓库分离），经 GitHub REST Contents API 读写，凭据为仅授予该仓库 Contents: Read and Write 的 fine-grained PAT（只存 Vercel 服务端环境变量，禁止任何 `NEXT_PUBLIC_` / 客户端可见形式）。

```text
{feedback-repo}/                      # 私有反馈仓库根
├── feedback/                         # 全部反馈，扁平结构（不做年月子目录）
│   ├── 20260921-143025-a3f9kz.md     # 一条反馈 = 一个 md 文件，文件名即 id
│   ├── 20260920-155801-c7tq3e.md
│   └── assets/
│       ├── _pending/                 # 附件临时区（提交前暂存）
│       │   └── {uuid}/               # 每次上传一个 uuid 目录
│       │       └── {安全化原文件名}
│       ├── 20260921-143025-a3f9kz/   # 该条反馈的正式附件（截图 + 日志）
│       │   ├── s1-导出闪退.png
│       │   └── a1-aisc-error.log
│       └── 20260919-091512-m2x8q7/
│           ├── s1-白屏.png
│           ├── a1-aisc-debug.log
│           └── a2-配置导出.zip
```

- 每条反馈的**数据面**只有两处：`feedback/{id}.md`（frontmatter + 正文）与 `feedback/assets/{id}/`（附件）。二者以 id 关联，无需任何索引文件。
- 双路径口径：问题反馈（type ∈ bug/ux/question/other）与需求反馈（type = feature）共用同一 schema 与目录，仅正文分区模板、字段采集与状态中文文案不同（见 §1、§2、§3）。
- 附件一律先传 `feedback/assets/_pending/{uuid}/`，表单正式提交时由服务端改名归位到 `feedback/assets/{id}/`（见 §7.2）。
- 读取：Server Component + lib 层直调 GitHub，ISR `revalidate = 300`；禁止构建期拉取、禁止浏览器直连 GitHub API。

---

## 1. frontmatter 全字段表

文件头使用 YAML frontmatter（gray-matter 解析，js-yaml 指定 `JSON_SCHEMA`，避免 ISO 时间被隐式解析为 Date、`no` 被解析为 false 等 YAML 1.1 隐式类型）。**除 `archived` 外所有值一律双引号字符串**，防止含冒号/井号的文本破坏 YAML。

| 字段名 | 类型 | 必填 | 取值 / 枚举 | 前端中文映射 | 说明 |
|---|---|---|---|---|---|
| `id` | string | 是 | `^\d{8}-\d{6}-[a-z0-9]{6}$`（如 `20260921-143025-a3f9kz`） | —（即用户可见编号，原样展示） | 服务端生成，生成后永不变更；即文件名去 `.md` 后缀 |
| `product` | string | 是 | 固定 `"aisc-issues"` | AISC_ISSUES | 预留多产品；v1 表单不出现该选择，服务端硬编码写入（见 §5.4） |
| `title` | string | 是 | 1–50 字（1 个汉字/字母均计 1） | — | 问题路径 = "一句话概括"；功能路径 = "一句话概括想要的功能"。超 50 字由服务端拒绝（400），不做静默截断 |
| `type` | string | 是 | `bug` \| `feature` \| `ux` \| `question` \| `other` | 程序出错或闪退 / 功能建议 / 用着别扭不顺手 / 不会用有疑问 / 其他 | 双路径表单的 UI 组织不影响此枚举：问题路径只出现 bug/ux/question/other 四张卡片，功能路径固定 `feature` |
| `severity` | string | 问题路径必填；功能路径不采集 | `blocker` \| `normal` \| `low` | 完全没法用了 / 能用但别扭 / 小问题 | 仅问题路径表单采集（口语化三档）；功能路径由服务端固定写入 `"normal"`，保证 schema 单一 |
| `status` | string | 是 | `submitted` \| `in-progress` \| `replied` \| `resolved` \| `wontfix` \| `duplicate` \| `hidden` | 双路径双映射：已收到；处理中/开发中；已回复；已解决/已上线；暂不处理/暂不计划；重复；已隐藏（详见 §2.1） | 提交时服务端写 `submitted`；此后仅开发者可改（见 §2.2） |
| `tier` | string | 是 | `basic` \| `detailed` | 基本反馈 / 详细反馈 | 问题路径 = 是否随表单提交了日志等辅助附件（≥1 个 ⇒ `detailed`，否则 ⇒ `basic`）；功能路径固定 `basic` |
| `created_at` | string | 是 | ISO 8601，带 `+08:00` 偏移：`"2026-09-21T14:30:25+08:00"` | 2026-09-21 14:30 | 提交时服务端生成，永不变更 |
| `updated_at` | string | 是 | 同上格式 | 2026-09-20 10:05 | 提交时初始值 = `created_at`；此后开发者每次编辑（改 status 或追加回复）必须同步更新 |
| `nickname` | string | 否 | 自定义称呼原文；≤20 字符 | —（私有仓库，原文展示，无需打码） | 两条路径均选填；v0.1.0 起不采集任何联系方式（原 `contact` 字段与打码逻辑整体移除）；未填时整个字段省略 |
| `duplicate_of` | string | 否 | 另一条反馈的 `id` | "与编号 xxx 重复" | 仅 `status: duplicate` 时应有值；其余状态省略该字段 |
| `archived` | boolean | 是 | `true` \| `false`（YAML 裸布尔，不加引号） | 已归档 | 服务端始终显式写入，默认 `false`；`true` = 已完结归档，不再进入任何列表，但专属详情页仍可访问。与 `hidden`（内容不可见）语义不同 |

**服务端校验（`POST /api/feedback` 写入前强制，按路径区分规则）**：

1. 字段白名单：以上 12 个字段之外一律拒绝；所有枚举值必须命中上表小写英文原值。
2. 长度：`title` ≤ 50 字、详细描述 ≤ 2000 字、`nickname` ≤ 20 字符、使用场景与现状替代办法各 ≤ 500 字（后两项为服务端上限约定，防超长请求）。
3. `id` / `product` / `created_at` / `updated_at` / `status`（初始）/ `archived` 忽略客户端传入值，由服务端生成覆盖。
4. 问题路径：`type` ∈ {`bug`,`ux`,`question`,`other`}，收到 `feature` 即 400；`severity` 必填。
5. 功能路径：`type` 强制 `feature`；`severity` 覆写 `normal`；`tier` 覆写 `basic`；请求体出现日志附件引用即 400（日志上传仅问题路径提供）。

对应 TypeScript 类型（放 `src/lib/types.ts`）：

```ts
export const TYPE_VALUES = ["bug", "feature", "ux", "question", "other"] as const;
export const SEVERITY_VALUES = ["blocker", "normal", "low"] as const;
export const STATUS_VALUES = ["submitted", "in-progress", "replied", "resolved", "wontfix", "duplicate", "hidden"] as const;
export const TIER_VALUES = ["basic", "detailed"] as const;
export const PRODUCT_IDS = ["aisc-issues"] as const;

export type FeedbackType = (typeof TYPE_VALUES)[number];
export type Severity = (typeof SEVERITY_VALUES)[number];
export type FeedbackStatus = (typeof STATUS_VALUES)[number];
export type Tier = (typeof TIER_VALUES)[number];

export interface FeedbackFrontmatter {
  id: string;                    // 20260921-143025-a3f9kz
  product: "aisc-issues";
  title: string;
  type: FeedbackType;
  severity: Severity;            // 功能路径恒为 "normal"
  status: FeedbackStatus;
  tier: Tier;                    // 功能路径恒为 "basic"
  created_at: string;            // "2026-09-21T14:30:25+08:00"
  updated_at: string;
  nickname?: string;            // 选填称呼，≤20 字（v0.1.0 以 contact 换入）
  duplicate_of?: string;         // 仅 status = duplicate
  archived: boolean;             // 恒为 false（v1）
}

export const ID_PATTERN = /^\d{8}-\d{6}-[a-z0-9]{6}$/;
```

---

## 2. 状态机（status）

### 2.1 七个状态：双路径中文映射、含义与可见性

| status | 问题路径中文 | 功能路径中文 | 含义 | 列表/搜索可见 | 详情页 `/issue/{id}` 可见 |
|---|---|---|---|---|---|
| `submitted` | 已收到 | 已收到 | 用户已提交，开发者尚未处理（**初始状态**，提交时服务端写入） | 是 | 是 |
| `in-progress` | 处理中 | 开发中 | 开发者已认领：问题正在排查 / 功能已列入开发计划 | 是 | 是 |
| `replied` | 已回复 | 已回复 | 开发者已在 `## 开发者回复` 下追加至少一轮回复，等待用户确认 | 是 | 是 |
| `resolved` | 已解决 | 已上线 | 问题已修复 / 功能已发布 | 是 | 是 |
| `wontfix` | 暂不处理 | 暂不计划 | 明确不做，理由须写入开发者回复 | 是 | 是 |
| `duplicate` | 重复 | 重复 | 与已有反馈重复；**必须**同时填 `duplicate_of` | 是 | 是（显示"与编号 {duplicate_of} 重复"并给出跳转链接） |
| `hidden` | 已隐藏 | 已隐藏 | 垃圾/灌水/含敏感信息，人工隐藏 | 否 | 整页仅显示「该反馈已被隐藏，无法查看。」 |

**双映射的实现口径**：同一枚举两套文案，按 `category` 派生值选择（见 §5.5）：`category === "issue"` 用问题列，`category === "feature"` 用功能列。存储始终只有英文枚举，中文文案只存在于前端映射表（`src/lib/status-labels.ts`），不迁移、不入库。

**首页回信区（双 Tab）收录口径**：「问题」Tab = `category === "issue"`，「功能建议」Tab = `category === "feature"`；各自收录 `## 开发者回复` 分区**存在实际内容**（非"（暂无）"占位）的条目，与 status 无关（`resolved`/`wontfix`/`duplicate` 条目若有回复同样收录）；按 `updated_at` 倒序取前 10 条；每条 = 标题 + 类型/状态中文标签（状态用双映射）+ 回复摘要（约 100 字）+ 更新时间。

### 2.2 修改权限与流转规则

- **谁可以改**：仅开发者。途径 = 直接在 GitHub 网页编辑 md 文件（v1 不建管理后台，站点无任何 status 写入口）。网站代码只在**创建时**写入初始 `submitted`，之后绝不改 status。用户提交后不可自行编辑或撤回（v1）。
- **流转规则**：**允许任意两个状态间流转，不做强校验**——包括"重开"（如 `resolved → in-progress`、`wontfix → in-progress`），无状态机合法性拦截，也没有历史记录（回退依据靠开发者回复分区的内容留痕）。
- **软约定**（建议路径，非强校验）：`submitted → in-progress → replied → resolved`；`duplicate`/`hidden`/`wontfix` 为终态倾向但可随时改回。
- **硬约定**（服务端与开发者共同遵守）：
  1. 改 `status` 的同一次编辑必须同步更新 `updated_at`，否则回信区排序失真；
  2. `status: duplicate` 必须配 `duplicate_of`（指向仍存在的反馈 id），且指向目标不得是 `hidden`；
  3. `hidden` 是内容级"不存在"：列表、搜索、回信区、详情页、`/api/asset` 均按 404 处理（`/api/asset` 校验所属反馈 md 是否为 hidden）；
  4. `duplicate` 与 `hidden` 区别：duplicate 保留原始内容供用户经专属链接查看并跳转目标；hidden 彻底不可见。二者都**不删除文件**，随时可手工改回；
  5. 同时满足 duplicate 与 hidden 语义时（重复且是垃圾）：以 `hidden` 为准，`status` 写 `hidden`。
- `archived` 与 status 正交：归档只影响列表可见性，不代表内容状态，v1 通常保持 `false`。

---

## 3. 正文分区模板（按路径区分）与转义规则

每条反馈的正文（frontmatter 之后）由服务端按下述固定顺序生成。完整示例见 §4。

### 3.1 问题路径模板（type ∈ bug/ux/question/other）

```markdown
## 问题描述
{表单"详细描述"原文，≤2000 字}

## 复现步骤          ← 仅 type=bug 生成此分区；ux/question/other 整段省略（连标题也不写）
{用户填写的复现步骤原文；未填则写"（未提供）"}

## 期望结果
{原文；未填则"（未提供）"}

## 实际结果
{原文；未填则"（未提供）"}

## 环境信息
- 浏览器 UA：{navigator.userAgent}
- 操作系统：{由 UA 推断，如 Windows 10 / macOS / Android}
- 页面地址：{location.href，提交时所在页}
- 提交时间：{YYYY-MM-DD HH:mm:ss（北京时间）}

## 截图
{每张一行：![截图 n](feedback/assets/{id}/s{n}-{安全化原文件名})；无则"（无）"}

## 附件
{每个一行：[文件名](feedback/assets/{id}/a{n}-{安全化原文件名})；仅 detailed 档有；无则"（无）"}

## 开发者回复
（暂无）
```

### 3.2 功能路径模板（type = feature）

```markdown
## 想要的功能
{表单"详细描述"原文（想解决什么问题、希望怎么用），≤2000 字}

## 想解决的问题
（未提供）          ← 已定稿（2026-09-22）：不拆分表单字段，维持此初始占位

## 使用场景
{选填原文（什么时候会用到）；未填则"（未提供）"}

## 现状的替代办法
{选填原文（现状的替代办法/痛点）；未填则"（未提供）"}

## 环境信息
- 浏览器 UA：{navigator.userAgent}
- 提交时间：{YYYY-MM-DD HH:mm:ss（北京时间）}

## 截图
{每张一行：![截图 n](feedback/assets/{id}/s{n}-{安全化原文件名})；无则"（无）"}

## 开发者回复
（暂无）
```

功能模板**没有 `## 附件` 分区**：日志附件上传仅问题路径提供，功能路径请求体出现附件引用即 400（见 §1 校验第 5 条）。功能路径环境信息仅 UA 与提交时间两项（不含操作系统、页面地址）。

> ⚠️ 待确认：基线 v0.1.0 的功能路径表单只有两个自由文本字段（"一句话概括想要的功能" + 一个"详细描述"），但正文模板有「## 想要的功能」与「## 想解决的问题」两个分区。本文补充约定：详细描述原文整体写入「## 想要的功能」，「## 想解决的问题」初始写"（未提供）"。若希望两分区都有内容，需把表单"详细描述"拆成两个字段（属表单设计变更，需用户确认后同步修改 01/03 文档与本模板）。
>
> ✅ **已拍板（2026-09-22）：按本文约定执行（不拆字段，「## 想解决的问题」初始为"（未提供）"），即为定稿。**

### 3.3 生成与转义规则（服务端 `POST /api/feedback` 执行）

1. 环境信息由前端随表单 payload 提交（UA/OS/URL/提交时间四项，功能路径两项），**不是表单项**，用户不可见不可改；服务端仍做长度白名单校验（每项 ≤ 500 字符）。
2. 用户自由文本（描述/步骤/期望/实际/场景/替代办法）入库前：剥离 `\x00-\x08\x0B\x0C\x0E-\x1F` 控制字符（保留 `\n`）；行首的 `#{1,6} `（1–6 个 # 加空格）统一加反斜杠转义为 `\# `，防止用户文本伪造分区标题或"### 日期 开发者"回复标题；详细描述截断 2000 字。
3. `title` 为 frontmatter 单行值，不适用行首转义，但需剥离换行。
4. 各分区标题（`## xxx`）由服务端模板生成，用户内容永远在分区标题之下；两个模板的分区顺序固定如上，不得增删调序。

---

## 4. 完整示例文件（可直接作模板与测试样例）

### 4.1 示例一：问题路径 basic 档 bug —— `feedback/20260921-143025-a3f9kz.md`

````markdown
---
id: "20260921-143025-a3f9kz"
product: "aisc-issues"
title: "导出报表时软件闪退"
type: "bug"
severity: "blocker"
status: "submitted"
tier: "basic"
created_at: "2026-09-21T14:30:25+08:00"
updated_at: "2026-09-21T14:30:25+08:00"
nickname: "阿明"
archived: false
---

## 问题描述

点导出报表按钮，进度条走到一半软件直接闪退，重新打开后文件没了，试了三次都这样，月底要交报表很着急。

## 复现步骤

1. 打开 AISC_ISSUES，进入"报表"页
2. 选好时间范围，点"导出报表"
3. 进度条走到一半，软件整个消失

## 期望结果

导出成功，文件正常保存。

## 实际结果

软件闪退，导出文件丢失。

## 环境信息

- 浏览器 UA：Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36
- 操作系统：Windows 10
- 页面地址：https://feedback.example.com/
- 提交时间：2026-09-21 14:30:25（北京时间）

## 截图

![截图 1](feedback/assets/20260921-143025-a3f9kz/s1-导出闪退.png)

## 附件

（无）

## 开发者回复

（暂无）
````

### 4.2 示例二：问题路径 detailed 档含附件、含两轮回复 —— `feedback/20260919-091512-m2x8q7.md`

````markdown
---
id: "20260919-091512-m2x8q7"
product: "aisc-issues"
title: "登录后偶尔白屏，重试几次才进主页"
type: "bug"
severity: "normal"
status: "replied"
tier: "detailed"
created_at: "2026-09-19T09:15:12+08:00"
updated_at: "2026-09-20T10:05:33+08:00"
archived: false
---

## 问题描述

最近一周大概每三五次登录就有一次白屏，浏览器刷新几次能恢复，附了软件日志和一个配置导出包，麻烦看一下。

## 复现步骤

1. 打开软件，输入账号密码登录
2. 偶发（约三成概率）停在白屏
3. 按 F5 刷新 2–3 次后正常进入主页

## 期望结果

登录后一次就进入主页。

## 实际结果

偶发白屏，需多次刷新。

## 环境信息

- 浏览器 UA：Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36
- 操作系统：Windows 11
- 页面地址：https://feedback.example.com/
- 提交时间：2026-09-19 09:15:12（北京时间）

## 截图

![截图 1](feedback/assets/20260919-091512-m2x8q7/s1-白屏.png)

## 附件

[aisc-debug.log](feedback/assets/20260919-091512-m2x8q7/a1-aisc-debug.log)

[配置导出.zip](feedback/assets/20260919-091512-m2x8q7/a2-配置导出.zip)

## 开发者回复

### 2026-09-19 16:40 开发者

日志已收到，定位到是登录回调里一次未捕获的异常，下个版本修复。麻烦留意更新公告。

### 2026-09-20 10:05 开发者

修复已进入内测，预计本周五发布版本 1.4.2，届时麻烦升级后帮忙确认一下。
````

### 4.3 示例三：功能路径 feature（提交时初始状态）—— `feedback/20260920-155801-c7tq3e.md`

`severity: "normal"` 与 `tier: "basic"` 由服务端固定写入（功能路径不采集严重程度、不提供日志上传）；`## 想解决的问题` 按 §3.2 约定初始为"（未提供）"。

````markdown
---
id: "20260920-155801-c7tq3e"
product: "aisc-issues"
title: "希望能批量导出报表"
type: "feature"
severity: "normal"
status: "submitted"
tier: "basic"
created_at: "2026-09-20T15:58:01+08:00"
updated_at: "2026-09-20T15:58:01+08:00"
nickname: "小王"
archived: false
---

## 想要的功能

希望报表页支持批量导出：可以勾选多个报表，一次全部导出成一个压缩包，方便月底汇总。

## 想解决的问题

（未提供）

## 使用场景

每个月底要把当月所有报表汇总发给我们领导，现在得一张一张导出再自己打包。

## 现状的替代办法

手动一张张导出，再用压缩软件打包，大概要十多分钟，偶尔会漏掉一两张。

## 环境信息

- 浏览器 UA：Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36
- 提交时间：2026-09-20 15:58:01（北京时间）

## 截图

![截图 1](feedback/assets/20260920-155801-c7tq3e/s1-批量导出参考图.png)

## 开发者回复

（暂无）
````

---

## 5. 文件命名与目录规则

### 5.1 id 生成算法（服务端，`POST /api/feedback` 内）

`id = {北京时间 YYYYMMDD}-{HHmmss}-{6 位随机 [a-z0-9]}`，例如 `20260921-143025-a3f9kz`。时间部分与 `created_at` 取**同一个 now 值**（见 §9）。随机部分用密码学随机源，禁止 `Math.random`：

```ts
import { randomInt } from "node:crypto";

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789"; // 36 个字符

function randomSuffix(len = 6): string {
  let out = "";
  for (let i = 0; i < len; i++) out += ALPHABET[randomInt(0, 36)]; // randomInt 无模偏差
  return out;
}

// nowMs 为本次提交取定的统一时刻
function makeId(nowMs: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(nowMs));
  const get = (t: string) => parts.find(p => p.type === t)!.value;
  return `${get("year")}${get("month")}${get("day")}-${get("hour")}${get("minute")}${get("second")}-${randomSuffix()}`;
}
```

### 5.2 防冲突机制

1. 概率层：随机段 36⁶ ≈ 21.7 亿组合，同一秒内两人提交且随机串全同的概率可忽略。
2. 预检层：PUT 之前先 `GET /repos/{owner}/{repo}/contents/feedback/{id}.md`，返回 200 即视为冲突（新建必须 404）。
3. 重试层：Contents API PUT 返回 409/422（路径已存在/sha 冲突）时，**仅重掷 6 位随机串，时间戳不变**，重试 ≤ 3 次，指数退避 500ms / 1s / 2s。
4. 3 次仍失败：返回提交失败页，表单内容全量保留（含 localStorage 草稿），用户可稍后重试；已上传的 `_pending` 附件引用继续有效，不重复上传。客户端另持幂等键（UUID）防双击/断网重发造成的重复提交。

### 5.3 扁平结构（不做年月子目录）的理由

- 列表页 = 一次 `GET .../contents/feedback` 列出全部 `.md` 文件名，再用 p-limit 并发拉取各文件 frontmatter（gray-matter 仅解析头部），`revalidate = 300` 缓存；年月分层则需递归多次列目录、调用次数随目录数线性增长，且 ISR 失效成本更高。
- 排序与筛选依据是 frontmatter 的 `created_at`/`status`/`type`，不依赖路径，扁平不损失任何能力。
- 规模预估：条目为个人软件反馈量级（数千条内），单目录无性能问题；真到量级再分片，届时按 `product` 分目录是第一刀（见 §5.4）。

### 5.4 `product` 字段的多产品预留

v1 单产品，服务端硬编码 `product: "aisc-issues"`，不做多产品切换 UI（v1 非目标）。未来增加产品时：先扩 `PRODUCT_IDS` 常量与表单产品选择；目录可演进为 `feedback/{product}/{id}.md`（assets 同步迁到 `feedback/assets/{product}/{id}/`）。由于每条记录的 frontmatter 已含 `product`，迁移脚本只需按字段值分组移动文件并重写路径引用，无需解析正文推断归属。

### 5.5 `category` 派生规则（不入库）

```ts
// 读取时派生，不写入任何文件
export type Category = "issue" | "feature";
export const deriveCategory = (type: FeedbackType): Category =>
  type === "feature" ? "feature" : "issue";
```

- 用途：状态中文双映射选套（§2.1）、回信区双 Tab 分流（「问题」/「功能建议」）、列表页"问题/功能"筛选维度。
- 不写入 frontmatter 的理由：`category` 由 `type` 完全决定，入库即冗余，且可能出现两字段不一致的人为错误；派生函数放 `src/lib/types.ts`，全站唯一实现。

---

## 6. 回信协议操作指引（面向开发者，GitHub 网页操作）

前提：v1 开发者直接在 GitHub 网页编辑私有反馈仓库，不建管理后台。用户经专属详情页 `/issue/{id}?t={token}` 查看回复。每次回信 = 一次文件编辑，同时完成"追加回复 + 改 status + 更新 updated_at"三件事。

### 6.1 通用步骤

1. **定位文件**：打开反馈仓库 `feedback/` 目录，按编号找到 `{id}.md`（用户来信/截图里会带编号）。文件列表按字母序排列，编号前 8 位是日期，天然按日期聚簇；也可用仓库搜索框输入 `path:feedback/ 关键词`。
2. **进入编辑**：点开文件 → 右上角铅笔图标（Edit this file）。
3. **改 frontmatter（文件头，两条 `---` 之间）**：
   - `status: "..."` 改为目标状态，**小写英文原值**（如 `"replied"`、`"resolved"`），不要写中文、不要新增枚举外的值；
   - `updated_at: "..."` 同步改为当前北京时间，格式严格为 `"2026-09-21T15:32:00+08:00"`（保留双引号，以 `+08:00` 结尾）；
   - 若标记重复：改 `status: "duplicate"`，并增加一行 `duplicate_of: "对方反馈id"`；
   - 若只是隐藏垃圾：仅改 `status: "hidden"`，不需要写回复，其余不动。
4. **追加回复（文件正文末尾）**：滚动到 `## 开发者回复` 分区，把占位的"（暂无）"删去（仅第一轮），在**已有内容下方**追加（多轮就依次往下叠，**不删除、不修改历史轮次与用户各分区内容**）：

   ```markdown
   ### 2026-09-21 15:32 开发者

   回复正文，可用 markdown（列表、代码块、加粗均可），面向不懂编程的用户请写大白话。
   ```

   标题格式固定：`### YYYY-MM-DD HH:mm 开发者`（24 小时制北京时间，精确到分）。
5. **提交**：页面底部 "Commit changes" 直接提交到默认分支（commit message 建议 `reply: {id} → {status}`，便于日后翻日志）。

### 6.2 示例 A：问题路径（bug，`feedback/20260921-143025-a3f9kz.md`，§4.1 那条）

用户报告导出闪退（`status: "submitted"`）。开发者定位并修复后：

- frontmatter 改两行：

  ```yaml
  status: "replied"
  updated_at: "2026-09-22T09:05:41+08:00"
  ```

- 正文 `## 开发者回复` 下，删去"（暂无）"，追加：

  ```markdown
  ### 2026-09-22 09:05 开发者

  收到，闪退问题已在 1.4.3 版本修复。请到官网下载最新版本更新后再试一次；如果还会闪退，请重新提交一条反馈并附上本条编号 20260921-143025-a3f9kz。
  ```

- 效果：首页「问题」Tab 出现该条（摘要取回复正文前约 100 字），状态徽章显示"已回复"。之后版本正式发布确认无问题时，再编辑一次：`status: "resolved"`（显示"已解决"）+ 更新 `updated_at` + 追加一轮 `### YYYY-MM-DD HH:mm 开发者`。

### 6.3 示例 B：功能路径（feature，`feedback/20260920-155801-c7tq3e.md`，§4.3 那条）

用户希望批量导出（`status: "submitted"`）。

- 第一步（评估通过，列入计划）：

  ```yaml
  status: "in-progress"
  updated_at: "2026-09-21T10:12:00+08:00"
  ```

  追加 `### 2026-09-21 10:12 开发者`：说明已列入 1.5.0 开发计划。前端状态徽章显示"**开发中**"（功能路径双映射）。
- 第二步（功能发布）：再编辑一次：

  ```yaml
  status: "resolved"
  updated_at: "2026-09-25T18:30:00+08:00"
  ```

  追加 `### 2026-09-25 18:30 开发者`：1.5.0 已上线批量导出，升级后在报表页勾选多个报表即可。前端状态徽章显示"**已上线**"，「功能建议」Tab 按新 `updated_at` 排到最前。

### 6.4 注意事项

- 站点 ISR 缓存 300 秒，前台最长约 5 分钟后才可见，不要以为没保存成功；
- `updated_at` 忘改的后果：回信区排序失真、详情页"更新时间"错误——发现后单独补改一次即可；
- 回复里如需贴图：把图片拖进编辑器让 GitHub 生成 `user-attachments/` 链接，该链接在详情页会作为外链处理（大陆用户可能加载不出），**优先文字说明**；站内正式附件仍走 §7 的 assets 规则；
- 一次编辑只改 status、updated_at、（可选 duplicate_of）和开发者回复分区四处，`id`/`product`/`type`/`tier`/`created_at`/`nickname` 与用户正文都别动；
- 若用户反馈为功能请求但填进了问题路径（或反之）：**不改 `type`**（保持存储稳定），在回复中说明即可；确需纠正属基线外操作，需人工评估。

---

## 7. 附件命名与引用规则

截图与日志附件（问题路径）属 **M2 里程碑**；M1 无附件上传入口，`tier` 恒为 `basic`。

### 7.1 归位后的命名（`feedback/assets/{id}/` 内）

| 类别 | 命名 | 来源 |
|---|---|---|
| 截图（两条路径均可，jpg/png/webp，≤3 张，客户端已压缩 ≤4MB/张并 canvas 重绘剥 EXIF） | `s{序号}-{安全化原文件名}`，如 `s1-导出闪退.png` | 序号按表单内顺序从 1 起 |
| 日志附件（仅问题路径 detailed 档，.log/.txt/.json/.zip，单个 ≤3MB，≤3 个） | `a{序号}-{安全化原文件名}`，如 `a1-aisc-debug.log` | 同上 |

**安全化函数**（服务端执行）：保留汉字/字母/数字/`_`/`-`/`.`；把空格与 `/ \ : * ? " < > |` 等替换为 `-`；扩展名转小写；总长超 80 字符时截断主名（保住扩展名）；处理后为空则回退为 `file`。

> ⚠️ 待确认：基线只规定了目录 `feedback/assets/{id}/` 与 `_pending/{uuid}` 临时位，未规定归位后的具体文件名。本文补充定义为 `s{n}-` / `a{n}-` 前缀 + 安全化原文件名（序号保证同条反馈内不重名，原名方便开发者辨认）。如与后续基线更新冲突，以基线为准。
>
> ✅ **已拍板（2026-09-22）：按本文命名方案执行，即为定稿。**

### 7.2 `_pending` 临时区与提交流程

1. 表单中用户每选一个附件，立即单独 `POST /api/attachment`（multipart），服务端校验类型/大小后写入 `feedback/assets/_pending/{uuid}/{安全化原文件名}`，返回该路径引用给前端暂存（绕开 Vercel 4.5MB 请求体限制：附件不走表单 JSON）。
2. 表单正式 `POST /api/feedback` 时，请求体只带引用列表（非文件本体）。服务端对每个引用执行三步归位：GET `_pending` 文件内容 → PUT 到 `feedback/assets/{id}/{最终名}` → DELETE `_pending` 文件（GitHub 无原子移动，两次写调用；中途失败按引用幂等重试，先查目标是否已存在）。归位全部成功才写入 md 并提交反馈；任一失败则整体提交失败，客户端可重试。
3. **孤儿文件**：上传到 `_pending` 后用户放弃提交或提交最终失败，即产生孤儿。**v1 不做清理**（无定时任务，fine-grained PAT 也无意赋予 workflow 权限）——私有仓库内无公开暴露面，体积以 MB 计，接受残留。未来版本可加定期脚本删除 `_pending/` 中超过 7 天的 uuid 目录（非 v1 范围）。代码注释需注明此取舍。
4. `_pending/` 永不出现在任何读取面：列表只读 `feedback/` 根层 `.md`；`/api/asset` 白名单拒绝 `_pending` 路径。

### 7.3 md 内引用与 `/api/asset` 代理的关系

- **md 内一律写仓库相对路径**（保持 GitHub 原生可看、可脚本迁移）：图片 `![截图 1](feedback/assets/{id}/s1-xxx.png)`，附件 `[文件名](feedback/assets/{id}/a1-xxx.log)`。
- 前端详情页渲染（react-markdown + remark-gfm + rehype-sanitize）时，自定义 `img`/`a` 组件把 `src`/`href` 重写为 `/api/asset?path=<encodeURIComponent(仓库相对路径)>`——因为大陆直连 GitHub raw 不可达，**一切附件与图片均经自家代理读私有仓库**。
- `GET /api/asset` 白名单（服务端强制）：
  - 路径正则：`^feedback/assets/[0-9]{8}-[0-9]{6}-[a-z0-9]{6}/[A-Za-z0-9一-龥._-]+$`（拒绝 `_pending`、拒绝 `..` 与二次编码 `%2e%2e`）；
  - 所属反馈 md 的 `status ≠ hidden`，否则 404；
  - Content-Type 白名单：`image/jpeg` / `image/png` / `image/webp`（可内联预览）、`text/plain` / `application/json` / `application/zip`（仅下载，`Content-Disposition: attachment`）；
  - 缓存头 `Cache-Control: public, max-age=300, immutable`（文件内容不可变，路径含随机串）。

---

## 8. 编号体系

- **用户可见编号 = id 本身**，格式 `20260921-143025-a3f9kz`（14 位时间 + 6 位随机）。成功页大字展示编号 + 专属详情页链接 `/issue/{id}?t={token}`，并提示"请收藏链接或截图保存编号"。
- **查询方式**：首页提供"按编号查询"输入框（M2 上线），输入完整编号跳转 `/issue/{id}`；编号不完整或不存在给"未找到该编号"空态，不支持模糊搜索。专属详情页 token 机制同为 M2；M1 成功页仅展示编号，无专属链接。
- **防遍历**：随机段 36⁶ ≈ 21.7 亿组合，叠加 token 因子，无法枚举他人反馈；`hidden` 状态 404。

> ⚠️ 待确认：基线 v0.1.0 规定了 `/issue/{id}?t={token}` 专属链接与首页"按编号查询"（无 token），但未定义 token 的生成、存储与访问控制边界（与 01 文档待确认②同源）。本文补充：`t = HMAC-SHA256(id, process.env.FEEDBACK_TOKEN_SECRET)` 的 hex 前 16 位，无状态、不落库、不进 frontmatter（避免改动已冻结 schema）；详情页公开可访问（编号 6 位随机串已提供不可枚举性），`t` 随专属链接携带但不作强制拦截——与 01 文档采用方案一致。若要求强制 token 校验，属基线变更，需用户确认并同步修改 01/03 文档。
>
> ✅ **已拍板（2026-09-22）：按本文方案执行（HMAC-SHA256 前 16 位、不落库、详情页公开、token 不强制拦截），即为定稿。**

---

## 9. 时区口径

- **全站统一北京时间 `+08:00`**：`created_at` / `updated_at` / 回复标题时间 / 文件名时间戳，一律 ISO 8601 显式偏移（`"2026-09-21T14:30:25+08:00"`）。**禁止** `Z`、`+00:00`、UTC 或无偏移写法。中国无夏令时，`Asia/Shanghai` 全年恒为 `+08:00`。
- **文件名时间与 `created_at` 一致性**：二者由服务端在提交时用**同一个 now 值**产出（见 §5.1 代码 `nowMs`），即文件名的 `YYYYMMDD-HHmmss` 就是 `created_at` 的钟面时间，二者永不矛盾；重试冲突时只换随机串、时间戳与 `created_at` 保持首次值不变。
- 精度口径：frontmatter 秒级；回复标题 `### YYYY-MM-DD HH:mm 开发者` 分钟级（人工书写易出错，分钟足够）；前端展示统一"2026-09-21 14:30"格式。
- 解析与序列化：js-yaml 用 `JSON_SCHEMA`，时间保持字符串原样（不会被解析成 Date）；服务端全程按字符串处理，前端展示直接使用或按 `Asia/Shanghai` 格式化，不做时区换算。
- 开发者手工编辑时：`updated_at` 与回复标题时间均填**北京时间**（GitHub 网页编辑器时区不影响手填的字符串值）。

---

## 10. 未来迁移：与 GitHub Issues 的字段映射

目标：任何时点可写脚本把全部 `feedback/{id}.md` 迁移为 GitHub Issues，信息无损。映射如下：

| 本站数据 | GitHub Issues 对应 | 迁移规则 |
|---|---|---|
| `title` | Issue 标题 | 原样；如需编号可见，标题后缀 `[{id}]` |
| `## 问题描述`~`## 附件`（或功能模板各分区）正文 | Issue body | 分区按原顺序拼接为一条 markdown，保留分区标题 |
| `## 开发者回复` 下各轮 `### YYYY-MM-DD HH:mm 开发者` | comments | 按 `### ` 行切分，每轮生成一条 comment，标题行保留在 comment 首行 |
| `id` | body 首行引用 `> 反馈编号：{id}` | 便于反向回链与对账 |
| `type` | label `type:{type}` | 5 枚举 → 5 个 label |
| `severity` | label `severity:{severity}` | 3 枚举 → 3 个 label |
| `status` | label `status:{status}`；`resolved`/`wontfix`/`duplicate` 迁移时同时 close issue | 7 枚举 → 7 个 label；中文双映射仅是展示层，不迁移 |
| `tier` | label `tier:{tier}` | 2 枚举 → 2 个 label |
| `product` | label `product:{product}` | v1 恒为 `product:aisc-issues` |
| `created_at` / `updated_at` | 无法改写 issue 系统时间；以 body 内"提交时间"与回复标题留痕为准 | 对账时以文件值为准 |
| `nickname` | 可写入首条 comment 首行（如「提交者称呼：阿明」）或丢弃 | 默认丢弃 |
| `duplicate_of` | close as duplicate + comment 链接目标（目标 issue 标题引用其 id） | 目标未迁移时先迁目标 |
| `hidden` | 不迁移（或迁移后立即 close + label `spam`，仅协作者可见） | 默认不迁移 |
| `archived` | label `archived` | 不影响 open/closed |
| `feedback/assets/{id}/` 文件 | 迁移脚本下载后作为 issue 附件上传，重写 body/comment 内 URL 为 GitHub 附件链接 | 路径映射表随脚本输出存档 |
| `category`（派生） | 无对应（由 `type:feature` label 推导） | 不迁移 |

迁移脚本要点：按 `created_at` 升序创建（保证 duplicate 目标先于指向者存在）；幂等（以 body 首行编号判断是否已迁移）；可用 gh CLI 或 REST/GraphQL API 实现；v1 不实现，仅保证数据结构可迁移。

# CLAUDE.md — AI 编码代理工作约定

本项目是 AISC_ISSUES 反馈站：Next.js App Router 应用，部署 Vercel，数据存私有 GitHub 反馈仓库（Contents API 读写）。动手前先读 develop_wiki.md 与 README；v0.1.0/v0.1.1 规格见 docs/archive/，进行中文档在 docs/plans/。

## 冻结基线
- 决策基线 v0.1.0 已冻结：任何文档、代码、讨论与其冲突时，一律以基线为准。
- frontmatter schema 与枚举不得擅改：product 固定 `"aisc-issues"`；type ∈ {bug, feature, ux, question, other}；severity ∈ {blocker, normal, low}（仅问题路径，功能路径默认 normal 不采集）；status ∈ {submitted, in-progress, replied, resolved, wontfix, duplicate, hidden}；tier ∈ {basic, detailed}（功能路径固定 basic）；`category` 为派生值（type==='feature' ? 'feature' : 'issue'），不写入 frontmatter；`nickname` 为可选字段（≤20 字；v0.1.0 起不采集任何联系方式，以 nickname 换入 contact）。
- 状态中文映射按 category 双映射：in-progress=问题:处理中/功能:开发中；resolved=问题:已解决/功能:已上线；wontfix=问题:暂不处理/功能:暂不计划；submitted=已收到、replied=已回复、duplicate=重复、hidden=已隐藏（两路径同）。改动须用户明示确认。
- 仓库布局（v0.1.2 演进）：`issues/{YYYYMMDD}-{概述≤20}-{提出者≤12}/` 每条一个目录，`反馈.md`（功能路径 `需求.md`）与附件同目录；仓库根 `索引.md` 由站点自动全量重建（每次提交 + 每日 cron），开发者直接改 md 的 status 即标记进度，无需管理后台（/admin 已移除，ADMIN_TOKEN 废弃）。
- v0.1.1 演进（已随 v0.1.2 一并登记）：frontmatter 新增可选 `affects`（投票计数，YAML 裸数字，缺省 0，投票不改 updated_at）；`_pending` 暂存目录名日期化 `{YYYYMMDD-HHmmss}-{uuid4}`。
- nickname 为必填（目录署名）；`id` 即目录名。
- 若认为基线有误：不要擅改，在文档中用 `> ⚠️ 待确认：` 引用块标注。

## 参考代码库（只读）
`_reference/Inspirations-Farm-App/inspirations-farm-app/` 只读，不得修改、不得提交。
可搬：src/lib/github-client.ts、src/lib/github.ts、src/lib/markdown-utils.ts、attachments 模式、api 路由骨架、表单反馈骨架、移动端 FAB/抽屉、viewport 配置。
必须改造：classic PAT → fine-grained PAT；去 PIN 锁改防滥用（蜜罐 + 同 IP 限频 5 次/小时 + 60s 冷却 + 服务端白名单校验）；「作者向 markdown 输入」改「结构化字段 + 服务端生成 md」。

## 技术栈（不得替换）
Next.js App Router + TypeScript strict + Tailwind CSS v4 + shadcn/ui + react-markdown(remark-gfm + rehype-sanitize) + gray-matter(js-yaml JSON_SCHEMA) + p-limit。

## 语言与文案
- 用户可见文案一律简体中文；枚举值一律英文小写，前端中文映射。
- 空态文案不含时限承诺（v0.1.1 R4 基线演进）：如「还没有回复，过几天再来看看。」；禁止「X 个工作日内回复」类 SLA 文案。

## 安全红线
- 禁止任何墙外资源（无 Google 字体/外部 CDN）；资源自托管或经自家 API 代理。
- GITHUB_PAT 等凭据只存 Vercel 服务端环境变量；禁止任何 NEXT_PUBLIC_ 形式或客户端可见泄漏。
- GET /api/asset 仅允许 issues/{目录}/ 白名单路径；markdown 渲染必须经 rehype-sanitize。
- 不采集任何联系方式（v0.1.0 移除 contact 字段与打码逻辑；仅保留选填 nickname ≤20 字，原文展示）；截图 EXIF 客户端剥离。

## 测试
`node --test --experimental-strip-types`（package.json 封装为 npm run test）。验收项与测试映射见 docs/archive/v0.1.0/04-implementation.md §6。

# develop_wiki — 开发规约与快速开始

> 本文件记录 AISC_ISSUES 反馈站的开发约定与继续开发的快速上手。
> 任何与冻结基线冲突的想法：先在文档里标注「⚠️ 待确认」，经确认后才能改基线。

---

## 一、项目定位

为软件 **AISC_ISSUES** 收集「问题反馈 + 功能需求」的简体中文站点——GitHub Issues 的平民化前端。目标用户：中国大陆、不懂编程，链接常在微信/QQ 内置浏览器打开。部署于 Vercel，数据存私有 GitHub 反馈仓库。

## 二、文档组织规约（重要）

| 位置 | 放什么 | 规则 |
|---|---|---|
| `docs/plans/` | **进行中版本**的开发文档 | 下一版开工时，新文档（需求/设计/计划）先放这里 |
| `docs/archive/<版本号>/` | **已完成版本**的文档 | 版本上线后用 `git mv` 从 plans 移入；按版本号建子目录（如 `v0.1.0/`） |
| 根目录 `develop_wiki.md` | 本文件：开发规约 + 快速开始 | 每次约定变化时更新 |
| 根目录 `todo.md` | 待改进 / 待开发清单 | 做完一条删一条；没有就保持空 |

> 当前状态：v0.1.0 已完成并上线，五份文档在 `docs/archive/v0.1.0/`；`docs/plans/` 为空，等待下一版需求。

## 三、双仓库结构（冻结决策，不得合并）

| 仓库 | 可见性 | 用途 |
|---|---|---|
| `Evergarden-Alan/AISC_ISSUES` | **public** | 本站代码（本仓库） |
| `Evergarden-Alan/aisc-issues-feedback` | **private** | 反馈数据（`feedback/{id}.md` + `feedback/assets/{id}/`），仅经服务端 PAT 读写 |

## 四、冻结基线 v0.1.0 要点（全文见归档文档）

- frontmatter schema 与枚举不得擅改：`product="aisc-issues"`、type 5 值、severity 3 值（仅问题路径）、status 7 值、tier 2 值；`category` 派生不入库；`nickname` 选填 ≤20 字；**不采集任何联系方式**。
- 状态中文双映射：in-progress=处理中/开发中、resolved=已解决/已上线、wontfix=暂不处理/暂不计划。
- 双路径表单：问题（type ∈ bug/ux/question/other，可传日志附件）与功能（type=feature，无附件）。
- 回信协议：`## 开发者回复` 下追加 `### YYYY-MM-DD HH:mm 开发者`，同步改 status 与 updated_at（管理页或 GitHub 网页均可）。
- 附件限制：截图 ≤10 张（≤4MB/张，客户端压缩剥 EXIF）；日志 ≤3 个（≤20MB/个，>3.5MB 自动分片上传）。
- 版本内已拍板的 10 项争议（severity 必填、详情页 token 边界、轻统计口径等）见归档文档中的「✅ 已拍板」标注。

## 五、技术栈与分层（不得替换）

Next.js App Router + TypeScript strict + Tailwind v4 + shadcn/ui 风格组件 + react-markdown(rehype-sanitize) + gray-matter(js-yaml JSON_SCHEMA) + p-limit。分层单向：route 薄控制器 → lib 编排 → github-client（纯 HTTP）/ markdown-utils（纯函数）→ data 读层；组件不碰 GitHub。lib/types 内部相对导入**必须带 `.ts` 扩展名**（node:test 直跑 TS 的前提）。

## 六、安全红线（摘要，全文见 CLAUDE.md）

- 凭据只存服务端环境变量；禁止 `NEXT_PUBLIC_` 泄漏 PAT。
- 附件读取一律 raw 方式（Contents API JSON 读 >1MB 文件不返回 content）；`/api/asset` 仅白名单路径。
- 用户可见文案简体中文；禁止墙外资源；md 渲染必须过 rehype-sanitize。

## 七、快速开始（继续开发）

```bash
git clone git@github.com:Evergarden-Alan/AISC_ISSUES.git
cd AISC_ISSUES
npm install
cp .env.example .env.local   # 填 5 个变量（见下）
npm run dev                  # http://localhost:3000
npm run test                 # 55 项单测
npm run build                # 发布前本地构建检查
```

`.env.local` 必填/可选：

| 变量 | 必填 | 说明 |
|---|---|---|
| `GITHUB_PAT` | ✅ | fine-grained PAT：仅反馈仓库、仅 Contents 读写 |
| `REPO_OWNER` / `REPO_NAME` | ✅ | `Evergarden-Alan` / `aisc-issues-feedback` |
| `FEEDBACK_TOKEN_SECRET` | ✅ | 详情页 token HMAC 密钥 |
| `NEXT_PUBLIC_SITE_URL` | 建议 | `https://feedback.alanevergarden.xyz` |
| `ADMIN_TOKEN` | 可选 | 不配则 /admin 停用 |
| `TURNSTILE_*` / `UPSTASH_*` | 可选 | 预留开关，默认关闭 |

## 八、部署与运维要点

- 部署 = `git push` 到 main，Vercel 自动构建（已绑定域名 `feedback.alanevergarden.xyz`，函数区域 **hkg1 香港**——大陆上传提速关键，勿改回美区）。
- 管理后台：`/admin`（ADMIN_TOKEN 登录，改状态 + 写回信）。
- 令牌泄漏应急、常见报错排查：见 `docs/archive/v0.1.0/05-manual-setup.md`。
- 改环境变量后必须 Redeploy。

## 九、版本历史

| 版本 | 日期 | 内容 | 文档 |
|---|---|---|---|
| v0.1.0 | 2026-09-22 | M1 双路径提交+回信区；M2 截图/日志/详情页/编号查询；M3 列表+轻统计+管理页 | `docs/archive/v0.1.0/` |

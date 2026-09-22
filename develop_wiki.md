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

> 当前状态：v0.1.0 / v0.1.1 已上线（文档在 `docs/archive/`）；`docs/plans/v0.1.2/` 为进行中文档。

## 三、双仓库结构（冻结决策，不得合并）

| 仓库 | 可见性 | 用途 |
|---|---|---|
| `Evergarden-Alan/AISC_ISSUES` | **public** | 本站代码（本仓库） |
| `Evergarden-Alan/aisc-issues-feedback` | **private** | 反馈数据：`issues/{日期-概述-提出者}/`（md + 附件同目录）+ 根目录 `索引.md`（v0.1.2 布局），仅经服务端 PAT 读写 |

**开发者工作流（v0.1.2 起）**：克隆 issues 仓库即可看全部反馈与附件；处理完直接改对应 md 的 `status` 字段标记进度（索引.md 由站点在下次提交/每日任务时自动同步，无需管理后台）。

## 四、冻结基线 v0.1.0 要点（全文见归档文档）

- frontmatter schema 与枚举不得擅改：`product="aisc-issues"`、type 5 值、severity 3 值（仅问题路径）、status 7 值、tier 2 值；`category` 派生不入库；`nickname` 必填 ≤20 字（v0.1.2 起，作目录署名）；**不采集任何联系方式**。
- v0.1.1 演进：`affects` 投票计数字段（裸数字，缺省 0）；`_pending` 暂存目录日期化；管理页于 v0.1.2 移除。
- 状态中文双映射：in-progress=处理中/开发中、resolved=已解决/已上线、wontfix=暂不处理/暂不计划。
- 双路径表单：问题（type ∈ bug/ux/question/other，可传日志附件）与功能（type=feature，无附件）。
- 回信协议：`## 开发者回复` 下追加 `### YYYY-MM-DD HH:mm 开发者`，同步改 status 与 updated_at（管理页或 GitHub 网页均可）。
- 附件限制：截图 ≤10 张（≤4MB/张，客户端压缩剥 EXIF）；日志 ≤3 个（≤20MB/个，>3.5MB 自动分片上传）。
- 提交拦截（v0.1.2）：无截图/日志 + 复现三字段全空 + 描述 <15 字时提示「难以定位问题」，用户确认后仍可提交。
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
| ~~`ADMIN_TOKEN`~~ | 已移除 | v0.1.2 删除管理页，开发者直接改 issues 仓库中的 md |
| `CRON_SECRET` | cron 需配 | v0.1.1：/api/cron/cleanup 鉴权；不配则清理任务停用（404） |
| `TURNSTILE_*` | 可选 | v0.1.1 已实现；三值齐备才启用，默认关（开启前须确认墙外脚本例外） |
| `UPSTASH_*` | 可选 | v0.1.1 已实现；非空即启用 Redis 精确限流，留空回退内存 |

## 八、部署与运维要点

- 部署 = `git push` 到 main，Vercel 自动构建（已绑定域名 `feedback.alanevergarden.xyz`，函数区域 **hkg1 香港**——大陆上传提速关键，勿改回美区）。
- 每日自动任务（v0.1.1 起，CRON_SECRET 鉴权）：03:00 清理暂存区孤儿 + 重建 `索引.md`。
- 令牌泄漏应急、常见报错排查：见 `docs/archive/v0.1.0/05-manual-setup.md`。
- 改环境变量后必须 Redeploy。

## 九、版本历史

| 版本 | 日期 | 内容 | 文档 |
|---|---|---|---|
| v0.1.0 | 2026-09-22 | M1 双路径提交+回信区；M2 截图/日志/详情页/编号查询；M3 列表+轻统计+管理页 | `docs/archive/v0.1.0/` |
| v0.1.1 | 2026-09-22 | 上传进度（百分比+速度）；_pending 日期化+每日自动清理；Trees 读取解除 1000 上限；Turnstile 开关（默认关）+Upstash 限流；管理页增强（已随 v0.1.2 移除）；+1 投票（affects）；文案精简+模糊查询/日期筛选 | `docs/archive/v0.1.1/` |
| v0.1.2 | 2026-09-22 | 仓库布局目录化（issues/{日期-概述-提出者}/，md+附件同目录）；根目录 索引.md 自动维护；移除管理页；首页全量列表（并入 /issues）；称呼必填；稀薄提交拦截 | `docs/plans/v0.1.2/` |

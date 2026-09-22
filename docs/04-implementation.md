# 04 实施计划（Implementation Plan）

> 读者：AI 编码代理与开发者。本文将 01（产品）/02（数据模型）/03（架构）落成可执行的开发顺序与交付切分。与【决策基线 v0.1.0】冲突处，一律以基线为准。

## 1. 前置与全局约定

- 决策基线 v0.1.0 已冻结（约定见 CLAUDE.md）：frontmatter schema、枚举值、状态双映射、双路径字段划分均不得擅改。
- 依赖文档：docs/01-product.md（验收以 §8 为准）、docs/02-data-model.md（schema/正文模板/示例）、docs/03-architecture.md（§2 目录树、§3 API、§4 lib 分层、§10 环境变量、§11 Vercel 部署）。
- 参考代码库只读：`_reference/Inspirations-Farm-App/inspirations-farm-app/`。可搬：`src/lib/github-client.ts`、`src/lib/github.ts`、`src/lib/markdown-utils.ts`、attachments 模式、api 路由骨架、表单反馈骨架、移动端 FAB/抽屉、viewport 配置；必须改造：classic PAT → fine-grained PAT、去 PIN 锁改防滥用、「作者向 markdown 输入」改「结构化字段 + 服务端生成 md」。
- v1 非目标（不做）：账号体系、邮件通知、管理后台、多语言、统计模块、国内验证码/短信、多产品切换 UI、功能需求投票。

## 2. 脚手架与依赖安装清单（一次性）

1. `npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*"`；确认 Tailwind v4（package.json 中 `tailwindcss` 为 ^4.x、`@tailwindcss/postcss`）。
2. `npx shadcn@latest init`，然后 `npx shadcn@latest add button card input textarea label tabs badge collapsible accordion dialog sheet select radio-group alert separator`。
3. 运行时依赖：`npm i react-markdown remark-gfm rehype-sanitize gray-matter js-yaml p-limit`。
4. 限频选型（03 §7 限流与蜜罐）：默认函数内存近似实现（Map + 滚动时间窗）；预留 Upstash Redis 接口，启用时才 `npm i @upstash/redis`。
5. 复制 `.env.example` 为 `.env.local`，按 03 §10 填：`GITHUB_PAT`、`REPO_OWNER`、`REPO_NAME`、`FEEDBACK_TOKEN_SECRET`（必填）；`NEXT_PUBLIC_SITE_URL`（绑域名后）、`UPSTASH_*`、`TURNSTILE_ENABLED`（可选，Turnstile 默认关闭）。
6. `npm run dev` 打通空白首页后进入 §3。

## 3. src/ 实现顺序（对应 03 §2 目录树，编号即建议顺序，每步完成即补对应单测）

| 序 | 文件 | 内容要点 | 依赖 |
|---|---|---|---|
| 1 | src/lib/constants.ts | `product="aisc-issues"`；type/severity/status/tier 枚举；状态双映射中文表（问题/功能两套）；类型中文文案；空态文案「我们通常在 3 个工作日内回复」 | — |
| 2 | —（v0.1.0 变更） | 不再创建 src/lib/mask.ts：contact 字段与打码逻辑整体移除，仅保留选填 nickname（≤20 字、原文展示，见 02 §1 / 03 §8） | — |
| 3 | src/lib/github-client.ts（getConfig） | 服务端环境变量读取与启动校验；凭据禁止任何 `NEXT_PUBLIC_` 前缀 | — |
| 4 | src/lib/github-client.ts / src/lib/feedback.ts | Contents API 封装（PUT/GET/列目录）与编排层（createFeedback/listFeedback/getFeedback/relocateAssets）；fine-grained PAT 改造点；p-limit 并发控制 | 3 |
| 5 | src/lib/markdown-utils.ts | gray-matter + js-yaml JSON_SCHEMA 解析校验；正文分区解析；`## 开发者回复` 最新一轮 → ≤100 字摘要；双模板渲染（frontmatter + 分区正文服务端生成） | 1 |
| 6 | src/lib/validate.ts | 按路径区分的请求体校验：字段白名单/长度/枚举（与 03 §3.1 一致：steps ≤2000、expected ≤1000、actual ≤1000，均仅问题路径，steps 仅 type=bug 写入） | 1 |
| 7 | src/lib/rate-limit.ts | 同 IP 5 次/小时 + 60s 冷却；内存实现，接口预留 Upstash | — |
| 8 | src/app/page.tsx + src/components/* | 首页 Server Component：Hero（主标题兼顾两类 + 副标题「1 分钟提交，开发者会回复」+ 主 CTA）、回信区双 Tab（问题/功能建议，各有开发者回复的条目按 updated_at 倒序 10 条）、空态；ISR `revalidate = 300` | 1,5 |
| 9 | src/app/api/feedback/route.ts | POST：幂等键（客户端 UUID）、蜜罐字段、限频、schema 校验、Contents API PUT、409/422 换随机串重试 ≤3 次（指数退避）、失败可重试 | 4,6,7 |
| 10 | src/components/feedback-form.tsx 等表单组件 + src/hooks/use-draft.ts | 双路径卡片表单（问题 4 类单选卡片 + severity 三选；功能路径 type 固定 feature、tier 固定 basic）；localStorage 草稿 `aisc:draft` 按路径分桶（01 §4.0）；环境信息自动采集注入；图片客户端压缩 ≤4MB + canvas 重绘剥 EXIF | 6,9 |
| 11 | src/app/api/attachment/route.ts | POST 附件 → `feedback/assets/_pending/{uuid}`；仅问题路径；.log/.txt/.json/.zip、单文件 ≤3MB、≤3 个 | 4 |
| 12 | src/app/api/asset/route.ts | GET 代理私有仓库（大陆不可达 raw）；路径白名单仅 `feedback/assets/` | 4 |
| 13 | src/app/issue/[id]/page.tsx | 专属详情页 `/issue/{id}?t={token}`；首页「按编号查询」入口 | 5,12 |
| 14 | src/app/issues/page.tsx | 「查看全部」：问题/功能维度 + 状态 + 类型筛选 + 关键词搜索；轻统计 | 5 |
| 15 | src/app/submit/success/page.tsx | 成功页：编号 + 详情页链接 + 「收藏或截图保存」提示 | 9 |

序 1–7 为 M1 前置；8–10 完成 M1；11–13 完成 M2；14 完成 M3（15 随 M1 尾部交付；M1 版成功页仅展示编号/复制编号/SLA，不渲染专属链接区，M2 起补全——01 §6.1、02 §8）。

## 4. 里程碑任务分解（可勾选）

### M1 只读回信区（双 Tab）+ 两条路径基本提交（无附件、无 token 详情页）
- [ ] §2 脚手架与依赖安装
- [ ] constants / config + 单测（状态双映射；mask 已随 contact 移除而取消）
- [ ] github-client：PUT/GET 打通（在反馈仓库写一个临时 md 验证后删除）
- [ ] markdown-utils：解析/渲染/摘要 + 单测
- [ ] 首页：Hero + 双 Tab + 各 10 条倒序 + 空态文案
- [ ] POST /api/feedback：白名单/长度/枚举校验、幂等键、限频、蜜罐、409/422 重试
- [ ] 双路径表单与失败保留内容可重试（降级三层）
- [ ] 草稿 localStorage（含路径分桶与切换保留，01 §4.0）
- [ ] seed 02 §4 三条样例（见 §7）并核验 01 §8 对应项
- [ ] Vercel Preview 冒烟

### M2 截图 + 日志附件（问题路径）+ 编号查询 + 专属详情页
- [ ] 截图：≤3 张、jpg/png/webp、客户端压缩 ≤4MB/张、canvas 重绘剥 EXIF
- [ ] POST /api/attachment（_pending/{uuid} 临时位）
- [ ] 表单提交时服务端把 _pending 改名归位到 feedback/assets/{id}/；孤儿文件 v1 不清理（02 已注明）
- [ ] GET /api/asset 代理与路径白名单
- [ ] /issue/{id}?t={token} 详情页、成功页链接、首页按编号查询
- [ ] 环境信息自动采集注入（问题路径：UA/操作系统/页面 URL/提交时间；功能路径：仅 UA 与提交时间）

### M3 列表筛选搜索 + 轻统计 +（可选）受保护管理页
- [ ] 「查看全部」列表页：问题/功能维度 + 状态 + 类型筛选 + 关键词搜索
- [ ] 轻统计（总数/各状态计数）
- [ ] （可选）token 保护的轻量管理页；Turnstile feature flag（默认关闭）

## 5. 本地开发与 Vercel 部署顺序

1. 本地：`cp .env.example .env.local` → 填 4 个必填变量 → `npm run dev` → 按 §7 seed 样例。
2. 测试：`node --test --experimental-strip-types`（package.json 封装为 `npm run test`）。
3. Vercel：导入网站代码仓库 → Production 与 Preview 均配环境变量（03 §10）→ PAT 按 90 天轮换（TODO-USER）。
4. 域名：TODO-USER 备域名 + DNS 解析到 Vercel → Settings→Domains 绑定 → 配 `NEXT_PUBLIC_SITE_URL`。
5. 大陆可达性检查：无任何墙外资源（无 Google 字体等）；图片/附件一律经 `/api/asset` 自家代理。
详细步骤以 03 §9/§10/§11 与 README「TODO-USER」为准。

## 6. 01 §8 验收清单 → 测试用例映射（按能力域；实施时在 01 §8 条目旁回链本表行号）

| 验收能力（01 §8） | 验证方式 | 落点 |
|---|---|---|
| 回信区双 Tab 分流（问题/功能各 10 条、updated_at 倒序） | seed 数据集手测 + 列表过滤/排序纯函数单测 | tests/（列表过滤）+ 手测 |
| 状态双映射徽章（in-progress→处理中/开发中 等） | constants 双映射表单测 | tests/（constants） |
| hidden 条目公众不可见（详情 404、列表不出现） | markdown-utils 过滤单测 + 手测 | tests/ + 手测 |
| duplicate 跳转 duplicate_of | frontmatter 读取单测 + 详情页手测 | tests/ + 手测 |
| /api/asset 代理与路径白名单 | 白名单拒绝 `../` 与非 `feedback/assets/` 路径的单测 | tests/ |
| nickname ≤20 字边界（19/20/21 字） | validate.ts 分路径校验断言 | tests/validate.test.mjs |
| 切换路径不丢内容（01 §4.0 与 §8 新增项） | draft 分桶合并纯函数单测 + 手测 | tests/（draft） |
| 幂等键防重复、409/422 重试 ≤3 次指数退避 | 重试器 mock 409/422 单测 | tests/ |
| EXIF 剥离与 ≤4MB 压缩、附件类型/大小限制 | 校验函数单测 + 手测 | tests/ |
| 限频 5 次/小时 + 60s 冷却 | rate-limit 时间窗单测 | tests/ |
| 表单必填/长度/错误文案（两条路径） | schema.ts 分路径校验单测 | tests/ |

（单测文件名如与 03 §2 已列名不同，以 03 §2 为准改名，映射关系不变。）

## 7. 测试样例 seed（02 §4 三份示例）

目的：为 01 §8 的回信区双 Tab 分流、状态双映射徽章、hidden 404、/api/asset 代理、duplicate 跳转提供可复现数据集。

### 7.1 手工方式（推荐，本地/预览通用）
1. `git clone` 私有反馈仓库（用仓库直读权限即可，不占用 PAT）。
2. 将 02 §4 三份示例原样放入 `feedback/`：`20260921-143025-a3f9kz.md`、`20260919-091512-m2x8q7.md`、`20260920-155801-c7tq3e.md`。
3. assets 同步：在各 `feedback/assets/{id}/` 下放置对应 md 内引用的截图/附件文件，文件名与 md 引用完全一致；内容可用 1×1 占位 PNG 或几行文本的 .log/.txt（小于 GitHub 100MB 限制即可被 Contents API 正常读取）。`feedback/assets/_pending/` 不需要 seed（仅运行期使用）。
4. commit + push。本地 `npm run dev` 立即可见；production 需等 ISR revalidate=300s 或重新部署。

### 7.2 脚本方式（可选）
- `scripts/seed.mjs`：读 `.env.local` 的 GITHUB_PAT/REPO_OWNER/REPO_NAME，对每份样例执行 Contents API PUT（内容 base64）；`npm run seed` 调用；幂等（同名文件已存在则跳过）。附件资产逐个 PUT 到对应 `feedback/assets/{id}/` 路径。

### 7.3 覆盖矩阵
- 三条样例须至少覆盖：问题路径 + replied（问题 Tab 有回复条目）、功能路径 + resolved 或 in-progress（功能 Tab + 状态双映射文案）、一条 duplicate 带 duplicate_of（跳转验证）。
- 若 02 §4 现有三条未覆盖上述场景（功能样例为 submitted 且无回复、三条均无 duplicate/hidden）：seed 后在 GitHub 网页补齐——功能样例（`20260920-155801-c7tq3e.md`）追加一轮 `### YYYY-MM-DD HH:mm 开发者` 回复并把 status 改为 resolved 或 in-progress（覆盖功能 Tab 与状态双映射文案）；另建一条副本、status 改 duplicate 并加 `duplicate_of`（覆盖跳转验证）；再把任一条 status 改为 hidden，手测其 `/issue/{id}` 返回 404 且不出现在任何列表。

### 7.4 tests/ fixture 关联
- 03 §2 所列单测不访问网络：将三份样例 md 副本放 `tests/fixtures/feedback/*.md`，markdown-utils / 列表过滤 / 摘要类单测从 fixtures 读取；schema / rate-limit 等纯函数单测内联样例。
- fixtures 与 02 §4 保持同步：修改 02 §4 示例时同步修改 fixtures 并重跑单测。

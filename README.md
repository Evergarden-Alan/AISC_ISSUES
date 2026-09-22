# AISC_ISSUES 反馈站

为软件 AISC_ISSUES 收集「问题反馈」与「功能需求」的纯简体中文站点——GitHub Issues 的平民化前端。目标用户在中国大陆、不懂编程；1 分钟提交，开发者会回复。部署于 Vercel，数据存于专用私有 GitHub 反馈仓库（与网站代码仓库分离）。

## 文档导航
- docs/01-product.md 产品规格（双路径表单/首页 IA/状态文案/验收清单）
- docs/02-data-model.md frontmatter schema、正文分区模板、示例
- docs/03-architecture.md 目录树、API、lib 工具、环境变量与部署
- docs/04-implementation.md 里程碑任务分解、实现顺序、seed 与测试映射
- CLAUDE.md AI 编码代理工作约定
- docs/05-manual-setup.md 手动操作手册（PAT/部署/域名，写给不熟悉的人）

## 快速开始

要求：Node.js ≥ 20、npm、一个 GitHub 账号。

    npm install
    cp .env.example .env.local   # 填入下表变量
    npm run dev                  # http://localhost:3000

.env.local 必填（完整清单见 03 §10）：

| 变量 | 说明 |
|---|---|
| GITHUB_PAT | fine-grained PAT（仅反馈仓库、仅 Contents: Read and write） |
| REPO_OWNER | 反馈仓库所有者 |
| REPO_NAME | 反馈仓库名 |
| FEEDBACK_TOKEN_SECRET | 专属详情页 token 签名密钥 |

可选：NEXT_PUBLIC_SITE_URL（绑定域名后）、UPSTASH_*（限频）、TURNSTILE_ENABLED（默认 false）。全部变量须同时配置到 Vercel 的 Production 与 Preview。

测试：`npm run test`（= `node --test --experimental-strip-types`）。测试样例 seed 见 docs/04-implementation.md §7。

## TODO-USER（人类待办汇总，完成前站点仅本地/预览可用，细节见 03 §9/§10）

1. 新建专用【私有】GitHub 反馈仓库（与网站代码仓库分离），默认分支 main。
2. 创建 fine-grained PAT：仅勾选该仓库、仅权限 Contents: Read and write；有效期 90 天或不逾期（不逾期时记住泄漏应急：吊销→换新→更新环境变量，见 docs/05）；只存 Vercel 服务端环境变量，到期后在 Vercel 同步更新。
3. 购买域名并将 DNS 解析指向 Vercel → Vercel 项目 Settings→Domains 绑定 → 配置 NEXT_PUBLIC_SITE_URL。
4. Vercel 项目的 Production 与 Preview 环境均配置全部环境变量（含轮换后的新 PAT）。

## 约束速览
- 用户可见文案一律简体中文；无登录、无邮件通知（v1 非目标见 04 §1）。
- 枚举一律英文小写，前端做中文映射；frontmatter schema 不得擅改（见 CLAUDE.md）。
- 禁止任何墙外资源（无 Google 字体等）；图片/附件一律经 GET /api/asset 自家代理。
- 凭据只存服务端环境变量，禁止任何 NEXT_PUBLIC_ / 客户端可见形式。

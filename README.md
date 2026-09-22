# AISC_ISSUES 反馈站

为软件 AISC_ISSUES 收集「问题反馈」与「功能需求」的纯简体中文站点——GitHub Issues 的平民化前端。目标用户在中国大陆、不懂编程。部署于 Vercel，数据存于专用私有 GitHub 反馈仓库（与网站代码仓库分离）。

线上地址：https://feedback.alanevergarden.xyz

## 文档导航
- develop_wiki.md 开发规约与快速开始（先读这个）
- docs/todo.md 待改进 / 待开发清单
- docs/devlog.md 开发日志（教训与经验，动手前先读「教训与经验」一节）
- docs/plans/ 进行中版本文档（当前为空）
- docs/archive/ 已上线版本文档：
  - docs/archive/v0.1.0/ 产品规格 / 数据模型 / 架构 / 实施拆解 / 手动部署手册
  - docs/archive/v0.1.1/ 上传进度 / 自动清理 / Trees 读取 / Turnstile / Upstash / 投票 / 文案与查询
  - docs/archive/v0.1.2/ 仓库布局目录化 / 索引.md / 移除管理页 / 首页全量列表 / 稀薄提交拦截
- CLAUDE.md AI 编码代理工作约定

## 反馈仓库布局（v0.1.2 起）

```
aisc-issues-feedback（私有）
├─ 索引.md                  ← 反馈/需求两表（序号|关键字|时间|当前进度），站点自动维护
└─ issues/
   └─ 20260922-概述-提出者/  ← 每条反馈一个目录：反馈.md（功能=需求.md）+ 附件同目录
```

开发者工作流：克隆仓库 → 看 `索引.md` 总览 → 处理完改对应 md 的 `status` 字段标记进度（站点 ≤5 分钟同步，索引自动跟上）。

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
| CRON_SECRET | 每日自动任务鉴权（暂存清理 + 索引重建；不配则任务停用） |

可选：NEXT_PUBLIC_SITE_URL（绑定域名后）、UPSTASH_*（Redis 精确限流，留空回退内存）、TURNSTILE_*（人机验证，默认关）。~~ADMIN_TOKEN~~ 已于 v0.1.2 废弃（管理页移除）。全部变量须同时配置到 Vercel 的 Production 与 Preview。

可选：NEXT_PUBLIC_SITE_URL（绑定域名后）、UPSTASH_*（限频）、TURNSTILE_ENABLED（默认 false）。全部变量须同时配置到 Vercel 的 Production 与 Preview。

测试：`npm run test`（= `node --test --experimental-strip-types`）。测试样例 seed 见 docs/archive/v0.1.0/04-implementation.md §7。

## 运维备忘

- 部署 = push 到 main，Vercel 自动构建（域名 feedback.alanevergarden.xyz，函数区域 hkg1 勿改回美区）。
- 改环境变量后必须 Redeploy；令牌泄漏应急见 docs/archive/v0.1.0/05-manual-setup.md。
- 每日自动任务（北京 03:00）：清理暂存区孤儿 + 重建 索引.md；手动触发：
  `curl -H "Authorization: Bearer $CRON_SECRET" https://feedback.alanevergarden.xyz/api/cron/cleanup`

## 约束速览
- 用户可见文案一律简体中文；无登录、无邮件通知（v1 非目标见 04 §1）。
- 枚举一律英文小写，前端做中文映射；frontmatter schema 不得擅改（见 CLAUDE.md）。
- 禁止任何墙外资源（无 Google 字体等）；图片/附件一律经 GET /api/asset 自家代理。
- 凭据只存服务端环境变量，禁止任何 NEXT_PUBLIC_ / 客户端可见形式。

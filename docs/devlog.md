# devlog — 开发日志

> 规约：每个版本收尾、重大变更或踩坑记一条；**教训必须记录**，动手前先翻一遍本文，避免重蹈。
> 条目按时间正序；最新版本收尾时更新「教训与经验」。

---

## 2026-09-22 · v0.1.0 首版上线

- 需求评审：多智能体评审出 67 个缺口，用户拍板 10 项决策（severity 必填、详情页 token 边界、轻统计口径等）。
- 架构定型：双仓库分离（代码 public + 反馈数据 private）、frontmatter schema 冻结、问题/功能双路径表单、蜜罐 + IP 限频防滥用。
- 实现 M1（双路径提交 + 回信区）→ M2（截图/日志分片上传、详情页、编号查询）→ M3（列表页、轻统计、/admin 管理页），55 项单测。
- 部署：Vercel + 域名 feedback.alanevergarden.xyz；**函数区域切到 hkg1 香港**（大陆上传提速关键，勿改回美区）。
- 迭代：截图上限 3→10、日志上限 3MB→20MB（>3.5MB 客户端分片 + 服务端 finalize 合并）；提交流程改为 /submit/pending 中转页（失败回表单弹 toast）。
- 文档整理规约确立：进行中文档放 `docs/plans/`，完成移 `docs/archive/<版本>/`；根目录 develop_wiki.md（规约+快速开始）与 todo.md（做完一条删一条）。

## 2026-09-22 · v0.1.1 体验与稳健性

- 计划：以 todo.md 为开发目标（用户明示，构成基线演进 R4——移除 SLA 类文案），三文档（范围/设计/任务）。
- 实现：XHR 上传进度（百分比 + EMA 速度 + 剩余时间）；`_pending` 暂存目录日期化 + `/api/cron/cleanup`（每日北京 03:00）；Git Trees API 两步枚举解除 1000 条截断；Turnstile 人机验证（默认关、缺 token 降级放行）；Upstash Redis 限流（裸 fetch pipeline，故障回退内存）；管理页编辑/撤回回复、批量改状态、删除反馈；`affects` 投票计数 + `/api/vote`；全站移除 SLA/承诺文案；编号模糊查询 + 日期区间筛选。测试 55 → 96 项。
- 用户实测暴露三个 bug（当天修复）：
  1. **≤3.5MB 日志直传被误判分片**（报「分片信息不正确」）——直传 v0.1.1 起也携带 uploadId（日期化目录），而分片判定只看「有无 uploadId」；
  2. **幂等键失败后卡死**——提交失败后 in-flight 锁不释放，15 分钟内重试全被 409「正在提交」拦截（真实故障链：截图过期 400 → 键卡死 → 用户怎么重试都失败）；
  3. 首页「我有编号，查进度」锚点与查询框文案冗余 → 删除。

## 2026-09-22 · v0.1.2 仓库布局目录化 + 去管理页

- 用户三项裁决（基线演进）：
  1. **移除管理页**——开发者克隆 issues 仓库直接改 md 的 status 标记进度；首页改为全量列表（并入 /issues），hidden 不再过滤；
  2. **仓库布局目录化**——`issues/{日期-概述-提出者}/` 每条一个目录（反馈.md/需求.md + 附件同目录）；仓库根 `索引.md` 两表自动维护；表单「称呼」升为必填；
  3. **稀薄提交拦截**——无截图/日志 + 复现三字段全空 + 描述 <15 字时提示难以定位问题，确认后可继续。
- 实现：Trees 枚举条目目录、双 md 文件名探测、索引全量重建（每次提交 + 每日 cron 顺带）、中文目录名全链路适配、存量数据迁移（旧 ubcjc0 → 新目录）、暂存区迁至 `issues/_pending`（cron 双路径清理过渡）。测试 96 → 99 项。
- 追加：索引表增加「时间」列（序号/关键字/时间/当前进度），线上索引即时重建。
- 追加调整：首页查询框与「全部反馈」列表自带搜索重复 → 移除查询框与 IdLookup 组件。
- 追加修复：**图片过期复发**——v0.1.2 路径迁移用字符串批量替换，漏掉 `feedback/assets/${ref}` 间接拼接两处（直传落盘、finalize 合并落盘），附件写进旧路径而提交按新路径找 → 全部报「已过期」。修复 = PENDING_BASE 常量收口 + 布局守卫测试。
- 追加修复：**详情页图片/附件 404**——同一迁移的第三处漏网：渲染层 `rewriteAssetUrls` 正则仍只认旧前缀，md 里的 issues/ 链接没被改写成代理地址。新增渲染层守卫测试（issues/ 路径必须改写为 /api/asset）。
- 追加修复：**提交后回首页看不到新条目**（需手动刷新）——双重缓存：服务端读缓存 + ISR 5 分钟、客户端路由缓存。修复 = GitHub 读取统一打 `issues` 标签，提交/投票/每日重建后 revalidateTag 即时失效；成功页「返回首页」改整页加载。
- 收尾补全（教训驱动，见下）：v0.1.1 计划归档、版本历史、README 全面更新、CLAUDE.md 演进登记。

---

## 教训与经验（动手前先读）

### 流程类

1. **版本收尾要有清单，且必须覆盖入口文档**。v0.1.1 收尾只做了归档/版本历史/todo，README 里的 SLA 残留文案、ADMIN_TOKEN、已完成待办清单一直拖到 v0.1.2 收尾才被发现。收尾固定动作：归档 plans → 版本历史 → todo 清理 → **README / CLAUDE.md / develop_wiki 逐个过一遍** → 单测全绿。
2. **基线演进必须当场登记**。CLAUDE.md 的「schema 不得擅改」条款下，演进点（affects、目录化等）要随版本写进 CLAUDE.md，挂起不记 = 下个会话的 AI 会按旧基线拦你。

### 技术坑（GitHub / Next.js / 架构）

3. **GitHub Contents API 以 JSON 方式读 >1MB 文件不返回 content**——附件读取必须走 raw Accept；取 sha 用 object Accept。这是 v0.1.0 「图片上传已过期」假故障的根因。
4. **写锁必须与释放配对**。幂等键这类 in-flight 锁，所有失败路径都要释放，否则「一次失败、锁 15 分钟」，用户怎么重试都是 409。
5. **模式判定要看业务字段，不能看附带字段的有无**。「是否分片上传」曾用「有无 uploadId」判定，后来直传也带 uploadId（为了目录日期化）就误判了——改为校验 index/total 字段。
6. **空仓库的 `git/trees/HEAD` 返回 404**（HEAD 提交指向不可取的空树对象）——枚举必须有 Contents 回退；空树/幽灵目录清理需底层 Git Data API（create-tree + sha:null 删除 + 新提交）。
7. **Next.js 动态路由参数以百分号编码到达**——中文目录名作 id 时，页面入口必须 `decodeURIComponent`，否则白名单校验直接失败 404。
8. **Next 文件系统数据缓存会把陈旧响应留到 revalidate 期结束**——本地验证改了仓库数据后遇到「幽灵空列表/404」，先等 300 秒或删 `.next/cache/fetch-cache` 再下结论。
9. **lib 内部相对导入必须带 `.ts` 扩展名**（node --test 直跑 TS 的前提，Node type stripping 限制）；`.mjs` 测试文件里不能写 TS 注解。
10. **Windows 本地测试中文内容**：python 写文件默认 GBK、curl 控制台传参编码不稳——测试数据一律 `encoding="utf-8"` 落文件再 `--data-binary` 发送。
11. **路径迁移不要用字符串批量替换**——模板字面量的间接拼接（`` `feedback/assets/${ref}` ``）不会被字面量替换命中。目录/路径迁移应先收口为常量（如 PENDING_BASE），并配一个「守卫测试」扫描源码禁止旧字面量。
12. **GitHub 对突发 content-creation 有次级限流（不计入 /rate_limit 的 core 配额）**——Vercel 共享出口 IP 批量写 GitHub 时可能整段短暂 500/403，几分钟自愈。判据：core 配额满血但所有 PUT 挂；处置：等 + 退避，勿盲目改代码。另：Contents API 的目录列表/读在大规模写删后存在边缘缓存不一致（幽灵条目、幽灵 404），以 git/trees 或延迟后的重试为准。

### 好实践（保持）

- 双仓库分离（代码 public / 数据 private）+ 服务端 PAT 代理，用户侧零凭据。
- 人类可读的仓库布局（目录名即索引：日期-概述-提出者）+ 站点自动维护 `索引.md`，开发者工作流 = 克隆 + 改 md。
- 破坏性操作（删除反馈）要求完整输入编号确认；feature flag（Turnstile/Upstash）默认关、异常自动降级。
- 每个用户可见 bug 修复都补单测/e2e 回归，测试随版本只增不减（55 → 99）。

---

## 教训与经验（动手前先读）

### 流程类

1. **版本收尾要有清单，且必须覆盖入口文档**。v0.1.1 收尾只做了归档/版本历史/todo，README 里的 SLA 残留文案、ADMIN_TOKEN、已完成待办清单一直拖到 v0.1.2 收尾才被发现。收尾固定动作：归档 plans → 版本历史 → todo 清理 → **README / CLAUDE.md / develop_wiki 逐个过一遍** → 单测全绿。
2. **基线演进必须当场登记**。CLAUDE.md 的「schema 不得擅改」条款下，演进点（affects、目录化等）要随版本写进 CLAUDE.md，挂起不记 = 下个会话的 AI 会按旧基线拦你。

### 技术坑（GitHub / Next.js / 架构）

3. **GitHub Contents API 以 JSON 方式读 >1MB 文件不返回 content**——附件读取必须走 raw Accept；取 sha 用 object Accept。这是 v0.1.0 「图片上传已过期」假故障的根因。
4. **写锁必须与释放配对**。幂等键这类 in-flight 锁，所有失败路径都要释放，否则「一次失败、锁 15 分钟」，用户怎么重试都是 409。
5. **模式判定要看业务字段，不能看附带字段的有无**。「是否分片上传」曾用「有无 uploadId」判定，后来直传也带 uploadId（为了目录日期化）就误判了——改为校验 index/total 字段。
6. **空仓库的 `git/trees/HEAD` 返回 404**（HEAD 提交指向不可取的空树对象）——枚举必须有 Contents 回退；空树/幽灵目录清理需底层 Git Data API（create-tree + sha:null 删除 + 新提交）。
7. **Next.js 动态路由参数以百分号编码到达**——中文目录名作 id 时，页面入口必须 `decodeURIComponent`，否则白名单校验直接失败 404。
8. **Next 文件系统数据缓存会把陈旧响应留到 revalidate 期结束**——本地验证改了仓库数据后遇到「幽灵空列表/404」，先等 300 秒或删 `.next/cache/fetch-cache` 再下结论。
9. **lib 内部相对导入必须带 `.ts` 扩展名**（node --test 直跑 TS 的前提，Node type stripping 限制）；`.mjs` 测试文件里不能写 TS 注解。
10. **Windows 本地测试中文内容**：python 写文件默认 GBK、curl 控制台传参编码不稳——测试数据一律 `encoding="utf-8"` 落文件再 `--data-binary` 发送。
11. **路径迁移不要用字符串批量替换**——模板字面量的间接拼接（`` `feedback/assets/${ref}` ``）不会被字面量替换命中。目录/路径迁移应先收口为常量（如 PENDING_BASE），并配一个「守卫测试」扫描源码禁止旧字面量。
12. **GitHub 对突发 content-creation 有次级限流（不计入 /rate_limit 的 core 配额）**——Vercel 共享出口 IP 批量写 GitHub 时可能整段短暂 500/403，几分钟自愈。判据：core 配额满血但所有 PUT 挂；处置：等 + 退避，勿盲目改代码。另：Contents API 的目录列表/读在大规模写删后存在边缘缓存不一致（幽灵条目、幽灵 404），以 git/trees 或延迟后的重试为准。

### 好实践（保持）

- 双仓库分离（代码 public / 数据 private）+ 服务端 PAT 代理，用户侧零凭据。
- 人类可读的仓库布局（目录名即索引：日期-概述-提出者）+ 站点自动维护 `索引.md`，开发者工作流 = 克隆 + 改 md。
- 破坏性操作（删除反馈）要求完整输入编号确认；feature flag（Turnstile/Upstash）默认关、异常自动降级。
- 每个用户可见 bug 修复都补单测/e2e 回归，测试随版本只增不减（55 → 99）。

---

## 教训与经验（动手前先读）

### 流程类

1. **版本收尾要有清单，且必须覆盖入口文档**。v0.1.1 收尾只做了归档/版本历史/todo，README 里的 SLA 残留文案、ADMIN_TOKEN、已完成待办清单一直拖到 v0.1.2 收尾才被发现。收尾固定动作：归档 plans → 版本历史 → todo 清理 → **README / CLAUDE.md / develop_wiki 逐个过一遍** → 单测全绿。
2. **基线演进必须当场登记**。CLAUDE.md 的「schema 不得擅改」条款下，演进点（affects、目录化等）要随版本写进 CLAUDE.md，挂起不记 = 下个会话的 AI 会按旧基线拦你。

### 技术坑（GitHub / Next.js / 架构）

3. **GitHub Contents API 以 JSON 方式读 >1MB 文件不返回 content**——附件读取必须走 raw Accept；取 sha 用 object Accept。这是 v0.1.0 「图片上传已过期」假故障的根因。
4. **写锁必须与释放配对**。幂等键这类 in-flight 锁，所有失败路径都要释放，否则「一次失败、锁 15 分钟」，用户怎么重试都是 409。
5. **模式判定要看业务字段，不能看附带字段的有无**。「是否分片上传」曾用「有无 uploadId」判定，后来直传也带 uploadId（为了目录日期化）就误判了——改为校验 index/total 字段。
6. **空仓库的 `git/trees/HEAD` 返回 404**（HEAD 提交指向不可取的空树对象）——枚举必须有 Contents 回退；空树/幽灵目录清理需底层 Git Data API（create-tree + sha:null 删除 + 新提交）。
7. **Next.js 动态路由参数以百分号编码到达**——中文目录名作 id 时，页面入口必须 `decodeURIComponent`，否则白名单校验直接失败 404。
8. **Next 文件系统数据缓存会把陈旧响应留到 revalidate 期结束**——本地验证改了仓库数据后遇到「幽灵空列表/404」，先等 300 秒或删 `.next/cache/fetch-cache` 再下结论。
9. **lib 内部相对导入必须带 `.ts` 扩展名**（node --test 直跑 TS 的前提，Node type stripping 限制）；`.mjs` 测试文件里不能写 TS 注解。
10. **Windows 本地测试中文内容**：python 写文件默认 GBK、curl 控制台传参编码不稳——测试数据一律 `encoding="utf-8"` 落文件再 `--data-binary` 发送。
11. **路径迁移不要用字符串批量替换**——模板字面量的间接拼接（`` `feedback/assets/${ref}` ``）不会被字面量替换命中。目录/路径迁移应先收口为常量（如 PENDING_BASE），并配一个「守卫测试」扫描源码禁止旧字面量。
12. **GitHub 对突发 content-creation 有次级限流（不计入 /rate_limit 的 core 配额）**——Vercel 共享出口 IP 批量写 GitHub 时可能整段短暂 500/403，几分钟自愈。判据：core 配额满血但所有 PUT 挂；处置：等 + 退避，勿盲目改代码。另：Contents API 的目录列表/读在大规模写删后存在边缘缓存不一致（幽灵条目、幽灵 404），以 git/trees 或延迟后的重试为准。

### 好实践（保持）

- 双仓库分离（代码 public / 数据 private）+ 服务端 PAT 代理，用户侧零凭据。
- 人类可读的仓库布局（目录名即索引：日期-概述-提出者）+ 站点自动维护 `索引.md`，开发者工作流 = 克隆 + 改 md。
- 破坏性操作（删除反馈）要求完整输入编号确认；feature flag（Turnstile/Upstash）默认关、异常自动降级。
- 每个用户可见 bug 修复都补单测/e2e 回归，测试随版本只增不减（55 → 99）。

## 教训与经验（动手前先读）

### 流程类

1. **版本收尾要有清单，且必须覆盖入口文档**。v0.1.1 收尾只做了归档/版本历史/todo，README 里的 SLA 残留文案、ADMIN_TOKEN、已完成待办清单一直拖到 v0.1.2 收尾才被发现。收尾固定动作：归档 plans → 版本历史 → todo 清理 → **README / CLAUDE.md / develop_wiki 逐个过一遍** → 单测全绿。
2. **基线演进必须当场登记**。CLAUDE.md 的「schema 不得擅改」条款下，演进点（affects、目录化等）要随版本写进 CLAUDE.md，挂起不记 = 下个会话的 AI 会按旧基线拦你。

### 技术坑（GitHub / Next.js / 架构）

3. **GitHub Contents API 以 JSON 方式读 >1MB 文件不返回 content**——附件读取必须走 raw Accept；取 sha 用 object Accept。这是 v0.1.0 「图片上传已过期」假故障的根因。
4. **写锁必须与释放配对**。幂等键这类 in-flight 锁，所有失败路径都要释放，否则「一次失败、锁 15 分钟」，用户怎么重试都是 409。
5. **模式判定要看业务字段，不能看附带字段的有无**。「是否分片上传」曾用「有无 uploadId」判定，后来直传也带 uploadId（为了目录日期化）就误判了——改为校验 index/total 字段。
6. **空仓库的 `git/trees/HEAD` 返回 404**（HEAD 提交指向不可取的空树对象）——枚举必须有 Contents 回退；空树/幽灵目录清理需底层 Git Data API（create-tree + sha:null 删除 + 新提交）。
7. **Next.js 动态路由参数以百分号编码到达**——中文目录名作 id 时，页面入口必须 `decodeURIComponent`，否则白名单校验直接失败 404。
8. **Next 文件系统数据缓存会把陈旧响应留到 revalidate 期结束**——本地验证改了仓库数据后遇到「幽灵空列表/404」，先等 300 秒或删 `.next/cache/fetch-cache` 再下结论。
9. **lib 内部相对导入必须带 `.ts` 扩展名**（node --test 直跑 TS 的前提，Node type stripping 限制）；`.mjs` 测试文件里不能写 TS 注解。
10. **Windows 本地测试中文内容**：python 写文件默认 GBK、curl 控制台传参编码不稳——测试数据一律 `encoding="utf-8"` 落文件再 `--data-binary` 发送。
11. **路径迁移不要用字符串批量替换**——模板字面量的间接拼接（`` `feedback/assets/${ref}` ``）不会被字面量替换命中。目录/路径迁移应先收口为常量（如 PENDING_BASE），并配一个「守卫测试」扫描源码禁止旧字面量。
12. **GitHub 对突发 content-creation 有次级限流（不计入 /rate_limit 的 core 配额）**——Vercel 共享出口 IP 批量写 GitHub 时可能整段短暂 500/403，几分钟自愈。判据：core 配额满血但所有 PUT 挂；处置：等 + 退避，勿盲目改代码。另：Contents API 的目录列表/读在大规模写删后存在边缘缓存不一致（幽灵条目、幽灵 404），以 git/trees 或延迟后的重试为准。

### 好实践（保持）

- 双仓库分离（代码 public / 数据 private）+ 服务端 PAT 代理，用户侧零凭据。
- 人类可读的仓库布局（目录名即索引：日期-概述-提出者）+ 站点自动维护 `索引.md`，开发者工作流 = 克隆 + 改 md。
- 破坏性操作（删除反馈）要求完整输入编号确认；feature flag（Turnstile/Upstash）默认关、异常自动降级。
- 每个用户可见 bug 修复都补单测/e2e 回归，测试随版本只增不减（55 → 99）。

## 教训与经验（动手前先读）

### 流程类

1. **版本收尾要有清单，且必须覆盖入口文档**。v0.1.1 收尾只做了归档/版本历史/todo，README 里的 SLA 残留文案、ADMIN_TOKEN、已完成待办清单一直拖到 v0.1.2 收尾才被发现。收尾固定动作：归档 plans → 版本历史 → todo 清理 → **README / CLAUDE.md / develop_wiki 逐个过一遍** → 单测全绿。
2. **基线演进必须当场登记**。CLAUDE.md 的「schema 不得擅改」条款下，演进点（affects、目录化等）要随版本写进 CLAUDE.md，挂起不记 = 下个会话的 AI 会按旧基线拦你。

### 技术坑（GitHub / Next.js / 架构）

3. **GitHub Contents API 以 JSON 方式读 >1MB 文件不返回 content**——附件读取必须走 raw Accept；取 sha 用 object Accept。这是 v0.1.0 「图片上传已过期」假故障的根因。
4. **写锁必须与释放配对**。幂等键这类 in-flight 锁，所有失败路径都要释放，否则「一次失败、锁 15 分钟」，用户怎么重试都是 409。
5. **模式判定要看业务字段，不能看附带字段的有无**。「是否分片上传」曾用「有无 uploadId」判定，后来直传也带 uploadId（为了目录日期化）就误判了——改为校验 index/total 字段。
6. **空仓库的 `git/trees/HEAD` 返回 404**（HEAD 提交指向不可取的空树对象）——枚举必须有 Contents 回退；空树/幽灵目录清理需底层 Git Data API（create-tree + sha:null 删除 + 新提交）。
7. **Next.js 动态路由参数以百分号编码到达**——中文目录名作 id 时，页面入口必须 `decodeURIComponent`，否则白名单校验直接失败 404。
8. **Next 文件系统数据缓存会把陈旧响应留到 revalidate 期结束**——本地验证改了仓库数据后遇到「幽灵空列表/404」，先等 300 秒或删 `.next/cache/fetch-cache` 再下结论。
9. **lib 内部相对导入必须带 `.ts` 扩展名**（node --test 直跑 TS 的前提，Node type stripping 限制）；`.mjs` 测试文件里不能写 TS 注解。
10. **Windows 本地测试中文内容**：python 写文件默认 GBK、curl 控制台传参编码不稳——测试数据一律 `encoding="utf-8"` 落文件再 `--data-binary` 发送。
11. **路径迁移不要用字符串批量替换**——模板字面量的间接拼接（`` `feedback/assets/${ref}` ``）不会被字面量替换命中。目录/路径迁移应先收口为常量（如 PENDING_BASE），并配一个「守卫测试」扫描源码禁止旧字面量。
12. **GitHub 对突发 content-creation 有次级限流（不计入 /rate_limit 的 core 配额）**——Vercel 共享出口 IP 批量写 GitHub 时可能整段短暂 500/403，几分钟自愈。判据：core 配额满血但所有 PUT 挂；处置：等 + 退避，勿盲目改代码。另：Contents API 的目录列表/读在大规模写删后存在边缘缓存不一致（幽灵条目、幽灵 404），以 git/trees 或延迟后的重试为准。

### 好实践（保持）

- 双仓库分离（代码 public / 数据 private）+ 服务端 PAT 代理，用户侧零凭据。
- 人类可读的仓库布局（目录名即索引：日期-概述-提出者）+ 站点自动维护 `索引.md`，开发者工作流 = 克隆 + 改 md。
- 破坏性操作（删除反馈）要求完整输入编号确认；feature flag（Turnstile/Upstash）默认关、异常自动降级。
- 每个用户可见 bug 修复都补单测/e2e 回归，测试随版本只增不减（55 → 99）。

### 流程类

1. **版本收尾要有清单，且必须覆盖入口文档**。v0.1.1 收尾只做了归档/版本历史/todo，README 里的 SLA 残留文案、ADMIN_TOKEN、已完成待办清单一直拖到 v0.1.2 收尾才被发现。收尾固定动作：归档 plans → 版本历史 → todo 清理 → **README / CLAUDE.md / develop_wiki 逐个过一遍** → 单测全绿。
2. **基线演进必须当场登记**。CLAUDE.md 的「schema 不得擅改」条款下，演进点（affects、目录化等）要随版本写进 CLAUDE.md，挂起不记 = 下个会话的 AI 会按旧基线拦你。

### 技术坑（GitHub / Next.js / 架构）

3. **GitHub Contents API 以 JSON 方式读 >1MB 文件不返回 content**——附件读取必须走 raw Accept；取 sha 用 object Accept。这是 v0.1.0 「图片上传已过期」假故障的根因。
4. **写锁必须与释放配对**。幂等键这类 in-flight 锁，所有失败路径都要释放，否则「一次失败、锁 15 分钟」，用户怎么重试都是 409。
5. **模式判定要看业务字段，不能看附带字段的有无**。「是否分片上传」曾用「有无 uploadId」判定，后来直传也带 uploadId（为了目录日期化）就误判了——改为校验 index/total 字段。
6. **空仓库的 `git/trees/HEAD` 返回 404**（HEAD 提交指向不可取的空树对象）——枚举必须有 Contents 回退；空树/幽灵目录清理需底层 Git Data API（create-tree + sha:null 删除 + 新提交）。
7. **Next.js 动态路由参数以百分号编码到达**——中文目录名作 id 时，页面入口必须 `decodeURIComponent`，否则白名单校验直接失败 404。
8. **Next 文件系统数据缓存会把陈旧响应留到 revalidate 期结束**——本地验证改了仓库数据后遇到「幽灵空列表/404」，先等 300 秒或删 `.next/cache/fetch-cache` 再下结论。
9. **lib 内部相对导入必须带 `.ts` 扩展名**（node --test 直跑 TS 的前提，Node type stripping 限制）；`.mjs` 测试文件里不能写 TS 注解。
10. **Windows 本地测试中文内容**：python 写文件默认 GBK、curl 控制台传参编码不稳——测试数据一律 `encoding="utf-8"` 落文件再 `--data-binary` 发送。
11. **路径迁移不要用字符串批量替换**——模板字面量的间接拼接（`` `feedback/assets/${ref}` ``）不会被字面量替换命中。目录/路径迁移应先收口为常量（如 PENDING_BASE），并配一个「守卫测试」扫描源码禁止旧字面量。
12. **GitHub 对突发 content-creation 有次级限流（不计入 /rate_limit 的 core 配额）**——Vercel 共享出口 IP 批量写 GitHub 时可能整段短暂 500/403，几分钟自愈。判据：core 配额满血但所有 PUT 挂；处置：等 + 退避，勿盲目改代码。另：Contents API 的目录列表/读在大规模写删后存在边缘缓存不一致（幽灵条目、幽灵 404），以 git/trees 或延迟后的重试为准。

### 好实践（保持）

- 双仓库分离（代码 public / 数据 private）+ 服务端 PAT 代理，用户侧零凭据。
- 人类可读的仓库布局（目录名即索引：日期-概述-提出者）+ 站点自动维护 `索引.md`，开发者工作流 = 克隆 + 改 md。
- 破坏性操作（删除反馈）要求完整输入编号确认；feature flag（Turnstile/Upstash）默认关、异常自动降级。
- 每个用户可见 bug 修复都补单测/e2e 回归，测试随版本只增不减（55 → 99）。

### 流程类

1. **版本收尾要有清单，且必须覆盖入口文档**。v0.1.1 收尾只做了归档/版本历史/todo，README 里的 SLA 残留文案、ADMIN_TOKEN、已完成待办清单一直拖到 v0.1.2 收尾才被发现。收尾固定动作：归档 plans → 版本历史 → todo 清理 → **README / CLAUDE.md / develop_wiki 逐个过一遍** → 单测全绿。
2. **基线演进必须当场登记**。CLAUDE.md 的「schema 不得擅改」条款下，演进点（affects、目录化等）要随版本写进 CLAUDE.md，挂起不记 = 下个会话的 AI 会按旧基线拦你。

### 技术坑（GitHub / Next.js / 架构）

3. **GitHub Contents API 以 JSON 方式读 >1MB 文件不返回 content**——附件读取必须走 raw Accept；取 sha 用 object Accept。这是 v0.1.0 「图片上传已过期」假故障的根因。
4. **写锁必须与释放配对**。幂等键这类 in-flight 锁，所有失败路径都要释放，否则「一次失败、锁 15 分钟」，用户怎么重试都是 409。
5. **模式判定要看业务字段，不能看附带字段的有无**。「是否分片上传」曾用「有无 uploadId」判定，后来直传也带 uploadId（为了目录日期化）就误判了——改为校验 index/total 字段。
6. **空仓库的 `git/trees/HEAD` 返回 404**（HEAD 提交指向不可取的空树对象）——枚举必须有 Contents 回退；空树/幽灵目录清理需底层 Git Data API（create-tree + sha:null 删除 + 新提交）。
7. **Next.js 动态路由参数以百分号编码到达**——中文目录名作 id 时，页面入口必须 `decodeURIComponent`，否则白名单校验直接失败 404。
8. **Next 文件系统数据缓存会把陈旧响应留到 revalidate 期结束**——本地验证改了仓库数据后遇到「幽灵空列表/404」，先等 300 秒或删 `.next/cache/fetch-cache` 再下结论。
9. **lib 内部相对导入必须带 `.ts` 扩展名**（node --test 直跑 TS 的前提，Node type stripping 限制）；`.mjs` 测试文件里不能写 TS 注解。
10. **Windows 本地测试中文内容**：python 写文件默认 GBK、curl 控制台传参编码不稳——测试数据一律 `encoding="utf-8"` 落文件再 `--data-binary` 发送。
11. **路径迁移不要用字符串批量替换**——模板字面量的间接拼接（`` `feedback/assets/${ref}` ``）不会被字面量替换命中。目录/路径迁移应先收口为常量（如 PENDING_BASE），并配一个「守卫测试」扫描源码禁止旧字面量。
12. **GitHub 对突发 content-creation 有次级限流（不计入 /rate_limit 的 core 配额）**——Vercel 共享出口 IP 批量写 GitHub 时可能整段短暂 500/403，几分钟自愈。判据：core 配额满血但所有 PUT 挂；处置：等 + 退避，勿盲目改代码。另：Contents API 的目录列表/读在大规模写删后存在边缘缓存不一致（幽灵条目、幽灵 404），以 git/trees 或延迟后的重试为准。

### 好实践（保持）

- 双仓库分离（代码 public / 数据 private）+ 服务端 PAT 代理，用户侧零凭据。
- 人类可读的仓库布局（目录名即索引：日期-概述-提出者）+ 站点自动维护 `索引.md`，开发者工作流 = 克隆 + 改 md。
- 破坏性操作（删除反馈）要求完整输入编号确认；feature flag（Turnstile/Upstash）默认关、异常自动降级。
- 每个用户可见 bug 修复都补单测/e2e 回归，测试随版本只增不减（55 → 99）。

1. **版本收尾要有清单，且必须覆盖入口文档**。v0.1.1 收尾只做了归档/版本历史/todo，README 里的 SLA 残留文案、ADMIN_TOKEN、已完成待办清单一直拖到 v0.1.2 收尾才被发现。收尾固定动作：归档 plans → 版本历史 → todo 清理 → **README / CLAUDE.md / develop_wiki 逐个过一遍** → 单测全绿。
2. **基线演进必须当场登记**。CLAUDE.md 的「schema 不得擅改」条款下，演进点（affects、目录化等）要随版本写进 CLAUDE.md，挂起不记 = 下个会话的 AI 会按旧基线拦你。

### 技术坑（GitHub / Next.js / 架构）

3. **GitHub Contents API 以 JSON 方式读 >1MB 文件不返回 content**——附件读取必须走 raw Accept；取 sha 用 object Accept。这是 v0.1.0 「图片上传已过期」假故障的根因。
4. **写锁必须与释放配对**。幂等键这类 in-flight 锁，所有失败路径都要释放，否则「一次失败、锁 15 分钟」，用户怎么重试都是 409。
5. **模式判定要看业务字段，不能看附带字段的有无**。「是否分片上传」曾用「有无 uploadId」判定，后来直传也带 uploadId（为了目录日期化）就误判了——改为校验 index/total 字段。
6. **空仓库的 `git/trees/HEAD` 返回 404**（HEAD 提交指向不可取的空树对象）——枚举必须有 Contents 回退；空树/幽灵目录清理需底层 Git Data API（create-tree + sha:null 删除 + 新提交）。
7. **Next.js 动态路由参数以百分号编码到达**——中文目录名作 id 时，页面入口必须 `decodeURIComponent`，否则白名单校验直接失败 404。
8. **Next 文件系统数据缓存会把陈旧响应留到 revalidate 期结束**——本地验证改了仓库数据后遇到「幽灵空列表/404」，先等 300 秒或删 `.next/cache/fetch-cache` 再下结论。
9. **lib 内部相对导入必须带 `.ts` 扩展名**（node --test 直跑 TS 的前提，Node type stripping 限制）；`.mjs` 测试文件里不能写 TS 注解。
10. **Windows 本地测试中文内容**：python 写文件默认 GBK、curl 控制台传参编码不稳——测试数据一律 `encoding="utf-8"` 落文件再 `--data-binary` 发送。
11. **路径迁移不要用字符串批量替换**——模板字面量的间接拼接（`` `feedback/assets/${ref}` ``）不会被字面量替换命中。目录/路径迁移应先收口为常量（如 PENDING_BASE），并配一个「守卫测试」扫描源码禁止旧字面量。
12. **GitHub 对突发 content-creation 有次级限流（不计入 /rate_limit 的 core 配额）**——Vercel 共享出口 IP 批量写 GitHub 时可能整段短暂 500/403，几分钟自愈。判据：core 配额满血但所有 PUT 挂；处置：等 + 退避，勿盲目改代码。另：Contents API 的目录列表/读在大规模写删后存在边缘缓存不一致（幽灵条目、幽灵 404），以 git/trees 或延迟后的重试为准。

### 好实践（保持）

- 双仓库分离（代码 public / 数据 private）+ 服务端 PAT 代理，用户侧零凭据。
- 人类可读的仓库布局（目录名即索引：日期-概述-提出者）+ 站点自动维护 `索引.md`，开发者工作流 = 克隆 + 改 md。
- 破坏性操作（删除反馈）要求完整输入编号确认；feature flag（Turnstile/Upstash）默认关、异常自动降级。
- 每个用户可见 bug 修复都补单测/e2e 回归，测试随版本只增不减（55 → 99）。

1. **版本收尾要有清单，且必须覆盖入口文档**。v0.1.1 收尾只做了归档/版本历史/todo，README 里的 SLA 残留文案、ADMIN_TOKEN、已完成待办清单一直拖到 v0.1.2 收尾才被发现。收尾固定动作：归档 plans → 版本历史 → todo 清理 → **README / CLAUDE.md / develop_wiki 逐个过一遍** → 单测全绿。
2. **基线演进必须当场登记**。CLAUDE.md 的「schema 不得擅改」条款下，演进点（affects、目录化等）要随版本写进 CLAUDE.md，挂起不记 = 下个会话的 AI 会按旧基线拦你。

### 技术坑（GitHub / Next.js / 架构）

3. **GitHub Contents API 以 JSON 方式读 >1MB 文件不返回 content**——附件读取必须走 raw Accept；取 sha 用 object Accept。这是 v0.1.0 「图片上传已过期」假故障的根因。
4. **写锁必须与释放配对**。幂等键这类 in-flight 锁，所有失败路径都要释放，否则「一次失败、锁 15 分钟」，用户怎么重试都是 409。
5. **模式判定要看业务字段，不能看附带字段的有无**。「是否分片上传」曾用「有无 uploadId」判定，后来直传也带 uploadId（为了目录日期化）就误判了——改为校验 index/total 字段。
6. **空仓库的 `git/trees/HEAD` 返回 404**（HEAD 提交指向不可取的空树对象）——枚举必须有 Contents 回退；空树/幽灵目录清理需底层 Git Data API（create-tree + sha:null 删除 + 新提交）。
7. **Next.js 动态路由参数以百分号编码到达**——中文目录名作 id 时，页面入口必须 `decodeURIComponent`，否则白名单校验直接失败 404。
8. **Next 文件系统数据缓存会把陈旧响应留到 revalidate 期结束**——本地验证改了仓库数据后遇到「幽灵空列表/404」，先等 300 秒或删 `.next/cache/fetch-cache` 再下结论。
9. **lib 内部相对导入必须带 `.ts` 扩展名**（node --test 直跑 TS 的前提，Node type stripping 限制）；`.mjs` 测试文件里不能写 TS 注解。
10. **Windows 本地测试中文内容**：python 写文件默认 GBK、curl 控制台传参编码不稳——测试数据一律 `encoding="utf-8"` 落文件再 `--data-binary` 发送。
11. **路径迁移不要用字符串批量替换**——模板字面量的间接拼接（`` `feedback/assets/${ref}` ``）不会被字面量替换命中。目录/路径迁移应先收口为常量（如 PENDING_BASE），并配一个「守卫测试」扫描源码禁止旧字面量。
12. **GitHub 对突发 content-creation 有次级限流（不计入 /rate_limit 的 core 配额）**——Vercel 共享出口 IP 批量写 GitHub 时可能整段短暂 500/403，几分钟自愈。判据：core 配额满血但所有 PUT 挂；处置：等 + 退避，勿盲目改代码。另：Contents API 的目录列表/读在大规模写删后存在边缘缓存不一致（幽灵条目、幽灵 404），以 git/trees 或延迟后的重试为准。

### 好实践（保持）

- 双仓库分离（代码 public / 数据 private）+ 服务端 PAT 代理，用户侧零凭据。
- 人类可读的仓库布局（目录名即索引：日期-概述-提出者）+ 站点自动维护 `索引.md`，开发者工作流 = 克隆 + 改 md。
- 破坏性操作（删除反馈）要求完整输入编号确认；feature flag（Turnstile/Upstash）默认关、异常自动降级。
- 每个用户可见 bug 修复都补单测/e2e 回归，测试随版本只增不减（55 → 99）。

2. **基线演进必须当场登记**。CLAUDE.md 的「schema 不得擅改」条款下，演进点（affects、目录化等）要随版本写进 CLAUDE.md，挂起不记 = 下个会话的 AI 会按旧基线拦你。

### 技术坑（GitHub / Next.js / 架构）

3. **GitHub Contents API 以 JSON 方式读 >1MB 文件不返回 content**——附件读取必须走 raw Accept；取 sha 用 object Accept。这是 v0.1.0 「图片上传已过期」假故障的根因。
4. **写锁必须与释放配对**。幂等键这类 in-flight 锁，所有失败路径都要释放，否则「一次失败、锁 15 分钟」，用户怎么重试都是 409。
5. **模式判定要看业务字段，不能看附带字段的有无**。「是否分片上传」曾用「有无 uploadId」判定，后来直传也带 uploadId（为了目录日期化）就误判了——改为校验 index/total 字段。
6. **空仓库的 `git/trees/HEAD` 返回 404**（HEAD 提交指向不可取的空树对象）——枚举必须有 Contents 回退；空树/幽灵目录清理需底层 Git Data API（create-tree + sha:null 删除 + 新提交）。
7. **Next.js 动态路由参数以百分号编码到达**——中文目录名作 id 时，页面入口必须 `decodeURIComponent`，否则白名单校验直接失败 404。
8. **Next 文件系统数据缓存会把陈旧响应留到 revalidate 期结束**——本地验证改了仓库数据后遇到「幽灵空列表/404」，先等 300 秒或删 `.next/cache/fetch-cache` 再下结论。
9. **lib 内部相对导入必须带 `.ts` 扩展名**（node --test 直跑 TS 的前提，Node type stripping 限制）；`.mjs` 测试文件里不能写 TS 注解。
10. **Windows 本地测试中文内容**：python 写文件默认 GBK、curl 控制台传参编码不稳——测试数据一律 `encoding="utf-8"` 落文件再 `--data-binary` 发送。
11. **路径迁移不要用字符串批量替换**——模板字面量的间接拼接（`` `feedback/assets/${ref}` ``）不会被字面量替换命中。目录/路径迁移应先收口为常量（如 PENDING_BASE），并配一个「守卫测试」扫描源码禁止旧字面量。
12. **GitHub 对突发 content-creation 有次级限流（不计入 /rate_limit 的 core 配额）**——Vercel 共享出口 IP 批量写 GitHub 时可能整段短暂 500/403，几分钟自愈。判据：core 配额满血但所有 PUT 挂；处置：等 + 退避，勿盲目改代码。另：Contents API 的目录列表/读在大规模写删后存在边缘缓存不一致（幽灵条目、幽灵 404），以 git/trees 或延迟后的重试为准。

### 好实践（保持）

- 双仓库分离（代码 public / 数据 private）+ 服务端 PAT 代理，用户侧零凭据。
- 人类可读的仓库布局（目录名即索引：日期-概述-提出者）+ 站点自动维护 `索引.md`，开发者工作流 = 克隆 + 改 md。
- 破坏性操作（删除反馈）要求完整输入编号确认；feature flag（Turnstile/Upstash）默认关、异常自动降级。
- 每个用户可见 bug 修复都补单测/e2e 回归，测试随版本只增不减（55 → 99）。

### 技术坑（GitHub / Next.js / 架构）

3. **GitHub Contents API 以 JSON 方式读 >1MB 文件不返回 content**——附件读取必须走 raw Accept；取 sha 用 object Accept。这是 v0.1.0 「图片上传已过期」假故障的根因。
4. **写锁必须与释放配对**。幂等键这类 in-flight 锁，所有失败路径都要释放，否则「一次失败、锁 15 分钟」，用户怎么重试都是 409。
5. **模式判定要看业务字段，不能看附带字段的有无**。「是否分片上传」曾用「有无 uploadId」判定，后来直传也带 uploadId（为了目录日期化）就误判了——改为校验 index/total 字段。
6. **空仓库的 `git/trees/HEAD` 返回 404**（HEAD 提交指向不可取的空树对象）——枚举必须有 Contents 回退；空树/幽灵目录清理需底层 Git Data API（create-tree + sha:null 删除 + 新提交）。
7. **Next.js 动态路由参数以百分号编码到达**——中文目录名作 id 时，页面入口必须 `decodeURIComponent`，否则白名单校验直接失败 404。
8. **Next 文件系统数据缓存会把陈旧响应留到 revalidate 期结束**——本地验证改了仓库数据后遇到「幽灵空列表/404」，先等 300 秒或删 `.next/cache/fetch-cache` 再下结论。
9. **lib 内部相对导入必须带 `.ts` 扩展名**（node --test 直跑 TS 的前提，Node type stripping 限制）；`.mjs` 测试文件里不能写 TS 注解。
10. **Windows 本地测试中文内容**：python 写文件默认 GBK、curl 控制台传参编码不稳——测试数据一律 `encoding="utf-8"` 落文件再 `--data-binary` 发送。
11. **路径迁移不要用字符串批量替换**——模板字面量的间接拼接（`` `feedback/assets/${ref}` ``）不会被字面量替换命中。目录/路径迁移应先收口为常量（如 PENDING_BASE），并配一个「守卫测试」扫描源码禁止旧字面量。
12. **GitHub 对突发 content-creation 有次级限流（不计入 /rate_limit 的 core 配额）**——Vercel 共享出口 IP 批量写 GitHub 时可能整段短暂 500/403，几分钟自愈。判据：core 配额满血但所有 PUT 挂；处置：等 + 退避，勿盲目改代码。另：Contents API 的目录列表/读在大规模写删后存在边缘缓存不一致（幽灵条目、幽灵 404），以 git/trees 或延迟后的重试为准。

### 好实践（保持）

- 双仓库分离（代码 public / 数据 private）+ 服务端 PAT 代理，用户侧零凭据。
- 人类可读的仓库布局（目录名即索引：日期-概述-提出者）+ 站点自动维护 `索引.md`，开发者工作流 = 克隆 + 改 md。
- 破坏性操作（删除反馈）要求完整输入编号确认；feature flag（Turnstile/Upstash）默认关、异常自动降级。
- 每个用户可见 bug 修复都补单测/e2e 回归，测试随版本只增不减（55 → 99）。

### 技术坑（GitHub / Next.js / 架构）

3. **GitHub Contents API 以 JSON 方式读 >1MB 文件不返回 content**——附件读取必须走 raw Accept；取 sha 用 object Accept。这是 v0.1.0 「图片上传已过期」假故障的根因。
4. **写锁必须与释放配对**。幂等键这类 in-flight 锁，所有失败路径都要释放，否则「一次失败、锁 15 分钟」，用户怎么重试都是 409。
5. **模式判定要看业务字段，不能看附带字段的有无**。「是否分片上传」曾用「有无 uploadId」判定，后来直传也带 uploadId（为了目录日期化）就误判了——改为校验 index/total 字段。
6. **空仓库的 `git/trees/HEAD` 返回 404**（HEAD 提交指向不可取的空树对象）——枚举必须有 Contents 回退；空树/幽灵目录清理需底层 Git Data API（create-tree + sha:null 删除 + 新提交）。
7. **Next.js 动态路由参数以百分号编码到达**——中文目录名作 id 时，页面入口必须 `decodeURIComponent`，否则白名单校验直接失败 404。
8. **Next 文件系统数据缓存会把陈旧响应留到 revalidate 期结束**——本地验证改了仓库数据后遇到「幽灵空列表/404」，先等 300 秒或删 `.next/cache/fetch-cache` 再下结论。
9. **lib 内部相对导入必须带 `.ts` 扩展名**（node --test 直跑 TS 的前提，Node type stripping 限制）；`.mjs` 测试文件里不能写 TS 注解。
10. **Windows 本地测试中文内容**：python 写文件默认 GBK、curl 控制台传参编码不稳——测试数据一律 `encoding="utf-8"` 落文件再 `--data-binary` 发送。
11. **路径迁移不要用字符串批量替换**——模板字面量的间接拼接（`` `feedback/assets/${ref}` ``）不会被字面量替换命中。目录/路径迁移应先收口为常量（如 PENDING_BASE），并配一个「守卫测试」扫描源码禁止旧字面量。
12. **GitHub 对突发 content-creation 有次级限流（不计入 /rate_limit 的 core 配额）**——Vercel 共享出口 IP 批量写 GitHub 时可能整段短暂 500/403，几分钟自愈。判据：core 配额满血但所有 PUT 挂；处置：等 + 退避，勿盲目改代码。另：Contents API 的目录列表/读在大规模写删后存在边缘缓存不一致（幽灵条目、幽灵 404），以 git/trees 或延迟后的重试为准。

### 好实践（保持）

- 双仓库分离（代码 public / 数据 private）+ 服务端 PAT 代理，用户侧零凭据。
- 人类可读的仓库布局（目录名即索引：日期-概述-提出者）+ 站点自动维护 `索引.md`，开发者工作流 = 克隆 + 改 md。
- 破坏性操作（删除反馈）要求完整输入编号确认；feature flag（Turnstile/Upstash）默认关、异常自动降级。
- 每个用户可见 bug 修复都补单测/e2e 回归，测试随版本只增不减（55 → 99）。

3. **GitHub Contents API 以 JSON 方式读 >1MB 文件不返回 content**——附件读取必须走 raw Accept；取 sha 用 object Accept。这是 v0.1.0 「图片上传已过期」假故障的根因。
4. **写锁必须与释放配对**。幂等键这类 in-flight 锁，所有失败路径都要释放，否则「一次失败、锁 15 分钟」，用户怎么重试都是 409。
5. **模式判定要看业务字段，不能看附带字段的有无**。「是否分片上传」曾用「有无 uploadId」判定，后来直传也带 uploadId（为了目录日期化）就误判了——改为校验 index/total 字段。
6. **空仓库的 `git/trees/HEAD` 返回 404**（HEAD 提交指向不可取的空树对象）——枚举必须有 Contents 回退；空树/幽灵目录清理需底层 Git Data API（create-tree + sha:null 删除 + 新提交）。
7. **Next.js 动态路由参数以百分号编码到达**——中文目录名作 id 时，页面入口必须 `decodeURIComponent`，否则白名单校验直接失败 404。
8. **Next 文件系统数据缓存会把陈旧响应留到 revalidate 期结束**——本地验证改了仓库数据后遇到「幽灵空列表/404」，先等 300 秒或删 `.next/cache/fetch-cache` 再下结论。
9. **lib 内部相对导入必须带 `.ts` 扩展名**（node --test 直跑 TS 的前提，Node type stripping 限制）；`.mjs` 测试文件里不能写 TS 注解。
10. **Windows 本地测试中文内容**：python 写文件默认 GBK、curl 控制台传参编码不稳——测试数据一律 `encoding="utf-8"` 落文件再 `--data-binary` 发送。
11. **路径迁移不要用字符串批量替换**——模板字面量的间接拼接（`` `feedback/assets/${ref}` ``）不会被字面量替换命中。目录/路径迁移应先收口为常量（如 PENDING_BASE），并配一个「守卫测试」扫描源码禁止旧字面量。
12. **GitHub 对突发 content-creation 有次级限流（不计入 /rate_limit 的 core 配额）**——Vercel 共享出口 IP 批量写 GitHub 时可能整段短暂 500/403，几分钟自愈。判据：core 配额满血但所有 PUT 挂；处置：等 + 退避，勿盲目改代码。另：Contents API 的目录列表/读在大规模写删后存在边缘缓存不一致（幽灵条目、幽灵 404），以 git/trees 或延迟后的重试为准。

### 好实践（保持）

- 双仓库分离（代码 public / 数据 private）+ 服务端 PAT 代理，用户侧零凭据。
- 人类可读的仓库布局（目录名即索引：日期-概述-提出者）+ 站点自动维护 `索引.md`，开发者工作流 = 克隆 + 改 md。
- 破坏性操作（删除反馈）要求完整输入编号确认；feature flag（Turnstile/Upstash）默认关、异常自动降级。
- 每个用户可见 bug 修复都补单测/e2e 回归，测试随版本只增不减（55 → 99）。

3. **GitHub Contents API 以 JSON 方式读 >1MB 文件不返回 content**——附件读取必须走 raw Accept；取 sha 用 object Accept。这是 v0.1.0 「图片上传已过期」假故障的根因。
4. **写锁必须与释放配对**。幂等键这类 in-flight 锁，所有失败路径都要释放，否则「一次失败、锁 15 分钟」，用户怎么重试都是 409。
5. **模式判定要看业务字段，不能看附带字段的有无**。「是否分片上传」曾用「有无 uploadId」判定，后来直传也带 uploadId（为了目录日期化）就误判了——改为校验 index/total 字段。
6. **空仓库的 `git/trees/HEAD` 返回 404**（HEAD 提交指向不可取的空树对象）——枚举必须有 Contents 回退；空树/幽灵目录清理需底层 Git Data API（create-tree + sha:null 删除 + 新提交）。
7. **Next.js 动态路由参数以百分号编码到达**——中文目录名作 id 时，页面入口必须 `decodeURIComponent`，否则白名单校验直接失败 404。
8. **Next 文件系统数据缓存会把陈旧响应留到 revalidate 期结束**——本地验证改了仓库数据后遇到「幽灵空列表/404」，先等 300 秒或删 `.next/cache/fetch-cache` 再下结论。
9. **lib 内部相对导入必须带 `.ts` 扩展名**（node --test 直跑 TS 的前提，Node type stripping 限制）；`.mjs` 测试文件里不能写 TS 注解。
10. **Windows 本地测试中文内容**：python 写文件默认 GBK、curl 控制台传参编码不稳——测试数据一律 `encoding="utf-8"` 落文件再 `--data-binary` 发送。
11. **路径迁移不要用字符串批量替换**——模板字面量的间接拼接（`` `feedback/assets/${ref}` ``）不会被字面量替换命中。目录/路径迁移应先收口为常量（如 PENDING_BASE），并配一个「守卫测试」扫描源码禁止旧字面量。
12. **GitHub 对突发 content-creation 有次级限流（不计入 /rate_limit 的 core 配额）**——Vercel 共享出口 IP 批量写 GitHub 时可能整段短暂 500/403，几分钟自愈。判据：core 配额满血但所有 PUT 挂；处置：等 + 退避，勿盲目改代码。另：Contents API 的目录列表/读在大规模写删后存在边缘缓存不一致（幽灵条目、幽灵 404），以 git/trees 或延迟后的重试为准。

### 好实践（保持）

- 双仓库分离（代码 public / 数据 private）+ 服务端 PAT 代理，用户侧零凭据。
- 人类可读的仓库布局（目录名即索引：日期-概述-提出者）+ 站点自动维护 `索引.md`，开发者工作流 = 克隆 + 改 md。
- 破坏性操作（删除反馈）要求完整输入编号确认；feature flag（Turnstile/Upstash）默认关、异常自动降级。
- 每个用户可见 bug 修复都补单测/e2e 回归，测试随版本只增不减（55 → 99）。

4. **写锁必须与释放配对**。幂等键这类 in-flight 锁，所有失败路径都要释放，否则「一次失败、锁 15 分钟」，用户怎么重试都是 409。
5. **模式判定要看业务字段，不能看附带字段的有无**。「是否分片上传」曾用「有无 uploadId」判定，后来直传也带 uploadId（为了目录日期化）就误判了——改为校验 index/total 字段。
6. **空仓库的 `git/trees/HEAD` 返回 404**（HEAD 提交指向不可取的空树对象）——枚举必须有 Contents 回退；空树/幽灵目录清理需底层 Git Data API（create-tree + sha:null 删除 + 新提交）。
7. **Next.js 动态路由参数以百分号编码到达**——中文目录名作 id 时，页面入口必须 `decodeURIComponent`，否则白名单校验直接失败 404。
8. **Next 文件系统数据缓存会把陈旧响应留到 revalidate 期结束**——本地验证改了仓库数据后遇到「幽灵空列表/404」，先等 300 秒或删 `.next/cache/fetch-cache` 再下结论。
9. **lib 内部相对导入必须带 `.ts` 扩展名**（node --test 直跑 TS 的前提，Node type stripping 限制）；`.mjs` 测试文件里不能写 TS 注解。
10. **Windows 本地测试中文内容**：python 写文件默认 GBK、curl 控制台传参编码不稳——测试数据一律 `encoding="utf-8"` 落文件再 `--data-binary` 发送。
11. **路径迁移不要用字符串批量替换**——模板字面量的间接拼接（`` `feedback/assets/${ref}` ``）不会被字面量替换命中。目录/路径迁移应先收口为常量（如 PENDING_BASE），并配一个「守卫测试」扫描源码禁止旧字面量。
12. **GitHub 对突发 content-creation 有次级限流（不计入 /rate_limit 的 core 配额）**——Vercel 共享出口 IP 批量写 GitHub 时可能整段短暂 500/403，几分钟自愈。判据：core 配额满血但所有 PUT 挂；处置：等 + 退避，勿盲目改代码。另：Contents API 的目录列表/读在大规模写删后存在边缘缓存不一致（幽灵条目、幽灵 404），以 git/trees 或延迟后的重试为准。

### 好实践（保持）

- 双仓库分离（代码 public / 数据 private）+ 服务端 PAT 代理，用户侧零凭据。
- 人类可读的仓库布局（目录名即索引：日期-概述-提出者）+ 站点自动维护 `索引.md`，开发者工作流 = 克隆 + 改 md。
- 破坏性操作（删除反馈）要求完整输入编号确认；feature flag（Turnstile/Upstash）默认关、异常自动降级。
- 每个用户可见 bug 修复都补单测/e2e 回归，测试随版本只增不减（55 → 99）。

5. **模式判定要看业务字段，不能看附带字段的有无**。「是否分片上传」曾用「有无 uploadId」判定，后来直传也带 uploadId（为了目录日期化）就误判了——改为校验 index/total 字段。
6. **空仓库的 `git/trees/HEAD` 返回 404**（HEAD 提交指向不可取的空树对象）——枚举必须有 Contents 回退；空树/幽灵目录清理需底层 Git Data API（create-tree + sha:null 删除 + 新提交）。
7. **Next.js 动态路由参数以百分号编码到达**——中文目录名作 id 时，页面入口必须 `decodeURIComponent`，否则白名单校验直接失败 404。
8. **Next 文件系统数据缓存会把陈旧响应留到 revalidate 期结束**——本地验证改了仓库数据后遇到「幽灵空列表/404」，先等 300 秒或删 `.next/cache/fetch-cache` 再下结论。
9. **lib 内部相对导入必须带 `.ts` 扩展名**（node --test 直跑 TS 的前提，Node type stripping 限制）；`.mjs` 测试文件里不能写 TS 注解。
10. **Windows 本地测试中文内容**：python 写文件默认 GBK、curl 控制台传参编码不稳——测试数据一律 `encoding="utf-8"` 落文件再 `--data-binary` 发送。
11. **路径迁移不要用字符串批量替换**——模板字面量的间接拼接（`` `feedback/assets/${ref}` ``）不会被字面量替换命中。目录/路径迁移应先收口为常量（如 PENDING_BASE），并配一个「守卫测试」扫描源码禁止旧字面量。
12. **GitHub 对突发 content-creation 有次级限流（不计入 /rate_limit 的 core 配额）**——Vercel 共享出口 IP 批量写 GitHub 时可能整段短暂 500/403，几分钟自愈。判据：core 配额满血但所有 PUT 挂；处置：等 + 退避，勿盲目改代码。另：Contents API 的目录列表/读在大规模写删后存在边缘缓存不一致（幽灵条目、幽灵 404），以 git/trees 或延迟后的重试为准。

### 好实践（保持）

- 双仓库分离（代码 public / 数据 private）+ 服务端 PAT 代理，用户侧零凭据。
- 人类可读的仓库布局（目录名即索引：日期-概述-提出者）+ 站点自动维护 `索引.md`，开发者工作流 = 克隆 + 改 md。
- 破坏性操作（删除反馈）要求完整输入编号确认；feature flag（Turnstile/Upstash）默认关、异常自动降级。
- 每个用户可见 bug 修复都补单测/e2e 回归，测试随版本只增不减（55 → 99）。

6. **空仓库的 `git/trees/HEAD` 返回 404**（HEAD 提交指向不可取的空树对象）——枚举必须有 Contents 回退；空树/幽灵目录清理需底层 Git Data API（create-tree + sha:null 删除 + 新提交）。
7. **Next.js 动态路由参数以百分号编码到达**——中文目录名作 id 时，页面入口必须 `decodeURIComponent`，否则白名单校验直接失败 404。
8. **Next 文件系统数据缓存会把陈旧响应留到 revalidate 期结束**——本地验证改了仓库数据后遇到「幽灵空列表/404」，先等 300 秒或删 `.next/cache/fetch-cache` 再下结论。
9. **lib 内部相对导入必须带 `.ts` 扩展名**（node --test 直跑 TS 的前提，Node type stripping 限制）；`.mjs` 测试文件里不能写 TS 注解。
10. **Windows 本地测试中文内容**：python 写文件默认 GBK、curl 控制台传参编码不稳——测试数据一律 `encoding="utf-8"` 落文件再 `--data-binary` 发送。
11. **路径迁移不要用字符串批量替换**——模板字面量的间接拼接（`` `feedback/assets/${ref}` ``）不会被字面量替换命中。目录/路径迁移应先收口为常量（如 PENDING_BASE），并配一个「守卫测试」扫描源码禁止旧字面量。
12. **GitHub 对突发 content-creation 有次级限流（不计入 /rate_limit 的 core 配额）**——Vercel 共享出口 IP 批量写 GitHub 时可能整段短暂 500/403，几分钟自愈。判据：core 配额满血但所有 PUT 挂；处置：等 + 退避，勿盲目改代码。另：Contents API 的目录列表/读在大规模写删后存在边缘缓存不一致（幽灵条目、幽灵 404），以 git/trees 或延迟后的重试为准。

### 好实践（保持）

- 双仓库分离（代码 public / 数据 private）+ 服务端 PAT 代理，用户侧零凭据。
- 人类可读的仓库布局（目录名即索引：日期-概述-提出者）+ 站点自动维护 `索引.md`，开发者工作流 = 克隆 + 改 md。
- 破坏性操作（删除反馈）要求完整输入编号确认；feature flag（Turnstile/Upstash）默认关、异常自动降级。
- 每个用户可见 bug 修复都补单测/e2e 回归，测试随版本只增不减（55 → 99）。

7. **Next.js 动态路由参数以百分号编码到达**——中文目录名作 id 时，页面入口必须 `decodeURIComponent`，否则白名单校验直接失败 404。
8. **Next 文件系统数据缓存会把陈旧响应留到 revalidate 期结束**——本地验证改了仓库数据后遇到「幽灵空列表/404」，先等 300 秒或删 `.next/cache/fetch-cache` 再下结论。
9. **lib 内部相对导入必须带 `.ts` 扩展名**（node --test 直跑 TS 的前提，Node type stripping 限制）；`.mjs` 测试文件里不能写 TS 注解。
10. **Windows 本地测试中文内容**：python 写文件默认 GBK、curl 控制台传参编码不稳——测试数据一律 `encoding="utf-8"` 落文件再 `--data-binary` 发送。
11. **路径迁移不要用字符串批量替换**——模板字面量的间接拼接（`` `feedback/assets/${ref}` ``）不会被字面量替换命中。目录/路径迁移应先收口为常量（如 PENDING_BASE），并配一个「守卫测试」扫描源码禁止旧字面量。
12. **GitHub 对突发 content-creation 有次级限流（不计入 /rate_limit 的 core 配额）**——Vercel 共享出口 IP 批量写 GitHub 时可能整段短暂 500/403，几分钟自愈。判据：core 配额满血但所有 PUT 挂；处置：等 + 退避，勿盲目改代码。另：Contents API 的目录列表/读在大规模写删后存在边缘缓存不一致（幽灵条目、幽灵 404），以 git/trees 或延迟后的重试为准。

### 好实践（保持）

- 双仓库分离（代码 public / 数据 private）+ 服务端 PAT 代理，用户侧零凭据。
- 人类可读的仓库布局（目录名即索引：日期-概述-提出者）+ 站点自动维护 `索引.md`，开发者工作流 = 克隆 + 改 md。
- 破坏性操作（删除反馈）要求完整输入编号确认；feature flag（Turnstile/Upstash）默认关、异常自动降级。
- 每个用户可见 bug 修复都补单测/e2e 回归，测试随版本只增不减（55 → 99）。

8. **Next 文件系统数据缓存会把陈旧响应留到 revalidate 期结束**——本地验证改了仓库数据后遇到「幽灵空列表/404」，先等 300 秒或删 `.next/cache/fetch-cache` 再下结论。
9. **lib 内部相对导入必须带 `.ts` 扩展名**（node --test 直跑 TS 的前提，Node type stripping 限制）；`.mjs` 测试文件里不能写 TS 注解。
10. **Windows 本地测试中文内容**：python 写文件默认 GBK、curl 控制台传参编码不稳——测试数据一律 `encoding="utf-8"` 落文件再 `--data-binary` 发送。
11. **路径迁移不要用字符串批量替换**——模板字面量的间接拼接（`` `feedback/assets/${ref}` ``）不会被字面量替换命中。目录/路径迁移应先收口为常量（如 PENDING_BASE），并配一个「守卫测试」扫描源码禁止旧字面量。
12. **GitHub 对突发 content-creation 有次级限流（不计入 /rate_limit 的 core 配额）**——Vercel 共享出口 IP 批量写 GitHub 时可能整段短暂 500/403，几分钟自愈。判据：core 配额满血但所有 PUT 挂；处置：等 + 退避，勿盲目改代码。另：Contents API 的目录列表/读在大规模写删后存在边缘缓存不一致（幽灵条目、幽灵 404），以 git/trees 或延迟后的重试为准。

### 好实践（保持）

- 双仓库分离（代码 public / 数据 private）+ 服务端 PAT 代理，用户侧零凭据。
- 人类可读的仓库布局（目录名即索引：日期-概述-提出者）+ 站点自动维护 `索引.md`，开发者工作流 = 克隆 + 改 md。
- 破坏性操作（删除反馈）要求完整输入编号确认；feature flag（Turnstile/Upstash）默认关、异常自动降级。
- 每个用户可见 bug 修复都补单测/e2e 回归，测试随版本只增不减（55 → 99）。

9. **lib 内部相对导入必须带 `.ts` 扩展名**（node --test 直跑 TS 的前提，Node type stripping 限制）；`.mjs` 测试文件里不能写 TS 注解。
10. **Windows 本地测试中文内容**：python 写文件默认 GBK、curl 控制台传参编码不稳——测试数据一律 `encoding="utf-8"` 落文件再 `--data-binary` 发送。
11. **路径迁移不要用字符串批量替换**——模板字面量的间接拼接（`` `feedback/assets/${ref}` ``）不会被字面量替换命中。目录/路径迁移应先收口为常量（如 PENDING_BASE），并配一个「守卫测试」扫描源码禁止旧字面量。
12. **GitHub 对突发 content-creation 有次级限流（不计入 /rate_limit 的 core 配额）**——Vercel 共享出口 IP 批量写 GitHub 时可能整段短暂 500/403，几分钟自愈。判据：core 配额满血但所有 PUT 挂；处置：等 + 退避，勿盲目改代码。另：Contents API 的目录列表/读在大规模写删后存在边缘缓存不一致（幽灵条目、幽灵 404），以 git/trees 或延迟后的重试为准。

### 好实践（保持）

- 双仓库分离（代码 public / 数据 private）+ 服务端 PAT 代理，用户侧零凭据。
- 人类可读的仓库布局（目录名即索引：日期-概述-提出者）+ 站点自动维护 `索引.md`，开发者工作流 = 克隆 + 改 md。
- 破坏性操作（删除反馈）要求完整输入编号确认；feature flag（Turnstile/Upstash）默认关、异常自动降级。
- 每个用户可见 bug 修复都补单测/e2e 回归，测试随版本只增不减（55 → 99）。

10. **Windows 本地测试中文内容**：python 写文件默认 GBK、curl 控制台传参编码不稳——测试数据一律 `encoding="utf-8"` 落文件再 `--data-binary` 发送。
11. **路径迁移不要用字符串批量替换**——模板字面量的间接拼接（`` `feedback/assets/${ref}` ``）不会被字面量替换命中。目录/路径迁移应先收口为常量（如 PENDING_BASE），并配一个「守卫测试」扫描源码禁止旧字面量。
12. **GitHub 对突发 content-creation 有次级限流（不计入 /rate_limit 的 core 配额）**——Vercel 共享出口 IP 批量写 GitHub 时可能整段短暂 500/403，几分钟自愈。判据：core 配额满血但所有 PUT 挂；处置：等 + 退避，勿盲目改代码。另：Contents API 的目录列表/读在大规模写删后存在边缘缓存不一致（幽灵条目、幽灵 404），以 git/trees 或延迟后的重试为准。

### 好实践（保持）

- 双仓库分离（代码 public / 数据 private）+ 服务端 PAT 代理，用户侧零凭据。
- 人类可读的仓库布局（目录名即索引：日期-概述-提出者）+ 站点自动维护 `索引.md`，开发者工作流 = 克隆 + 改 md。
- 破坏性操作（删除反馈）要求完整输入编号确认；feature flag（Turnstile/Upstash）默认关、异常自动降级。
- 每个用户可见 bug 修复都补单测/e2e 回归，测试随版本只增不减（55 → 99）。

11. **路径迁移不要用字符串批量替换**——模板字面量的间接拼接（`` `feedback/assets/${ref}` ``）不会被字面量替换命中。目录/路径迁移应先收口为常量（如 PENDING_BASE），并配一个「守卫测试」扫描源码禁止旧字面量。
12. **GitHub 对突发 content-creation 有次级限流（不计入 /rate_limit 的 core 配额）**——Vercel 共享出口 IP 批量写 GitHub 时可能整段短暂 500/403，几分钟自愈。判据：core 配额满血但所有 PUT 挂；处置：等 + 退避，勿盲目改代码。另：Contents API 的目录列表/读在大规模写删后存在边缘缓存不一致（幽灵条目、幽灵 404），以 git/trees 或延迟后的重试为准。

### 好实践（保持）

- 双仓库分离（代码 public / 数据 private）+ 服务端 PAT 代理，用户侧零凭据。
- 人类可读的仓库布局（目录名即索引：日期-概述-提出者）+ 站点自动维护 `索引.md`，开发者工作流 = 克隆 + 改 md。
- 破坏性操作（删除反馈）要求完整输入编号确认；feature flag（Turnstile/Upstash）默认关、异常自动降级。
- 每个用户可见 bug 修复都补单测/e2e 回归，测试随版本只增不减（55 → 99）。

12. **GitHub 对突发 content-creation 有次级限流（不计入 /rate_limit 的 core 配额）**——Vercel 共享出口 IP 批量写 GitHub 时可能整段短暂 500/403，几分钟自愈。判据：core 配额满血但所有 PUT 挂；处置：等 + 退避，勿盲目改代码。另：Contents API 的目录列表/读在大规模写删后存在边缘缓存不一致（幽灵条目、幽灵 404），以 git/trees 或延迟后的重试为准。

### 好实践（保持）

- 双仓库分离（代码 public / 数据 private）+ 服务端 PAT 代理，用户侧零凭据。
- 人类可读的仓库布局（目录名即索引：日期-概述-提出者）+ 站点自动维护 `索引.md`，开发者工作流 = 克隆 + 改 md。
- 破坏性操作（删除反馈）要求完整输入编号确认；feature flag（Turnstile/Upstash）默认关、异常自动降级。
- 每个用户可见 bug 修复都补单测/e2e 回归，测试随版本只增不减（55 → 99）。

### 好实践（保持）

- 双仓库分离（代码 public / 数据 private）+ 服务端 PAT 代理，用户侧零凭据。
- 人类可读的仓库布局（目录名即索引：日期-概述-提出者）+ 站点自动维护 `索引.md`，开发者工作流 = 克隆 + 改 md。
- 破坏性操作（删除反馈）要求完整输入编号确认；feature flag（Turnstile/Upstash）默认关、异常自动降级。
- 每个用户可见 bug 修复都补单测/e2e 回归，测试随版本只增不减（55 → 99）。

### 好实践（保持）

- 双仓库分离（代码 public / 数据 private）+ 服务端 PAT 代理，用户侧零凭据。
- 人类可读的仓库布局（目录名即索引：日期-概述-提出者）+ 站点自动维护 `索引.md`，开发者工作流 = 克隆 + 改 md。
- 破坏性操作（删除反馈）要求完整输入编号确认；feature flag（Turnstile/Upstash）默认关、异常自动降级。
- 每个用户可见 bug 修复都补单测/e2e 回归，测试随版本只增不减（55 → 99）。

- 双仓库分离（代码 public / 数据 private）+ 服务端 PAT 代理，用户侧零凭据。
- 人类可读的仓库布局（目录名即索引：日期-概述-提出者）+ 站点自动维护 `索引.md`，开发者工作流 = 克隆 + 改 md。
- 破坏性操作（删除反馈）要求完整输入编号确认；feature flag（Turnstile/Upstash）默认关、异常自动降级。
- 每个用户可见 bug 修复都补单测/e2e 回归，测试随版本只增不减（55 → 99）。

- 双仓库分离（代码 public / 数据 private）+ 服务端 PAT 代理，用户侧零凭据。
- 人类可读的仓库布局（目录名即索引：日期-概述-提出者）+ 站点自动维护 `索引.md`，开发者工作流 = 克隆 + 改 md。
- 破坏性操作（删除反馈）要求完整输入编号确认；feature flag（Turnstile/Upstash）默认关、异常自动降级。
- 每个用户可见 bug 修复都补单测/e2e 回归，测试随版本只增不减（55 → 99）。

- 人类可读的仓库布局（目录名即索引：日期-概述-提出者）+ 站点自动维护 `索引.md`，开发者工作流 = 克隆 + 改 md。
- 破坏性操作（删除反馈）要求完整输入编号确认；feature flag（Turnstile/Upstash）默认关、异常自动降级。
- 每个用户可见 bug 修复都补单测/e2e 回归，测试随版本只增不减（55 → 99）。

- 破坏性操作（删除反馈）要求完整输入编号确认；feature flag（Turnstile/Upstash）默认关、异常自动降级。
- 每个用户可见 bug 修复都补单测/e2e 回归，测试随版本只增不减（55 → 99）。

- 每个用户可见 bug 修复都补单测/e2e 回归，测试随版本只增不减（55 → 99）。

# 05 · 手动操作手册（写给不懂编程/不熟悉 GitHub 网页的你）

> 全程只需要做一次，约 15 分钟。做完这 4 步，网站就能真正收反馈了。
> 每一步做完可以回来告诉我（或直接说"做完了"），我会接手剩下的技术活。

---

## 第 1 步：生成 GitHub 令牌（PAT）—— 约 3 分钟

这是让网站"有权限"往反馈仓库里写文件的钥匙。

1. 浏览器打开：**https://github.com/settings/personal-access-tokens/new**
   （如果页面打不开，先登录 https://github.com ，再点右上角你的头像 → **Settings** → 左侧最底部 **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → 右上角 **Generate new token**）
2. 按下面填写：
   - **Token name**（名称）：随便填，如 `aisc-issues-site`
   - **Expiration**（有效期）：选 **90 days**（到期需要换新的，到时候告诉我一声）
   - **Resource owner**：保持 **Evergarden-Alan**（就是你）
3. **Repository access** 区块：选 **Only select repositories** → 点击 **Select repositories** 下拉 → 勾选 **aisc-issues-feedback**（只勾这一个！不要勾 AISC_ISSUES）
4. 往下滚动到 **Permissions** → **Repository permissions**：
   - 找到 **Contents** → 右边下拉选择 **Read and write**
   - 其他所有权限一概不动（保持默认 No access）
5. 拉到页面最底部，点绿色按钮 **Generate token**
6. 页面会显示一串绿色高亮的令牌（`github_pat_` 开头）——**点旁边的复制按钮**。
   ⚠️ 这个令牌**只显示这一次**，关掉页面就再也看不到了。
7. 粘贴到本项目根目录的 `.env.local` 文件里，替换掉 `在这里粘贴你的PAT` 那一行
   （用记事本/VS Code 打开 `E:\Windows\Users\alan\Documents\AISC_ISSUES\.env.local` 即可）
8. 📅 建议在手机日历里加一个"90 天后"的提醒：**更换 GitHub 令牌**（到期后网站会收不到反馈）

> ✅ 第 1 步做完后告诉我，我可以帮你验证令牌是否配置成功，并继续 seed 测试数据。

---

## 第 2 步：本地试运行（可选，想先看看效果再做）—— 约 2 分钟

打开终端（Windows 搜索 PowerShell 或直接在项目文件夹地址栏输入 `cmd`），执行：

```
npm run dev
```

然后浏览器打开 **http://localhost:3000**：
- 首页应该能看到大标题"遇到问题，或想要新功能？"和提交按钮
- 点"我要提反馈"→ 选"我遇到了问题"→ 随便填一点 → 提交
- 如果提交成功且提示编号，说明整条链路通了（反馈已写进私有仓库，可以去 https://github.com/Evergarden-Alan/aisc-issues-feedback 的 feedback 目录看一眼）
- 测试完按 `Ctrl+C` 停止

> 不想做这步也行，直接跳到第 3 步部署，在 Vercel 上看效果。

---

## 第 3 步：部署到 Vercel —— 约 5 分钟

1. 浏览器打开 **https://vercel.com** → 点右上角 **Sign Up** / **Log In** → 选择 **Continue with GitHub** → 用你的 GitHub 账号（Evergarden-Alan）授权登录
2. 登录后进入控制台，点 **Add New... → Project**
3. 在 **Import Git Repository** 列表里找到 **AISC_ISSUES** → 点右侧 **Import**
   （如果列表里没有：点 **Adjust GitHub App Permissions**，授权 Vercel 访问该仓库）
4. 配置页面：
   - **Framework Preset**：应自动识别为 **Next.js**（不用动）
   - **Root Directory**：不用动（默认仓库根）
   - 其他全部保持默认
5. 展开 **Environment Variables**（环境变量）区块，逐条添加以下 4 条 **必填**
   （每条：Name 框填变量名，Value 框填值；务必加满 4 条再部署）：

   | Name（变量名） | Value（值） |
   |---|---|
   | `GITHUB_PAT` | 粘贴第 1 步生成的令牌 |
   | `REPO_OWNER` | `Evergarden-Alan` |
   | `REPO_NAME` | `aisc-issues-feedback` |
   | `FEEDBACK_TOKEN_SECRET` | 打开本地 `.env.local`，把 `FEEDBACK_TOKEN_SECRET=` 后面那串复制过来 |

   另外把 Value 输入框下方的环境勾选保持默认（Production + Preview 都勾）。
6. 点 **Deploy**，等待 1~2 分钟，出现🎉庆祝页即成功
7. 点 **Continue to Dashboard**，页面顶部能看到你的网址（形如 `xxx.vercel.app`）——这就是网站的第一版地址
8. **顺手做**：回到 Vercel 项目的 **Settings → Environment Variables**，再添加一条：
   - Name：`NEXT_PUBLIC_SITE_URL`
   - Value：你的 vercel 网址（带 `https://`，如 `https://aisc-issues.vercel.app`）
   - 添加后必须 **Settings → Deployments → 最新一条 → 右侧 ⋯ → Redeploy** 重启一次才生效

> ⚠️ `*.vercel.app` 域名在中国大陆时通时断，自己测试没问题；正式给用户用之前，先做第 4 步绑自己的域名。

---

## 第 4 步：绑定自己的域名（正式上线前做）—— 约 10 分钟 + 等待生效

如果你还没有域名，先去注册一个（推荐阿里云万网 h5.aliyun.com 或腾讯云 dnspod.cn，`.com`/`.cn` 均可，几十元/年）。

1. **添加 DNS 解析**：登录域名服务商 → 找到你的域名 → **解析设置（DNS）** → 添加记录：
   - 记录类型：**CNAME**
   - 主机记录：`feedback`（意思是 feedback.你的域名.com 这个子域名；想用别的名字就填别的）
   - 记录值：`cname.vercel-dns.com`
   - TTL：默认（10 分钟）
2. **在 Vercel 绑定**：项目 → **Settings → Domains** → 输入 `feedback.你的域名.com` → **Add**
   - 如果提示校验，按 Vercel 页面上显示的提示照做即可（通常是让你再补一条 A 记录或 TXT 记录，照抄它的提示）
   - 证书（HTTPS）Vercel 自动签发，等几分钟出现 ✓ 即可
3. **更新环境变量**：**Settings → Environment Variables** → 把 `NEXT_PUBLIC_SITE_URL` 的值改成 `https://feedback.你的域名.com` → 保存 → **重新 Redeploy**
4. 手机浏览器打开新域名，完整走一遍：提交反馈 → 看到编号 → GitHub 网页上回信 → 5 分钟内首页"开发者最新回复"出现该条

---

## 常见问题排查

| 现象 | 原因与处理 |
|---|---|
| 提交反馈报"提交暂时没有成功" | 90% 是 `GITHUB_PAT` 没配对：检查是否粘贴完整、是否只勾了 aisc-issues-feedback 仓库、Contents 权限是否选了 Read and write |
| GitHub 提示令牌到期/401 | 第 1 步重新生成一个，同时更新 `.env.local` 和 Vercel 环境变量，再 Redeploy |
| 提交报"请通过本网站提交" | `NEXT_PUBLIC_SITE_URL` 和实际访问域名不一致：改成当前域名后 Redeploy |
| 提交报"您操作有点快/反馈有点多" | 限频正常工作（60 秒冷却、每小时 5 条），等一会再试 |
| 网页显示"页面出错了" | 打开 Vercel 项目 → **Deployments** → 点最新部署 → **Functions** 或 **Runtime Logs** 看报错，截图给我 |
| 改了环境变量没生效 | Vercel 改环境变量后**必须 Redeploy**：Settings → Deployments → 最新一条 → ⋯ → Redeploy |

---

## 做完之后

把「第 1 步的 PAT 已粘贴」或任何一步的结果告诉我，我会接手：
- 验证令牌与写链路（写一条测试反馈 → 确认 → 删除）
- 向反馈仓库 seed 三条样例数据（docs/04 §7），让回信区有内容可看
- 然后开工 **M2**：截图上传、日志附件、编号查询、专属详情页

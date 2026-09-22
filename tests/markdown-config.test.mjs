import { test } from "node:test";
import assert from "node:assert/strict";
import { rewriteAssetUrls } from "../src/lib/markdown-config.ts";

// 详情页渲染守卫（v0.1.2 教训）：md 里的 issues/ 仓库路径必须改写为 /api/asset 代理，
// 漏改写 = 图片/附件全部 404（布局迁移时正则没跟上，特加渲染层测试防复发）

test("rewriteAssetUrls：issues/ 图片与附件路径改写为 /api/asset", () => {
  const img = "![截图 1](issues/20260922-构建镜像时网络异常-匿名/s1-微信图片_123.jpg)";
  const out1 = rewriteAssetUrls(img);
  assert.ok(out1.startsWith("![截图 1](/api/asset?path="), out1);
  assert.ok(decodeURIComponent(out1).includes("issues/20260922-构建镜像时网络异常-匿名/s1-微信图片_123.jpg"));

  const file = "[build.log](issues/20260922-x-匿名/a1-build.log)";
  const out2 = rewriteAssetUrls(file);
  assert.ok(out2.startsWith("[build.log](/api/asset?path="), out2);
});

test("rewriteAssetUrls：不改写站内相对链接与外链", () => {
  assert.equal(rewriteAssetUrls("[首页](/)"), "[首页](/)");
  assert.equal(rewriteAssetUrls("[外链](https://example.com/x.png)"), "[外链](https://example.com/x.png)");
});

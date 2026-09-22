import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// 布局守卫（v0.1.2 教训）：src 内禁止出现旧布局字面量 feedback/assets。
// 唯一例外：cron 路由清理 v0.1.0 残留暂存区的基路径。
// 背景：路径迁移曾用字符串批量替换，漏掉 `feedback/assets/${ref}` 间接拼接两处，
// 附件写进旧路径而提交按新路径找 → 全部报「已过期」。

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

test("src 无旧布局字面量 feedback/assets（cron 旧路径清理除外）", () => {
  const offenders = [];
  for (const f of walk("src")) {
    const norm = f.replace(/\\/g, "/");
    if (norm.endsWith("api/cron/cleanup/route.ts")) continue; // 旧暂存区清理白名单
    const text = readFileSync(f, "utf-8");
    if (text.includes("feedback/assets")) offenders.push(norm);
  }
  assert.deepEqual(offenders, []);
});

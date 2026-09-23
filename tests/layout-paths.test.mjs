import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// 布局守卫（v0.1.2 教训）：src 内禁止出现旧布局字面量 feedback/assets（零容忍）。
// 背景：路径迁移曾用字符串批量替换，漏掉 `feedback/assets/${ref}` 间接拼接两处，
// 附件写进旧路径而提交按新路径找 → 全部报「已过期」。
// v0.1.0 旧布局目录已于 2026-09-23 从数据仓库移除，旧路径扫描代码随之删除。

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

test("src 无旧布局字面量 feedback/assets（零容忍）", () => {
  const offenders = [];
  for (const f of walk("src")) {
    const text = readFileSync(f, "utf-8");
    if (text.includes("feedback/assets")) offenders.push(f.replace(/\\/g, "/"));
  }
  assert.deepEqual(offenders, []);
});

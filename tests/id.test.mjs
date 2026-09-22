import { test } from "node:test";
import assert from "node:assert/strict";
import { makeFolderId, randomSuffix, ID_PATTERN } from "../src/lib/id.ts";
import { beijingIso, beijingStamp } from "../src/lib/beijing-time.ts";

// id 生成与北京时间口径（02 §5.1、§9）

test("makeFolderId：{YYYYMMDD}-{概述≤20}-{提出者≤12}，非法字符清洗", () => {
  const now = Date.UTC(2026, 8, 21, 6, 30, 25); // 北京 2026-09-21
  const id = makeFolderId("导出报表时软件闪退", "阿明", now);
  assert.equal(id, "20260921-导出报表时软件闪退-阿明");
  assert.match(id, ID_PATTERN);
  // 空格/特殊符号 → -，连续 - 合并，掐头去尾
  assert.equal(
    makeFolderId("  a/b:*c?  ", "小 明", now),
    "20260921-a-b-c-小-明"
  );
  // 超长截断（概述 20、提出者 12）
  const long = makeFolderId("长".repeat(30), "名".repeat(20), now);
  const [, t, n] = long.split("-");
  assert.equal(t.length, 20);
  assert.equal(n.length, 12);
  // 空值兜底
  assert.equal(makeFolderId("", "", now), "20260921-未命名-匿名");
});

test("randomSuffix 字符集与长度", () => {
  for (let i = 0; i < 20; i++) {
    const s = randomSuffix(6);
    assert.match(s, /^[a-z0-9]{6}$/);
  }
});

test("beijingIso 显式 +08:00，禁止 Z/UTC", () => {
  const iso = beijingIso(Date.UTC(2026, 8, 21, 6, 30, 25));
  assert.equal(iso, "2026-09-21T14:30:25+08:00");
  assert.ok(!iso.endsWith("Z"));
});

test("beijingStamp 与 beijingIso 钟面时间一致（02 §9）", () => {
  const ms = Date.UTC(2026, 11, 31, 16, 5, 9); // 北京 2027-01-01 00:05:09（跨年边界）
  assert.equal(beijingStamp(ms), "20270101-000509");
  assert.equal(beijingIso(ms), "2027-01-01T00:05:09+08:00");
});

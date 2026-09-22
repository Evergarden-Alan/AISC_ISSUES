import { test } from "node:test";
import assert from "node:assert/strict";
import { makeId, randomSuffix, ID_PATTERN } from "../src/lib/id.ts";
import { beijingIso, beijingStamp } from "../src/lib/beijing-time.ts";

// id 生成与北京时间口径（02 §5.1、§9）

test("id 格式：YYYYMMDD-HHmmss-6位随机小写字母数字", () => {
  const id = makeId(Date.UTC(2026, 8, 21, 6, 30, 25)); // 北京时间 2026-09-21 14:30:25
  assert.match(id, ID_PATTERN);
  const [date, time, rand] = id.split("-");
  assert.equal(date, "20260921");
  assert.equal(time, "143025");
  assert.match(rand, /^[a-z0-9]{6}$/);
});

test("同一时刻多次生成：时间戳相同、随机串不同", () => {
  const now = Date.UTC(2026, 8, 21, 6, 30, 25);
  const ids = new Set(Array.from({ length: 50 }, () => makeId(now)));
  assert.equal(ids.size, 50); // 随机段不重复（36^6 空间下 50 连同概率可忽略）
  for (const id of ids) {
    assert.equal(id.slice(0, 15), "20260921-143025"); // 时间戳稳定（同一 nowMs）
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

test("randomSuffix 字符集与长度", () => {
  for (let i = 0; i < 20; i++) {
    const s = randomSuffix(6);
    assert.match(s, /^[a-z0-9]{6}$/);
  }
});

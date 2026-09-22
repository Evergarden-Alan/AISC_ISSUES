import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ID_PATTERN,
} from "../src/lib/constants.ts";
import { hitVoteLimit } from "../src/lib/rate-limit.ts";
import {
  affectsOf,
  parseFeedback,
  setFrontmatterIntField,
} from "../src/lib/markdown-utils.ts";
import { readFileSync } from "node:fs";

// 投票（v0.1.1 T4.1/T4.2）：affects 归一化与写入、限频窗口、updated_at 不变

const FIXTURE = readFileSync(
  new URL("./fixtures/feedback/20260921-143025-a3f9kz.md", import.meta.url),
  "utf-8"
);
const FIXTURE_VOTED = readFileSync(
  new URL("./fixtures/feedback/20260922-100001-vote007.md", import.meta.url),
  "utf-8"
);

test("affectsOf：缺省 0、正常值、脏数据归 0、上限钳制", () => {
  assert.equal(affectsOf(parseFeedback(FIXTURE).fm), 0); // 无字段
  assert.equal(affectsOf(parseFeedback(FIXTURE_VOTED).fm), 7);
  assert.equal(affectsOf({ affects: undefined }), 0);
  assert.equal(affectsOf({ affects: "3" }), 0); // 字符串
  assert.equal(affectsOf({ affects: -2 }), 0); // 负数
  assert.equal(affectsOf({ affects: 2.5 }), 2); // 小数向下取整
  assert.equal(affectsOf({ affects: Number.NaN }), 0);
  assert.equal(affectsOf({ affects: 2_000_000 }), 999_999); // 封顶
});

test("setFrontmatterIntField：已有字段裸数字替换；缺省时插入 status 行后", () => {
  // 存量文件首投：0 → 1，字段插入 status 行之后、裸数字不加引号
  const first = setFrontmatterIntField(FIXTURE, "affects", 1);
  assert.ok(first.includes('status: "submitted"\naffects: 1'));
  assert.ok(!first.includes('affects: "1"'));
  const fm1 = parseFeedback(first).fm;
  assert.equal(fm1.affects, 1);
  assert.equal(fm1.updated_at, parseFeedback(FIXTURE).fm.updated_at); // updated_at 不变
  assert.equal(fm1.created_at, parseFeedback(FIXTURE).fm.created_at);
  // 再次投票：整行替换为裸数字
  const second = setFrontmatterIntField(first, "affects", 2);
  assert.ok(second.includes("affects: 2"));
  assert.ok(!second.includes("affects: 1"));
  // 已投样例正常 +1
  const next = setFrontmatterIntField(FIXTURE_VOTED, "affects", 8);
  assert.ok(next.includes("affects: 8"));
  assert.equal(parseFeedback(next).fm.affects, 8);
});

test("setFrontmatterIntField：无 frontmatter / 无 status 锚点 → 原样返回", () => {
  assert.equal(setFrontmatterIntField("普通文本", "affects", 1), "普通文本");
  assert.equal(
    setFrontmatterIntField("---\ntitle: \"x\"\n---\n正文", "affects", 1),
    '---\ntitle: "x"\n---\n正文'
  );
  assert.equal(setFrontmatterIntField("---\nbroken", "affects", 1), "---\nbroken");
});

test("ID_PATTERN 复用：投票编号边界（缺段 / 大写 / 超长拒绝）", () => {
  assert.ok(ID_PATTERN.test("20260921-143025-a3f9kz"));
  assert.ok(!ID_PATTERN.test("20260921-143025")); // 缺随机段
  assert.ok(!ID_PATTERN.test("20260921-143025-A3F9KZ")); // 大写
  assert.ok(!ID_PATTERN.test("20260921-1430250-a3f9kz")); // 超长
  assert.ok(!ID_PATTERN.test("x20260921-143025-a3f9kz"));
});

test("hitVoteLimit（内存）：同（IP, 反馈）1 次/小时、跨窗口重置、另一条不受影响", async () => {
  // 走默认 limiter 的内存后端（未配置 UPSTASH 时）；键 vote:{ip}:{id}
  const ip = `vote-test-${Math.random().toString(36).slice(2)}`; // 独立 IP 防测试间串扰
  const idA = "20260921-143025-a3f9kz";
  const idB = "20260920-155801-c7tq3e";
  const now = Date.now();
  assert.equal(await hitVoteLimit(ip, idA, now), true);
  assert.equal(await hitVoteLimit(ip, idA, now + 60_000), false); // 1 小时内第二次
  assert.equal(await hitVoteLimit(ip, idB, now + 120_000), true); // 另一条不受影响
  assert.equal(await hitVoteLimit(ip, idA, now + 3_600_000 + 1), true); // 跨窗口重置
});

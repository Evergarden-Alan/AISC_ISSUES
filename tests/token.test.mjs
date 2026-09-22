import { test } from "node:test";
import assert from "node:assert/strict";
import { makeIssueToken } from "../src/lib/token.ts";

// 详情页专属链接 token（02 §8 已拍板：HMAC-SHA256 前 16 位、无状态、不落库）

test("token 为 16 位十六进制小写，确定性可复算", () => {
  process.env.FEEDBACK_TOKEN_SECRET = "test-secret-for-unit";
  const t1 = makeIssueToken("20260921-143025-a3f9kz");
  const t2 = makeIssueToken("20260921-143025-a3f9kz");
  assert.match(t1, /^[0-9a-f]{16}$/);
  assert.equal(t1, t2); // 同 id 同密钥 → 同 token（无状态）
});

test("不同 id / 不同密钥 → 不同 token", () => {
  process.env.FEEDBACK_TOKEN_SECRET = "test-secret-for-unit";
  const a = makeIssueToken("20260921-143025-a3f9kz");
  const b = makeIssueToken("20260921-143025-a3f9kx");
  assert.notEqual(a, b);
  process.env.FEEDBACK_TOKEN_SECRET = "another-secret";
  const c = makeIssueToken("20260921-143025-a3f9kz");
  assert.notEqual(a, c);
});

test("未配置密钥时抛错（不静默降级）", () => {
  const prev = process.env.FEEDBACK_TOKEN_SECRET;
  delete process.env.FEEDBACK_TOKEN_SECRET;
  assert.throws(() => makeIssueToken("x"));
  process.env.FEEDBACK_TOKEN_SECRET = prev;
});

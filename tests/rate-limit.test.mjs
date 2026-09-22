import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hitRateLimit,
  checkIdempotency,
  finishIdempotency,
} from "../src/lib/rate-limit.ts";

// 限频 5 次/小时 + 60s 冷却 + 幂等键状态机（03 §6.1、§7；04 §6 映射行）

test("同 IP 第 6 次/小时被拒（reason=hour）", () => {
  const t0 = 1_000_000;
  for (let i = 0; i < 5; i++) {
    assert.deepEqual(hitRateLimit("ip-a", t0 + i * 120_000), { allowed: true }); // 每 2 分钟一次，避开冷却
  }
  const r = hitRateLimit("ip-a", t0 + 5 * 120_000);
  assert.deepEqual(r, { allowed: false, reason: "hour" });
});

test("60 秒冷却：紧邻第二次提交被拒（reason=cooldown）", () => {
  const t0 = 5_000_000;
  assert.deepEqual(hitRateLimit("ip-b", t0), { allowed: true });
  assert.deepEqual(hitRateLimit("ip-b", t0 + 59_000), {
    allowed: false,
    reason: "cooldown",
  });
  assert.deepEqual(hitRateLimit("ip-b", t0 + 61_000), { allowed: true });
});

test("滑动窗口：1 小时后计数重置", () => {
  const t0 = 10_000_000;
  for (let i = 0; i < 5; i++) {
    hitRateLimit("ip-c", t0 + i * 120_000);
  }
  assert.equal(hitRateLimit("ip-c", t0 + 11 * 60_000).allowed, false); // 窗口内第 6 次
  assert.equal(hitRateLimit("ip-c", t0 + 61 * 60_000).allowed, true); // 窗口外重置
});

test("不同 IP 相互独立", () => {
  const t0 = 20_000_000;
  assert.deepEqual(hitRateLimit("ip-d", t0), { allowed: true });
  assert.deepEqual(hitRateLimit("ip-e", t0), { allowed: true });
});

test("幂等键：new → in-flight → done 返回缓存结果", () => {
  const key = "11111111-2222-4333-8444-555555555555";
  const t0 = 30_000_000;
  assert.deepEqual(checkIdempotency(key, t0), { kind: "new" });
  assert.deepEqual(checkIdempotency(key, t0 + 1), { kind: "in-flight" });
  finishIdempotency(key, { ok: true, id: "20260921-143025-a3f9kz" }, t0 + 2);
  const done = checkIdempotency(key, t0 + 3);
  assert.equal(done.kind, "done");
  if (done.kind === "done") {
    assert.equal(done.result.id, "20260921-143025-a3f9kz");
  }
});

test("幂等键 TTL 15 分钟后过期重置", () => {
  const key = "aaaa1111-2222-4333-8444-555555555555";
  const t0 = 40_000_000;
  checkIdempotency(key, t0);
  finishIdempotency(key, { ok: true, id: "x-1" }, t0);
  const after = checkIdempotency(key, t0 + 16 * 60_000);
  assert.equal(after.kind, "new");
});

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createRateLimiter,
  hitRateLimit,
  hitUploadLimit,
  hitVoteLimit,
  upstashConfigured,
  upstashPipeline,
} from "../src/lib/rate-limit.ts";

// Upstash Redis 后端（v0.1.1 T2.2）：pipeline 请求体、判定语义、故障回退内存

const REAL_FETCH = globalThis.fetch;

function setUpstash(url, token) {
  if (url === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
  else process.env.UPSTASH_REDIS_REST_URL = url;
  if (token === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN;
  else process.env.UPSTASH_REDIS_REST_TOKEN = token;
}

function jsonRes(pairs) {
  return {
    ok: true,
    status: 200,
    json: async () => pairs,
  };
}

test("upstashConfigured：两项均非空才配置", () => {
  setUpstash(undefined, undefined);
  assert.equal(upstashConfigured(), false);
  setUpstash("https://x.upstash.io", "");
  assert.equal(upstashConfigured(), false);
  setUpstash("https://x.upstash.io", "tok");
  assert.equal(upstashConfigured(), true);
  setUpstash(undefined, undefined);
});

test("Redis incr：单请求 POST /pipeline，Bearer 鉴权，INCR + PEXPIRE NX（毫秒）", async () => {
  setUpstash("https://x.upstash.io/", "tok");
  let captured = null;
  globalThis.fetch = async (url, init) => {
    captured = { url: String(url), headers: init?.headers, body: init?.body };
    return jsonRes([
      [null, 1],
      [null, 1],
    ]);
  };
  try {
    const n = await upstashPipeline([
      ["INCR", "rl:1.2.3.4"],
      ["PEXPIRE", "rl:1.2.3.4", "3600000", "NX"],
    ]);
    assert.deepEqual(n, [1, 1]);
    assert.match(captured.url, /^https:\/\/x\.upstash\.io\/pipeline$/);
    assert.equal(captured.headers.Authorization, "Bearer tok");
    const body = JSON.parse(captured.body);
    assert.deepEqual(body[0], ["INCR", "rl:1.2.3.4"]);
    assert.deepEqual(body[1], ["PEXPIRE", "rl:1.2.3.4", "3600000", "NX"]);
  } finally {
    globalThis.fetch = REAL_FETCH;
    setUpstash(undefined, undefined);
  }
});

test("命令级错误（pipeline 返回 error）→ 抛错", async () => {
  setUpstash("https://x.upstash.io", "tok");
  globalThis.fetch = async () => jsonRes([["ERR unknown command", null]]);
  try {
    await assert.rejects(() => upstashPipeline([["BOGUS"]]));
  } finally {
    globalThis.fetch = REAL_FETCH;
    setUpstash(undefined, undefined);
  }
});

test("配置 Upstash 且命令成功：5 次/小时 + 冷却语义与内存一致", async () => {
  setUpstash("https://x.upstash.io", "tok");
  // 每次 fetch = 一个 pipeline 批：hitRateLimit 两批（SET NX 冷却 → INCR 小时），
  // hitUploadLimit / hitVoteLimit 各一批（仅 INCR）
  const script = [];
  globalThis.fetch = async () => jsonRes([[null, script.shift()]]);
  try {
    // 第 1 次提交：冷却 SET NX → "OK"，小时 INCR → 1
    script.push("OK", 1);
    assert.deepEqual(await hitRateLimit("ip-r"), { allowed: true });
    // 第 2 次（60s 内）：冷却键已存在，SET NX → null ⇒ cooldown（不消耗 INCR）
    script.push(null);
    assert.deepEqual(await hitRateLimit("ip-r"), { allowed: false, reason: "cooldown" });
    // 窗口第 6 次：冷却 "OK"、INCR → 6
    script.push("OK", 6);
    assert.deepEqual(await hitRateLimit("ip-r"), { allowed: false, reason: "hour" });
    // 上传 20 次/小时：第 20 次允许、第 21 次拒绝
    script.push(20);
    assert.equal(await hitUploadLimit("ip-r"), true);
    script.push(21);
    assert.equal(await hitUploadLimit("ip-r"), false);
    // 投票 1 次/小时：第 1 次允许、第 2 次拒绝
    script.push(1);
    assert.equal(await hitVoteLimit("ip-r", "20260921-143025-a3f9kz"), true);
    script.push(2);
    assert.equal(await hitVoteLimit("ip-r", "20260921-143025-a3f9kz"), false);
  } finally {
    globalThis.fetch = REAL_FETCH;
    setUpstash(undefined, undefined);
  }
});

test("Redis 抛错 / 非 2xx → 降级内存路径，判定仍正确", async () => {
  setUpstash("https://x.upstash.io", "tok");
  globalThis.fetch = async () => {
    throw new Error("connection refused");
  };
  try {
    assert.deepEqual(await hitRateLimit("ip-fallback"), { allowed: true });
    assert.equal(await hitUploadLimit("ip-fallback"), true);
    assert.equal(await hitVoteLimit("ip-fallback", "20260921-143025-a3f9kz"), true);
  } finally {
    globalThis.fetch = REAL_FETCH;
  }
  globalThis.fetch = async () => ({
    ok: false,
    status: 500,
    json: async () => [],
  });
  try {
    assert.equal(await hitVoteLimit("ip-fallback2", "20260921-143025-a3f9kz"), true);
  } finally {
    globalThis.fetch = REAL_FETCH;
    setUpstash(undefined, undefined);
  }
});

test("幂等键语义两后端一致：createRateLimiter 注入假后端验证 new → in-flight → done", async () => {
  const store = new Map();
  const fakeIdem = {
    async setIfAbsent(key, value, ttlMs, now = Date.now()) {
      const e = store.get(key);
      if (e && e.expiresAt > now) return false;
      store.set(key, { value, expiresAt: now + ttlMs });
      return true;
    },
    async get(key, now = Date.now()) {
      const e = store.get(key);
      if (!e || e.expiresAt <= now) return null;
      return e.value;
    },
    async set(key, value, ttlMs, now = Date.now()) {
      store.set(key, { value, expiresAt: now + ttlMs });
    },
  };
  const fakeCounter = {
    async incr() {
      return 1;
    },
    async setIfAbsent() {
      return true;
    },
  };
  const limiter = createRateLimiter(fakeCounter, fakeIdem);
  const key = "11111111-2222-4333-8444-555555555555";
  const t0 = 30_000_000;
  assert.deepEqual(await limiter.checkIdempotency(key, t0), { kind: "new" });
  assert.deepEqual(await limiter.checkIdempotency(key, t0 + 1), { kind: "in-flight" });
  await limiter.finishIdempotency(key, { ok: true, id: "20260921-143025-a3f9kz" }, t0 + 2);
  const done = await limiter.checkIdempotency(key, t0 + 3);
  assert.equal(done.kind, "done");
  if (done.kind === "done") assert.equal(done.result.id, "20260921-143025-a3f9kz");
  // TTL 过期后重置
  assert.deepEqual(await limiter.checkIdempotency(key, t0 + 16 * 60_000), { kind: "new" });
});

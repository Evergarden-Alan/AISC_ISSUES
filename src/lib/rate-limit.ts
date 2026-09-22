// 限流与幂等（v0.1.1 双后端）：UPSTASH_REDIS_REST_URL/TOKEN 均非空 → Redis 精确计数
// （裸 fetch REST pipeline，零新增依赖）；未配置或故障 → 函数内存实现（v0.1.0 行为）。
// 可用性优先：Redis 任何异常降级内存并告警——宁松勿断。

const HOUR_MS = 3_600_000;
const COOLDOWN_MS = 60_000;
const MAX_PER_HOUR = 5; // 同 IP 提交 5 次/小时
const UPLOAD_MAX_PER_HOUR = 20; // 附件上传 20 次/小时（无冷却）
const VOTE_MAX_PER_HOUR = 1; // 同（IP, 反馈）投票 1 次/小时
const IDEMPOTENCY_TTL_MS = 15 * 60_000;
const REDIS_TIMEOUT_MS = 500;

export type RateVerdict =
  | { allowed: true }
  | { allowed: false; reason: "cooldown" | "hour" };

export type IdemVerdict =
  | { kind: "new" }
  | { kind: "in-flight" }
  | { kind: "done"; result: { ok: true; id: string } };

// ===== 后端接口（测试可注入；now 仅内存后端使用）=====

export interface CounterBackend {
  /** 窗口计数：INCR key（首次设 TTL windowMs）。返回窗口内当前计数 */
  incr(key: string, windowMs: number, now?: number): Promise<number>;
  /** 冷却闸门：SET key 1 PX windowMs NX。置入成功（此前不存在）→ true */
  setIfAbsent(key: string, windowMs: number, now?: number): Promise<boolean>;
}

export interface IdemBackend {
  setIfAbsent(key: string, value: string, ttlMs: number, now?: number): Promise<boolean>;
  get(key: string, now?: number): Promise<string | null>;
  set(key: string, value: string, ttlMs: number, now?: number): Promise<void>;
  delete(key: string): Promise<void>;
}

// ===== 判定逻辑（纯编排，键名与阈值集中在这一层）=====

export interface RateLimiter {
  hitRateLimit(ip: string, now?: number): Promise<RateVerdict>;
  hitUploadLimit(ip: string, now?: number): Promise<boolean>;
  hitVoteLimit(ip: string, id: string, now?: number): Promise<boolean>;
  checkIdempotency(key: string, now?: number): Promise<IdemVerdict>;
  finishIdempotency(
    key: string,
    result: { ok: true; id: string },
    now?: number
  ): Promise<void>;
  /** 释放 in-flight 幂等键（提交失败后调用）；done 结果保留（重放仍返回成功） */
  releaseIdempotency(key: string, now?: number): Promise<void>;
}

export function createRateLimiter(
  counter: CounterBackend,
  idem: IdemBackend
): RateLimiter {
  return {
    async hitRateLimit(ip, now) {
      const cdOk = await counter.setIfAbsent(`rl:cd:${ip}`, COOLDOWN_MS, now);
      if (!cdOk) return { allowed: false, reason: "cooldown" };
      const n = await counter.incr(`rl:${ip}`, HOUR_MS, now);
      if (n > MAX_PER_HOUR) return { allowed: false, reason: "hour" };
      return { allowed: true };
    },
    async hitUploadLimit(ip, now) {
      const n = await counter.incr(`rl:up:${ip}`, HOUR_MS, now);
      return n <= UPLOAD_MAX_PER_HOUR;
    },
    async hitVoteLimit(ip, id, now) {
      const n = await counter.incr(`vote:${ip}:${id}`, HOUR_MS, now);
      return n <= VOTE_MAX_PER_HOUR;
    },
    async checkIdempotency(key, now) {
      const k = `idem:${key}`;
      const fresh = await idem.setIfAbsent(
        k,
        JSON.stringify({ state: "in-flight" }),
        IDEMPOTENCY_TTL_MS,
        now
      );
      if (fresh) return { kind: "new" };
      const raw = await idem.get(k, now);
      if (!raw) return { kind: "new" }; // 恰好过期：按新键处理
      try {
        const rec = JSON.parse(raw) as {
          state?: string;
          result?: { ok: true; id: string };
        };
        if (rec.state === "done" && rec.result) {
          return { kind: "done", result: rec.result };
        }
        return { kind: "in-flight" };
      } catch {
        return { kind: "in-flight" };
      }
    },
    async finishIdempotency(key, result, now) {
      await idem.set(
        `idem:${key}`,
        JSON.stringify({ state: "done", result }),
        IDEMPOTENCY_TTL_MS,
        now
      );
    },
    async releaseIdempotency(key, now) {
      const k = `idem:${key}`;
      const raw = await idem.get(k, now);
      if (!raw) return;
      try {
        const rec = JSON.parse(raw) as { state?: string };
        if (rec.state === "done") return; // 已成功的结果不释放
      } catch {
        // 无法解析按 in-flight 处理，走删除
      }
      await idem.delete(k);
    },
  };
}

// ===== 内存后端（v0.1.0 行为；单实例近似计数）=====

const MAX_MAP_SIZE = 10_000; // 防内存膨胀：超限整体重置

const memWindows = new Map<string, { count: number; windowStart: number }>();
const memKv = new Map<string, { value: string; expiresAt: number }>();

function memSweep(now: number): void {
  if (memWindows.size + memKv.size < MAX_MAP_SIZE / 2) return;
  if (memWindows.size + memKv.size >= MAX_MAP_SIZE) {
    memWindows.clear();
    memKv.clear();
    return;
  }
  for (const [k, e] of memWindows) {
    if (now - e.windowStart > 2 * HOUR_MS) memWindows.delete(k);
  }
  for (const [k, e] of memKv) {
    if (e.expiresAt <= now) memKv.delete(k);
  }
}

const memoryCounter: CounterBackend = {
  async incr(key, windowMs, now = Date.now()) {
    memSweep(now);
    const e = memWindows.get(key);
    if (!e || now - e.windowStart > windowMs) {
      memWindows.set(key, { count: 1, windowStart: now });
      return 1;
    }
    e.count += 1;
    return e.count;
  },
  async setIfAbsent(key, windowMs, now = Date.now()) {
    const e = memKv.get(key);
    if (e && e.expiresAt > now) return false;
    memKv.set(key, { value: "1", expiresAt: now + windowMs });
    return true;
  },
};

const memoryIdem: IdemBackend = {
  async setIfAbsent(key, value, ttlMs, now = Date.now()) {
    const e = memKv.get(key);
    if (e && e.expiresAt > now) return false;
    memKv.set(key, { value, expiresAt: now + ttlMs });
    return true;
  },
  async get(key, now = Date.now()) {
    const e = memKv.get(key);
    if (!e) return null;
    if (e.expiresAt <= now) {
      memKv.delete(key);
      return null;
    }
    return e.value;
  },
  async set(key, value, ttlMs, now = Date.now()) {
    memKv.set(key, { value, expiresAt: now + ttlMs });
  },
  async delete(key) {
    memKv.delete(key);
  },
};

// ===== Redis 后端（Upstash REST pipeline；接口报错一律抛出由上层降级）=====

export function upstashConfigured(): boolean {
  return !!(
    process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
  );
}

/** 单次 POST /pipeline 发送多条命令；返回 [error, result] 对中的 result 列表 */
export async function upstashPipeline(cmds: unknown[][]): Promise<unknown[]> {
  const url = process.env.UPSTASH_REDIS_REST_URL!.replace(/\/+$/, "");
  const token = process.env.UPSTASH_REDIS_REST_TOKEN!;
  const res = await fetch(`${url}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(cmds),
    signal: AbortSignal.timeout(REDIS_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`upstash http ${res.status}`);
  const data = (await res.json()) as [unknown, unknown][];
  for (const [err] of data) {
    if (err) throw new Error("upstash command error");
  }
  return data.map(([, r]) => r);
}

const redisCounter: CounterBackend = {
  async incr(key, windowMs) {
    const out = await upstashPipeline([
      ["INCR", key],
      ["PEXPIRE", key, String(windowMs), "NX"],
    ]);
    return Number(out[0]) || 0;
  },
  async setIfAbsent(key, windowMs) {
    const out = await upstashPipeline([
      ["SET", key, "1", "PX", String(windowMs), "NX"],
    ]);
    return out[0] === "OK";
  },
};

const redisIdem: IdemBackend = {
  async setIfAbsent(key, value, ttlMs) {
    const out = await upstashPipeline([
      ["SET", key, value, "PX", String(ttlMs), "NX"],
    ]);
    return out[0] === "OK";
  },
  async get(key) {
    const out = await upstashPipeline([["GET", key]]);
    const v = out[0];
    return typeof v === "string" ? v : null;
  },
  async set(key, value, ttlMs) {
    await upstashPipeline([["SET", key, value, "PX", String(ttlMs)]]);
  },
  async delete(key) {
    await upstashPipeline([["DEL", key]]);
  },
};

// ===== 对外入口：按配置选后端，Redis 故障逐次降级内存 =====

const memoryLimiter = createRateLimiter(memoryCounter, memoryIdem);
const redisLimiter = createRateLimiter(redisCounter, redisIdem);

async function run<T>(fn: (l: RateLimiter) => Promise<T>): Promise<T> {
  if (upstashConfigured()) {
    try {
      return await fn(redisLimiter);
    } catch (e) {
      console.error(
        "[rate-limit] Redis 不可用，本次降级内存计数：",
        e instanceof Error ? e.message : e
      );
    }
  }
  return fn(memoryLimiter);
}

export function hitRateLimit(ip: string, now?: number): Promise<RateVerdict> {
  return run((l) => l.hitRateLimit(ip, now));
}

export function hitUploadLimit(ip: string, now?: number): Promise<boolean> {
  return run((l) => l.hitUploadLimit(ip, now));
}

export function hitVoteLimit(ip: string, id: string, now?: number): Promise<boolean> {
  return run((l) => l.hitVoteLimit(ip, id, now));
}

export function checkIdempotency(key: string, now?: number): Promise<IdemVerdict> {
  return run((l) => l.checkIdempotency(key, now));
}

export function finishIdempotency(
  key: string,
  result: { ok: true; id: string },
  now?: number
): Promise<void> {
  return run((l) => l.finishIdempotency(key, result, now));
}

export function releaseIdempotency(key: string, now?: number): Promise<void> {
  return run((l) => l.releaseIdempotency(key, now));
}

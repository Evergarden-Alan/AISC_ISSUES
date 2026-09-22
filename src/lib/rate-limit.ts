// 限流与幂等（03 §6.1、§7）：函数内存近似实现，Upstash 接口预留（v1 不接）。
// Serverless 多实例下为尽力而为——与蜜罐 + 字段白名单叠加后误重复/滥用概率可忽略。

const HOUR_MS = 3_600_000;
const MAX_PER_HOUR = 5; // 同 IP 5 次/小时
const COOLDOWN_MS = 60_000; // 两次提交间隔 ≥60s
const MAX_MAP_SIZE = 10_000; // 防内存膨胀：超限整体重置

interface RateEntry {
  count: number;
  windowStart: number;
  lastAt: number;
}

const rateMap = new Map<string, RateEntry>();

export type RateVerdict =
  | { allowed: true }
  | { allowed: false; reason: "cooldown" | "hour" };

/** 惰性清理：写入时顺带删除过期项 */
function sweep(now: number): void {
  if (rateMap.size < MAX_MAP_SIZE / 2) return;
  if (rateMap.size >= MAX_MAP_SIZE) {
    rateMap.clear();
    return;
  }
  for (const [k, e] of rateMap) {
    if (now - e.windowStart > HOUR_MS) rateMap.delete(k);
  }
}

export function hitRateLimit(ip: string, now: number = Date.now()): RateVerdict {
  sweep(now);
  const entry = rateMap.get(ip);

  if (entry) {
    if (now - entry.lastAt < COOLDOWN_MS) return { allowed: false, reason: "cooldown" };
    if (now - entry.windowStart <= HOUR_MS && entry.count >= MAX_PER_HOUR) {
      return { allowed: false, reason: "hour" };
    }
    if (now - entry.windowStart > HOUR_MS) {
      entry.count = 0;
      entry.windowStart = now;
    }
    entry.count += 1;
    entry.lastAt = now;
    return { allowed: true };
  }

  rateMap.set(ip, { count: 1, windowStart: now, lastAt: now });
  return { allowed: true };
}

// ===== 幂等键（防重复提交，03 §6.1）=====

const IDEMPOTENCY_TTL_MS = 15 * 60_000;

interface IdemRecord {
  state: "in-flight" | "done";
  result?: { ok: true; id: string };
  expiresAt: number;
}

const idemMap = new Map<string, IdemRecord>();

export type IdemVerdict =
  | { kind: "new" }
  | { kind: "in-flight" }
  | { kind: "done"; result: { ok: true; id: string } };

export function checkIdempotency(key: string, now: number = Date.now()): IdemVerdict {
  const rec = idemMap.get(key);
  if (!rec || now > rec.expiresAt) {
    idemMap.set(key, { state: "in-flight", expiresAt: now + IDEMPOTENCY_TTL_MS });
    return { kind: "new" };
  }
  if (rec.state === "in-flight") return { kind: "in-flight" };
  return { kind: "done", result: rec.result! };
}

export function finishIdempotency(
  key: string,
  result: { ok: true; id: string },
  now: number = Date.now()
): void {
  const rec = idemMap.get(key);
  if (rec) {
    rec.state = "done";
    rec.result = result;
  } else {
    idemMap.set(key, { state: "done", result, expiresAt: now + IDEMPOTENCY_TTL_MS });
  }
}

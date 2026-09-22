import { upstashConfigured, upstashPipeline } from "./rate-limit.ts";

// Turnstile 人机验证（v0.1.1 M2-1，默认关）：三值齐备才启用；
// 校验一次性 token（siteverify）+ 防重放（内存 Map TTL 10 分钟 / Redis SET NX EX 600）。
// fail-closed：siteverify 不可达按失败处理；「缺 token 降级放行」在路由层判定。

const REPLAY_TTL_SECONDS = 600;

/** 三值齐备且 ENABLED 严格等于 "true"；缺一即整体关闭 */
export function turnstileEnabled(): boolean {
  return (
    process.env.TURNSTILE_ENABLED === "true" &&
    !!process.env.TURNSTILE_SECRET_KEY &&
    !!process.env.TURNSTILE_SITE_KEY
  );
}

// ===== 防重放集合（内存 / Redis 双实现）=====

const usedTokens = new Map<string, number>(); // token → expiresAt（ms）

function memSweepUsed(now: number): void {
  if (usedTokens.size < 5000) return;
  for (const [t, exp] of usedTokens) {
    if (exp <= now) usedTokens.delete(t);
  }
}

async function tokenAlreadyUsed(token: string): Promise<boolean> {
  const key = `tsused:${token}`;
  if (upstashConfigured()) {
    try {
      const out = await upstashPipeline([["GET", key]]);
      return out[0] != null;
    } catch (e) {
      console.error(
        "[turnstile] Redis 不可用，重放集合降级内存：",
        e instanceof Error ? e.message : e
      );
    }
  }
  const now = Date.now();
  memSweepUsed(now);
  const exp = usedTokens.get(token);
  return exp !== undefined && exp > now;
}

async function markTokenUsed(token: string): Promise<void> {
  const key = `tsused:${token}`;
  if (upstashConfigured()) {
    try {
      await upstashPipeline([
        ["SET", key, "1", "EX", String(REPLAY_TTL_SECONDS)],
      ]);
      return;
    } catch (e) {
      console.error(
        "[turnstile] Redis 不可用，重放集合降级内存：",
        e instanceof Error ? e.message : e
      );
    }
  }
  usedTokens.set(token, Date.now() + REPLAY_TTL_SECONDS * 1000);
}

/**
 * 一次性 token 校验：POST siteverify（secret/response/remoteip，5s 超时）。
 * success !== true、网络异常、超时、非 JSON 一律 false（fail-closed）。
 * 校验成功后 token 记入已用集合；重复 token（重放）直接按失败处理。
 */
export async function verifyTurnstileToken(
  token: string,
  ip: string
): Promise<boolean> {
  if (await tokenAlreadyUsed(token)) return false;
  try {
    const body = new URLSearchParams({
      secret: process.env.TURNSTILE_SECRET_KEY ?? "",
      response: token,
      remoteip: ip,
    });
    const res = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        signal: AbortSignal.timeout(5000),
        cache: "no-store",
      }
    );
    if (!res.ok) return false;
    const data = (await res.json()) as { success?: boolean };
    if (data.success !== true) return false;
  } catch {
    return false;
  }
  await markTokenUsed(token);
  return true;
}

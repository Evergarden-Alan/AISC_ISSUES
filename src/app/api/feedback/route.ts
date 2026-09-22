import { NextRequest, NextResponse } from "next/server";
import { validateSubmission } from "@/lib/validate";
import {
  hitRateLimit,
  checkIdempotency,
  finishIdempotency,
  releaseIdempotency,
} from "@/lib/rate-limit";
import { createFeedback, StaleRefError } from "@/lib/feedback";
import { GitHubApiError } from "@/lib/github-client";
import { makeId } from "@/lib/id";
import { makeIssueToken } from "@/lib/token";
import { sameOrigin, clientIp } from "@/lib/guards";
import { turnstileEnabled, verifyTurnstileToken } from "@/lib/turnstile";

// POST /api/feedback —— 薄控制器（03 §3.1）：校验 → 调 lib → 组装响应。
// 安全：Origin 同源校验；蜜罐静默丢弃；同 IP 限频；幂等键；服务端白名单。

export const runtime = "nodejs";
export const maxDuration = 60;

function fail(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function POST(req: NextRequest) {
  // ① Origin 同源校验
  if (!sameOrigin(req)) return fail("请通过本网站提交", 403);

  // ② 解析请求体
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail("提交内容格式不正确");
  }
  if (typeof body !== "object" || body === null) return fail("提交内容格式不正确");
  const b = body as Record<string, unknown>;

  // ③ 蜜罐：非空 → 不写仓库、不计限流、返回 200 伪成功（合法格式假编号）
  if (typeof b.website === "string" && b.website.trim() !== "") {
    return NextResponse.json({ ok: true, id: makeId(Date.now()) });
  }

  // ④ 同 IP 限频：5 次/小时 + 60s 冷却
  const verdict = await hitRateLimit(clientIp(req));
  if (!verdict.allowed) {
    return fail(
      verdict.reason === "cooldown"
        ? "您操作有点快，请 1 分钟后再提交。"
        : "您今天提交的反馈有点多，请 1 小时后再来。",
      429
    );
  }

  // ⑤ 幂等键：header 与 body 必须一致（03 §3.1）
  const headerKey = req.headers.get("x-idempotency-key") ?? "";
  const bodyKey = typeof b.idempotencyKey === "string" ? b.idempotencyKey : "";
  if (!headerKey || headerKey !== bodyKey) {
    return fail("提交标识缺失，请刷新页面重试");
  }
  const idem = await checkIdempotency(bodyKey);
  if (idem.kind === "in-flight") {
    return fail("正在提交，请稍候…", 409);
  }
  if (idem.kind === "done") {
    return NextResponse.json(idem.result);
  }
  // 本次请求持有幂等键：后续任何失败路径都必须释放，否则 15 分钟内重试全是
  // 409「正在提交」（真实案例：截图过期 400 后键卡死，用户怎么重试都被拦）
  const ownsIdemKey = idem.kind === "new";
  const failOwned = (error: string, status = 400, extra?: Record<string, unknown>) => {
    const res = NextResponse.json({ ok: false, error, ...extra }, { status });
    return ownsIdemKey ? releaseIdempotency(bodyKey).then(() => res) : Promise.resolve(res);
  };

  // ⑤.5 Turnstile 人机验证（v0.1.1 M2-1，默认关；开启时缺 token 降级放行并告警）
  if (turnstileEnabled()) {
    const tsTok = typeof b.turnstileToken === "string" ? b.turnstileToken : "";
    if (!tsTok) {
      console.warn("[turnstile] 缺 token 降级放行");
    } else if (!(await verifyTurnstileToken(tsTok, clientIp(req)))) {
      return failOwned("人机验证未通过，请刷新页面重试");
    }
  }

  // ⑥ 字段白名单/枚举/长度校验（按路径区分）
  const validated = validateSubmission(body);
  if (!validated.ok) return failOwned(validated.error);

  // ⑦ 写入私有反馈仓库（预检/归位/409/422 换随机串重试都在编排层内）
  try {
    const id = await createFeedback(validated.value);
    const token = makeIssueToken(id);
    const url = `/issue/${id}?t=${token}`;
    const result = { ok: true as const, id, token, url };
    await finishIdempotency(bodyKey, result);
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof StaleRefError) {
      return failOwned("截图或附件已过期，请重新上传", 400, { staleRef: e.ref });
    }
    console.error(
      "[api/feedback] 写入失败：",
      e instanceof GitHubApiError ? `GitHub API ${e.status}` : e
    );
    return failOwned("提交暂时没有成功，您填写的内容都保留着，请稍后重试", 500);
  }
}

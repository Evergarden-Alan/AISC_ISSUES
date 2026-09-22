import { NextRequest, NextResponse } from "next/server";
import { validateSubmission } from "@/lib/validate";
import { hitRateLimit, checkIdempotency, finishIdempotency } from "@/lib/rate-limit";
import { createFeedback } from "@/lib/feedback";
import { GitHubApiError } from "@/lib/github-client";
import { makeId } from "@/lib/id";

// POST /api/feedback —— 薄控制器（03 §3.1）：校验 → 调 lib → 组装响应。
// 安全：Origin 同源校验；蜜罐静默丢弃；同 IP 限频；幂等键；服务端白名单。

export const runtime = "nodejs";
export const maxDuration = 60;

function fail(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  const allowed = new Set<string>();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (siteUrl) allowed.add(siteUrl.replace(/\/$/, ""));
  const host = req.headers.get("host");
  if (host) {
    allowed.add(`https://${host}`);
    allowed.add(`http://${host}`);
  }
  return allowed.has(origin.replace(/\/$/, ""));
}

function clientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  return xff?.split(",")[0]?.trim() || "unknown"; // 取不到按 unknown 合并计数（宁可误伤）
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
  const verdict = hitRateLimit(clientIp(req));
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
  const idem = checkIdempotency(bodyKey);
  if (idem.kind === "in-flight") {
    return fail("正在提交，请稍候…", 409);
  }
  if (idem.kind === "done") {
    return NextResponse.json(idem.result);
  }

  // ⑥ 字段白名单/枚举/长度校验（按路径区分）
  const validated = validateSubmission(body);
  if (!validated.ok) return fail(validated.error);

  // ⑦ 写入私有反馈仓库（409/422 换随机串重试在编排层内）
  try {
    const id = await createFeedback(validated.value);
    const result = { ok: true as const, id };
    finishIdempotency(bodyKey, result);
    return NextResponse.json(result);
  } catch (e) {
    console.error(
      "[api/feedback] 写入失败：",
      e instanceof GitHubApiError ? `GitHub API ${e.status}` : e
    );
    return fail("提交暂时没有成功，您填写的内容都保留着，请稍后重试", 500);
  }
}

import { NextRequest, NextResponse } from "next/server";
import { sameOrigin } from "@/lib/guards";
import { ADMIN_COOKIE, adminEnabled, cookieValueFor, tokenMatches } from "@/lib/admin";

// POST /api/admin/login —— 管理页登录：校验 ADMIN_TOKEN，下发 httpOnly cookie

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) {
    return NextResponse.json({ ok: false, error: "请通过本网站提交" }, { status: 403 });
  }
  if (!adminEnabled()) {
    return NextResponse.json(
      { ok: false, error: "管理功能未启用（服务端未配置 ADMIN_TOKEN）" },
      { status: 403 }
    );
  }
  let token = "";
  try {
    const body = (await req.json()) as { token?: string };
    token = typeof body.token === "string" ? body.token : "";
  } catch {
    return NextResponse.json({ ok: false, error: "请求格式不正确" }, { status: 400 });
  }
  if (!token || !tokenMatches(token)) {
    return NextResponse.json({ ok: false, error: "管理令牌不正确" }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, cookieValueFor(token), {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/",
    maxAge: 60 * 60 * 12, // 12 小时
  });
  return res;
}

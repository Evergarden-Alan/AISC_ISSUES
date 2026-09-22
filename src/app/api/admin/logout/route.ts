import { NextRequest, NextResponse } from "next/server";
import { sameOrigin } from "@/lib/guards";
import { ADMIN_COOKIE } from "@/lib/admin";

// POST /api/admin/logout —— 清除管理 cookie

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) {
    return NextResponse.json({ ok: false, error: "请通过本网站提交" }, { status: 403 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, "", { httpOnly: true, secure: true, sameSite: "strict", path: "/", maxAge: 0 });
  return res;
}

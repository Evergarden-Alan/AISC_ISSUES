import { NextRequest, NextResponse } from "next/server";
import { isAdmin, adminEnabled } from "@/lib/admin";
import { getAdminList } from "@/lib/data";

// GET /api/admin/list —— 管理页数据（含 hidden 条目）；cookie 门禁

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!adminEnabled()) {
    return NextResponse.json(
      { ok: false, error: "管理功能未启用" },
      { status: 403 }
    );
  }
  if (!isAdmin(req)) {
    return NextResponse.json({ ok: false, error: "请先登录" }, { status: 401 });
  }
  const items = await getAdminList();
  return NextResponse.json({ ok: true, items });
}

import type { NextRequest } from "next/server";

// API 路由共用守卫：Origin 同源校验 + 客户端 IP 提取（03 §3 统一约定）

export function sameOrigin(req: NextRequest): boolean {
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

export function clientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  return xff?.split(",")[0]?.trim() || "unknown"; // 取不到按 unknown 合并计数（宁可误伤）
}

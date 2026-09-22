import { createHash, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

// 管理页守卫（03：受保护管理页，可选件）
// 凭据 = ADMIN_TOKEN 环境变量（不配置则管理功能整体停用）。
// 登录后下发 httpOnly cookie（值为 token 的 sha256，服务端可复算校验），JS 永远拿不到原文。

export const ADMIN_COOKIE = "aisc_admin";

export function adminEnabled(): boolean {
  return !!process.env.ADMIN_TOKEN;
}

export function cookieValueFor(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function tokenMatches(input: string): boolean {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) return false;
  const a = Buffer.from(cookieValueFor(input));
  const b = Buffer.from(cookieValueFor(expected));
  return a.length === b.length && timingSafeEqual(a, b);
}

export function isAdmin(req: NextRequest): boolean {
  if (!adminEnabled()) return false;
  const got = req.cookies.get(ADMIN_COOKIE)?.value ?? "";
  const expect = cookieValueFor(process.env.ADMIN_TOKEN!);
  const a = Buffer.from(got);
  const b = Buffer.from(expect);
  return a.length === b.length && timingSafeEqual(a, b);
}

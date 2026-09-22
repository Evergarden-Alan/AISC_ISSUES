import { createHmac } from "node:crypto";

// 详情页专属链接 token（02 §8 已拍板口径）：
// t = HMAC-SHA256(FEEDBACK_TOKEN_SECRET, id) 前 16 位十六进制小写；
// 无状态、不落库、不进 frontmatter；详情页公开可访问，t 不作强制拦截。

export function makeIssueToken(id: string): string {
  const secret = process.env.FEEDBACK_TOKEN_SECRET;
  if (!secret) {
    throw new Error("FEEDBACK_TOKEN_SECRET is not configured");
  }
  return createHmac("sha256", secret).update(id).digest("hex").slice(0, 16);
}

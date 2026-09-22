import { randomInt } from "node:crypto";
import { beijingParts } from "./beijing-time.ts";

export { ID_PATTERN } from "./constants.ts";

/** 目录名段清洗：保留汉字/字母/数字/_/-，其余替换为 -，掐头去尾并限长 */
function sanitizeSegment(s: string, maxLen: number): string {
  const cleaned = (s || "")
    .replace(/[/\\:*?"<>|\s]/g, "-")
    .replace(/[^A-Za-z0-9一-龥_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned.slice(0, maxLen);
}

/**
 * 条目目录名 = {YYYYMMDD}-{概述≤20}-{提出者≤12}（北京日期；v0.1.2 布局）。
 * 概述/提出者为空时回退「未命名/匿名」（表单层已必填，此处兜底脏数据）。
 */
export function makeFolderId(
  title: string,
  nickname: string,
  nowMs: number
): string {
  const p = beijingParts(nowMs);
  const date = `${p.year}${p.month}${p.day}`;
  const t = sanitizeSegment(title, 20) || "未命名";
  const n = sanitizeSegment(nickname, 12) || "匿名";
  return `${date}-${t}-${n}`;
}

/** 密码学随机后缀（目录名极端冲突兜底），禁止 Math.random */
export function randomSuffix(len = 4): string {
  const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < len; i++) out += ALPHABET[randomInt(0, ALPHABET.length)];
  return out;
}

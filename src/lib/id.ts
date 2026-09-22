import { randomInt } from "node:crypto";
import { beijingStamp } from "./beijing-time.ts";

// id = {北京时间 YYYYMMDD}-{HHmmss}-{6 位随机 [a-z0-9]}（02 §5.1）
const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789"; // 36 个字符

/** 密码学随机源，禁止 Math.random */
export function randomSuffix(len = 6): string {
  let out = "";
  for (let i = 0; i < len; i++) out += ALPHABET[randomInt(0, ALPHABET.length)];
  return out;
}

/** nowMs 为本次提交取定的统一时刻（文件名时间与 created_at 同源，02 §9） */
export function makeId(nowMs: number): string {
  return `${beijingStamp(nowMs)}-${randomSuffix()}`;
}

export const ID_PATTERN = /^\d{8}-\d{6}-[a-z0-9]{6}$/;

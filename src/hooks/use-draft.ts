"use client";

import { LIMITS } from "@/lib/constants";

// localStorage 草稿（01 §4.0/§4.0.1、03 §6.1）：
// 键 aisc:draft，单键按路径分桶；微信内置浏览器隐私模式读写需 try/catch 静默降级。

export type FormPath = "issue" | "feature";

export interface DraftState {
  version: 1;
  path: FormPath;
  shared: {
    title: string;
    description: string;
    nickname: string;
  };
  issue: {
    type: "bug" | "ux" | "question" | "other" | null;
    severity: "blocker" | "normal" | "low" | null;
    steps: string;
    expected: string;
    actual: string;
  };
  feature: {
    scenario: string;
    workaround: string;
  };
  idempotencyKey: string;
  savedAt: string; // ISO 8601 (+08:00)
}

const KEY = "aisc:draft";

export function emptyDraft(): DraftState {
  return {
    version: 1,
    path: "issue",
    shared: { title: "", description: "", nickname: "" },
    issue: { type: null, severity: null, steps: "", expected: "", actual: "" },
    feature: { scenario: "", workaround: "" },
    idempotencyKey: "",
    savedAt: "",
  };
}

/** UUID v4：crypto.randomUUID 不可用（非安全上下文）时手动拼装 */
export function makeUuidV4(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${h.slice(17, 21)}-${h.slice(21)}`;
}

export function loadDraft(): DraftState {
  const base = emptyDraft();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) {
      base.idempotencyKey = makeUuidV4();
      return base;
    }
    const parsed = JSON.parse(raw) as Partial<DraftState>;
    if (parsed.version !== 1) {
      base.idempotencyKey = makeUuidV4();
      return base;
    }
    return {
      ...base,
      ...parsed,
      shared: { ...base.shared, ...parsed.shared },
      issue: { ...base.issue, ...parsed.issue },
      feature: { ...base.feature, ...parsed.feature },
      idempotencyKey: parsed.idempotencyKey || makeUuidV4(),
    };
  } catch {
    return { ...base, idempotencyKey: makeUuidV4() };
  }
}

/** 保存草稿（自动填 savedAt 与幂等键）；失败静默（内置浏览器隐私模式） */
export function saveDraft(draft: DraftState): void {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({ ...draft, savedAt: new Date().toISOString() })
    );
  } catch {
    // 静默降级：不再显示「草稿已自动保存」
  }
}

export function clearDraft(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // 忽略
  }
}

/** 前端实时字数按字符计（汉字算 1），与服务端 lenOk 口径一致 */
export function charCount(s: string): number {
  return [...s].length;
}

export { LIMITS };

import {
  PENDING_DIR_LEGACY_RE,
  PENDING_DIR_NEW_RE,
  pendingDirDateMs,
} from "./attachments.ts";

// _pending 孤儿清理纯函数层（02-design §3.1）：目录名判龄与超龄筛选，路由层只做 IO。

const DAY_MS = 24 * 60 * 60 * 1000;

/** 清理阈值：目录日期距今 >7 天即删（日粒度近似，当天上传最长存活约 8 个自然日） */
export const PENDING_MAX_AGE_MS = 7 * DAY_MS;

/**
 * v0.1.0 遗留裸 uuid 目录的删除起点：北京时间 2026-09-29 00:00（= v0.1.0 上线日 + 7 天）。
 * 此时刻之前旧目录跳过（无法判龄），之后视为超龄一并删除。
 */
export const LEGACY_PENDING_CUTOFF_MS = Date.UTC(2026, 8, 28, 16, 0, 0);

export interface StaleDirsResult {
  stale: string[]; // 待删除
  kept: string[]; // 未超龄，保留
  skipped: string[]; // 既非新格式也非旧 uuid 格式 → 防误删，跳过
}

export function selectStalePendingDirs(
  dirNames: string[],
  nowMs: number,
  opts: { maxAgeMs?: number; legacyCutoffMs?: number } = {}
): StaleDirsResult {
  const maxAge = opts.maxAgeMs ?? PENDING_MAX_AGE_MS;
  const legacyCutoff = opts.legacyCutoffMs ?? LEGACY_PENDING_CUTOFF_MS;
  const stale: string[] = [];
  const kept: string[] = [];
  const skipped: string[] = [];
  for (const name of dirNames) {
    if (PENDING_DIR_NEW_RE.test(name)) {
      const t = pendingDirDateMs(name);
      if (t !== null && nowMs - t > maxAge) stale.push(name);
      else kept.push(name);
    } else if (PENDING_DIR_LEGACY_RE.test(name)) {
      if (nowMs >= legacyCutoff) stale.push(name);
      else kept.push(name);
    } else {
      skipped.push(name);
    }
  }
  return { stale, kept, skipped };
}

import { test } from "node:test";
import assert from "node:assert/strict";
import { pendingDirDateMs } from "../src/lib/attachments.ts";
import {
  LEGACY_PENDING_CUTOFF_MS,
  PENDING_MAX_AGE_MS,
  selectStalePendingDirs,
} from "../src/lib/pending-cleanup.ts";

// _pending 目录判龄与超龄筛选（02-design §1.2/§3.1；03-tasks T1.2）

const DAY = 24 * 60 * 60 * 1000;
const NEW = "20260922-143005-3f2a1b0c-9d8e-4f7a-b6c5-d4e5f6071829";
const OLD = "3f2a1b0c-9d8e-4f7a-b6c5-d4e5f6071829"; // v0.1.0 遗留裸 uuid
const ILLEGAL = "not-a-directory-name";

test("pendingDirDateMs：合法目录返回北京时间 epoch；裸 uuid 与非法名返回 null", () => {
  // 北京 2026-09-22 14:30:05 = UTC 06:30:05
  assert.equal(pendingDirDateMs(NEW), Date.UTC(2026, 8, 22, 6, 30, 5));
  assert.equal(pendingDirDateMs(OLD), null);
  assert.equal(pendingDirDateMs(ILLEGAL), null);
  assert.equal(pendingDirDateMs("20261399-993099-3f2a1b0c-9d8e-4f7a-b6c5-d4e5f6071829"), null);
});

test("截止筛选：8 天前选删、7 天内与当日保留", () => {
  const now = Date.UTC(2026, 8, 30, 6, 0, 0); // 北京 9-30 14:00
  const d8 = "20260922-143005-3f2a1b0c-9d8e-4f7a-b6c5-d4e5f6071829"; // 8 天前
  const d1 = "20260929-143005-3f2a1b0c-9d8e-4f7a-b6c5-d4e5f6071829"; // 1 天前
  const d0 = "20260930-140000-3f2a1b0c-9d8e-4f7a-b6c5-d4e5f6071829"; // 当天
  const r = selectStalePendingDirs([d8, d1, d0], now);
  assert.deepEqual(r.stale, [d8]);
  assert.deepEqual(r.kept, [d1, d0]);
  assert.deepEqual(r.skipped, []);
});

test("阈值精确性：恰好 7 天保留、超过 7 天删除（PENDING_MAX_AGE_MS = 7 天）", () => {
  const created = Date.UTC(2026, 8, 22, 6, 30, 5);
  assert.equal(PENDING_MAX_AGE_MS, 7 * DAY);
  assert.equal(
    selectStalePendingDirs(["20260922-143005-3f2a1b0c-9d8e-4f7a-b6c5-d4e5f6071829"], created + PENDING_MAX_AGE_MS).stale.length,
    0
  );
  assert.equal(
    selectStalePendingDirs(["20260922-143005-3f2a1b0c-9d8e-4f7a-b6c5-d4e5f6071829"], created + PENDING_MAX_AGE_MS + 1).stale.length,
    1
  );
});

test("非法目录名跳过（防误删）、空清单安全返回", () => {
  const now = Date.UTC(2026, 8, 30, 6, 0, 0);
  const r = selectStalePendingDirs([ILLEGAL, "assets", ""], now);
  assert.deepEqual(r.stale, []);
  assert.deepEqual(r.kept, []);
  assert.deepEqual(r.skipped, [ILLEGAL, "assets", ""]);
  const empty = selectStalePendingDirs([], now);
  assert.deepEqual(empty, { stale: [], kept: [], skipped: [] });
});

test("遗留裸 uuid 目录：2026-09-29 前保留、其后视为超龄", () => {
  const before = LEGACY_PENDING_CUTOFF_MS - 1;
  const at = LEGACY_PENDING_CUTOFF_MS;
  assert.equal(selectStalePendingDirs([OLD], before).stale.length, 0);
  assert.equal(selectStalePendingDirs([OLD], before).kept.length, 1);
  assert.equal(selectStalePendingDirs([OLD], at).stale.length, 1);
});

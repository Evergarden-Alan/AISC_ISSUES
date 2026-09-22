import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clampPercent,
  emaSpeed,
  etaSecondsOf,
  formatUploadProgress,
  makeUploadId,
} from "../src/lib/upload-client.ts";

// 上传进度纯函数（02-design §2.1/§2.2；03-tasks §3.2）

test("clampPercent：0 与 100 边界、非法 total、超界钳制", () => {
  assert.equal(clampPercent(0, 1000), 0);
  assert.equal(clampPercent(1000, 1000), 100);
  assert.equal(clampPercent(1500, 1000), 100); // multipart 开销不修正，钳 100
  assert.equal(clampPercent(500, 0), 0);
  assert.equal(clampPercent(500, -1), 0);
  assert.equal(clampPercent(Number.NaN, 100), 0);
  assert.equal(clampPercent(1, Number.NaN), 0);
  assert.equal(clampPercent(1234, 10000), 12); // 向下取整
});

test("emaSpeed：首样本直取、α=0.3 平滑、零样本保持", () => {
  const first = emaSpeed(0, 1000, 1000); // 1000 B/s
  assert.equal(first, 1000);
  // 下一样本 3000 B/s：ema = 1000*0.7 + 3000*0.3 = 1600
  assert.equal(emaSpeed(first, 3000, 1000), 1600);
  assert.equal(emaSpeed(1600, 0, 1000), 1600); // 无新增字节 → 不变
  assert.equal(emaSpeed(1600, 1000, 0), 1600); // 零时长样本 → 不变
});

test("etaSecondsOf：速度为 0 → -1；正常向上取整", () => {
  assert.equal(etaSecondsOf(1000, 500, 0), -1);
  assert.equal(etaSecondsOf(10_000, 0, 1000), 10);
  assert.equal(etaSecondsOf(10_000, 500, 1000), 10); // 剩 9500 → ceil 10
  assert.equal(etaSecondsOf(10_000, 10_000, 1000), 0);
  assert.equal(etaSecondsOf(100, 200, 50), 0); // 已超出 → 0
});

test("formatUploadProgress：速度为 0 仅百分比；KB/s 与 MB/s 进位；剩余时间 ≥2 秒才附", () => {
  assert.equal(formatUploadProgress({ loaded: 45, total: 100, percent: 45, bytesPerSecond: 0, etaSeconds: -1 }), "45%");
  assert.equal(
    formatUploadProgress({ loaded: 45, total: 100, percent: 45, bytesPerSecond: 812 * 1024, etaSeconds: 30 }),
    "45%（812 KB/s，剩余约 30 秒）"
  );
  assert.equal(
    formatUploadProgress({ loaded: 78, total: 100, percent: 78, bytesPerSecond: 1.4 * 1024 * 1024, etaSeconds: 6 }),
    "78%（1.4 MB/s，剩余约 6 秒）"
  );
  assert.equal(
    formatUploadProgress({ loaded: 10, total: 100, percent: 10, bytesPerSecond: 2 * 1024 * 1024, etaSeconds: 1 }),
    "10%（2.0 MB/s）"
  ); // 剩余 <2 秒不显示
  assert.equal(
    formatUploadProgress({ loaded: 1, total: 100, percent: 1, bytesPerSecond: 512, etaSeconds: 4 }),
    "1%（1 KB/s，剩余约 4 秒）"
  ); // 极小速度避免显示 0 KB/s
});

test("分片跨片按字节聚合进度公式（loaded = 已完成分片字节 + 当前片已传字节）", () => {
  const file = { size: 10 * 1024 * 1024 };
  const CHUNK = 3.5 * 1024 * 1024;
  const total = Math.ceil(file.size / CHUNK); // 3 片
  assert.equal(total, 3);
  // 第 2 片（i=1）内已传 1MB
  const uploadedBefore = 1 * CHUNK;
  const loadedAll = Math.min(file.size, uploadedBefore + 1024 * 1024);
  const percent = clampPercent(loadedAll, file.size);
  assert.equal(loadedAll, 4.5 * 1024 * 1024);
  assert.equal(percent, 45);
  // 最后一片内超出按文件大小钳制（2 片覆盖 7MB，末片 +3MB 即整文件）
  const lastAll = Math.min(file.size, 2 * CHUNK + 3 * 1024 * 1024);
  assert.equal(lastAll, file.size);
  assert.equal(clampPercent(lastAll, file.size), 100);
});

test("makeUploadId：日期前缀（北京时间）+ uuid4 双段格式", () => {
  // 北京 2026-09-22 14:30:05 = UTC 06:30:05
  const id = makeUploadId(Date.UTC(2026, 8, 22, 6, 30, 5));
  assert.match(id, /^20260922-143005-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  const id2 = makeUploadId(Date.UTC(2026, 8, 22, 6, 30, 5));
  assert.notEqual(id, id2); // uuid 段随机
});

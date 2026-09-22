"use client";

// 附件上传客户端封装（POST /api/attachment，multipart）
// 小文件单请求直传；大文件（>3.5MB）切片分传 + finalize 合并（绕开 Vercel 4.5MB 请求体上限）。
// v0.1.1：表单提交统一走 XHR（fetch 拿不到上传进度）；进度/速度计算为可单测纯函数。

export interface UploadedRef {
  ref: string;
  originalName: string;
}

export interface UploadProgress {
  loaded: number; // 已发送字节（分片场景 = 已完成分片字节 + 当前片内进度）
  total: number; // 总字节（整个文件）
  percent: number; // 0–100 整数
  bytesPerSecond: number; // EMA 平滑速度（B/s）；发起未满 2 秒为 0（不显示，防跳变）
  etaSeconds: number; // 剩余秒数；速度为 0 时 -1
}

export type ProgressCb = (p: UploadProgress) => void;

const CHUNK_SIZE = 3.5 * 1024 * 1024; // 留出 multipart 开销余量
const XHR_TIMEOUT_MS = 60_000;
const EMA_ALPHA = 0.3;
const SPEED_MIN_SAMPLE_MS = 2_000;

// ===== 进度计算纯函数（tests/upload-progress.test.mjs）=====

export function clampPercent(loaded: number, total: number): number {
  if (!Number.isFinite(loaded) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.floor((loaded / total) * 100)));
}

/** 指数滑动平均：首样本直接取值，其后 prev*(1-α)+inst*α */
export function emaSpeed(
  prev: number,
  sampleBytes: number,
  sampleMs: number
): number {
  if (sampleMs <= 0 || sampleBytes <= 0) return prev;
  const inst = sampleBytes / (sampleMs / 1000);
  return prev === 0 ? inst : prev * (1 - EMA_ALPHA) + inst * EMA_ALPHA;
}

export function etaSecondsOf(
  total: number,
  loaded: number,
  bytesPerSecond: number
): number {
  if (bytesPerSecond <= 0) return -1;
  return Math.ceil(Math.max(0, total - loaded) / bytesPerSecond);
}

/** 文案规范（02-design §2.2）：45% / 45%（812 KB/s） / 78%（1.4 MB/s，剩余约 6 秒） */
export function formatUploadProgress(p: UploadProgress): string {
  if (p.bytesPerSecond <= 0) return `${p.percent}%`;
  const speed =
    p.bytesPerSecond < 1024 * 1024
      ? `${Math.max(1, Math.round(p.bytesPerSecond / 1024))} KB/s`
      : `${(p.bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`;
  return p.etaSeconds >= 2
    ? `${p.percent}%（${speed}，剩余约 ${p.etaSeconds} 秒）`
    : `${p.percent}%（${speed}）`;
}

/** 单次请求内的进度跟踪器：EMA 速度 + 发起未满 2 秒不显示速度 */
function createTracker(total: number): (loaded: number) => UploadProgress {
  const startAt = Date.now();
  let ema = 0;
  let lastAt = startAt;
  let lastLoaded = 0;
  return (loaded: number): UploadProgress => {
    const now = Date.now();
    const dt = now - lastAt;
    if (dt > 0 && loaded > lastLoaded) {
      ema = emaSpeed(ema, loaded - lastLoaded, dt);
    }
    lastAt = now;
    lastLoaded = loaded;
    const elapsed = now - startAt;
    const bps = elapsed < SPEED_MIN_SAMPLE_MS ? 0 : ema;
    return {
      loaded,
      total,
      percent: clampPercent(loaded, total),
      bytesPerSecond: bps,
      etaSeconds: etaSecondsOf(total, loaded, bps),
    };
  };
}

/** _pending 目录名：北京时间 YYYYMMDD-HHmmss-uuid4（客户端时钟偏差 ≤7 天无实际影响） */
export function makeUploadId(now: number = Date.now()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(now));
  const o: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") o[part.type] = part.value;
  }
  return `${o.year}${o.month}${o.day}-${o.hour}${o.minute}${o.second}-${makeUuidV4()}`;
}

/** UUID v4：crypto.randomUUID 不可用（非安全上下文）时手动拼装（与 use-draft 同逻辑） */
function makeUuidV4(): string {
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

// ===== XHR 传输 =====

type XhrData = {
  ok: boolean;
  ref?: string;
  originalName?: string;
  error?: string;
};

function postFormXhr(
  fd: FormData,
  onBytes?: (loaded: number, total: number) => void
): Promise<XhrData> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/attachment");
    xhr.timeout = XHR_TIMEOUT_MS;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onBytes?.(e.loaded, e.total);
    };
    xhr.onload = () => {
      try {
        resolve(JSON.parse(xhr.responseText) as XhrData);
      } catch {
        reject(new Error("上传失败，请稍后重试"));
      }
    };
    xhr.onerror = () => reject(new Error("上传失败，请稍后重试"));
    xhr.ontimeout = () => reject(new Error("上传失败，请稍后重试"));
    xhr.send(fd);
  });
}

/** 单请求直传（≤3.5MB）。onProgress 提供整文件进度 */
export async function uploadAttachment(
  file: File,
  kind: "image" | "file",
  onProgress?: ProgressCb,
  turnstileToken?: string
): Promise<UploadedRef> {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("kind", kind);
  fd.append("uploadId", makeUploadId()); // v0.1.1：直传也带日期化目录名
  if (turnstileToken) fd.append("turnstileToken", turnstileToken);
  const tracker = createTracker(file.size);
  const data = await postFormXhr(fd, (loaded, total) =>
    onProgress?.(tracker(Math.min(loaded, total)))
  );
  if (!data.ok || !data.ref) throw new Error(data.error || "上传失败，请稍后重试");
  return { ref: data.ref, originalName: data.originalName ?? file.name };
}

/**
 * 大文件分片上传：逐片 POST（带 uploadId/index/total），全部完成后 finalize 合并。
 * onProgress 回调整体进度（按字节跨片聚合；速度取当前分片滑动窗口值，近似），
 * chunkIndex 从 1 起。
 */
export async function uploadLargeFile(
  file: File,
  onProgress?: (
    p: UploadProgress,
    chunkIndex: number,
    chunkTotal: number
  ) => void,
  turnstileToken?: string,
  onFinalizeStart?: () => void
): Promise<UploadedRef> {
  const uploadId = makeUploadId();
  const total = Math.ceil(file.size / CHUNK_SIZE);
  for (let i = 0; i < total; i++) {
    const blob = file.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
    const fd = new FormData();
    fd.append("file", blob, `${file.name}.part${i}`);
    fd.append("kind", "file");
    fd.append("uploadId", uploadId);
    fd.append("name", file.name);
    fd.append("index", String(i));
    fd.append("total", String(total));
    if (turnstileToken) fd.append("turnstileToken", turnstileToken);
    const tracker = createTracker(blob.size);
    const uploadedBefore = i * CHUNK_SIZE;
    const data = await postFormXhr(fd, (loaded, chunkTotal) => {
      const loadedAll = Math.min(file.size, uploadedBefore + loaded);
      onProgress?.(
        {
          ...tracker(Math.min(loaded, chunkTotal)),
          loaded: loadedAll,
          total: file.size,
          percent: clampPercent(loadedAll, file.size),
        },
        i + 1,
        total
      );
    });
    if (!data.ok) throw new Error(data.error || "上传失败，请稍后重试");
  }
  // finalize：服务端按序合并分片 → 生成单一 _pending 引用
  onFinalizeStart?.();
  const fd = new FormData();
  fd.append("kind", "file");
  fd.append("finalize", "1");
  fd.append("uploadId", uploadId);
  fd.append("name", file.name);
  fd.append("total", String(total));
  if (turnstileToken) fd.append("turnstileToken", turnstileToken);
  const data = await postFormXhr(fd);
  if (!data.ok || !data.ref) throw new Error(data.error || "上传失败，请稍后重试");
  return { ref: data.ref, originalName: data.originalName ?? file.name };
}

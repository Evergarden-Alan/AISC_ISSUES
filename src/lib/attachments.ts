// 附件校验常量 + 魔数嗅闻 + 请求体封顶 + 文件名安全化 + 资源路径白名单（03 §3.2/§3.3、02 §7.1）

export const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // 截图 ≤4MB/张（客户端已压缩）
export const MAX_FILE_BYTES = 20 * 1024 * 1024; // 日志 ≤20MB/个（分片上传后服务端合并）
export const MAX_BODY_BYTES = 4 * 1024 * 1024; // Vercel 请求体 4.5MB 上限之下的流式封顶
export const MAX_CHUNK_BYTES = 4 * 1024 * 1024; // 单个分片上限（客户端按 3.5MB 切）

export const IMAGE_EXTS = ["jpg", "png", "webp"] as const;
export const FILE_EXTS = ["log", "txt", "json", "zip"] as const;

export class RequestBodyTooLargeError extends Error {
  constructor() {
    super("request body too large");
    this.name = "RequestBodyTooLargeError";
  }
}

/** 流式读取请求体，超过 MAX_BODY_BYTES 立即中断（不进解析器） */
export async function readLimitedBody(req: Request): Promise<Buffer> {
  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > MAX_BODY_BYTES) throw new RequestBodyTooLargeError();
  const reader = req.body?.getReader();
  if (!reader) throw new RequestBodyTooLargeError();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      reader.cancel();
      throw new RequestBodyTooLargeError();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** 忽略客户端 MIME 声明，只认魔数（03 §3.2）；不支持 gif/svg */
export function sniffImageType(buf: Buffer): "jpeg" | "png" | "webp" | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "jpeg";
  }
  if (
    buf.length >= 4 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    return "png";
  }
  if (
    buf.length >= 12 &&
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "webp";
  }
  return null;
}

export function isZipMagic(buf: Buffer): boolean {
  return (
    buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04
  );
}

/** 文件扩展名（小写，不含点）；无扩展名返回空串 */
export function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i === -1 ? "" : name.slice(i + 1).toLowerCase();
}

/**
 * 安全化原文件名（02 §7.1）：保留汉字/字母/数字/_/-/.；
 * 空格与 / \ : * ? " < > | 等替换为 -；扩展名转小写；
 * 总长超 80 字符截断主名（保住扩展名）；处理后为空回退 "file"。
 */
export function sanitizeFileName(name: string): string {
  const normalized = (name || "").replace(/[/\\:*?"<>|\s]/g, "-");
  const ext = extOf(normalized);
  const base = ext ? normalized.slice(0, normalized.length - ext.length - 1) : normalized;
  let safeBase = base.replace(/[^A-Za-z0-9一-龥_-]/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "");
  const safeExt = ext.replace(/[^A-Za-z0-9]/g, "");
  if (!safeBase) safeBase = "file";
  const maxBase = 80 - (safeExt ? safeExt.length + 1 : 0);
  if (safeBase.length > maxBase) safeBase = safeBase.slice(0, maxBase);
  return safeExt ? `${safeBase}.${safeExt}` : safeBase;
}

/** /api/asset 路径白名单：issues/{目录名}/{文件名}（v0.1.2 布局；_pending 多一段天然不匹配） */
export const ASSET_PATH_PATTERN =
  /^issues\/[A-Za-z0-9一-龥._-]{1,120}\/[A-Za-z0-9一-龥._-]+$/;

/**
 * 附件引用白名单（v0.1.1 日期化目录，双格式兼容）：
 * 新 _pending/{YYYYMMDD-HHmmss}-{uuid4}/{安全化文件名}；旧 _pending/{uuid4}/… 过渡期放行。
 */
export const PENDING_REF_PATTERN =
  /^_pending\/(\d{8}-\d{6}-[0-9a-f-]{36}|[0-9a-f-]{36})\/[A-Za-z0-9一-龥._-]+$/;

/** _pending 子目录名：日期化新格式 */
export const PENDING_DIR_NEW_RE = /^\d{8}-\d{6}-[0-9a-f-]{36}$/;
/** _pending 子目录名：v0.1.0 遗留裸 uuid 格式 */
export const PENDING_DIR_LEGACY_RE = /^[0-9a-f-]{36}$/;

/**
 * 目录名前 15 位日期时间（北京时间 YYYYMMDD-HHmmss）→ epoch ms。
 * 无日期前缀（v0.1.0 遗留）或格式非法 → null。
 */
export function pendingDirDateMs(dirName: string): number | null {
  const m = dirName.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-/);
  if (!m) return null;
  const [, y, mo, d, h, mi, se] = m;
  const moN = +mo, dN = +d, hN = +h, miN = +mi, seN = +se;
  if (moN < 1 || moN > 12 || dN < 1 || dN > 31 || hN > 23 || miN > 59 || seN > 59) {
    return null; // 分段越界（防 Date.UTC 静默进位误判）
  }
  const ms = Date.UTC(+y, moN - 1, dN, hN - 8, miN, seN); // 北京 = UTC+8
  return Number.isFinite(ms) ? ms : null;
}

export function isValidAssetPath(p: string): boolean {
  return !p.includes("..") && ASSET_PATH_PATTERN.test(p);
}

export function assetContentType(name: string): string {
  switch (extOf(name)) {
    case "jpg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "log":
    case "txt":
      return "text/plain; charset=utf-8";
    case "json":
      return "application/json";
    case "zip":
      return "application/zip";
    default:
      return "application/octet-stream";
  }
}

export function assetIsInlineImage(name: string): boolean {
  return ["jpg", "png", "webp"].includes(extOf(name));
}

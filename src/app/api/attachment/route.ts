import { NextRequest, NextResponse } from "next/server";
import { sameOrigin, clientIp } from "@/lib/guards";
import { hitUploadLimit } from "@/lib/rate-limit";
import {
  FILE_EXTS,
  IMAGE_EXTS,
  MAX_CHUNK_BYTES,
  MAX_FILE_BYTES,
  MAX_IMAGE_BYTES,
  RequestBodyTooLargeError,
  extOf,
  isZipMagic,
  readLimitedBody,
  sanitizeFileName,
  sniffImageType,
} from "@/lib/attachments";
import {
  GitHubApiError,
  githubDeleteFile,
  githubGetFileBytesRetry,
  githubGetFileMeta,
  githubPutFileBytes,
} from "@/lib/github-client";

// POST /api/attachment —— 附件分传（03 §3.2）
// 两种模式：
// ① 直传：file + kind —— 图片魔数校验 / 日志·压缩包内容校验，落盘 _pending/{uuid}/{安全化名}
// ② 分片（大文件 >3.5MB）：file(片) + kind=file + uploadId + name + index + total，
//    落盘 _pending/{uploadId}/{安全化名}.part{i}；最后 finalize=1 按序合并为单一引用
//    （绕开 Vercel 4.5MB 请求体上限；合并放 finalize 而非提交时，下游协议不变）

export const runtime = "nodejs";
export const maxDuration = 60;

function fail(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

const UUID_RE = /^[0-9a-f-]{36}$/;

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return fail("请通过本网站提交", 403);
  if (!hitUploadLimit(clientIp(req))) {
    return fail("上传太频繁，请稍后再试", 429);
  }

  let form: FormData;
  try {
    const buf = await readLimitedBody(req);
    const contentType = req.headers.get("content-type") ?? "";
    form = await new Request("http://local/", {
      method: "POST",
      headers: { "content-type": contentType },
      body: new Uint8Array(buf),
    }).formData();
  } catch (e) {
    if (e instanceof RequestBodyTooLargeError) {
      return fail("文件过大（图片上限 4MB / 文件上限 20MB，大文件已自动分片）", 413);
    }
    return fail("上传内容格式不正确");
  }

  const file = form.get("file");
  const kind = form.get("kind");
  const isFinalize = form.get("finalize") === "1";
  const rawUploadId = form.get("uploadId");
  const uploadId = typeof rawUploadId === "string" ? rawUploadId : "";

  if (isFinalize) {
    if (file !== null || kind !== "file" || !UUID_RE.test(uploadId)) {
      return fail("上传内容格式不正确");
    }
    return finalize(form);
  }

  if (!(file instanceof File) || (kind !== "image" && kind !== "file")) {
    return fail("上传内容格式不正确");
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const isChunk = !!uploadId && kind === "file";
  // 分片模式的原始文件名以 name 字段为准（file.name 已带 .part{i} 后缀）
  const originalName =
    isChunk && typeof form.get("name") === "string" && form.get("name")
      ? String(form.get("name"))
      : file.name;
  const ext = extOf(originalName);

  if (kind === "image") {
    // 图片不支持分片：客户端已压缩 ≤4MB
    if (!IMAGE_EXTS.includes(ext as never)) {
      return fail("该文件类型不支持，仅支持 JPG / PNG / WebP 图片", 415);
    }
    if (buf.byteLength > MAX_IMAGE_BYTES) {
      return fail("文件过大（图片上限 4MB）", 413);
    }
    if (!sniffImageType(buf)) return fail("不支持的文件格式", 415);
  } else if (isChunk) {
    // 分片模式：扩展名按原始名白名单；大小/分片号校验；内容校验推迟到 finalize 合并后
    if (!FILE_EXTS.includes(ext as never)) {
      return fail("该文件类型不支持，仅支持 .log / .txt / .json / .zip", 415);
    }
    const index = Number(form.get("index"));
    const total = Number(form.get("total"));
    if (!Number.isInteger(index) || index < 0 || index >= 12) {
      return fail("分片信息不正确");
    }
    if (!Number.isInteger(total) || total < 1 || total > 12) {
      return fail("分片信息不正确");
    }
    if (buf.byteLength > MAX_CHUNK_BYTES) {
      return fail("分片过大", 413);
    }
  } else {
    // 直传日志/压缩包：完整校验
    if (!FILE_EXTS.includes(ext as never)) {
      return fail("该文件类型不支持，仅支持 .log / .txt / .json / .zip", 415);
    }
    if (buf.byteLength > MAX_FILE_BYTES) {
      return fail("文件过大（上限 20MB）", 413);
    }
    if (ext === "log" || ext === "txt") {
      try {
        new TextDecoder("utf-8", { fatal: true }).decode(buf);
      } catch {
        return fail("该文件不是文本文件", 415);
      }
    } else if (ext === "json") {
      try {
        JSON.parse(buf.toString("utf-8"));
      } catch {
        return fail("该文件不是有效的 JSON 文件", 415);
      }
    } else if (!isZipMagic(buf)) {
      return fail("不支持的文件格式", 415);
    }
  }

  // 分片与直传统一用「原始名的安全化形态」命名；分片落盘加 .part{i} 后缀，
  // 与 finalize 的取回路径严格一致
  const safeName = sanitizeFileName(originalName);
  const dir = uploadId || crypto.randomUUID();
  const ref = `_pending/${dir}/${safeName}`;
  const path = isChunk
    ? `feedback/assets/_pending/${dir}/${safeName}.part${form.get("index")}`
    : `feedback/assets/${ref}`;
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        await githubPutFileBytes(path, buf, `asset: 上传 ${safeName}`);
        break;
      } catch (e) {
        const status = e instanceof GitHubApiError ? e.status : 0;
        if (status === 422 && attempt < 2) continue;
        throw e;
      }
    }
  } catch (e) {
    console.error(
      "[api/attachment] 写入失败：",
      e instanceof GitHubApiError ? `GitHub API ${e.status}` : e
    );
    return fail("上传暂时没有成功，请稍后再试", 500);
  }

  return NextResponse.json({
    ok: true,
    ref: isChunk ? "" : ref, // 分片响应不返回引用
    originalName: safeName.slice(0, 100),
    size: buf.byteLength,
  });
}

/** finalize：按序 GET 全部分片 → 合并 → 校验总量与魔数/文本 → PUT 单一 _pending → 删分片 */
async function finalize(form: FormData): Promise<NextResponse> {
  const uploadId = String(form.get("uploadId"));
  const rawName = String(form.get("name") ?? "");
  const total = Number(form.get("total") ?? 0);
  if (!Number.isInteger(total) || total < 1 || total > 12) {
    return fail("分片信息不正确");
  }
  const safeName = sanitizeFileName(rawName);
  const ext = extOf(safeName);

  try {
    const parts: Buffer[] = [];
    let size = 0;
    for (let i = 0; i < total; i++) {
      // raw 读取（>1MB 文件 JSON 读不返回 content）；带重试应对写后读短暂 404
      const b = await githubGetFileBytesRetry(
        `feedback/assets/_pending/${uploadId}/${safeName}.part${i}`,
        { attempts: 5, delayMs: 800 }
      );
      if (!b) return fail("分片缺失，请重新上传该文件");
      size += b.byteLength;
      if (size > MAX_FILE_BYTES) return fail("文件过大（上限 20MB）", 413);
      parts.push(b);
    }
    const merged = Buffer.concat(parts);

    // 合并后做与直传一致的内容校验
    if (ext === "log" || ext === "txt") {
      try {
        new TextDecoder("utf-8", { fatal: true }).decode(merged);
      } catch {
        return fail("该文件不是文本文件", 415);
      }
    } else if (ext === "json") {
      try {
        JSON.parse(merged.toString("utf-8"));
      } catch {
        return fail("该文件不是有效的 JSON 文件", 415);
      }
    } else if (!isZipMagic(merged)) {
      return fail("不支持的文件格式", 415);
    }

    const ref = `_pending/${uploadId}/${safeName}`;
    await githubPutFileBytes(
      `feedback/assets/${ref}`,
      merged,
      `asset: 分片合并 ${safeName}`
    );
    // 删除分片（object 方式取 sha，>1MB 分片也适用；失败不阻断：孤儿 v1 不清理）
    await Promise.all(
      Array.from({ length: total }, (_, i) =>
        (async () => {
          try {
            const p = `feedback/assets/_pending/${uploadId}/${safeName}.part${i}`;
            const meta = await githubGetFileMeta(p);
            if (meta?.sha) await githubDeleteFile(p, meta.sha, "asset: 清理分片");
          } catch {
            // 忽略
          }
        })()
      )
    );

    return NextResponse.json({
      ok: true,
      ref,
      originalName: safeName.slice(0, 100),
      size: merged.byteLength,
    });
  } catch (e) {
    console.error(
      "[api/attachment] finalize 失败：",
      e instanceof GitHubApiError ? `GitHub API ${e.status}` : e
    );
    return fail("上传暂时没有成功，请稍后再试", 500);
  }
}

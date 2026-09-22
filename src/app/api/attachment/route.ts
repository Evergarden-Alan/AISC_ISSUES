import { NextRequest, NextResponse } from "next/server";
import { sameOrigin, clientIp } from "@/lib/guards";
import { hitUploadLimit } from "@/lib/rate-limit";
import {
  FILE_EXTS,
  IMAGE_EXTS,
  MAX_FILE_BYTES,
  MAX_IMAGE_BYTES,
  RequestBodyTooLargeError,
  extOf,
  isZipMagic,
  readLimitedBody,
  sanitizeFileName,
  sniffImageType,
} from "@/lib/attachments";
import { GitHubApiError, githubPutFileBytes } from "@/lib/github-client";

// POST /api/attachment —— 附件分传（03 §3.2）：
// 单文件 multipart；先流式封顶再解析（绕开 Vercel 4.5MB 请求体限制）；
// 图片认魔数、日志认内容、压缩包认魔数；落盘 _pending/{uuid}/{安全化原名}。

export const runtime = "nodejs";
export const maxDuration = 60;

function fail(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return fail("请通过本网站提交", 403);
  if (!hitUploadLimit(clientIp(req))) {
    return fail("上传太频繁，请稍后再试", 429);
  }

  // 流式封顶后再交给 multipart 解析器
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
      return fail("文件过大（图片上限 4MB / 日志上限 3MB）", 413);
    }
    return fail("上传内容格式不正确");
  }

  const file = form.get("file");
  const kind = form.get("kind");
  if (!(file instanceof File) || (kind !== "image" && kind !== "file")) {
    return fail("上传内容格式不正确");
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const ext = extOf(file.name);

  if (kind === "image") {
    if (!IMAGE_EXTS.includes(ext as never)) {
      return fail("该文件类型不支持，仅支持 JPG / PNG / WebP 图片", 415);
    }
    if (buf.byteLength > MAX_IMAGE_BYTES) {
      return fail("文件过大（图片上限 4MB / 日志上限 3MB）", 413);
    }
    // 忽略客户端 MIME 声明，只认魔数（03 §8）
    if (!sniffImageType(buf)) return fail("不支持的文件格式", 415);
  } else {
    if (!FILE_EXTS.includes(ext as never)) {
      return fail("该文件类型不支持，仅支持 .log / .txt / .json / .zip", 415);
    }
    if (buf.byteLength > MAX_FILE_BYTES) {
      return fail("文件过大（图片上限 4MB / 日志上限 3MB）", 413);
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
      // .zip
      return fail("不支持的文件格式", 415);
    }
  }

  // 落盘：feedback/assets/_pending/{uuid}/{安全化原文件名}（02 §7.2）；422 换 uuid 重试
  const safeName = sanitizeFileName(file.name);
  const ref = `_pending/${crypto.randomUUID()}/${safeName}`;
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        await githubPutFileBytes(
          `feedback/assets/${ref}`,
          buf,
          `asset: 上传 ${safeName}`
        );
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
    ref,
    originalName: safeName.slice(0, 100),
    size: buf.byteLength,
  });
}

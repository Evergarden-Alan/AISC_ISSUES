"use client";

// 附件上传客户端封装（POST /api/attachment，multipart）
// 小文件单请求直传；大文件（>3.5MB）切片分传 + finalize 合并（绕开 Vercel 4.5MB 请求体上限）

export interface UploadedRef {
  ref: string;
  originalName: string;
}

const CHUNK_SIZE = 3.5 * 1024 * 1024; // 留出 multipart 开销余量

async function postForm(
  fd: FormData
): Promise<{ ok: boolean; ref?: string; originalName?: string; error?: string }> {
  const res = await fetch("/api/attachment", { method: "POST", body: fd });
  return (await res.json().catch(() => null)) as never;
}

/** 单请求直传（≤3.5MB） */
export async function uploadAttachment(
  file: File,
  kind: "image" | "file"
): Promise<UploadedRef> {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("kind", kind);
  const data = await postForm(fd);
  if (!data.ok || !data.ref) throw new Error(data.error || "上传失败，请稍后重试");
  return { ref: data.ref, originalName: data.originalName ?? file.name };
}

/**
 * 大文件分片上传：逐片 POST（带 uploadId/index/total），全部完成后 finalize 合并。
 * onProgress(已完成分片数, 总分片数) 用于进度提示。
 */
export async function uploadLargeFile(
  file: File,
  onProgress?: (done: number, total: number) => void
): Promise<UploadedRef> {
  const uploadId = crypto.randomUUID();
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
    const data = await postForm(fd);
    if (!data.ok) throw new Error(data.error || "上传失败，请稍后重试");
    onProgress?.(i + 1, total);
  }
  // finalize：服务端按序合并分片 → 生成单一 _pending 引用
  const fd = new FormData();
  fd.append("kind", "file");
  fd.append("finalize", "1");
  fd.append("uploadId", uploadId);
  fd.append("name", file.name);
  fd.append("total", String(total));
  const data = await postForm(fd);
  if (!data.ok || !data.ref) throw new Error(data.error || "上传失败，请稍后重试");
  return { ref: data.ref, originalName: data.originalName ?? file.name };
}

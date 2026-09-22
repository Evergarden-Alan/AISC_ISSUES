"use client";

// 附件上传客户端封装（POST /api/attachment，multipart）

export interface UploadedRef {
  ref: string;
  originalName: string;
}

export async function uploadAttachment(
  file: File,
  kind: "image" | "file"
): Promise<UploadedRef> {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("kind", kind);
  const res = await fetch("/api/attachment", { method: "POST", body: fd });
  const data = (await res.json().catch(() => null)) as
    | { ok: boolean; ref?: string; originalName?: string; error?: string }
    | null;
  if (!res.ok || !data?.ok || !data.ref) {
    throw new Error(data?.error || "上传失败，请稍后重试");
  }
  return { ref: data.ref, originalName: data.originalName ?? file.name };
}

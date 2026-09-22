"use client";

import { useRef, useState } from "react";
import { Paperclip, Trash2, TriangleAlert } from "lucide-react";
import { uploadAttachment, type UploadedRef } from "@/lib/upload-client";

// 日志附件上传（01 §4.2 字段 6，仅问题路径）：.log/.txt/.json/.zip、单文件 ≤3MB、最多 3 个。
// 逐个经 /api/attachment 分传（绕开 Vercel 4.5MB 请求体限制），提交时仅带引用。

const MAX_FILES = 3;
const MAX_BYTES = 3 * 1024 * 1024;

export function AttachmentUploader({
  value,
  onChange,
}: {
  value: UploadedRef[];
  onChange: (v: UploadedRef[]) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFiles(list: FileList | null) {
    if (!list || uploading) return;
    setError("");
    const room = MAX_FILES - value.length;
    if (list.length > room) {
      setError(`最多上传 ${MAX_FILES} 个文件`);
    }
    setUploading(true);
    const next = [...value];
    try {
      for (const file of Array.from(list).slice(0, room)) {
        if (!/\.(log|txt|json|zip)$/i.test(file.name)) {
          setError("该文件类型不支持，仅支持 .log / .txt / .json / .zip");
          continue;
        }
        if (file.size > MAX_BYTES) {
          setError("单个文件不能超过 3MB");
          continue;
        }
        const uploaded = await uploadAttachment(file, "file");
        next.push(uploaded);
      }
      onChange(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "上传失败，请稍后重试");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function remove(ref: string) {
    onChange(value.filter((v) => v.ref !== ref));
  }

  return (
    <div>
      <div className="space-y-2">
        {value.map((f) => (
          <div
            key={f.ref}
            className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
          >
            <Paperclip aria-hidden className="size-4 shrink-0 text-slate-400" />
            <span className="truncate">{f.originalName}</span>
            <button
              type="button"
              onClick={() => remove(f.ref)}
              aria-label={`删除文件 ${f.originalName}`}
              className="ml-auto flex size-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-red-600"
            >
              <Trash2 aria-hidden className="size-4" />
            </button>
          </div>
        ))}
      </div>
      {value.length < MAX_FILES ? (
        <label
          className={`mt-2 inline-flex h-11 cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm text-slate-700 hover:bg-slate-100 ${
            uploading ? "pointer-events-none opacity-60" : ""
          }`}
        >
          {uploading ? "上传中…" : "选择文件"}
          <input
            ref={inputRef}
            type="file"
            accept=".log,.txt,.json,.zip"
            multiple
            className="sr-only"
            onChange={(e) => handleFiles(e.target.files)}
          />
        </label>
      ) : null}
      <p className="mt-1.5 text-xs text-slate-400">
        每个不超过 3MB，最多 3 个；仅支持 .log / .txt / .json / .zip。
      </p>
      {error ? (
        <p role="alert" className="mt-1.5 flex items-center gap-1 text-sm text-red-600">
          <TriangleAlert aria-hidden className="size-4" />
          {error}
        </p>
      ) : null}
    </div>
  );
}

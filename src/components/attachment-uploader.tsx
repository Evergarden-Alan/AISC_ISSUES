"use client";

import { useRef, useState } from "react";
import { Paperclip, Trash2, TriangleAlert } from "lucide-react";
import {
  formatUploadProgress,
  uploadAttachment,
  uploadLargeFile,
  type UploadedRef,
} from "@/lib/upload-client";

// 日志附件上传（01 §4.2 字段 6，仅问题路径）：.log/.txt/.json/.zip、单文件 ≤20MB、最多 3 个。
// >3.5MB 自动分片上传 + 服务端合并（绕开 Vercel 4.5MB 请求体上限）。
// v0.1.1：XHR 进度（百分比 + 速度）；分片显示「x/y 片」，合并阶段固定文案。

const MAX_FILES = 3;
const MAX_BYTES = 20 * 1024 * 1024;
const CHUNK_THRESHOLD = 3.5 * 1024 * 1024;

export function AttachmentUploader({
  value,
  onChange,
  onUploadingChange,
  getTurnstileToken,
}: {
  value: UploadedRef[];
  onChange: (v: UploadedRef[]) => void;
  onUploadingChange?: (uploading: boolean) => void;
  getTurnstileToken?: () => Promise<string>;
}) {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function setUploadingBoth(v: boolean) {
    setUploading(v);
    onUploadingChange?.(v);
  }

  async function uploadOne(file: File): Promise<UploadedRef> {
    const token = getTurnstileToken ? await getTurnstileToken() : "";
    if (file.size <= CHUNK_THRESHOLD) {
      return uploadAttachment(
        file,
        "file",
        (p) => setProgress(`上传中 ${formatUploadProgress(p)}`),
        token
      );
    }
    return uploadLargeFile(
      file,
      (p, i, total) =>
        setProgress(`上传中 ${formatUploadProgress(p)}，第 ${i}/${total} 片`),
      token,
      () => setProgress("正在合并分片…")
    );
  }

  async function handleFiles(list: FileList | null) {
    if (!list || uploading) return;
    setError("");
    setProgress("");
    const room = MAX_FILES - value.length;
    if (list.length > room) {
      setError(`最多上传 ${MAX_FILES} 个文件`);
    }
    setUploadingBoth(true);
    const next = [...value];
    try {
      for (const file of Array.from(list).slice(0, room)) {
        if (!/\.(log|txt|json|zip)$/i.test(file.name)) {
          setError("该文件类型不支持，仅支持 .log / .txt / .json / .zip");
          continue;
        }
        if (file.size > MAX_BYTES) {
          setError("单个文件不能超过 20MB");
          continue;
        }
        setProgress(`正在上传 ${file.name}…`);
        const uploaded = await uploadOne(file);
        next.push(uploaded);
        onChange([...next]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "上传失败，请稍后重试");
    } finally {
      setProgress("");
      setUploadingBoth(false);
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
          {uploading ? progress || "上传中…" : "选择文件"}
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
        每个不超过 20MB，最多 3 个；仅支持 .log / .txt / .json / .zip；大文件将自动分片上传。
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

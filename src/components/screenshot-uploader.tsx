"use client";

import { useRef, useState } from "react";
import { ImagePlus, Trash2, TriangleAlert } from "lucide-react";
import { compressImageToJpeg } from "@/lib/image-compress";
import { uploadAttachment, type UploadedRef } from "@/lib/upload-client";

// 截图上传（01 §4.1 字段 5）：≤10 张、jpg/png/webp、客户端压缩 ≤4MB + canvas 剥 EXIF。
// 微信内置浏览器多选不稳：按「可多次点击累计」设计，multiple 保留为渐进增强。
// 并发 2 上传提速；v0.1.1：批次整体进度（虚线 tile 显示百分比，title 悬停全量文案）。

const MAX_SHOTS = 10;

export function ScreenshotUploader({
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
  const [compressing, setCompressing] = useState(0);
  const [batchPercent, setBatchPercent] = useState(0);
  const [batchTitle, setBatchTitle] = useState("");
  const [error, setError] = useState("");
  const [urls, setUrls] = useState<Record<string, string>>({});
  const inputRef = useRef<HTMLInputElement>(null);

  function setUploadingBoth(v: boolean) {
    setUploading(v);
    onUploadingChange?.(v);
  }

  async function handleFiles(list: FileList | null) {
    if (!list || uploading) return;
    setError("");
    const room = MAX_SHOTS - value.length;
    if (list.length > room) {
      setError(`最多上传 ${MAX_SHOTS} 张截图`);
    }
    setUploadingBoth(true);
    const next = [...value];
    const picked = Array.from(list).slice(0, room);
    const failed: string[] = [];
    const percents = new Array<number>(picked.length).fill(0);
    let doneCount = 0;

    const report = () => {
      const sum = percents.reduce((a, b) => a + b, 0);
      const percent = picked.length
        ? Math.min(100, Math.floor(sum / picked.length))
        : 100;
      setBatchPercent(percent);
      setBatchTitle(`已上传 ${doneCount}/${picked.length} 张`);
    };
    report();

    // 并发 2 压缩+上传；percents 按选中顺序归属（shift 原子取号）
    const queue = [...picked];
    const worker = async () => {
      for (;;) {
        const idx = picked.length - queue.length;
        const file = queue.shift();
        if (!file) return;
        try {
          if (!/\.(jpe?g|png|webp)$/i.test(file.name)) {
            failed.push(`${file.name}：格式不支持`);
            percents[idx] = 100;
            doneCount += 1;
            report();
            continue;
          }
          setCompressing((c) => c + 1);
          const blob = await compressImageToJpeg(file);
          setCompressing((c) => Math.max(0, c - 1));
          const base = file.name.replace(/\.[^.]+$/, "") || "截图";
          const jpg = new File([blob], `${base}.jpg`, { type: "image/jpeg" });
          const token = getTurnstileToken ? await getTurnstileToken() : "";
          const uploaded = await uploadAttachment(
            jpg,
            "image",
            (p) => {
              percents[idx] = p.percent;
              report();
            },
            token
          );
          percents[idx] = 100;
          doneCount += 1;
          report();
          next.push(uploaded);
          setUrls((u) => ({ ...u, [uploaded.ref]: URL.createObjectURL(blob) }));
          onChange([...next]);
        } catch (e) {
          setCompressing((c) => Math.max(0, c - 1));
          percents[idx] = 100;
          doneCount += 1;
          report();
          failed.push(`${file.name}：${e instanceof Error ? e.message : "上传失败"}`);
        }
      }
    };
    await Promise.all([worker(), worker()]);
    if (failed.length) setError(failed[0]);
    setUploadingBoth(false);
    setBatchPercent(0);
    setBatchTitle("");
    if (inputRef.current) inputRef.current.value = "";
  }

  function remove(ref: string) {
    setUrls((u) => {
      if (u[ref]) URL.revokeObjectURL(u[ref]);
      const { [ref]: _drop, ...rest } = u;
      return rest;
    });
    onChange(value.filter((v) => v.ref !== ref));
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        {value.map((shot) => (
          <div
            key={shot.ref}
            className="relative size-20 overflow-hidden rounded-lg border border-slate-200 bg-white"
          >
            {urls[shot.ref] ? (
              <img
                src={urls[shot.ref]}
                alt={`已添加截图：${shot.originalName}`}
                className="size-full object-cover"
              />
            ) : (
              <div className="flex size-full items-center justify-center text-xs text-slate-400">
                已上传
              </div>
            )}
            <button
              type="button"
              onClick={() => remove(shot.ref)}
              aria-label={`删除截图 ${shot.originalName}`}
              className="absolute right-1 top-1 flex size-6 items-center justify-center rounded-full bg-black/60 text-white"
            >
              <Trash2 aria-hidden className="size-3.5" />
            </button>
          </div>
        ))}
        {value.length < MAX_SHOTS ? (
          <label
            title={uploading ? batchTitle : undefined}
            className={`flex size-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-slate-300 text-xs text-slate-500 hover:border-blue-400 hover:text-blue-600 ${
              uploading ? "pointer-events-none opacity-60" : ""
            }`}
          >
            <ImagePlus aria-hidden className="size-5" />
            {compressing > 0
              ? "处理图片中…"
              : uploading
                ? `上传中 ${batchPercent}%`
                : "添加截图"}
            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              className="sr-only"
              onChange={(e) => handleFiles(e.target.files)}
            />
          </label>
        ) : null}
      </div>
      <p className="mt-1.5 text-xs text-slate-400">
        支持拍照或从相册选择，最多 10 张；会自动压缩并去除位置信息。
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

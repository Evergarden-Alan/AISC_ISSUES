"use client";

// 客户端图片压缩（canvas 重绘导出 = 天然剥除 EXIF/GPS，01 §4.1、03 §8）
// 策略：统一重编码为 jpeg，质量 0.85 起步；超 4MB 依次降质量、再缩边。

const MAX_BYTES = 4 * 1024 * 1024;
const MIMES = ["image/jpeg", "image/png", "image/webp"] as const;

export async function compressImageToJpeg(file: File): Promise<Blob> {
  if (!MIMES.includes(file.type as never)) {
    throw new Error("仅支持 JPG / PNG / WebP 图片");
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    // 个别内置浏览器不支持 createImageBitmap：小图直接放行原文件（≤4MB），否则报错
    if (file.size <= MAX_BYTES) return file;
    throw new Error("图片读取失败，请换一张试试");
  }
  try {
    let scale = 1;
    let quality = 0.85;
    for (let i = 0; i < 8; i++) {
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("图片处理失败");
      ctx.drawImage(bitmap, 0, 0, w, h);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", quality)
      );
      if (blob && blob.size <= MAX_BYTES) return blob;
      if (quality > 0.45) {
        quality -= 0.15;
      } else {
        scale *= 0.8; // 质量到底了就缩边
      }
    }
    throw new Error("图片过大，压缩后仍超过 4MB");
  } finally {
    bitmap.close?.();
  }
}

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SLA_TEXT } from "@/lib/constants";

// 提交成功页（01 §6.1；M1 版：仅编号 + 复制编号 + SLA，不渲染专属链接区——M2 起补全）

export default function SubmitSuccessPage() {
  const router = useRouter();
  const [id, setId] = useState<string>("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let raw: string | null = null;
    try {
      raw = sessionStorage.getItem("aisc:last-submit");
    } catch {
      // 忽略
    }
    let nextId = "";
    try {
      nextId = raw ? ((JSON.parse(raw) as { id?: string }).id ?? "") : "";
    } catch {
      nextId = "";
    }
    if (!nextId) {
      router.replace("/");
      return;
    }
    // 同步读取客户端存储后 setState：sessionStorage 仅浏览器存在，
    // 不能在 useState 初始化器中读取（SSR 预渲染会失败/不一致）。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setId(nextId);
  }, [router]);

  async function copyId() {
    if (!id) return;
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // 剪贴板 API 不可用（部分内置浏览器）：编号为可长按选择的纯文本
      setCopied(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-4 py-12">
      <div className="rounded-2xl border border-green-200 bg-white p-6 text-center sm:p-10">
        <div
          aria-hidden
          className="mx-auto flex size-14 items-center justify-center rounded-full bg-green-100 text-3xl"
        >
          ✅
        </div>
        <h1 className="mt-4 text-2xl font-bold">提交成功，谢谢您！</h1>

        <div className="mt-8 text-left">
          <p className="text-sm text-slate-500">您的反馈编号</p>
          <p
            className="mt-1 select-all break-all rounded-lg bg-slate-100 px-4 py-3 font-mono text-xl tracking-wide"
            aria-label={`反馈编号 ${id}`}
          >
            {id}
          </p>
          <Button
            variant="outline"
            onClick={copyId}
            className="mt-3 w-full sm:w-auto"
          >
            {copied ? (
              <>
                <Check aria-hidden />
                已复制
              </>
            ) : (
              <>
                <Copy aria-hidden />
                复制编号
              </>
            )}
          </Button>
          <p className="mt-2 text-xs text-slate-500">
            复制不了？长按编号即可复制。
          </p>
        </div>

        <p className="mt-8 text-sm text-slate-600">{SLA_TEXT}。</p>
      </div>

      <Link
        href="/"
        className="mx-auto mt-8 text-sm text-blue-600 hover:underline"
      >
        返回首页
      </Link>
    </main>
  );
}

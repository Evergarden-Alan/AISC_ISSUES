"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

// 提交成功页（01 §6.1 定稿）：编号 + 复制编号 + 专属链接区（M2 起渲染）
// v0.1.1 R4：移除 SLA 类承诺文案，保留中性引导。

interface LastSubmit {
  id: string;
  url: string; // 绝对地址（表单提交成功时拼好）
}

export default function SubmitSuccessPage() {
  const router = useRouter();
  const [last, setLast] = useState<LastSubmit | null>(null);
  const [copiedId, setCopiedId] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);

  useEffect(() => {
    let raw: string | null = null;
    try {
      raw = sessionStorage.getItem("aisc:last-submit");
    } catch {
      // 忽略
    }
    let parsed: LastSubmit | null = null;
    try {
      if (raw) {
        const obj = JSON.parse(raw) as { id?: string; url?: string };
        if (obj.id && obj.url) parsed = { id: obj.id, url: obj.url };
      }
    } catch {
      parsed = null;
    }
    if (!parsed) {
      router.replace("/");
      return;
    }
    // 同步读取客户端存储后 setState：sessionStorage 仅浏览器存在，
    // 不能在 useState 初始化器中读取（SSR 预渲染会失败/不一致）。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLast(parsed);
  }, [router]);

  async function copy(text: string, which: "id" | "url") {
    try {
      await navigator.clipboard.writeText(text);
      if (which === "id") {
        setCopiedId(true);
        setTimeout(() => setCopiedId(false), 2000);
      } else {
        setCopiedUrl(true);
        setTimeout(() => setCopiedUrl(false), 2000);
      }
    } catch {
      // 剪贴板 API 不可用（部分内置浏览器）：内容为可长按选择的纯文本
    }
  }

  if (!last) {
    return <main className="min-h-dvh" />; // 等待读取/跳转
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

        {/* 编号区 */}
        <div className="mt-8 text-left">
          <p className="text-sm text-slate-500">您的反馈编号</p>
          <p
            className="mt-1 select-all break-all rounded-lg bg-slate-100 px-4 py-3 font-mono text-xl tracking-wide"
            aria-label={`反馈编号 ${last.id}`}
          >
            {last.id}
          </p>
          <Button
            variant="outline"
            onClick={() => copy(last.id, "id")}
            className="mt-3 w-full sm:w-auto"
          >
            {copiedId ? (
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
          <p className="mt-2 text-xs text-slate-500">复制不了？长按编号即可复制。</p>
        </div>

        {/* 专属链接区（M2） */}
        <div className="mt-8 border-t border-slate-200 pt-6 text-left">
          <p className="text-sm text-slate-500">查看进度的专属链接</p>
          <p className="mt-1 select-all break-all rounded-lg bg-slate-100 px-4 py-3 font-mono text-sm">
            {last.url}
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <Button
              variant="outline"
              onClick={() => copy(last.url, "url")}
              className="w-full sm:w-auto"
            >
              {copiedUrl ? (
                <>
                  <Check aria-hidden />
                  已复制
                </>
              ) : (
                <>
                  <Copy aria-hidden />
                  复制链接
                </>
              )}
            </Button>
            <Link
              href={last.url.replace(/^https?:\/\/[^/]+/, "")}
              className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-blue-600 px-5 text-base font-medium text-white hover:bg-blue-700 sm:w-auto"
            >
              查看我的反馈
            </Link>
          </div>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            这个链接就是您反馈的凭证，请收藏（点右上角「…」菜单）或截图保存。之后打开它，就能看到开发者的回复。
          </p>
          <p className="mt-1 text-xs text-slate-500">
            如果链接丢了，也可以回首页，在「按编号查询」里输入编号找回。
          </p>
        </div>

        <p className="mt-8 text-sm text-slate-600">
          您的反馈已收到。之后通过上面的专属链接回来看看，就能看到开发者的回复。
        </p>
      </div>

      <Link href="/" className="mx-auto mt-8 text-sm text-blue-600 hover:underline">
        返回首页
      </Link>
    </main>
  );
}

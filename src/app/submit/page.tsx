import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { FeedbackForm } from "@/components/feedback-form";
import { turnstileEnabled } from "@/lib/turnstile";

// 反馈表单页（01 §2 步骤 2）
// Turnstile 默认关闭；开启时服务端读 SITE_KEY 经 props 下发（无 NEXT_PUBLIC_ 变量）。

export const metadata = { title: "提交反馈 · AISC_ISSUES 反馈站" };

export default function SubmitPage() {
  const siteKey = turnstileEnabled() ? (process.env.TURNSTILE_SITE_KEY ?? "") : "";
  return (
    <main className="mx-auto w-full max-w-2xl px-4 pb-8 pt-8">
      <Link
        href="/"
        className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft aria-hidden className="size-4" />
        返回首页
      </Link>
      <h1 className="mt-4 text-2xl font-bold">提交反馈</h1>
      <div className="mt-6">
        <FeedbackForm siteKey={siteKey || undefined} />
      </div>
    </main>
  );
}

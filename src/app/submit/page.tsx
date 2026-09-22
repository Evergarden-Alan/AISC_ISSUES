import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { FeedbackForm } from "@/components/feedback-form";

// 反馈表单页（01 §2 步骤 2）

export const metadata = { title: "提交反馈 · AISC_ISSUES 反馈站" };

export default function SubmitPage() {
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
        <FeedbackForm />
      </div>
    </main>
  );
}

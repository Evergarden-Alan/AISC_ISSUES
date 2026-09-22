import Link from "next/link";
import { MessageSquarePlus } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { ReplyTabs } from "@/components/reply-tabs";
import { getRepliedIssues } from "@/lib/data";
import { SLA_TEXT } from "@/lib/constants";
import { cn } from "@/lib/utils";

// 首页（01 §3）：Hero 引导区 → 开发者回信区（双 Tab）→ 页脚。
// M1 无「按编号查询」区块（M2+）；ISR 300 秒。

export const revalidate = 300;

export default async function Home() {
  const replied = await getRepliedIssues();
  const year = new Date().getFullYear();

  return (
    <main className="mx-auto min-h-dvh w-full max-w-2xl px-4 pb-16">
      {/* Hero 引导区（首屏可见：主标题/副标题/SLA/CTA） */}
      <section className="pt-14 pb-10 text-center">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
          遇到问题，或想要新功能？
        </h1>
        <p className="mt-3 text-lg text-slate-600">1 分钟提交，开发者会回复。</p>
        <p className="mt-1 text-sm text-slate-500">{SLA_TEXT}</p>
        <Link
          href="/submit"
          className={cn(buttonVariants({ size: "lg" }), "mt-6 w-full sm:w-auto")}
        >
          <MessageSquarePlus aria-hidden />
          我要提反馈
        </Link>
      </section>

      {/* 开发者回信区（双 Tab） */}
      <section aria-labelledby="reply-heading">
        <h2 id="reply-heading" className="mb-4 text-xl font-semibold">
          开发者最新回复
        </h2>
        <ReplyTabs issue={replied.issue} feature={replied.feature} />
      </section>

      {/* 页脚（01 §3.5 三行文案） */}
      <footer className="mt-16 border-t border-slate-200 pt-6 text-center text-xs leading-6 text-slate-500">
        <p>AISC_ISSUES 反馈站 · 专门收集 AISC_ISSUES 软件的使用反馈</p>
        <p>
          反馈内容将以文本形式存入 GitHub
          仓库，供开发者查看和处理。{SLA_TEXT}。
        </p>
        <p>© {year} AISC_ISSUES</p>
      </footer>
    </main>
  );
}

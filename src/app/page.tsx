import Link from "next/link";
import { MessageSquarePlus } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { ReplyTabs } from "@/components/reply-tabs";
import { IdLookup } from "@/components/id-lookup";
import { getHomeData } from "@/lib/data";
import { cn } from "@/lib/utils";

// 首页（01 §3）：Hero → 轻统计（M3：累计/已解决/平均首次回应）→ 按编号查询 → 回信区双 Tab（含查看全部）→ 页脚
// ISR 300 秒。

export const revalidate = 300;

export default async function Home() {
  const { issue, feature, stats } = await getHomeData();
  const year = new Date().getFullYear();

  return (
    <main className="mx-auto min-h-dvh w-full max-w-2xl px-4 pb-16">
      {/* Hero 引导区（首屏可见：主标题/副标题/SLA/CTA） */}
      <section className="pt-14 pb-10 text-center">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
          遇到问题，或想要新功能？
        </h1>
        <p className="mt-3 text-lg text-slate-600">
          写下来告诉开发者，回这里看回复。
        </p>
        <Link
          href="/submit"
          className={cn(buttonVariants({ size: "lg" }), "mt-6 w-full sm:w-auto")}
        >
          <MessageSquarePlus aria-hidden />
          我要提反馈
        </Link>
      </section>

      {/* 轻统计（M3 已拍板口径：三个聚合数字） */}
      <section aria-label="反馈统计" className="mb-10">
        <dl className="grid grid-cols-3 gap-3 text-center">
          <div className="rounded-xl border border-slate-200 bg-white py-4">
            <dt className="text-xs text-slate-500">累计反馈</dt>
            <dd className="mt-1 text-2xl font-bold text-slate-900">
              {stats.total}
            </dd>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white py-4">
            <dt className="text-xs text-slate-500">已解决</dt>
            <dd className="mt-1 text-2xl font-bold text-green-700">
              {stats.resolved}
            </dd>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white py-4">
            <dt className="text-xs text-slate-500">平均首次回应</dt>
            <dd className="mt-1 text-2xl font-bold text-slate-900">
              {stats.avgFirstResponseDays === null
                ? "—"
                : `${stats.avgFirstResponseDays} 天`}
            </dd>
          </div>
        </dl>
      </section>

      {/* 编号 / 关键词查询（M2+；v0.1.1 M5 模糊查询） */}
      <section aria-label="反馈查询" className="pb-10">
        <IdLookup />
      </section>

      {/* 开发者回信区（双 Tab） */}
      <section aria-labelledby="reply-heading">
        <h2 id="reply-heading" className="mb-4 text-xl font-semibold">
          开发者最新回复
        </h2>
        <ReplyTabs issue={issue} feature={feature} />
        {/* 查看全部（M3 列表页已上线，恒渲染——01 §3.3） */}
        <div className="mt-5 text-center">
          <Link
            href="/issues"
            className={cn(buttonVariants({ variant: "outline" }), "w-full sm:w-auto")}
          >
            查看全部回复
          </Link>
        </div>
      </section>

      {/* 页脚（01 §3.5 三行文案） */}
      <footer className="mt-16 border-t border-slate-200 pt-6 text-center text-xs leading-6 text-slate-500">
        <p>AISC_ISSUES 反馈站 · 专门收集 AISC_ISSUES 软件的使用反馈</p>
        <p>反馈内容将以文本形式存入 GitHub 仓库，供开发者查看和处理。</p>
        <p>© {year} AISC_ISSUES</p>
      </footer>
    </main>
  );
}

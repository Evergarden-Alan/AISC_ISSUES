import Link from "next/link";
import { MessageSquarePlus } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { IssuesBrowser } from "@/components/issues-browser";
import { getHomeData } from "@/lib/data";
import { cn } from "@/lib/utils";

// 首页（v0.1.2）：Hero → 轻统计 → 全部反馈列表（含状态与搜索筛选，v0.1.1 的 /issues 并入）→ 页脚
// 带 q/from/to 筛选直达；数据读经 ISR 缓存（300s），页面按请求渲染以支持 URL 参数。

export const revalidate = 300;

function one(v: string | string[] | undefined): string {
  return typeof v === "string" ? v : "";
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const { items, stats } = await getHomeData();
  const year = new Date().getFullYear();

  return (
    <main className="mx-auto min-h-dvh w-full max-w-2xl px-4 pb-16">
      {/* Hero 引导区（v0.1.1 R4：无承诺类文案） */}
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

      {/* 全部反馈（v0.1.2：全量条目 + 状态徽章 + 筛选，隐藏不过滤） */}
      <section aria-labelledby="list-heading" className="pb-4">
        <h2 id="list-heading" className="mb-4 text-xl font-semibold">
          全部反馈
        </h2>
        <IssuesBrowser
          items={items}
          initialQuery={one(sp.q)}
          initialFrom={one(sp.from)}
          initialTo={one(sp.to)}
        />
      </section>

      {/* 页脚 */}
      <footer className="mt-10 border-t border-slate-200 pt-6 text-center text-xs leading-6 text-slate-500">
        <p>AISC_ISSUES 反馈站 · 专门收集 AISC_ISSUES 软件的使用反馈</p>
        <p>反馈内容将以文本形式存入 GitHub 仓库，供开发者查看和处理。</p>
        <p>© {year} AISC_ISSUES</p>
      </footer>
    </main>
  );
}

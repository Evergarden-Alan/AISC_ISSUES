import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { IssuesBrowser } from "@/components/issues-browser";
import { getIssuesForList } from "@/lib/data";

// 「查看全部」列表页 /issues（M3；v0.1.1 M5-2 支持 ?q=&from=&to= 直达筛选态）：
// 维度/状态/类型筛选 + 关键词搜索 + 提交日期区间 + 分页。读取面数据缓存仍为 ISR 300s；
// hidden/archived 条目不在列表出现（02 §2）。

export const revalidate = 300;

export const metadata = { title: "全部反馈 · AISC_ISSUES 反馈站" };

function one(v: string | string[] | undefined): string {
  return typeof v === "string" ? v : "";
}

export default async function IssuesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const items = await getIssuesForList();

  return (
    <main className="mx-auto w-full max-w-2xl px-4 pb-16 pt-8">
      <Link
        href="/"
        className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft aria-hidden className="size-4" />
        返回首页
      </Link>
      <h1 className="mt-4 text-2xl font-bold">全部反馈</h1>
      <div className="mt-6">
        <IssuesBrowser
          items={items}
          initialQuery={one(sp.q)}
          initialFrom={one(sp.from)}
          initialTo={one(sp.to)}
        />
      </div>
    </main>
  );
}

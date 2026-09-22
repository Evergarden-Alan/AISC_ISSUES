import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { IssuesBrowser } from "@/components/issues-browser";
import { getIssuesForList } from "@/lib/data";

// 「查看全部」列表页 /issues（M3）：维度/状态/类型筛选 + 关键词搜索 + 分页
// ISR 300s；hidden/archived 条目不在列表出现（02 §2）。

export const revalidate = 300;

export const metadata = { title: "全部反馈 · AISC_ISSUES 反馈站" };

export default async function IssuesPage() {
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
        <IssuesBrowser items={items} />
      </div>
    </main>
  );
}

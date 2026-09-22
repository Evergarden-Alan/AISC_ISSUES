import Link from "next/link";
import { TypeBadge, StatusBadge } from "@/components/badges";
import type { ReplyItem } from "@/types/feedback";

// 回信区单条卡片（01 §3.3）：标题 + 类型/状态标签 + ≈100 字摘要 + 更新时间

function formatTime(iso: string): string {
  return iso.replace("T", " ").slice(0, 16);
}

export function ReplyCard({ item }: { item: ReplyItem }) {
  return (
    <Link
      href={`/issue/${item.id}`}
      className="block rounded-xl border border-slate-200 bg-white p-4 transition-colors hover:border-blue-400 hover:bg-blue-50/40"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-base font-medium text-slate-900">{item.title}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <TypeBadge type={item.type} />
        <StatusBadge status={item.status} category={item.category} />
        <span className="ml-auto text-xs text-slate-500">
          {formatTime(item.updatedAt)}
        </span>
      </div>
      <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-slate-600">
        {item.excerpt}
      </p>
    </Link>
  );
}

"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { TypeBadge, StatusBadge } from "@/components/badges";
import {
  STATUS_LABELS,
  TYPE_LABELS,
  TYPE_VALUES,
  STATUS_VALUES,
} from "@/lib/constants";
import type { ListItem } from "@/lib/data";

// 「查看全部」列表浏览器（01 §3.3 → M3 列表页）：
// 问题/功能维度 + 状态 + 类型筛选 + 关键词搜索（标题/编号）+ 前端分页 20/页

const PAGE_SIZE = 20;

const DIMENSIONS = [
  { key: "all", label: "全部" },
  { key: "issue", label: "问题" },
  { key: "feature", label: "功能建议" },
] as const;

export function IssuesBrowser({ items }: { items: ListItem[] }) {
  const [dim, setDim] = useState<(typeof DIMENSIONS)[number]["key"]>("all");
  const [status, setStatus] = useState<string>("all");
  const [type, setType] = useState<string>("all");
  const [keyword, setKeyword] = useState("");
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return items.filter((it) => {
      if (dim !== "all" && it.category !== dim) return false;
      if (status !== "all" && it.status !== status) return false;
      if (type !== "all" && it.type !== type) return false;
      if (kw && !it.title.toLowerCase().includes(kw) && !it.id.includes(kw)) {
        return false;
      }
      return true;
    });
  }, [items, dim, status, type, keyword]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, totalPages);
  const pageItems = filtered.slice(
    (current - 1) * PAGE_SIZE,
    current * PAGE_SIZE
  );

  function resetPage() {
    setPage(1);
  }

  const chip = (
    active: boolean,
    label: string,
    onClick: () => void,
    key: string
  ) => (
    <button
      key={key}
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-sm transition-colors ${
        active
          ? "bg-blue-600 text-white"
          : "bg-slate-100 text-slate-700 hover:bg-slate-200"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div>
      {/* 关键词搜索 */}
      <input
        type="search"
        value={keyword}
        onChange={(e) => {
          setKeyword(e.target.value);
          resetPage();
        }}
        placeholder="搜索标题或反馈编号…"
        aria-label="搜索反馈"
        className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      />

      {/* 维度筛选 */}
      <div className="mt-3 flex flex-wrap gap-2">
        {DIMENSIONS.map((d) =>
          chip(dim === d.key, d.label, () => {
            setDim(d.key);
            resetPage();
          }, `dim-${d.key}`)
        )}
      </div>

      {/* 状态筛选（双映射合并文案） */}
      <div className="mt-2 flex flex-wrap gap-2">
        {chip(status === "all", "全部状态", () => {
          setStatus("all");
          resetPage();
        }, "st-all")}
        {STATUS_VALUES.filter((s) => s !== "hidden").map((s) => {
          const label = `${STATUS_LABELS[s].issue}${
            STATUS_LABELS[s].issue !== STATUS_LABELS[s].feature
              ? `/${STATUS_LABELS[s].feature}`
              : ""
          }`;
          return chip(status === s, label, () => {
            setStatus(s);
            resetPage();
          }, `st-${s}`);
        })}
      </div>

      {/* 类型筛选 */}
      <div className="mt-2 flex flex-wrap gap-2">
        {chip(type === "all", "全部类型", () => {
          setType("all");
          resetPage();
        }, "ty-all")}
        {TYPE_VALUES.map((t) =>
          chip(type === t, TYPE_LABELS[t], () => {
            setType(t);
            resetPage();
          }, `ty-${t}`)
        )}
      </div>

      <p className="mt-4 text-sm text-slate-500">共 {filtered.length} 条反馈</p>

      {/* 列表 */}
      <div className="mt-3 space-y-3">
        {pageItems.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
            没有符合筛选条件的反馈。
          </p>
        ) : (
          pageItems.map((it) => (
            <Link
              key={it.id}
              href={`/issue/${it.id}`}
              className="block rounded-xl border border-slate-200 bg-white p-4 transition-colors hover:border-blue-400 hover:bg-blue-50/40"
            >
              <span className="text-base font-medium text-slate-900">
                {it.title}
              </span>
              <span className="mt-2 flex flex-wrap items-center gap-1.5">
                <TypeBadge type={it.type} />
                <StatusBadge status={it.status} category={it.category} />
                <span className="ml-auto text-xs text-slate-500">
                  {it.updatedAt.replace("T", " ").slice(0, 16)}
                </span>
              </span>
            </Link>
          ))
        )}
      </div>

      {/* 分页 */}
      {totalPages > 1 ? (
        <div className="mt-6 flex items-center justify-center gap-4">
          <button
            type="button"
            disabled={current <= 1}
            onClick={() => setPage(current - 1)}
            className="h-10 rounded-lg border border-slate-300 bg-white px-4 text-sm disabled:opacity-40"
          >
            上一页
          </button>
          <span className="text-sm text-slate-600">
            {current} / {totalPages}
          </span>
          <button
            type="button"
            disabled={current >= totalPages}
            onClick={() => setPage(current + 1)}
            className="h-10 rounded-lg border border-slate-300 bg-white px-4 text-sm disabled:opacity-40"
          >
            下一页
          </button>
        </div>
      ) : null}
    </div>
  );
}

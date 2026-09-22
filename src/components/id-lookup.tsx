"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ID_PATTERN } from "@/lib/constants";

// 首页「按编号查询」（v0.1.1 M5-2）：完整编号直达详情页；其余输入转列表关键词搜索

export function IdLookup() {
  const router = useRouter();
  const [id, setId] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const v = id.trim();
    if (!v) return;
    if (ID_PATTERN.test(v)) {
      router.push(`/issue/${v}`);
      return;
    }
    // 非完整目录名 → 首页列表关键词搜索（标题 / 目录名模糊匹配，无死路）
    router.push(`/?q=${encodeURIComponent(v)}`);
  }

  return (
    <form onSubmit={submit} noValidate>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="text"
          value={id}
          onChange={(e) => setId(e.target.value)}
          placeholder="输入反馈编号或关键词，如 20260921-143025 或 闪退"
          aria-label="反馈编号或关键词"
          className="h-11 flex-1 rounded-lg border border-slate-300 bg-white px-3 text-base placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        />
        <button
          type="submit"
          className="h-11 shrink-0 rounded-lg bg-slate-800 px-6 text-base font-medium text-white hover:bg-slate-900"
        >
          查询
        </button>
      </div>
    </form>
  );
}

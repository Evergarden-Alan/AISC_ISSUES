"use client";

import { useState } from "react";
import { ReplyCard } from "@/components/reply-card";
import { EMPTY_REPLY_TEXT } from "@/lib/constants";
import type { ReplyItem } from "@/types/feedback";

// 回信区双 Tab（01 §3.3）：「问题」/「功能建议」，默认停在「问题」。
// 数据在服务端已按 category 分流并各取 10 条，本组件只做切换展示。

export function ReplyTabs({
  issue,
  feature,
}: {
  issue: ReplyItem[];
  feature: ReplyItem[];
}) {
  const [tab, setTab] = useState<"issue" | "feature">("issue");
  const items = tab === "issue" ? issue : feature;

  const tabBtn = (key: "issue" | "feature", label: string, count: number) => (
    <button
      key={key}
      type="button"
      role="tab"
      aria-selected={tab === key}
      aria-controls={`reply-panel-${key}`}
      id={`reply-tab-${key}`}
      onClick={() => setTab(key)}
      className={`rounded-lg px-4 py-2 text-base font-medium transition-colors ${
        tab === key
          ? "bg-blue-600 text-white"
          : "bg-slate-100 text-slate-700 hover:bg-slate-200"
      }`}
    >
      {label}
      <span className="ml-1 text-xs opacity-80">（{count}）</span>
    </button>
  );

  return (
    <div>
      <div role="tablist" aria-label="开发者回复分类" className="flex gap-2">
        {tabBtn("issue", "问题", issue.length)}
        {tabBtn("feature", "功能建议", feature.length)}
      </div>
      <div
        role="tabpanel"
        id={`reply-panel-${tab}`}
        aria-labelledby={`reply-tab-${tab}`}
        className="mt-4 space-y-3"
      >
        {items.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
            {EMPTY_REPLY_TEXT}
          </p>
        ) : (
          items.map((item) => <ReplyCard key={item.id} item={item} />)
        )}
      </div>
    </div>
  );
}

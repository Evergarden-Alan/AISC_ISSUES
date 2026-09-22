"use client";

import { useEffect, useState } from "react";
import { ThumbsUp } from "lucide-react";

// 「我也遇到（问题）/ 我想要（功能）」投票（v0.1.1 M4）。
// 乐观 +1，失败回滚；localStorage 仅做同浏览器置灰体验，去重以服务端 IP 限频为准。

export function VoteButton({
  id,
  category,
  initialAffects,
}: {
  id: string;
  category: "issue" | "feature";
  initialAffects: number;
}) {
  const storageKey = `aisc:voted:${id}`;
  const label = category === "issue" ? "我也遇到" : "我想要";
  const [voted, setVoted] = useState(false);
  const [count, setCount] = useState(initialAffects);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [msgOk, setMsgOk] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(storageKey)) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setVoted(true);
      }
    } catch {
      // 忽略
    }
  }, [storageKey]);

  async function vote() {
    if (voted || busy) return;
    setBusy(true);
    setMsg("");
    setCount((c) => c + 1); // 乐观 +1
    try {
      const res = await fetch("/api/vote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; affects?: number; error?: string }
        | null;
      if (res.ok && data?.ok) {
        setCount(typeof data.affects === "number" ? data.affects : count + 1);
        setVoted(true);
        setMsgOk(true);
        setMsg("已记录，谢谢反馈");
        try {
          localStorage.setItem(storageKey, "1");
        } catch {
          // 忽略
        }
      } else {
        setCount(initialAffects); // 回滚
        setMsgOk(false);
        setMsg(
          res.status === 429
            ? data?.error || "感谢支持，同一反馈 1 小时内只能助力一次"
            : res.status === 404
              ? "该反馈不存在"
              : "提交没有成功，请稍后重试"
        );
      }
    } catch {
      setCount(initialAffects);
      setMsgOk(false);
      setMsg("提交没有成功，请稍后重试");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 border-t border-slate-200 pt-5">
      <button
        type="button"
        onClick={vote}
        disabled={voted || busy}
        className={`inline-flex h-11 items-center gap-2 rounded-lg px-5 text-base font-medium transition-colors ${
          voted
            ? "cursor-default bg-green-100 text-green-800"
            : "bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
        }`}
      >
        <ThumbsUp aria-hidden className="size-4" />
        {label}（{count}）
      </button>
      <p className="mt-2 text-xs text-slate-400">
        {voted
          ? "您已支持过这条反馈"
          : category === "issue"
            ? "遇到同样的问题？点一下让开发者知道影响的人多"
            : "也想要这个功能？点一下让开发者知道需求的人多"}
      </p>
      {msg ? (
        <p
          role="status"
          className={`mt-1 text-sm ${msgOk ? "text-green-700" : "text-red-600"}`}
        >
          {msg}
        </p>
      ) : null}
    </div>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { TriangleAlert } from "lucide-react";
import { ID_PATTERN } from "@/lib/constants";

// 首页「按编号查询」（01 §3.2，M2+）：输入完整编号跳转详情页

export function IdLookup() {
  const router = useRouter();
  const [id, setId] = useState("");
  const [error, setError] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const v = id.trim();
    if (!ID_PATTERN.test(v)) {
      setError("没找到这个编号。请检查是否输错（编号形如 20260921-143025-a3f9kz）。");
      return;
    }
    router.push(`/issue/${v}`);
  }

  return (
    <form onSubmit={submit} noValidate>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="text"
          value={id}
          onChange={(e) => {
            setId(e.target.value);
            if (error) setError("");
          }}
          placeholder="请输入反馈编号，如 20260921-143025-a3f9kz"
          aria-label="反馈编号"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "lookup-error" : undefined}
          className="h-11 flex-1 rounded-lg border border-slate-300 bg-white px-3 text-base placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 aria-[invalid=true]:border-red-500"
        />
        <button
          type="submit"
          className="h-11 shrink-0 rounded-lg bg-slate-800 px-6 text-base font-medium text-white hover:bg-slate-900"
        >
          查询
        </button>
      </div>
      {error ? (
        <p
          id="lookup-error"
          role="alert"
          className="mt-1.5 flex items-center gap-1 text-sm text-red-600"
        >
          <TriangleAlert aria-hidden className="size-4" />
          {error}
        </p>
      ) : null}
    </form>
  );
}

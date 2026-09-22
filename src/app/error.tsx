"use client";

// 全局错误边界（纯中文文案）

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col items-center justify-center px-4 text-center">
      <h1 className="text-xl font-semibold">页面出错了</h1>
      <p className="mt-2 text-sm text-slate-600">
        可能是网络问题，请刷新重试。如果反复出现，请稍后再来。
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-6 h-11 rounded-lg bg-blue-600 px-5 text-base font-medium text-white hover:bg-blue-700"
      >
        重试
      </button>
      {error.digest ? (
        <p className="mt-4 text-xs text-slate-400">错误编号：{error.digest}</p>
      ) : null}
    </main>
  );
}

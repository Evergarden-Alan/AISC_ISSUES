import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col items-center justify-center px-4 text-center">
      <h1 className="text-xl font-semibold">页面不存在</h1>
      <p className="mt-2 text-sm text-slate-600">
        您访问的页面可能已移动或地址有误。
      </p>
      <Link
        href="/"
        className="mt-6 inline-flex h-11 items-center rounded-lg bg-blue-600 px-5 text-base font-medium text-white hover:bg-blue-700"
      >
        返回首页
      </Link>
    </main>
  );
}

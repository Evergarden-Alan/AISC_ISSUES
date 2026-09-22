import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { ID_PATTERN, NO_REPLY_DETAIL_TEXT } from "@/lib/constants";
import { getIssue } from "@/lib/data";
import { affectsOf } from "@/lib/markdown-utils";
import { StatusBadge, TypeBadge, SeverityBadge } from "@/components/badges";
import { IssueDetailBody } from "@/components/issue-detail-body";
import { VoteButton } from "@/components/vote-button";

// 专属详情页 /issue/{目录名}?t={token}（v0.1.2：目录名即 id）
// 公开可访问，t 为提交者凭证但不作强制拦截。ISR 300s。

export const revalidate = 300;

export const metadata = { title: "反馈详情 · AISC_ISSUES 反馈站" };

function formatTime(iso: string): string {
  return iso.replace("T", " ").slice(0, 16);
}

export default async function IssueDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // 动态路由参数以百分号编码到达（目录名含中文），需先解码
  let id = "";
  try {
    id = decodeURIComponent((await params).id);
  } catch {
    notFound();
  }
  if (!ID_PATTERN.test(id)) notFound();

  const result = await getIssue(id);
  if (!result) notFound();

  const { fm, sections, replies, category } = result.detail;

  return (
    <main className="mx-auto w-full max-w-2xl px-4 pb-16 pt-8">
      <Link
        href="/"
        className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft aria-hidden className="size-4" />
        返回首页
      </Link>

      {/* 头部：状态徽章 + 类型 + 影响程度（仅问题路径）+ 编号 + 提交时间（01 §6.2.1） */}
      <header className="mt-4">
        <h1 className="text-2xl font-bold leading-snug">{fm.title}</h1>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <StatusBadge status={fm.status} category={category} />
          <TypeBadge type={fm.type} />
          {category === "issue" ? <SeverityBadge severity={fm.severity} /> : null}
          <span className="ml-auto font-mono text-xs text-slate-400">{fm.id}</span>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          提交时间：{formatTime(fm.created_at)}
          {fm.nickname ? ` · 提交人称呼：${fm.nickname}` : ""}
        </p>
        {fm.status === "duplicate" && fm.duplicate_of ? (
          <p className="mt-3 rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-800">
            这条反馈与已有反馈重复：
            <Link
              href={`/issue/${fm.duplicate_of}`}
              className="font-medium underline hover:text-sky-950"
            >
              查看编号 {fm.duplicate_of}
            </Link>
          </p>
        ) : null}
      </header>

      {/* 原反馈分区 + 回复时间线 */}
      <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
        <IssueDetailBody sections={sections} replies={replies} />
        {replies.length === 0 ? (
          <p className="mt-4 rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500">
            {NO_REPLY_DETAIL_TEXT}
          </p>
        ) : null}

        {/* +1 投票（v0.1.1 M4）：问题=「我也遇到」/ 功能=「我想要」 */}
        <VoteButton id={fm.id} category={category} initialAffects={affectsOf(fm)} />
      </div>
    </main>
  );
}

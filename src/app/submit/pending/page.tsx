"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  clearDraft,
  loadDraft,
  saveDraft,
  type DraftState,
} from "@/hooks/use-draft";

// 提交中转页（/submit/pending）：表单校验通过后跳转到这里，由本页执行真正的 POST。
// 成功 → 写 aisc:last-submit、清草稿、进成功页；
// 失败 → 写 aisc:submit-error（失败原因）、回表单页弹 toast（草稿原样恢复）。
// 幂等键沿用草稿中的 UUID：即使中断重试也不会产生重复反馈（03 §6.1）。

export default function SubmitPendingPage() {
  const router = useRouter();
  const [started, setStarted] = useState(false);
  const runRef = useRef(false);

  useEffect(() => {
    if (runRef.current) return;
    runRef.current = true;
    setStarted(true);

    const draft: DraftState = loadDraft();
    if (!draft.shared.title.trim() || !draft.shared.description.trim()) {
      // 草稿为空（异常进入）：回表单
      router.replace("/submit");
      return;
    }

    async function run(d: DraftState) {
      const isIssue = d.path === "issue";
      const payload = {
        idempotencyKey: d.idempotencyKey,
        website: "",
        type: isIssue ? d.issue.type : "feature",
        severity: isIssue ? d.issue.severity : undefined,
        title: d.shared.title.trim(),
        description: d.shared.description.trim(),
        steps:
          isIssue && d.issue.type === "bug" ? d.issue.steps.trim() : undefined,
        expected: isIssue ? d.issue.expected.trim() : undefined,
        actual: isIssue ? d.issue.actual.trim() : undefined,
        scenario: !isIssue ? d.feature.scenario.trim() : undefined,
        workaround: !isIssue ? d.feature.workaround.trim() : undefined,
        nickname: d.shared.nickname.trim() || undefined,
        screenshots: d.shared.screenshots,
        attachments: isIssue ? d.issue.attachments : undefined,
        turnstileToken: d.turnstileToken || undefined,
        env: {
          ua: navigator.userAgent,
          platform: navigator.platform || "",
          url: location.origin + "/submit",
        },
      };

      // 幂等键保护下可安全重试：409＝上一次请求仍在处理（稍候重取结果）；
      // 网络异常同样重试——服务端未完成时键仍为 in-flight，不会重复提交
      type SubmitResult = {
        ok: boolean;
        id?: string;
        url?: string;
        error?: string;
        staleRef?: string;
      };
      let res: Response | null = null;
      let data: SubmitResult | null = null;
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          res = await fetch("/api/feedback", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-idempotency-key": d.idempotencyKey,
            },
            body: JSON.stringify(payload),
          });
          data = (await res.json().catch(() => null)) as SubmitResult | null;
        } catch {
          res = null;
          data = null;
        }
        if (res && res.status !== 409) break;
        if (attempt < 3) {
          await new Promise((r) => setTimeout(r, 2500));
        }
      }

      if (res && res.ok && data?.ok && data.id && data.url) {
        try {
          sessionStorage.setItem(
            "aisc:last-submit",
            JSON.stringify({
              id: data.id,
              url: `${location.origin}${data.url}`,
            })
          );
        } catch {
          // 忽略
        }
        clearDraft(); // 清空草稿；下次打开表单 loadDraft 会自动生成新的幂等键
        router.replace("/submit/success");
        return;
      }

      // 失败：写原因 → 回表单弹 toast（除过期附件被定向移除外，其余内容保留）
      let reason =
        data?.error ||
        "提交暂时没有成功，可能是网络问题。您填写的内容都保留着，请稍后再试一次。";
      const staleRef = typeof data?.staleRef === "string" ? data.staleRef : "";
      if (staleRef) {
        const shot = d.shared.screenshots.find((x) => x.ref === staleRef);
        const file = d.issue.attachments.find((x) => x.ref === staleRef);
        const name =
          shot?.originalName ?? file?.originalName ?? staleRef.split("/").pop() ?? "附件";
        saveDraft({
          ...d,
          shared: {
            ...d.shared,
            screenshots: d.shared.screenshots.filter((x) => x.ref !== staleRef),
          },
          issue: {
            ...d.issue,
            attachments: d.issue.attachments.filter((x) => x.ref !== staleRef),
          },
        });
        reason = `附件「${name}」已过期失效，已从表单移除，请重新上传后再提交`;
      }
      try {
        sessionStorage.setItem("aisc:submit-error", reason);
      } catch {
        // 忽略
      }
      router.replace("/submit");
    }

    void run(draft);
  }, [router]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col items-center justify-center px-4 text-center">
      <div
        aria-hidden
        className="size-12 animate-spin rounded-full border-4 border-slate-200 border-t-blue-600"
      />
      <h1 className="mt-6 text-xl font-semibold">正在提交…请不要关闭页面</h1>
      <p className="mt-2 text-sm text-slate-500">
        {started ? "正在把您的反馈写入处理队列，通常几秒内完成。" : "正在准备…"}
      </p>
    </main>
  );
}

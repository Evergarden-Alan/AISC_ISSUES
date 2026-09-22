"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldAlert, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/form-controls";
import {
  ISSUE_TYPE_SUBTEXT,
  ISSUE_TYPE_VALUES,
  LIMITS,
  SEVERITY_LABELS,
  SEVERITY_VALUES,
  TYPE_LABELS,
} from "@/lib/constants";
import {
  charCount,
  clearDraft,
  emptyDraft,
  loadDraft,
  makeUuidV4,
  saveDraft,
  type DraftState,
  type FormPath,
} from "@/hooks/use-draft";

// 反馈表单（01 §4）：第一步双路径二选一 → 按路径展示字段。
// 草稿实时存 localStorage（含所选路径与幂等键）；切换路径不丢内容；
// 提交失败保留全部内容可重试（降级三层）。

type FieldErrors = Partial<
  Record<"type" | "severity" | "title" | "description" | "nickname", string>
>;

export function FeedbackForm() {
  const router = useRouter();
  const [state, setState] = useState<DraftState>(emptyDraft);
  const [ready, setReady] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [savedHint, setSavedHint] = useState(false);
  const [pathHint, setPathHint] = useState("");
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 挂载时恢复草稿（含幂等键）。
  // 必须在 effect 中同步恢复：useState 初始化器会在 SSR 预渲染时执行，
  // 造成服务端/客户端草稿不一致的 hydration 错误。
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState(loadDraft());
     
    setReady(true);
  }, []);

  // 草稿实时保存（ready 后每次变更）；保存提示 2 秒后淡出
  useEffect(() => {
    if (!ready) return;
    saveDraft(state);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSavedHint(true);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSavedHint(false), 2000);
  }, [state, ready]);

  useEffect(
    () => () => {
      if (hintTimer.current) clearTimeout(hintTimer.current);
      if (savedTimer.current) clearTimeout(savedTimer.current);
    },
    []
  );

  function patchShared(patch: Partial<DraftState["shared"]>) {
    setState((s) => ({ ...s, shared: { ...s.shared, ...patch } }));
  }
  function patchIssue(patch: Partial<DraftState["issue"]>) {
    setState((s) => ({ ...s, issue: { ...s.issue, ...patch } }));
  }
  function patchFeature(patch: Partial<DraftState["feature"]>) {
    setState((s) => ({ ...s, feature: { ...s.feature, ...patch } }));
  }

  function switchPath(path: FormPath) {
    if (path === state.path) return;
    setState((s) => ({ ...s, path }));
    setPathHint(`已切换到${path === "issue" ? "问题" : "功能"}反馈，已填内容已保留`);
    if (hintTimer.current) clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setPathHint(""), 2500);
  }

  function validateClient(): FieldErrors {
    const errs: FieldErrors = {};
    if (state.path === "issue" && !state.issue.type) {
      errs.type = "请先选择问题类型";
    }
    if (state.path === "issue" && !state.issue.severity) {
      errs.severity = "请选择影响程度";
    }
    const title = state.shared.title.trim();
    if (!title) errs.title = "请用一句话概括";
    else if (charCount(title) > LIMITS.title) errs.title = "不能超过 50 字";
    const description = state.shared.description.trim();
    if (!description) errs.description = "请填写详细描述";
    else if (charCount(description) > LIMITS.description) {
      errs.description = "详细描述不能超过 2000 字";
    }
    const nickname = state.shared.nickname.trim();
    if (nickname && charCount(nickname) > LIMITS.nickname) {
      errs.nickname = "称呼不能超过 20 字";
    }
    return errs;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;

    const errs = validateClient();
    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      requestAnimationFrame(() => {
        document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      });
      return;
    }

    setSubmitting(true);
    setFormError("");
    const isIssue = state.path === "issue";
    const payload = {
      idempotencyKey: state.idempotencyKey,
      website: honeypotRef.current?.value ?? "",
      type: isIssue ? state.issue.type : "feature",
      severity: isIssue ? state.issue.severity : undefined,
      title: state.shared.title.trim(),
      description: state.shared.description.trim(),
      steps: isIssue && state.issue.type === "bug" ? state.issue.steps.trim() : undefined,
      expected: isIssue ? state.issue.expected.trim() : undefined,
      actual: isIssue ? state.issue.actual.trim() : undefined,
      scenario: !isIssue ? state.feature.scenario.trim() : undefined,
      workaround: !isIssue ? state.feature.workaround.trim() : undefined,
      nickname: state.shared.nickname.trim() || undefined,
      env: {
        ua: navigator.userAgent,
        platform: navigator.platform || "",
        url: location.href,
      },
    };

    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-idempotency-key": state.idempotencyKey,
        },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => null)) as
        | { ok: boolean; id?: string; error?: string }
        | null;
      if (res.ok && data?.ok && data.id) {
        clearDraft();
        // 轮换幂等键，避免下次提交复用旧键
        setState((s) => ({ ...s, ...emptyDraft(), idempotencyKey: makeUuidV4() }));
        try {
          sessionStorage.setItem("aisc:last-submit", JSON.stringify({ id: data.id }));
        } catch {
          // 忽略：成功页读取不到时回首页
        }
        router.push("/submit/success");
        return;
      }
      setFormError(
        data?.error || "提交暂时没有成功，您填写的内容都保留着，请稍后重试"
      );
    } catch {
      setFormError("网络异常，您填写的内容都保留着，请稍后点「提交反馈」再试一次。");
    } finally {
      setSubmitting(false);
    }
  }

  const honeypotRef = useRef<HTMLInputElement>(null);
  const isIssue = state.path === "issue";
  const titleLen = charCount(state.shared.title);
  const descLen = charCount(state.shared.description);

  return (
    <form onSubmit={handleSubmit} noValidate>
      {/* 隐藏蜜罐字段：不可见、不可聚焦；正常用户永远看不到（01 §4.4） */}
      <input
        ref={honeypotRef}
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="absolute left-[-9999px] opacity-0"
      />

      {/* 顶部隐私提示条 */}
      <div className="mb-6 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
        <ShieldAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
        <span>提交前请注意：请勿填写密码、手机号等敏感信息。</span>
      </div>

      {/* 第一步：双路径二选一大卡片（01 §4.0） */}
      <fieldset>
        <legend className="mb-2 text-base font-medium">您想说什么？</legend>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {(
            [
              { key: "issue", main: "我遇到了问题", sub: "软件出了故障、用着别扭或有疑问" },
              { key: "feature", main: "我想要新功能", sub: "希望软件增加新能力" },
            ] as const
          ).map((card) => (
            <label
              key={card.key}
              className={`flex cursor-pointer items-start gap-3 rounded-xl border-2 p-4 transition-colors ${
                state.path === card.key
                  ? "border-blue-600 bg-blue-50"
                  : "border-slate-200 bg-white hover:border-slate-300"
              }`}
            >
              <input
                type="radio"
                name="path"
                value={card.key}
                checked={state.path === card.key}
                onChange={() => switchPath(card.key)}
                className="sr-only"
              />
              <span aria-hidden className="mt-0.5 text-xl">
                {card.key === "issue" ? "🐛" : "✨"}
              </span>
              <span>
                <span className="block text-base font-semibold">{card.main}</span>
                <span className="mt-0.5 block text-sm text-slate-500">{card.sub}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      {pathHint ? (
        <p role="status" className="mt-2 text-sm text-green-700">
          {pathHint}
        </p>
      ) : null}

      {isIssue ? (
        <>
          {/* 问题类型 4 卡片（仅问题路径） */}
          <fieldset className="mt-8">
            <Label id="type-label" htmlFor={undefined}>
              这个问题属于哪一类？
            </Label>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {ISSUE_TYPE_VALUES.map((t) => (
                <label
                  key={t}
                  className={`flex cursor-pointer items-start gap-3 rounded-xl border-2 p-3 transition-colors ${
                    state.issue.type === t
                      ? "border-blue-600 bg-blue-50"
                      : "border-slate-200 bg-white hover:border-slate-300"
                  }`}
                >
                  <input
                    type="radio"
                    name="issue-type"
                    value={t}
                    checked={state.issue.type === t}
                    onChange={() => {
                      patchIssue({ type: t });
                      setErrors((e) => ({ ...e, type: undefined }));
                    }}
                    className="sr-only"
                    aria-describedby={errors.type ? "type-error" : undefined}
                  />
                  <span>
                    <span className="block text-base font-medium">
                      {TYPE_LABELS[t]}
                    </span>
                    <span className="mt-0.5 block text-sm text-slate-500">
                      {ISSUE_TYPE_SUBTEXT[t]}
                    </span>
                  </span>
                </label>
              ))}
            </div>
            {errors.type ? (
              <p id="type-error" role="alert" className="mt-1.5 flex items-center gap-1 text-sm text-red-600">
                <TriangleAlert aria-hidden className="size-4" />
                {errors.type}
              </p>
            ) : null}
          </fieldset>

          {/* 影响程度三档（仅问题路径，必填，默认不预选） */}
          <fieldset className="mt-6">
            <Label>这对您使用的影响有多大？</Label>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {SEVERITY_VALUES.map((sv) => (
                <label
                  key={sv}
                  className={`flex min-h-11 cursor-pointer items-center justify-center rounded-lg border-2 px-2 py-2 text-center text-sm transition-colors sm:text-base ${
                    state.issue.severity === sv
                      ? "border-blue-600 bg-blue-50 font-medium"
                      : "border-slate-200 bg-white hover:border-slate-300"
                  }`}
                >
                  <input
                    type="radio"
                    name="severity"
                    value={sv}
                    checked={state.issue.severity === sv}
                    onChange={() => {
                      patchIssue({ severity: sv });
                      setErrors((e) => ({ ...e, severity: undefined }));
                    }}
                    className="sr-only"
                    aria-describedby={errors.severity ? "severity-error" : undefined}
                  />
                  {SEVERITY_LABELS[sv]}
                </label>
              ))}
            </div>
            {errors.severity ? (
              <p id="severity-error" role="alert" className="mt-1.5 flex items-center gap-1 text-sm text-red-600">
                <TriangleAlert aria-hidden className="size-4" />
                {errors.severity}
              </p>
            ) : null}
          </fieldset>
        </>
      ) : null}

      {/* 一句话概括（两路径共用） */}
      <div className="mt-8">
        <div className="flex items-baseline justify-between">
          <Label htmlFor="title">
            {isIssue ? "用一句话概括问题" : "用一句话概括想要的功能"}
          </Label>
          <span className="text-xs text-slate-400">{titleLen}/{LIMITS.title}</span>
        </div>
        <Input
          id="title"
          value={state.shared.title}
          onChange={(e) => {
            patchShared({ title: e.target.value });
            if (errors.title) setErrors((er) => ({ ...er, title: undefined }));
          }}
          placeholder={isIssue ? "例：导出文件时软件卡住不动了" : "例：希望能批量导出报表"}
          maxLength={LIMITS.title + 10}
          aria-invalid={errors.title ? true : undefined}
          aria-describedby={errors.title ? "title-error" : "title-count"}
          className="mt-2"
        />
        {errors.title ? (
          <p id="title-error" role="alert" className="mt-1.5 flex items-center gap-1 text-sm text-red-600">
            <TriangleAlert aria-hidden className="size-4" />
            {errors.title}
          </p>
        ) : null}
      </div>

      {/* 详细描述（两路径共用） */}
      <div className="mt-6">
        <div className="flex items-baseline justify-between">
          <Label htmlFor="description">
            {isIssue ? "详细说说发生了什么" : "详细说说想解决什么问题、希望怎么用"}
          </Label>
          <span className="text-xs text-slate-400">{descLen}/{LIMITS.description}</span>
        </div>
        <Textarea
          id="description"
          rows={5}
          value={state.shared.description}
          onChange={(e) => {
            patchShared({ description: e.target.value });
            if (errors.description) setErrors((er) => ({ ...er, description: undefined }));
          }}
          placeholder={
            isIssue
              ? "什么时候开始的？您当时在做什么？屏幕上出现了什么提示？"
              : "这个功能是想解决什么麻烦？如果有了它，您会怎么用？"
          }
          aria-invalid={errors.description ? true : undefined}
          aria-describedby={errors.description ? "description-error" : undefined}
          className="mt-2"
        />
        {errors.description ? (
          <p id="description-error" role="alert" className="mt-1.5 flex items-center gap-1 text-sm text-red-600">
            <TriangleAlert aria-hidden className="size-4" />
            {errors.description}
          </p>
        ) : null}
      </div>

      {/* 问题路径补充选填：复现步骤（仅 bug）/ 期望结果 / 实际结果 */}
      {isIssue ? (
        <div className="mt-6 space-y-6 rounded-xl border border-slate-200 bg-white p-4">
          {state.issue.type === "bug" ? (
            <div>
              <Label htmlFor="steps">复现步骤（选填）</Label>
              <Textarea
                id="steps"
                rows={3}
                value={state.issue.steps}
                onChange={(e) => patchIssue({ steps: e.target.value })}
                placeholder="一步一步说明您是怎么操作的，方便我们照着重现"
                className="mt-2 min-h-0"
              />
            </div>
          ) : null}
          <div>
            <Label htmlFor="expected">您期望的结果（选填）</Label>
            <Textarea
              id="expected"
              rows={2}
              value={state.issue.expected}
              onChange={(e) => patchIssue({ expected: e.target.value })}
              placeholder="正常情况下您希望软件做成什么样"
              className="mt-2 min-h-0"
            />
          </div>
          <div>
            <Label htmlFor="actual">实际发生的结果（选填）</Label>
            <Textarea
              id="actual"
              rows={2}
              value={state.issue.actual}
              onChange={(e) => patchIssue({ actual: e.target.value })}
              placeholder="实际出现了什么，比如报错、闪退"
              className="mt-2 min-h-0"
            />
          </div>
        </div>
      ) : (
        /* 功能路径补充选填：使用场景 / 现状的替代办法 */
        <div className="mt-6 space-y-6 rounded-xl border border-slate-200 bg-white p-4">
          <div>
            <Label htmlFor="scenario">什么时候会用到？（可不填）</Label>
            <Textarea
              id="scenario"
              rows={2}
              value={state.feature.scenario}
              onChange={(e) => patchFeature({ scenario: e.target.value })}
              placeholder="例：每个月底汇总报表的时候"
              className="mt-2 min-h-0"
            />
          </div>
          <div>
            <Label htmlFor="workaround">现在您是怎么凑合的？（可不填）</Label>
            <Textarea
              id="workaround"
              rows={2}
              value={state.feature.workaround}
              onChange={(e) => patchFeature({ workaround: e.target.value })}
              placeholder="例：手动一张张导出再自己打包"
              className="mt-2 min-h-0"
            />
          </div>
        </div>
      )}

      {/* 怎么称呼您（两路径共用，选填 ≤20 字） */}
      <div className="mt-6">
        <Label htmlFor="nickname">怎么称呼您？（可不填）</Label>
        <Input
          id="nickname"
          value={state.shared.nickname}
          onChange={(e) => {
            patchShared({ nickname: e.target.value });
            if (errors.nickname) setErrors((er) => ({ ...er, nickname: undefined }));
          }}
          placeholder="例：小明"
          maxLength={LIMITS.nickname + 5}
          aria-invalid={errors.nickname ? true : undefined}
          aria-describedby={errors.nickname ? "nickname-error" : "nickname-hint"}
          className="mt-2"
        />
        {errors.nickname ? (
          <p id="nickname-error" role="alert" className="mt-1.5 flex items-center gap-1 text-sm text-red-600">
            <TriangleAlert aria-hidden className="size-4" />
            {errors.nickname}
          </p>
        ) : (
          <p id="nickname-hint" className="mt-1.5 text-xs text-slate-500">
            仅用于开发者辨认反馈，不会用于联系您。
          </p>
        )}
      </div>

      {/* 环境信息自动采集告知（常显小字，01 §5.3） */}
      <p className="mt-6 text-xs leading-5 text-slate-500">
        提交时会自动附上您的设备信息（操作系统、浏览器、所在页面、提交时间），帮助我们更快定位问题，无需您填写。
      </p>

      {/* 提交失败提示（保留全部内容） */}
      {formError ? (
        <p
          role="alert"
          className="mt-4 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700"
        >
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          {formError}
        </p>
      ) : null}

      {/* 提交按钮（01 §2 步骤 4） */}
      <div className="sticky bottom-0 -mx-4 mt-6 border-t border-slate-200 bg-slate-50/95 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur">
        <Button
          type="submit"
          size="lg"
          disabled={submitting}
          className="w-full"
        >
          {submitting ? "正在提交…请不要关闭页面" : "提交反馈"}
        </Button>
        {savedHint ? (
          <p role="status" className="mt-2 text-center text-xs text-green-700">
            草稿已自动保存
          </p>
        ) : null}
      </div>
    </form>
  );
}

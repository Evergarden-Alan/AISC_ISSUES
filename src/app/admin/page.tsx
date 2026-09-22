"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { LogOut, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/form-controls";
import { StatusBadge, TypeBadge } from "@/components/badges";
import {
  STATUS_LABELS,
  STATUS_VALUES,
  type StatusValue,
  type TypeValue,
} from "@/lib/constants";

// 管理页 /admin（v0.1.1 M3 增强）：
// 基础：改状态 + 追加回复；新增：编辑/撤回最后一轮回复、批量改状态（≤50）、
// 删除反馈（md + 附件，完整输入编号确认）。读取经 /api/admin/list（含 hidden）。

interface AdminItem {
  id: string;
  title: string;
  type: TypeValue;
  status: StatusValue;
  category: "issue" | "feature";
  createdAt: string;
  updatedAt: string;
  excerpt: string;
  affects: number;
  hidden: boolean;
  lastReplyText: string; // 最后一轮回复原文（空 = 无回复轮）
}

type Phase = "checking" | "login" | "ready" | "disabled";

interface DraftRow {
  status: StatusValue;
  reply: string;
  saving: boolean;
  msg: string;
  ok: boolean;
  editing: boolean; // 编辑回复态：reply 即编辑文本（预填最后一轮），保存走 edit-last-reply
}

interface DelRow {
  open: boolean;
  value: string;
  busy: boolean;
  msg: string;
}

const JSON_HEADERS = { "Content-Type": "application/json" };

export default function AdminPage() {
  const [phase, setPhase] = useState<Phase>("checking");
  const [items, setItems] = useState<AdminItem[]>([]);
  const [token, setToken] = useState("");
  const [loginError, setLoginError] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, DraftRow>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMsg, setBulkMsg] = useState("");
  const [bulkOk, setBulkOk] = useState(false);
  const [dels, setDels] = useState<Record<string, DelRow>>({});

  async function loadList() {
    const res = await fetch("/api/admin/list");
    if (res.status === 403) {
      setPhase("disabled");
      return;
    }
    if (res.status === 401) {
      setPhase("login");
      return;
    }
    const data = (await res.json()) as { ok: boolean; items?: AdminItem[] };
    if (data.ok && data.items) {
      setItems(data.items);
      const init: typeof drafts = {};
      for (const it of data.items) {
        init[it.id] = {
          status: it.status,
          reply: "",
          saving: false,
          msg: "",
          ok: false,
          editing: false,
        };
      }
      setDrafts(init);
      setSelected(new Set());
      setDels({});
      setPhase("ready");
    } else {
      setPhase("login");
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadList();
  }, []);

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setLoginError("");
    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ token }),
    });
    const data = (await res.json().catch(() => null)) as
      | { ok?: boolean; error?: string }
      | null;
    if (res.ok && data?.ok) {
      setToken("");
      await loadList();
    } else {
      setLoginError(data?.error || "登录失败，请重试");
    }
  }

  async function logout() {
    await fetch("/api/admin/logout", { method: "POST" });
    setPhase("login");
    setItems([]);
  }

  function patchDraft(id: string, patch: Partial<DraftRow>) {
    setDrafts((d) => ({ ...d, [id]: { ...d[id], ...patch } }));
  }

  function patchDel(id: string, patch: Partial<DelRow>) {
    setDels((d) => {
      const base: DelRow = d[id] ?? { open: false, value: "", busy: false, msg: "" };
      return { ...d, [id]: { ...base, ...patch } };
    });
  }

  function toggleSelect(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  const visible = showHidden ? items : items.filter((i) => !i.hidden);
  const allVisibleSelected =
    visible.length > 0 && visible.every((i) => selected.has(i.id));

  async function save(it: AdminItem) {
    const d = drafts[it.id];
    if (!d || d.saving) return;

    if (d.editing) {
      // 编辑最后一轮回复：以原轮次时间戳写回（服务端处理）
      const text = d.reply.trim();
      if (!text) {
        patchDraft(it.id, { msg: "请填写回复内容", ok: false });
        return;
      }
      if ([...text].length > 2000) {
        patchDraft(it.id, { msg: "回复内容不能超过 2000 字", ok: false });
        return;
      }
      patchDraft(it.id, { saving: true, msg: "" });
      const res = await fetch("/api/admin/update", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ id: it.id, action: "edit-last-reply", text }),
      });
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string }
        | null;
      if (res.ok && data?.ok) {
        patchDraft(it.id, {
          saving: false,
          reply: "",
          editing: false,
          msg: "✓ 已保存（线上 ≤5 分钟可见）",
          ok: true,
        });
        await loadList();
      } else {
        patchDraft(it.id, {
          saving: false,
          msg: data?.error || "保存失败，请重试",
          ok: false,
        });
      }
      return;
    }

    const statusChanged = d.status !== it.status;
    if (!statusChanged && !d.reply.trim()) {
      patchDraft(it.id, { msg: "请改状态或填写回复", ok: false });
      return;
    }
    patchDraft(it.id, { saving: true, msg: "" });
    const res = await fetch("/api/admin/update", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        id: it.id,
        status: statusChanged ? d.status : undefined,
        reply: d.reply.trim() || undefined,
      }),
    });
    const data = (await res.json().catch(() => null)) as
      | { ok?: boolean; error?: string }
      | null;
    if (res.ok && data?.ok) {
      setItems((list) =>
        list.map((x) =>
          x.id === it.id
            ? { ...x, status: d.status, hidden: d.status === "hidden" ? true : x.hidden }
            : x
        )
      );
      patchDraft(it.id, { saving: false, reply: "", msg: "✓ 已保存（线上 ≤5 分钟可见）", ok: true });
    } else {
      patchDraft(it.id, { saving: false, msg: data?.error || "保存失败，请重试", ok: false });
    }
  }

  async function withdrawReply(it: AdminItem) {
    const d = drafts[it.id];
    if (!d || d.saving || !it.lastReplyText) return;
    if (!window.confirm("撤回后用户将看不到这轮回复，确定？")) return;
    patchDraft(it.id, { saving: true, msg: "" });
    const res = await fetch("/api/admin/update", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ id: it.id, action: "remove-last-reply" }),
    });
    const data = (await res.json().catch(() => null)) as
      | { ok?: boolean; error?: string }
      | null;
    if (res.ok && data?.ok) {
      patchDraft(it.id, { saving: false, msg: "✓ 已撤回（线上 ≤5 分钟可见）", ok: true });
      await loadList();
    } else {
      patchDraft(it.id, { saving: false, msg: data?.error || "撤回失败，请重试", ok: false });
    }
  }

  async function applyBulk() {
    if (!bulkStatus || selected.size === 0 || bulkBusy) return;
    if (bulkStatus === "duplicate") return;
    const label = STATUS_LABELS[bulkStatus as StatusValue];
    const text =
      label.issue === label.feature
        ? label.issue
        : `${label.issue}/${label.feature}`;
    if (!window.confirm(`将 ${selected.size} 条改为「${text}」？`)) return;
    setBulkBusy(true);
    setBulkMsg("");
    const res = await fetch("/api/admin/bulk-status", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ ids: [...selected], status: bulkStatus }),
    });
    const data = (await res.json().catch(() => null)) as
      | {
          ok?: boolean;
          error?: string;
          results?: { id: string; ok: boolean; error?: string }[];
        }
      | null;
    if (res.ok && data?.ok && data.results) {
      const okN = data.results.filter((r) => r.ok).length;
      const failN = data.results.length - okN;
      const firstErr = data.results.find((r) => !r.ok)?.error;
      setBulkOk(failN === 0);
      setBulkOk(failN === 0);
      setBulkMsg(
        failN === 0
          ? `✓ 成功 ${okN} 条（线上 ≤5 分钟可见）`
          : `成功 ${okN} / 失败 ${failN}${firstErr ? `（${firstErr}）` : ""}`
      );
      await loadList();
    } else {
      setBulkOk(false);
      setBulkMsg(data?.error || "批量修改失败，请重试");
    }
    setBulkBusy(false);
  }

  async function deleteFeedback(it: AdminItem) {
    const del = dels[it.id];
    if (!del || del.busy) return;
    if (del.value !== it.id) {
      patchDel(it.id, { msg: "请输入完整编号以确认删除" });
      return;
    }
    patchDel(it.id, { busy: true, msg: "" });
    const res = await fetch("/api/admin/delete", {
      method: "DELETE",
      headers: JSON_HEADERS,
      body: JSON.stringify({ id: it.id, confirm: del.value }),
    });
    const data = (await res.json().catch(() => null)) as
      | { ok?: boolean; error?: string }
      | null;
    if (res.ok && data?.ok) {
      setItems((list) => list.filter((x) => x.id !== it.id));
    } else {
      patchDel(it.id, { busy: false, msg: data?.error || "删除失败，请重试" });
    }
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-16 pt-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">反馈管理</h1>
        {phase === "ready" ? (
          <button
            type="button"
            onClick={logout}
            className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"
          >
            <LogOut aria-hidden className="size-4" />
            退出
          </button>
        ) : null}
      </div>

      {phase === "checking" ? (
        <p className="mt-8 text-sm text-slate-500">正在验证身份…</p>
      ) : null}

      {phase === "disabled" ? (
        <p className="mt-8 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">
          管理功能未启用：需要在 Vercel（及本地 .env.local）配置环境变量
          <code className="mx-1 rounded bg-amber-100 px-1">ADMIN_TOKEN</code>
          后才能使用。配置后需 Redeploy。
        </p>
      ) : null}

      {phase === "login" ? (
        <form onSubmit={login} className="mt-8 max-w-sm" noValidate>
          <Label htmlFor="admin-token">管理令牌</Label>
          <Input
            id="admin-token"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="ADMIN_TOKEN"
            className="mt-2"
            autoComplete="current-password"
          />
          {loginError ? (
            <p role="alert" className="mt-2 flex items-center gap-1 text-sm text-red-600">
              <TriangleAlert aria-hidden className="size-4" />
              {loginError}
            </p>
          ) : null}
          <Button type="submit" className="mt-4 w-full">
            登录
          </Button>
        </form>
      ) : null}

      {phase === "ready" ? (
        <>
          <label className="mt-4 inline-flex cursor-pointer items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={showHidden}
              onChange={(e) => setShowHidden(e.target.checked)}
              className="size-4"
            />
            显示已隐藏条目（{items.filter((i) => i.hidden).length}）
          </label>

          {/* 批量操作条 */}
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
            <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={allVisibleSelected}
                onChange={(e) => {
                  setSelected(
                    e.target.checked ? new Set(visible.map((i) => i.id)) : new Set()
                  );
                }}
                className="size-4"
              />
              全选
            </label>
            {selected.size > 0 ? (
              <>
                <span className="text-sm font-medium text-slate-800">
                  已选 {selected.size} 条
                </span>
                <select
                  value={bulkStatus}
                  onChange={(e) => setBulkStatus(e.target.value)}
                  aria-label="批量目标状态"
                  className="h-10 rounded-lg border border-slate-300 bg-white px-2 text-sm"
                >
                  <option value="">选择状态…</option>
                  {STATUS_VALUES.map((sv) => {
                    const l = STATUS_LABELS[sv];
                    const text =
                      l.issue === l.feature ? l.issue : `${l.issue}/${l.feature}`;
                    const isDup = sv === "duplicate";
                    return (
                      <option key={sv} value={sv} disabled={isDup}>
                        {text}
                        {isDup ? "（需单条填写指向编号）" : ""}
                      </option>
                    );
                  })}
                </select>
                <Button
                  size="sm"
                  onClick={applyBulk}
                  disabled={bulkBusy || !bulkStatus || bulkStatus === "duplicate"}
                >
                  {bulkBusy ? "处理中…" : "批量修改"}
                </Button>
              </>
            ) : null}
            {bulkMsg ? (
              <span className={`text-sm ${bulkOk ? "text-green-700" : "text-red-600"}`}>
                {bulkMsg}
              </span>
            ) : null}
          </div>

          <div className="mt-4 space-y-4">
            {visible.map((it) => {
              const d = drafts[it.id];
              const del = dels[it.id] ?? {
                open: false,
                value: "",
                busy: false,
                msg: "",
              };
              const hasReply = !!it.lastReplyText;
              return (
                <div
                  key={it.id}
                  className={`rounded-xl border p-4 ${
                    it.hidden ? "border-slate-300 bg-slate-100 opacity-80" : "border-slate-200 bg-white"
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selected.has(it.id)}
                      onChange={() => toggleSelect(it.id)}
                      aria-label={`选择 ${it.title}`}
                      className="size-4"
                    />
                    <Link
                      href={`/issue/${it.id}`}
                      className="text-base font-medium hover:underline"
                    >
                      {it.title}
                    </Link>
                    <TypeBadge type={it.type} />
                    <StatusBadge status={it.status} category={it.category} />
                    <span className="text-xs text-slate-500">影响 {it.affects}</span>
                    <span className="ml-auto font-mono text-xs text-slate-400">{it.id}</span>
                  </div>

                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[200px_1fr]">
                    <div>
                      <Label htmlFor={`st-${it.id}`}>新状态</Label>
                      <select
                        id={`st-${it.id}`}
                        value={d?.status ?? it.status}
                        onChange={(e) =>
                          patchDraft(it.id, { status: e.target.value as StatusValue })
                        }
                        className="mt-1 h-11 w-full rounded-lg border border-slate-300 bg-white px-2 text-base"
                      >
                        {STATUS_VALUES.map((sv) => (
                          <option key={sv} value={sv}>
                            {STATUS_LABELS[sv][it.category]}
                            {sv !== it.status && sv === "hidden" ? "（隐藏）" : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <Label htmlFor={`rp-${it.id}`}>
                        {d?.editing
                          ? "编辑最后一轮回复（保留原时间戳）"
                          : "追加回复（可选，写入回信时间线）"}
                      </Label>
                      <Textarea
                        id={`rp-${it.id}`}
                        rows={d?.editing ? 4 : 2}
                        value={d?.reply ?? ""}
                        onChange={(e) => patchDraft(it.id, { reply: e.target.value })}
                        placeholder={
                          d?.editing
                            ? hasReply
                              ? it.lastReplyText
                              : "（暂无可编辑的回复）"
                            : "写给用户的话，大白话即可；保存后自动成为一轮回复"
                        }
                        className="mt-1 min-h-0"
                      />
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Button size="sm" onClick={() => save(it)} disabled={d?.saving}>
                      {d?.saving ? "保存中…" : d?.editing ? "保存修改" : "保存"}
                    </Button>
                    {d?.editing ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => patchDraft(it.id, { editing: false, reply: "" })}
                        disabled={d.saving}
                      >
                        取消编辑
                      </Button>
                    ) : (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            patchDraft(it.id, { editing: true, reply: it.lastReplyText })
                          }
                          disabled={!hasReply || d?.saving}
                        >
                          编辑回复
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => withdrawReply(it)}
                          disabled={!hasReply || d?.saving}
                        >
                          撤回回复
                        </Button>
                      </>
                    )}
                    {del.open ? null : (
                      <button
                        type="button"
                        onClick={() => patchDel(it.id, { open: true })}
                        className="ml-auto rounded-lg border border-red-300 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
                      >
                        删除反馈
                      </button>
                    )}
                    {d?.msg ? (
                      <span
                        className={`text-sm ${d.ok ? "text-green-700" : "text-red-600"}`}
                      >
                        {d.msg}
                      </span>
                    ) : null}
                  </div>

                  {/* 删除确认区（危险操作：要求完整输入编号） */}
                  {del.open ? (
                    <div className="mt-3 rounded-lg border border-red-300 bg-red-50 p-3">
                      <p className="text-sm text-red-800">
                        删除后无法恢复，附件将一并删除（仅 Git 历史可找回）。请输入完整编号
                        <span className="mx-1 font-mono font-medium">{it.id}</span>
                        以确认。
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <Input
                          type="text"
                          value={del.value}
                          onChange={(e) => patchDel(it.id, { value: e.target.value })}
                          placeholder={it.id}
                          aria-label="输入完整编号确认删除"
                          className="h-10 max-w-xs font-mono"
                        />
                        <button
                          type="button"
                          onClick={() => deleteFeedback(it)}
                          disabled={del.busy || del.value !== it.id}
                          className="h-10 rounded-lg bg-red-600 px-4 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-40"
                        >
                          {del.busy ? "删除中…" : "永久删除"}
                        </button>
                        <button
                          type="button"
                          onClick={() => patchDel(it.id, { open: false, value: "", msg: "" })}
                          className="text-sm text-slate-500 hover:text-slate-800"
                        >
                          取消
                        </button>
                        {del.msg ? (
                          <span className="text-sm text-red-600">{del.msg}</span>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
            {visible.length === 0 ? (
              <p className="text-sm text-slate-500">暂无反馈。</p>
            ) : null}
          </div>
        </>
      ) : null}
    </main>
  );
}

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

// 管理页 /admin（03：受保护管理页，可选件，默认未启用）
// 登录 = ADMIN_TOKEN（httpOnly cookie）；操作仅两个：改状态、追加回复。
// 每次保存 = 一次仓库编辑（同步 status/updated_at/回复分区，02 §6.4）。

interface AdminItem {
  id: string;
  title: string;
  type: TypeValue;
  status: StatusValue;
  category: "issue" | "feature";
  createdAt: string;
  updatedAt: string;
  excerpt: string;
  hidden: boolean;
}

type Phase = "checking" | "login" | "ready" | "disabled";

interface DraftRow {
  status: StatusValue;
  reply: string;
  saving: boolean;
  msg: string;
  ok: boolean;
}

export default function AdminPage() {
  const [phase, setPhase] = useState<Phase>("checking");
  const [items, setItems] = useState<AdminItem[]>([]);
  const [token, setToken] = useState("");
  const [loginError, setLoginError] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, DraftRow>>({});

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
        init[it.id] = { status: it.status, reply: "", saving: false, msg: "", ok: false };
      }
      setDrafts(init);
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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
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

  async function save(it: AdminItem) {
    const d = drafts[it.id];
    if (!d || d.saving) return;
    const statusChanged = d.status !== it.status;
    if (!statusChanged && !d.reply.trim()) {
      patchDraft(it.id, { msg: "请改状态或填写回复", ok: false });
      return;
    }
    patchDraft(it.id, { saving: true, msg: "" });
    const res = await fetch("/api/admin/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
          x.id === it.id ? { ...x, status: d.status, hidden: d.status === "hidden" ? true : x.hidden } : x
        )
      );
      patchDraft(it.id, { saving: false, reply: "", msg: "✓ 已保存（线上 ≤5 分钟可见）", ok: true });
    } else {
      patchDraft(it.id, { saving: false, msg: data?.error || "保存失败，请重试", ok: false });
    }
  }

  const visible = showHidden ? items : items.filter((i) => !i.hidden);

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

          <div className="mt-4 space-y-4">
            {visible.map((it) => {
              const d = drafts[it.id];
              return (
                <div
                  key={it.id}
                  className={`rounded-xl border p-4 ${
                    it.hidden ? "border-slate-300 bg-slate-100 opacity-80" : "border-slate-200 bg-white"
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/issue/${it.id}`}
                      className="text-base font-medium hover:underline"
                    >
                      {it.title}
                    </Link>
                    <TypeBadge type={it.type} />
                    <StatusBadge status={it.status} category={it.category} />
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
                      <Label htmlFor={`rp-${it.id}`}>追加回复（可选，写入回信时间线）</Label>
                      <Textarea
                        id={`rp-${it.id}`}
                        rows={2}
                        value={d?.reply ?? ""}
                        onChange={(e) => patchDraft(it.id, { reply: e.target.value })}
                        placeholder="写给用户的话，大白话即可；保存后自动成为一轮回复"
                        className="mt-1 min-h-0"
                      />
                    </div>
                  </div>

                  <div className="mt-3 flex items-center gap-3">
                    <Button
                      size="sm"
                      onClick={() => save(it)}
                      disabled={d?.saving}
                    >
                      {d?.saving ? "保存中…" : "保存"}
                    </Button>
                    {d?.msg ? (
                      <span
                        className={`text-sm ${d.ok ? "text-green-700" : "text-red-600"}`}
                      >
                        {d.msg}
                      </span>
                    ) : null}
                  </div>
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

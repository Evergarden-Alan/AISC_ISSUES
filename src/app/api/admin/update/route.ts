import { NextRequest, NextResponse } from "next/server";
import { sameOrigin } from "@/lib/guards";
import { isAdmin, adminEnabled } from "@/lib/admin";
import { ID_PATTERN, STATUS_VALUES, feedbackPath } from "@/lib/constants";
import { withConflictRetry, githubGetFile, githubPutFileBytes } from "@/lib/github-client";
import { decodeBase64Utf8 } from "@/lib/github-client";
import {
  appendDeveloperReply,
  extractReplyRounds,
  parseFeedback,
  removeLastDeveloperReply,
  setFrontmatterField,
} from "@/lib/markdown-utils";
import { beijingIso, beijingClock } from "@/lib/beijing-time";

// POST /api/admin/update —— 管理页写操作（v0.1.1 M3-1 扩展三种 action）：
// -（缺省）改 status / 追加回复：updated_at 必更；追加回复且未显式改状态、当前为
//   submitted ⇒ 自动置 replied（软约定）。
// - "remove-last-reply"：移除最后一轮；撤空且当前 replied ⇒ 回退 submitted（其余状态
//   不动，可用同次 status 覆盖）。
// - "edit-last-reply"：移除最后一轮并以原轮次时间戳写回编辑文本（修正而非新回复）。
// 硬约定（02 §6.4）：所有写路径必更 updated_at；写读走 withConflictRetry 重读 sha。

export const runtime = "nodejs";
export const maxDuration = 60;

function fail(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return fail("请通过本网站提交", 403);
  if (!adminEnabled()) return fail("管理功能未启用", 403);
  if (!isAdmin(req)) return fail("请先登录", 401);

  let body: {
    id?: string;
    status?: string;
    reply?: string;
    action?: string;
    text?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return fail("请求格式不正确");
  }
  const id = typeof body.id === "string" ? body.id : "";
  const status = typeof body.status === "string" ? body.status : "";
  const reply = typeof body.reply === "string" ? body.reply.trim() : "";
  const action = typeof body.action === "string" ? body.action : "";
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!ID_PATTERN.test(id)) return fail("反馈编号格式不正确");

  // action 白名单与互斥校验（action 出现时忽略 reply 字段）
  let mode: "default" | "remove-last-reply" | "edit-last-reply" = "default";
  if (action) {
    if (action !== "remove-last-reply" && action !== "edit-last-reply") {
      return fail("请求参数不正确");
    }
    if (reply) return fail("请求参数不正确");
    mode = action;
  }
  if (status && !STATUS_VALUES.includes(status as never)) {
    return fail("状态值不合法");
  }
  if (mode === "edit-last-reply") {
    if (!text) return fail("请填写回复内容");
    if ([...text].length > 2000) return fail("回复内容不能超过 2000 字");
  } else if (mode === "default" && !status && !reply) {
    return fail("请选择新状态或填写回复内容");
  } else if (mode === "default" && reply && [...reply].length > 2000) {
    return fail("回复内容不能超过 2000 字");
  }

  const path = feedbackPath(id);
  try {
    const newStatus = await withConflictRetry(async () => {
      // 每次尝试重新读最新 sha（冲突时由 withConflictRetry 重跑整个闭包）
      const file = await githubGetFile(path);
      if (!file?.content) throw new Error("NOT_FOUND");
      const raw = decodeBase64Utf8(file.content);
      const parsed = parseFeedback(raw);
      if (!parsed) throw new Error("NOT_FOUND");

      const nowMs = Date.now();
      let next = raw;
      let target = parsed.fm.status;

      if (mode === "remove-last-reply" || mode === "edit-last-reply") {
        const r = removeLastDeveloperReply(next);
        if (!r.removed || !r.round) throw new Error("NO_REPLY_TO_REMOVE");
        next = r.raw;
        if (mode === "edit-last-reply") {
          // 编辑 = 以原轮次时间戳写回（不生成新时间戳，时间线不失真）
          next = appendDeveloperReply(next, r.round.time, text);
          target = "replied";
        } else {
          // 撤空后的状态回退默认规则：当前 replied → submitted；其余状态不动
          if (!status && parsed.fm.status === "replied" && extractReplyRounds(next).length === 0) {
            next = setFrontmatterField(next, "status", "submitted");
            target = "submitted";
          }
        }
      }

      if (status && status !== parsed.fm.status) {
        next = setFrontmatterField(next, "status", status);
        target = status as typeof target;
      }
      if (mode === "default" && reply) {
        next = appendDeveloperReply(
          next,
          beijingClock(nowMs).slice(0, 16),
          reply
        );
        // 软约定：首次回复且未显式改状态 ⇒ replied
        if (!status && parsed.fm.status === "submitted") {
          next = setFrontmatterField(next, "status", "replied");
          target = "replied";
        }
      }
      next = setFrontmatterField(next, "updated_at", beijingIso(nowMs));

      const verb =
        mode === "remove-last-reply"
          ? `admin: 撤回回复 ${id}`
          : mode === "edit-last-reply"
            ? `admin: 编辑回复 ${id}`
            : `admin: ${id} → ${target}`;
      return githubPutFileBytes(
        path,
        Buffer.from(next, "utf-8"),
        verb,
        file.sha
      ).then(() => target);
    });
    return NextResponse.json({ ok: true, status: newStatus });
  } catch (e) {
    if (e instanceof Error && e.message === "NO_REPLY_TO_REMOVE") {
      return fail("暂无可撤回的回复");
    }
    if (e instanceof Error && e.message === "NOT_FOUND") {
      return fail("未找到该反馈", 404);
    }
    console.error("[api/admin/update] 写入失败：", e);
    return fail("保存暂时没有成功，请稍后重试", 500);
  }
}

import { NextRequest, NextResponse } from "next/server";
import { sameOrigin } from "@/lib/guards";
import { isAdmin, adminEnabled } from "@/lib/admin";
import { STATUS_VALUES, ID_PATTERN } from "@/lib/constants";
import { withConflictRetry, githubGetFile, githubPutFileBytes } from "@/lib/github-client";
import { decodeBase64Utf8 } from "@/lib/github-client";
import { appendDeveloperReply, parseFeedback, setFrontmatterField } from "@/lib/markdown-utils";
import { beijingIso, beijingClock } from "@/lib/beijing-time";

// POST /api/admin/update —— 管理页写操作：改 status / 追加回复（03 回信协议）
// 单次编辑同步完成：status（可选）+ 追加回复（可选）+ updated_at 必更（02 §6.4 硬约定）。
// 追加回复且未显式改状态、当前为 submitted ⇒ 自动置 replied（软约定）。

export const runtime = "nodejs";
export const maxDuration = 60;

function fail(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return fail("请通过本网站提交", 403);
  if (!adminEnabled()) return fail("管理功能未启用", 403);
  if (!isAdmin(req)) return fail("请先登录", 401);

  let body: { id?: string; status?: string; reply?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return fail("请求格式不正确");
  }
  const id = typeof body.id === "string" ? body.id : "";
  const status = typeof body.status === "string" ? body.status : "";
  const reply = typeof body.reply === "string" ? body.reply.trim() : "";
  if (!ID_PATTERN.test(id)) return fail("反馈编号格式不正确");
  if (!status && !reply) return fail("请选择新状态或填写回复内容");
  if (status && !STATUS_VALUES.includes(status as never)) {
    return fail("状态值不合法");
  }
  if (reply && [...reply].length > 2000) {
    return fail("回复内容不能超过 2000 字");
  }

  const path = `feedback/${id}.md`;
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
      if (status && status !== parsed.fm.status) {
        next = setFrontmatterField(next, "status", status);
        target = status as typeof target;
      }
      if (reply) {
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
      return githubPutFileBytes(
        path,
        Buffer.from(next, "utf-8"),
        `admin: ${id} → ${target}`,
        file.sha
      ).then(() => target);
    });
    return NextResponse.json({ ok: true, status: newStatus });
  } catch (e) {
    if (e instanceof Error && e.message === "NOT_FOUND") {
      return fail("未找到该反馈", 404);
    }
    console.error("[api/admin/update] 写入失败：", e);
    return fail("保存暂时没有成功，请稍后重试", 500);
  }
}

import { NextRequest, NextResponse } from "next/server";
import pLimit from "p-limit";
import { sameOrigin } from "@/lib/guards";
import { adminEnabled, isAdmin } from "@/lib/admin";
import { ID_PATTERN, STATUS_VALUES, feedbackPath } from "@/lib/constants";
import {
  decodeBase64Utf8,
  githubGetFile,
  githubPutFileBytes,
  withConflictRetry,
} from "@/lib/github-client";
import { parseFeedback, setFrontmatterField } from "@/lib/markdown-utils";
import { beijingIso } from "@/lib/beijing-time";

// POST /api/admin/bulk-status —— 批量改状态（v0.1.1 M3-2）
// ids ≤50；逐条独立执行「读最新 → status + updated_at → PUT sha」，单条失败不中断整批；
// 部分失败也返回 200（results 逐条 ok/error）。

export const runtime = "nodejs";
export const maxDuration = 60;

function fail(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return fail("请通过本网站提交", 403);
  if (!adminEnabled()) return fail("管理功能未启用", 403);
  if (!isAdmin(req)) return fail("请先登录", 401);

  let body: { ids?: unknown; status?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return fail("请求格式不正确");
  }
  const ids = body.ids;
  if (!Array.isArray(ids) || ids.length < 1) return fail("请求格式不正确");
  if (ids.length > 50) return fail("一次最多处理 50 条");
  for (const id of ids) {
    if (typeof id !== "string" || !ID_PATTERN.test(id)) {
      return fail("反馈编号格式不正确");
    }
  }
  const status = typeof body.status === "string" ? body.status : "";
  if (!STATUS_VALUES.includes(status as never)) return fail("状态值不合法");
  if (status === "duplicate") {
    return fail("重复状态请在单条编辑中设置");
  }

  const limit = pLimit(3);
  const results = await Promise.all(
    (ids as string[]).map((id) =>
      limit(async (): Promise<{ id: string; ok: boolean; error?: string }> => {
        const path = feedbackPath(id);
        try {
          await withConflictRetry(async () => {
            const file = await githubGetFile(path);
            if (!file?.content) throw new Error("NOT_FOUND");
            const raw = decodeBase64Utf8(file.content);
            if (!parseFeedback(raw)) throw new Error("NOT_FOUND");
            let next = setFrontmatterField(raw, "status", status);
            next = setFrontmatterField(next, "updated_at", beijingIso(Date.now()));
            await githubPutFileBytes(
              path,
              Buffer.from(next, "utf-8"),
              `admin: 批量 ${id} → ${status}`,
              file.sha
            );
          });
          return { id, ok: true };
        } catch (e) {
          if (e instanceof Error && e.message === "NOT_FOUND") {
            return { id, ok: false, error: "未找到该反馈" };
          }
          console.error("[api/admin/bulk-status] 单条失败：", id, e);
          return { id, ok: false, error: "保存失败，请重试" };
        }
      })
    )
  );
  return NextResponse.json({ ok: true, results });
}

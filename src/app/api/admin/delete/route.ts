import { NextRequest, NextResponse } from "next/server";
import pLimit from "p-limit";
import { sameOrigin } from "@/lib/guards";
import { adminEnabled, isAdmin } from "@/lib/admin";
import { ID_PATTERN, assetsPath, feedbackPath } from "@/lib/constants";
import {
  GitHubApiError,
  githubDeleteFile,
  githubGetFileMeta,
  githubListDir,
} from "@/lib/github-client";

// DELETE /api/admin/delete —— 彻底删除反馈（v0.1.1 M3-3）：md + 全部附件。
// confirm 必须与 id 完全相等（UI 要求完整输入编号）。
// 删除顺序先附件后 md（保证不产生「有 md 无附件」死链）；附件部分失败则不删 md，
// 幂等可重试（对同 id 再次调用即续删）。

export const runtime = "nodejs";
export const maxDuration = 60;

function fail(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function DELETE(req: NextRequest) {
  if (!sameOrigin(req)) return fail("请通过本网站提交", 403);
  if (!adminEnabled()) return fail("管理功能未启用", 403);
  if (!isAdmin(req)) return fail("请先登录", 401);

  let body: { id?: unknown; confirm?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return fail("请求格式不正确");
  }
  const id = typeof body.id === "string" ? body.id : "";
  const confirm = typeof body.confirm === "string" ? body.confirm : "";
  if (!ID_PATTERN.test(id)) return fail("反馈编号格式不正确");
  if (confirm !== id) return fail("请输入完整编号以确认删除");

  const mdPath = feedbackPath(id);
  try {
    // ① md 存在性（不存在也继续清残留附件，支持重试清理）
    const mdMeta = await githubGetFileMeta(mdPath);

    // ② 先删附件（任一失败则保留 md，可重试）
    const failedAssets: string[] = [];
    let deletedAssets = 0;
    const entries = await githubListDir(assetsPath(id));
    const files = (entries ?? []).filter((e) => e.type === "file");
    const limit = pLimit(3);
    await Promise.all(
      files.map((f) =>
        limit(async () => {
          try {
            const sha = f.sha ?? (await githubGetFileMeta(f.path))?.sha;
            if (!sha) {
              failedAssets.push(f.name);
              return;
            }
            await githubDeleteFile(f.path, sha, `admin: 删除附件 ${f.name}`);
            deletedAssets += 1;
          } catch (e) {
            if (e instanceof GitHubApiError && e.status === 404) return; // 已删
            console.error("[api/admin/delete] 附件删除失败：", f.path, e);
            failedAssets.push(f.name);
          }
        })
      )
    );
    if (failedAssets.length > 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "部分附件删除失败，反馈正文未删除，请重试",
          failedAssets,
        },
        { status: 500 }
      );
    }

    // ③ 最后删 md（存在性锚点）
    if (mdMeta) {
      await githubDeleteFile(mdPath, mdMeta.sha, `admin: 删除 ${id}`);
    }
    return NextResponse.json({
      ok: true,
      deletedMd: !!mdMeta,
      deletedAssets,
    });
  } catch (e) {
    console.error(
      "[api/admin/delete] 删除失败：",
      e instanceof GitHubApiError ? `GitHub API ${e.status}` : e
    );
    return fail("删除没有成功，请稍后重试", 500);
  }
}

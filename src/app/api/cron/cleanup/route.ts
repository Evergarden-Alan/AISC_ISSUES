import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import pLimit from "p-limit";
import {
  GitHubApiError,
  githubDeleteFile,
  githubGetFileMeta,
  githubListDir,
} from "@/lib/github-client";
import { pendingDirDateMs } from "@/lib/attachments";
import {
  LEGACY_PENDING_CUTOFF_MS,
  PENDING_MAX_AGE_MS,
  selectStalePendingDirs,
} from "@/lib/pending-cleanup";

// GET /api/cron/cleanup —— _pending 孤儿暂存自动清理（v0.1.1 M1-2）
// 鉴权：Authorization: Bearer ${CRON_SECRET}（Vercel Cron 自动附带）；未配置或不匹配一律 404。
// 规则：日期化目录距今 >7 天即删；v0.1.0 遗留裸 uuid 目录自 2026-09-29 起视为超龄；
// 既非新格式也非旧 uuid 格式的目录名跳过并记日志（防误删）。
// 单次运行删除上限 200 个文件（防 60s 超时；操作幂等，剩余次日继续）。

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_FILES_PER_RUN = 200;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const got = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "未找到该页面" }, { status: 404 });
  }

  try {
    const entries = await githubListDir("feedback/assets/_pending");
    if (!entries) {
      // 目录不存在 = 无事可做
      return NextResponse.json({
        ok: true,
        scanned: 0,
        deletedDirs: 0,
        deletedFiles: 0,
        failed: 0,
      });
    }
    const dirs = entries.filter((e) => e.type === "dir");
    const { stale, skipped } = selectStalePendingDirs(
      dirs.map((d) => d.name),
      Date.now(),
      { maxAgeMs: PENDING_MAX_AGE_MS, legacyCutoffMs: LEGACY_PENDING_CUTOFF_MS }
    );
    for (const name of skipped) {
      console.warn("[cron/cleanup] 跳过无法识别的目录：", name);
    }

    let deletedDirs = 0;
    let deletedFiles = 0;
    let failed = 0;
    const limit = pLimit(3);

    for (const name of stale) {
      const list = await githubListDir(`feedback/assets/_pending/${name}`);
      if (!list) {
        deletedDirs += 1; // 目录已不存在 = 已清理
        continue;
      }
      const fileEntries = list.filter((f) => f.type === "file");
      const results = await Promise.all(
        fileEntries.map((f) =>
          limit(async (): Promise<boolean> => {
            try {
              const sha = f.sha ?? (await githubGetFileMeta(f.path))?.sha;
              if (!sha) return false;
              await githubDeleteFile(f.path, sha, "cron: cleanup pending");
              return true;
            } catch (e) {
              if (e instanceof GitHubApiError && e.status === 404) return true; // 已删
              console.error("[cron/cleanup] 删除失败：", f.path, e);
              return false;
            }
          })
        )
      );
      deletedFiles += results.filter(Boolean).length;
      failed += results.filter((r) => !r).length;
      if (results.every(Boolean)) deletedDirs += 1;
      if (deletedFiles + failed >= MAX_FILES_PER_RUN) break; // 防超时，剩余次日继续
    }

    return NextResponse.json({
      ok: true,
      scanned: dirs.length,
      deletedDirs,
      deletedFiles,
      failed,
    });
  } catch (e) {
    console.error(
      "[cron/cleanup] 执行失败：",
      e instanceof GitHubApiError ? `GitHub API ${e.status}` : e
    );
    return NextResponse.json(
      { ok: false, error: "清理任务执行失败，请次日重试" },
      { status: 500 }
    );
  }
}

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
import { regenerateIndex } from "@/lib/feedback";

// GET /api/cron/cleanup —— 每日自动任务（v0.1.2）：
// ① 清理两处暂存区超龄孤儿：issues/_pending（现行）+ feedback/assets/_pending（v0.1.0 残留）；
// ② 全量重建仓库根 索引.md（开发者直接改 md 后的最长同步周期 = 1 天）。
// 鉴权：Authorization: Bearer ${CRON_SECRET}（Vercel Cron 自动附带）；未配置或不匹配一律 404。
// 规则：日期化目录距今 >7 天即删；遗留裸 uuid 目录自 2026-09-29 起视为超龄；
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

interface CleanupResult {
  ok: boolean;
  scanned: number;
  deletedDirs: number;
  deletedFiles: number;
  failed: number;
}

/** 清理单个暂存区基目录下的超龄目录 */
async function cleanupBase(base: string): Promise<CleanupResult> {
  try {
    const entries = await githubListDir(base);
    if (!entries) {
      return { ok: true, scanned: 0, deletedDirs: 0, deletedFiles: 0, failed: 0 };
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
      const list = await githubListDir(`${base}/${name}`);
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

    return {
      ok: true,
      scanned: dirs.length,
      deletedDirs,
      deletedFiles,
      failed,
    };
  } catch (e) {
    console.error("[cron/cleanup] 清理失败：", base, e);
    return { ok: false, scanned: 0, deletedDirs: 0, deletedFiles: 0, failed: 0 };
  }
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "未找到该页面" }, { status: 404 });
  }

  // ① 两处暂存区（现行 + 旧路径残留，后者清空后即恒为 no-op）
  const r1 = await cleanupBase("issues/_pending");
  const r2 = await cleanupBase("feedback/assets/_pending");

  // ② 顺带全量重建仓库根索引
  let indexRebuilt = false;
  try {
    await regenerateIndex();
    indexRebuilt = true;
  } catch (e) {
    console.error("[cron/cleanup] 索引重建失败：", e);
  }

  return NextResponse.json({
    ok: r1.ok && r2.ok,
    scanned: r1.scanned + r2.scanned,
    deletedDirs: r1.deletedDirs + r2.deletedDirs,
    deletedFiles: r1.deletedFiles + r2.deletedFiles,
    failed: r1.failed + r2.failed,
    indexRebuilt,
  });
}

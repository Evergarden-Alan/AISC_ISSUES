import pLimit from "p-limit";
import {
  GitHubApiError,
  decodeBase64Utf8,
  githubDeleteFile,
  githubGetFile,
  githubGetFileBytesRetry,
  githubGetFileMeta,
  githubListDir,
  githubListIssueFolders,
  githubPutFileBytes,
  sleep,
  withConflictRetry,
} from "./github-client.ts";
import { parseFeedback, renderFeedbackMarkdown } from "./markdown-utils.ts";
import { buildIndexMd, type IndexEntry } from "./index-md.ts";
import { makeFolderId, randomSuffix } from "./id.ts";
import {
  FEATURE_MD_NAME,
  INDEX_PATH,
  ISSUE_MD_NAME,
  itemDirPath,
  itemMdCandidates,
} from "./constants.ts";
import { deriveCategory } from "../types/feedback.ts";
import type { PendingRef } from "./validate.ts";
import type { ValidatedFeedback } from "../types/feedback.ts";

// 编排层（v0.1.2 布局）：issues/{日期-概述-提出者}/ 下 md + 附件同目录；
// 创建后全量重建仓库根 索引.md（反馈/需求两表）。

const RETRY_DELAYS_MS = [500, 1000, 2000]; // 指数退避（02 §5.2）

/** _pending 引用失效（已过期/被删）——路由层转 400 中文提示，携带 ref 供前端定向清理 */
export class StaleRefError extends Error {
  ref: string;
  constructor(ref: string) {
    super("stale pending ref");
    this.name = "StaleRefError";
    this.ref = ref;
  }
}

/** 单个 _pending 附件归位：GET 原始字节 → PUT 条目目录 → DELETE 暂存 */
async function relocateOne(
  ref: string,
  prefix: "s" | "a",
  index: number,
  folder: string
): Promise<void> {
  const base = ref.split("/").pop() ?? "file";
  const pendingPath = `issues/${ref}`; // ref 以 _pending/ 开头 → issues/_pending/…
  const finalPath = `${itemDirPath(folder)}/${prefix}${index}-${base}`;

  // raw 读取（>1MB 文件 JSON 读不返回 content）；带重试应对写后读短暂 404
  const bytes = await githubGetFileBytesRetry(pendingPath, { attempts: 4, delayMs: 800 });
  if (!bytes) throw new StaleRefError(ref);
  await githubPutFileBytes(finalPath, bytes, `asset: ${finalPath}`);
  // DELETE 需要 sha：object 方式取元数据（>1MB 也拿得到）；失败留孤儿（cron 清理兜底）
  try {
    const meta = await githubGetFileMeta(pendingPath);
    if (meta?.sha) {
      await githubDeleteFile(pendingPath, meta.sha, `asset: 归位 ${base}`);
    }
  } catch {
    // 忽略
  }
}

/** 全部附件归位；任一失败则整体抛错（不写入 md） */
async function relocateAssets(
  refs: PendingRef[],
  kind: "s" | "a",
  folder: string
): Promise<void> {
  const limit = pLimit(3);
  await Promise.all(
    refs.map((r, i) => limit(() => relocateOne(r.ref, kind, i + 1, folder)))
  );
}

/** 目录名占用探测：反馈.md / 需求.md 任一存在即视为已占用 */
async function folderTaken(folder: string): Promise<boolean> {
  for (const p of itemMdCandidates(folder)) {
    if (await githubGetFileMeta(p)) return true;
  }
  return false;
}

/**
 * 仓库根 索引.md 全量重建（无缓存读，刚写入的条目立即可见）。
 * 失败由调用方兜底（提交流程不因此失败；每日 cron 也会重建）。
 */
export async function regenerateIndex(): Promise<void> {
  let folders: string[];
  try {
    folders = await githubListIssueFolders();
  } catch {
    const entries = await githubListDir("issues");
    folders = (entries ?? [])
      .filter((x) => x.type === "dir" && x.name !== "_pending")
      .map((x) => x.name);
  }

  const limit = pLimit(8);
  const entries = (
    await Promise.all(
      folders.map((folder) =>
        limit(async (): Promise<IndexEntry | null> => {
          for (const path of itemMdCandidates(folder)) {
            // 写后读可能短暂 404：靠调用方时序 + 下次重建兜底，这里单次探测即可
            const f = await githubGetFile(path);
            if (!f?.content) continue;
            const parsed = parseFeedback(decodeBase64Utf8(f.content));
            if (!parsed) break;
            return {
              category: deriveCategory(parsed.fm.type),
              title: parsed.fm.title,
              status: parsed.fm.status,
              createdAt: parsed.fm.created_at,
            };
          }
          return null;
        })
      )
    )
  ).filter((x): x is IndexEntry => x !== null);

  const md = buildIndexMd(entries);
  await withConflictRetry(async () => {
    const meta = await githubGetFileMeta(INDEX_PATH);
    await githubPutFileBytes(
      INDEX_PATH,
      Buffer.from(md, "utf-8"),
      "index: 重建反馈索引",
      meta?.sha
    );
  });
}

/**
 * 创建一条反馈，返回其目录名（即 id）。
 * 顺序：解析目录名（冲突追加 -2/-9/随机段）→ 附件归位 → 写 md → 重建索引。
 */
export async function createFeedback(input: ValidatedFeedback): Promise<string> {
  const nowMs = Date.now();
  const base = makeFolderId(input.title, input.nickname ?? "", nowMs);
  const mdName = input.category === "feature" ? FEATURE_MD_NAME : ISSUE_MD_NAME;

  for (let attempt = 0; ; attempt++) {
    const folder = attempt === 0 ? base : `${base}-${randomSuffix()}`;
    try {
      // 预检：目录未被占用
      if (await folderTaken(folder)) throw new GitHubApiError(422);

      // 附件归位（先归位、后写 md；任一失败整体失败）
      if (input.screenshots?.length) {
        await relocateAssets(input.screenshots, "s", folder);
      }
      if (input.attachments?.length) {
        await relocateAssets(input.attachments, "a", folder);
      }

      const md = renderFeedbackMarkdown(input, folder, nowMs);
      await githubPutFileBytes(
        `${itemDirPath(folder)}/${mdName}`,
        Buffer.from(md, "utf-8"),
        `feedback: ${folder} (${input.category}/${input.type})`
      );

      // 索引重建：尽力而为，失败不影响本次提交（每日 cron 兜底重建）
      try {
        await regenerateIndex();
      } catch (e) {
        console.error("[feedback] 索引重建失败（不影响提交）:", e);
      }
      return folder;
    } catch (e) {
      const status = e instanceof GitHubApiError ? e.status : 0;
      const conflict = status === 409 || status === 422;
      if (conflict && attempt < RETRY_DELAYS_MS.length) {
        await sleep(RETRY_DELAYS_MS[attempt]);
        continue;
      }
      throw e;
    }
  }
}

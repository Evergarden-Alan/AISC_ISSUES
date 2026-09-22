import pLimit from "p-limit";
import {
  GitHubApiError,
  githubDeleteFile,
  githubGetFile,
  githubGetFileBytesRetry,
  githubGetFileMeta,
  githubPutFile,
  githubPutFileBytes,
  sleep,
} from "./github-client.ts";
import { renderFeedbackMarkdown } from "./markdown-utils.ts";
import { assetsPath, feedbackPath } from "./constants.ts";
import { makeId } from "./id.ts";
import type { PendingRef } from "./validate.ts";
import type { ValidatedFeedback } from "../types/feedback.ts";

// 编排层（03 §4）：预检 → 附件归位 → 渲染 md → PUT 创建 → 409/422 换随机串重试 ≤3 次

const RETRY_DELAYS_MS = [500, 1000, 2000]; // 指数退避（02 §5.2）

/** _pending 引用失效（已过期/被删）——路由层转 400 中文提示 */
export class StaleRefError extends Error {
  constructor() {
    super("stale pending ref");
    this.name = "StaleRefError";
  }
}

/** 单个 _pending 附件归位：GET 原始字节 → PUT assets/{id}/ → DELETE _pending */
async function relocateOne(
  ref: string,
  prefix: "s" | "a",
  index: number,
  id: string
): Promise<void> {
  const base = ref.split("/").pop() ?? "file";
  const pendingPath = `feedback/assets/${ref}`; // _pending 路径保持字面量（v0.1.1 收口约定）
  const finalPath = `${assetsPath(id)}/${prefix}${index}-${base}`;

  // raw 读取（>1MB 文件 JSON 读不返回 content）；带重试应对写后读短暂 404
  const bytes = await githubGetFileBytesRetry(pendingPath, { attempts: 4, delayMs: 800 });
  if (!bytes) throw new StaleRefError();
  await githubPutFileBytes(finalPath, bytes, `asset: ${finalPath}`);
  // DELETE 需要 sha：object 方式取元数据（>1MB 也拿得到）；失败留孤儿（v1 不清理，02 §7.2）
  try {
    const meta = await githubGetFileMeta(pendingPath);
    if (meta?.sha) {
      await githubDeleteFile(pendingPath, meta.sha, `asset: 归位 ${base}`);
    }
  } catch {
    // 忽略
  }
}

/** 全部附件归位；任一失败则整体抛错（不写入 md，02 §7.2） */
async function relocateAssets(
  refs: PendingRef[],
  kind: "s" | "a",
  id: string
): Promise<void> {
  const limit = pLimit(3);
  await Promise.all(
    refs.map((r, i) => limit(() => relocateOne(r.ref, kind, i + 1, id)))
  );
}

/**
 * 创建一条反馈，返回其 id。
 * 顺序（02 §7.2）：预检 id 未占用 → 附件归位（截图 s{n} / 日志 a{n}）→ 写 md；
 * 随机串冲突时仅重掷 6 位随机段，时间戳与 created_at 保持首次值（02 §5.2）。
 */
export async function createFeedback(input: ValidatedFeedback): Promise<string> {
  const nowMs = Date.now();

  for (let attempt = 0; ; attempt++) {
    const id = makeId(nowMs);
    try {
      // 预检：新建必须 404（02 §5.2 预检层）
      const existing = await githubGetFile(feedbackPath(id));
      if (existing) throw new GitHubApiError(422);

      // 附件归位（先归位、后写 md；任一失败整体失败）
      if (input.screenshots?.length) {
        await relocateAssets(input.screenshots, "s", id);
      }
      if (input.attachments?.length) {
        await relocateAssets(input.attachments, "a", id);
      }

      const md = renderFeedbackMarkdown(input, id, nowMs);
      await githubPutFile(
        feedbackPath(id),
        md,
        `feedback: ${id} (${input.category}/${input.type})`
      );
      return id;
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

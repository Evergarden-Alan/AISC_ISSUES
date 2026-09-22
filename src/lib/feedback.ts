import { GitHubApiError, githubPutFile, sleep } from "./github-client.ts";
import { renderFeedbackMarkdown } from "./markdown-utils.ts";
import { makeId } from "./id.ts";
import type { ValidatedFeedback } from "../types/feedback.ts";

// 编排层（03 §4）：生成 id → 渲染 md → PUT 创建 → 409/422 换随机串重试 ≤3 次

const RETRY_DELAYS_MS = [500, 1000, 2000]; // 指数退避（02 §5.2）

/**
 * 创建一条反馈，返回其 id。
 * 随机串冲突时仅重掷 6 位随机段，时间戳与 created_at 保持首次值（02 §5.2）。
 */
export async function createFeedback(input: ValidatedFeedback): Promise<string> {
  const nowMs = Date.now();

  for (let attempt = 0; ; attempt++) {
    const id = makeId(nowMs);
    const md = renderFeedbackMarkdown(input, id, nowMs);
    try {
      await githubPutFile(
        `feedback/${id}.md`,
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

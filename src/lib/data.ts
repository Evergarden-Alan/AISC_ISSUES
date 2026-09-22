import pLimit from "p-limit";
import {
  decodeBase64Utf8,
  getConfig,
  githubGetFile,
  githubListDir,
} from "./github-client.ts";
import {
  compareByUpdatedAt,
  extractLatestReply,
  extractReplyRounds,
  parseFeedback,
  splitSections,
} from "./markdown-utils.ts";
import { deriveCategory } from "../types/feedback.ts";
import type { FeedbackFrontmatter } from "../types/feedback.ts";
import type { ReplyItem } from "../types/feedback.ts";

// 服务端读层（03 §5）：Server Component 专用，ISR revalidate=300。
// 禁止构建期拉取、禁止浏览器直连 GitHub——全部收敛在这里。

const REVALIDATE_SECONDS = 300;
const REPLY_TAB_SIZE = 10; // 每个 Tab 最多 10 条（01 §3.3）

export interface ReplyTabData {
  issue: ReplyItem[];
  feature: ReplyItem[];
}

/**
 * 回信区双 Tab 数据：各自收录「有开发者实际回复」的条目，updated_at 倒序。
 * 环境变量缺失（本地未配置 .env.local）时静默降级为空列表，首页可正常渲染。
 */
export async function getRepliedIssues(): Promise<ReplyTabData> {
  try {
    const items = await listFeedbackSummaries();
    const replied = items
      .filter((it) => it.excerpt)
      .sort(compareByUpdatedAt);
    return {
      issue: replied.filter((it) => it.category === "issue").slice(0, REPLY_TAB_SIZE),
      feature: replied
        .filter((it) => it.category === "feature")
        .slice(0, REPLY_TAB_SIZE),
    };
  } catch (e) {
    console.error("[data] 读取反馈列表失败：", e);
    return { issue: [], feature: [] };
  }
}

interface Summary extends ReplyItem {
  archived: boolean;
  hidden: boolean;
}

async function listFeedbackSummaries(): Promise<Summary[]> {
  getConfig(); // 校验环境变量；实际鉴权在 github-client 内部

  const entries = await githubListDir("feedback", REVALIDATE_SECONDS);
  if (!entries) return [];
  const files = entries
    .filter((e) => e.type === "file" && e.name.endsWith(".md"))
    .map((e) => `feedback/${e.name}`);

  const limit = pLimit(8); // 并发控制防限流（认证配额 5000/h）
  const results = await Promise.all(
    files.map((path) =>
      limit(async (): Promise<Summary | null> => {
        const file = await githubGetFile(path, REVALIDATE_SECONDS);
        if (!file?.content) return null;
        const parsed = parseFeedback(decodeBase64Utf8(file.content));
        if (!parsed) return null;
        const { fm, body } = parsed;
        const hidden = fm.status === "hidden";
        const archived = fm.archived === true;
        if (hidden || archived) return null;
        const { hasReply, excerpt } = extractLatestReply(body);
        return {
          id: fm.id,
          title: fm.title,
          type: fm.type,
          status: fm.status,
          category: deriveCategory(fm.type),
          excerpt: hasReply ? excerpt : "",
          updatedAt: fm.updated_at,
          archived,
          hidden,
        };
      })
    )
  );
  return results.filter((r): r is Summary => r !== null);
}

// ===== 详情页读取（/issue/{id}，M2）=====

export type IssueDetailResult =
  | { kind: "ok"; detail: IssueDetail }
  | { kind: "hidden" }
  | null; // null = 不存在

export interface IssueDetail {
  fm: FeedbackFrontmatter;
  /** 正文分区（保持模板顺序；「开发者回复」分区除外，回信走 replies） */
  sections: { title: string; text: string }[];
  /** 开发者回复轮次（正序） */
  replies: { time: string; text: string }[];
  category: "issue" | "feature";
}

export async function getIssue(id: string): Promise<IssueDetailResult> {
  try {
    const file = await githubGetFile(`feedback/${id}.md`, REVALIDATE_SECONDS);
    if (!file?.content) return null;
    const parsed = parseFeedback(decodeBase64Utf8(file.content));
    if (!parsed) return null;
    if (parsed.fm.status === "hidden") return { kind: "hidden" };
    const sections = splitSections(parsed.body).filter(
      (s) => s.title !== "开发者回复"
    );
    return {
      kind: "ok",
      detail: {
        fm: parsed.fm,
        sections,
        replies: extractReplyRounds(parsed.body),
        category: deriveCategory(parsed.fm.type),
      },
    };
  } catch (e) {
    console.error("[data] 读取反馈详情失败：", e);
    return null;
  }
}

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
import { type StatusValue, type TypeValue } from "../lib/constants.ts";
import { deriveCategory, type Category, type FeedbackFrontmatter, type ReplyItem } from "../types/feedback.ts";

// 服务端读层（03 §5）：Server Component / 管理路由专用，ISR revalidate=300。
// 禁止构建期拉取、禁止浏览器直连 GitHub——全部收敛在这里。

const REVALIDATE_SECONDS = 300;
const REPLY_TAB_SIZE = 10; // 每个 Tab 最多 10 条（01 §3.3）

export interface ReplyTabData {
  issue: ReplyItem[];
  feature: ReplyItem[];
}

/** 首页轻统计（01 待确认④ 已拍板口径：三个聚合数字） */
export interface HomeStats {
  total: number; // 累计反馈数（不含 hidden/archived）
  resolved: number; // 已解决数
  avgFirstResponseDays: number | null; // 平均首次回应时长（天，1 位小数）；无回复数据为 null
}

export interface HomeData extends ReplyTabData {
  stats: HomeStats;
}

export interface ListItem {
  id: string;
  title: string;
  type: TypeValue;
  status: StatusValue;
  category: Category;
  createdAt: string;
  updatedAt: string;
  excerpt: string;
}

interface SummaryItem extends ListItem {
  hidden: boolean;
  archived: boolean;
  firstReplyAt: string | null; // 首轮回复时刻 "2026-09-19 16:40"
}

/** "2026-09-19 16:40" → 可比较的 ISO（+08:00） */
function minuteToIso(minute: string): string {
  return `${minute.replace(" ", "T")}:00+08:00`;
}

async function fetchSummaries(includeHidden: boolean): Promise<SummaryItem[]> {
  getConfig(); // 校验环境变量；实际鉴权在 github-client 内部

  const entries = await githubListDir("feedback", REVALIDATE_SECONDS);
  if (!entries) return [];
  const files = entries
    .filter((e) => e.type === "file" && e.name.endsWith(".md"))
    .map((e) => `feedback/${e.name}`);

  const limit = pLimit(8); // 并发控制防限流（认证配额 5000/h）
  const results = await Promise.all(
    files.map((path) =>
      limit(async (): Promise<SummaryItem | null> => {
        const file = await githubGetFile(path, REVALIDATE_SECONDS);
        if (!file?.content) return null;
        const parsed = parseFeedback(decodeBase64Utf8(file.content));
        if (!parsed) return null;
        const { fm, body } = parsed;
        const hidden = fm.status === "hidden";
        const archived = fm.archived === true;
        if (hidden && !includeHidden) return null;
        if (archived) return null;
        const { hasReply, excerpt } = extractLatestReply(body);
        const rounds = extractReplyRounds(body);
        return {
          id: fm.id,
          title: fm.title,
          type: fm.type,
          status: fm.status,
          category: deriveCategory(fm.type),
          createdAt: fm.created_at,
          updatedAt: fm.updated_at,
          excerpt: hasReply ? excerpt : "",
          hidden,
          archived,
          firstReplyAt: rounds.length > 0 ? rounds[0].time : null,
        };
      })
    )
  );
  return results.filter((r): r is SummaryItem => r !== null);
}

/**
 * 首页数据（回信区双 Tab + 轻统计）：一次拉取全量派生，避免重复请求 GitHub。
 * 双 Tab 各自收录「有开发者实际回复」的条目，updated_at 倒序（02 §2.1）。
 * 环境变量缺失（本地未配置 .env.local）时静默降级为空。
 */
export async function getHomeData(): Promise<HomeData> {
  try {
    const all = await fetchSummaries(false);
    const replied = all
      .filter((it) => it.excerpt)
      .sort(compareByUpdatedAt);

    const responded = all.filter((it) => it.firstReplyAt);
    const avgDays =
      responded.length === 0
        ? null
        : responded.reduce(
            (sum, it) =>
              sum +
              (Date.parse(minuteToIso(it.firstReplyAt!)) -
                Date.parse(it.createdAt)),
            0
          ) /
          responded.length /
          86_400_000;

    return {
      issue: replied
        .filter((it) => it.category === "issue")
        .slice(0, REPLY_TAB_SIZE),
      feature: replied
        .filter((it) => it.category === "feature")
        .slice(0, REPLY_TAB_SIZE),
      stats: {
        total: all.length,
        resolved: all.filter((it) => it.status === "resolved").length,
        avgFirstResponseDays:
          avgDays === null ? null : Math.round(avgDays * 10) / 10,
      },
    };
  } catch (e) {
    console.error("[data] 读取首页数据失败：", e);
    return {
      issue: [],
      feature: [],
      stats: { total: 0, resolved: 0, avgFirstResponseDays: null },
    };
  }
}

/** 「查看全部」列表页数据：全部非 hidden、非 archived 条目，updated_at 倒序 */
export async function getIssuesForList(): Promise<ListItem[]> {
  try {
    const all = await fetchSummaries(false);
    return all
      .sort(compareByUpdatedAt)
      .map(({ hidden: _h, archived: _a, firstReplyAt: _f, ...item }) => item);
  } catch (e) {
    console.error("[data] 读取列表失败：", e);
    return [];
  }
}

/** 管理页数据：含 hidden（垃圾治理需要可见才能恢复）；仅管理路由调用（有 cookie 门禁） */
export async function getAdminList(): Promise<ListItem[]> {
  try {
    const all = await fetchSummaries(true);
    return all.sort(compareByUpdatedAt);
  } catch (e) {
    console.error("[data] 读取管理列表失败：", e);
    return [];
  }
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

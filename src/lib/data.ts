import pLimit from "p-limit";
import {
  decodeBase64Utf8,
  getConfig,
  githubGetFile,
  githubListDir,
  githubListIssueFolders,
} from "./github-client.ts";
import {
  affectsOf,
  compareByUpdatedAt,
  extractReplyRounds,
  parseFeedback,
  splitSections,
} from "./markdown-utils.ts";
import {
  itemMdCandidates,
  type StatusValue,
  type TypeValue,
} from "../lib/constants.ts";
import {
  deriveCategory,
  type Category,
  type FeedbackFrontmatter,
} from "../types/feedback.ts";

// 服务端读层：Server Component 专用，ISR revalidate=300（v0.1.2 布局：issues/{目录}/md+附件）。
// 禁止构建期拉取、禁止浏览器直连 GitHub——全部收敛在这里。
// v0.1.2：不再按 hidden 过滤（管理页已移除，status 仅作展示）。

const REVALIDATE_SECONDS = 300;

export interface HomeStats {
  total: number; // 累计反馈数（不含 archived）
  resolved: number; // 已解决数
  avgFirstResponseDays: number | null; // 平均首次回应时长（天，1 位小数）；无回复数据为 null
}

export interface HomeData {
  items: ListItem[]; // 全部条目，updated_at 倒序（首页直接全量展示）
  stats: HomeStats;
}

export interface ListItem {
  id: string; // 目录名（20260922-概述-提出者）
  title: string;
  type: TypeValue;
  status: StatusValue;
  category: Category;
  createdAt: string;
  updatedAt: string;
  affects: number;
}

interface SummaryItem extends ListItem {
  firstReplyAt: string | null; // 首轮回复时刻 "2026-09-19 16:40"
}

/** "2026-09-19 16:40" → 可比较的 ISO（+08:00） */
function minuteToIso(minute: string): string {
  return `${minute.replace(" ", "T")}:00+08:00`;
}

/** 读取单个条目 md（反馈.md / 需求.md 依次探测）；404 返回 null */
async function readItemMd(
  id: string,
  revalidate?: number
): Promise<{ path: string; content: string } | null> {
  for (const path of itemMdCandidates(id)) {
    const f = await githubGetFile(path, revalidate);
    if (f?.content) return { path, content: decodeBase64Utf8(f.content) };
  }
  return null;
}

/**
 * 全量枚举（v0.1.2）：Trees API 两步取 issues/ 子树 md 路径（解除约 1000 条截断），
 * 失败回退 Contents 列目录（取目录名）；随后逐目录读 md 解析，p-limit(8)。
 */
export async function fetchSummaries(): Promise<SummaryItem[]> {
  getConfig();

  let folders: string[];
  try {
    folders = await githubListIssueFolders(REVALIDATE_SECONDS);
  } catch (e) {
    console.error(
      "[data] Trees API 读取失败，回退 Contents 列目录：",
      e instanceof Error ? e.message : e
    );
    const entries = await githubListDir("issues", REVALIDATE_SECONDS);
    folders = (entries ?? [])
      .filter((x) => x.type === "dir" && x.name !== "_pending")
      .map((x) => x.name);
  }

  const limit = pLimit(8);
  const results = await Promise.all(
    folders.map((folder) =>
      limit(async (): Promise<SummaryItem | null> => {
        const md = await readItemMd(folder, REVALIDATE_SECONDS);
        if (!md) return null;
        const parsed = parseFeedback(md.content);
        if (!parsed) return null;
        const { fm, body } = parsed;
        const rounds = extractReplyRounds(body);
        return {
          id: folder, // 目录名即 id（URL 与仓库路径的同一事实来源）
          title: fm.title,
          type: fm.type,
          status: fm.status,
          category: deriveCategory(fm.type),
          createdAt: fm.created_at,
          updatedAt: fm.updated_at,
          affects: affectsOf(fm),
          firstReplyAt: rounds.length > 0 ? rounds[0].time : null,
        };
      })
    )
  );
  return results.filter((r): r is SummaryItem => r !== null);
}

/**
 * 首页数据：全部条目（updated_at 倒序）+ 轻统计三数字。
 * 环境变量缺失（本地未配置 .env.local）时静默降级为空。
 */
export async function getHomeData(): Promise<HomeData> {
  try {
    const all = await fetchSummaries();
    const items: ListItem[] = all
      .sort(compareByUpdatedAt)
      .map(({ firstReplyAt: _f, ...item }) => item);

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
      items,
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
      items: [],
      stats: { total: 0, resolved: 0, avgFirstResponseDays: null },
    };
  }
}

// ===== 详情页读取（/issue/{目录名}）=====

export type IssueDetailResult = { kind: "ok"; detail: IssueDetail } | null; // null = 不存在

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
    const md = await readItemMd(id, REVALIDATE_SECONDS);
    if (!md) return null;
    const parsed = parseFeedback(md.content);
    if (!parsed) return null;
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

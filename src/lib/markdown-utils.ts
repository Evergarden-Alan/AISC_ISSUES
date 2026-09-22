import matter from "gray-matter";
import { JSON_SCHEMA, load as yamlLoad } from "js-yaml";
import {
  NO_REPLY_PLACEHOLDER,
  NONE_PLACEHOLDER,
  NOT_PROVIDED_PLACEHOLDER,
  PRODUCT_ID,
} from "./constants.ts";
import { beijingClock, beijingIso } from "./beijing-time.ts";
import type {
  FeedbackFrontmatter,
  ValidatedFeedback,
} from "../types/feedback.ts";

// 纯函数层：frontmatter 解析 / 正文模板渲染 / 回信摘要（02 §1、§3）

/** js-yaml JSON_SCHEMA：ISO 时间保持字符串、`no` 不被解析为 false（02 §1） */
export const MATTER_OPTS = {
  engines: {
    yaml: {
      parse: (s: string) => yamlLoad(s, { schema: JSON_SCHEMA }) as Record<string, unknown>,
      stringify: (o: object) =>
        JSON.stringify(o), // 本项目只用 parse；stringify 不走 gray-matter
    },
  },
} as const;

/** 解析反馈 md；数据不合法返回 null（读取面对脏数据容错） */
export function parseFeedback(raw: string): {
  fm: FeedbackFrontmatter;
  body: string;
} | null {
  try {
    const { data, content } = matter(raw, MATTER_OPTS);
    if (
      typeof data.id !== "string" ||
      typeof data.title !== "string" ||
      typeof data.type !== "string" ||
      typeof data.status !== "string" ||
      typeof data.created_at !== "string" ||
      typeof data.updated_at !== "string"
    ) {
      return null;
    }
    return {
      fm: data as unknown as FeedbackFrontmatter,
      body: content,
    };
  } catch {
    return null;
  }
}

/** 用户自由文本清洗：剥控制字符（保留换行）+ 行首 # 标题转义（02 §3.3） */
export function cleanUserText(s: string): string {
  return s
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
    .split("\n")
    .map((line) => line.replace(/^(#{1,6} )/, "\\$1"))
    .join("\n")
    .trim();
}

/** frontmatter 单行值清洗：剥离引号/反斜杠/换行 */
function yamlSafe(s: string): string {
  return s.replace(/["\\\r\n]/g, "");
}

export interface RenderInput extends ValidatedFeedback {
  envTime?: number; // 提交时刻（默认 Date.now()）；测试注入用
}

/** 服务端生成整份 feedback/{id}.md（02 §3 两套模板，分区顺序固定） */
export function renderFeedbackMarkdown(
  input: RenderInput,
  id: string,
  nowMs: number = input.envTime ?? Date.now()
): string {
  const fm: string[] = [
    "---",
    `id: "${id}"`,
    `product: "${PRODUCT_ID}"`,
    `title: "${yamlSafe(input.title)}"`,
    `type: "${input.type}"`,
    `severity: "${input.severity}"`,
    'status: "submitted"',
    'tier: "basic"', // v0.1.0（M1）无附件恒 basic；M2 起按附件推导
    `created_at: "${beijingIso(nowMs)}"`,
    `updated_at: "${beijingIso(nowMs)}"`,
  ];
  if (input.nickname) fm.push(`nickname: "${yamlSafe(input.nickname)}"`);
  fm.push("archived: false", "---");

  const section = (title: string, content: string) =>
    `## ${title}\n\n${content || NOT_PROVIDED_PLACEHOLDER}`;
  const envIssue = [
    `- 浏览器 UA：${input.env.ua ?? "未知"}`,
    `- 操作系统：${input.env.platform ?? "未知"}`,
    `- 页面地址：${input.env.url ?? "未知"}`,
    `- 提交时间：${beijingClock(nowMs)}（北京时间）`,
  ].join("\n");
  const envFeature = [
    `- 浏览器 UA：${input.env.ua ?? "未知"}`,
    `- 提交时间：${beijingClock(nowMs)}（北京时间）`,
  ].join("\n");

  const parts: string[] = [];
  if (input.category === "issue") {
    parts.push(section("问题描述", cleanUserText(input.description)));
    if (input.type === "bug") {
      parts.push(section("复现步骤", cleanUserText(input.steps ?? "")));
    }
    parts.push(section("期望结果", cleanUserText(input.expected ?? "")));
    parts.push(section("实际结果", cleanUserText(input.actual ?? "")));
    parts.push(section("环境信息", envIssue));
    parts.push(section("截图", NONE_PLACEHOLDER));
    parts.push(section("附件", NONE_PLACEHOLDER));
  } else {
    parts.push(section("想要的功能", cleanUserText(input.description)));
    parts.push(section("想解决的问题", NOT_PROVIDED_PLACEHOLDER));
    parts.push(section("使用场景", cleanUserText(input.scenario ?? "")));
    parts.push(
      section("现状的替代办法", cleanUserText(input.workaround ?? ""))
    );
    parts.push(section("环境信息", envFeature));
    parts.push(section("截图", NONE_PLACEHOLDER));
  }
  parts.push(`## 开发者回复\n\n${NO_REPLY_PLACEHOLDER}`);

  return `${fm.join("\n")}\n\n${parts.join("\n\n")}\n`;
}

/** 剥 markdown 符号，取纯文本摘要 */
function stripMarkdown(s: string): string {
  return s
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`~|-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** 取「## 开发者回复」最新一轮（最后一个 ### 小节）→ ≈100 字摘要 */
export function extractLatestReply(
  body: string,
  maxLen = 100
): { hasReply: boolean; excerpt: string } {
  const m = body.match(/^## 开发者回复\s*$/m);
  if (!m || m.index === undefined) return { hasReply: false, excerpt: "" };
  const rest = body.slice(m.index + m[0].length);
  const nextH2 = rest.search(/^## /m);
  const section = (nextH2 === -1 ? rest : rest.slice(0, nextH2)).trim();
  if (!section || section === NO_REPLY_PLACEHOLDER) {
    return { hasReply: false, excerpt: "" };
  }
  const rounds = [...section.matchAll(/^### (.+)$/gm)];
  if (rounds.length === 0) {
    // 无标准轮次标题但有内容：整节作一轮
    return { hasReply: true, excerpt: truncate(stripMarkdown(section), maxLen) };
  }
  const lastStart = rounds[rounds.length - 1].index ?? 0;
  const lastRound = section.slice(lastStart).replace(/^### .+$/m, "");
  return { hasReply: true, excerpt: truncate(stripMarkdown(lastRound), maxLen) };
}

function truncate(s: string, maxLen: number): string {
  return s.length > maxLen ? `${s.slice(0, maxLen)}…` : s;
}

/** 列表排序键：updatedAt 为 ISO +08:00 同格式字符串，字典序即时间序，倒序 */
export function compareByUpdatedAt<T extends { updatedAt: string }>(
  a: T,
  b: T
): number {
  return b.updatedAt.localeCompare(a.updatedAt);
}

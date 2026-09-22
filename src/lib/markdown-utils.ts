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

/**
 * 修改 frontmatter 的单个引号字符串字段（管理页改 status/updated_at 用）。
 * 仅在 frontmatter 区块内做整行替换；字段不存在则原样返回（不新增）。
 */
export function setFrontmatterField(
  raw: string,
  field: string,
  value: string
): string {
  if (!raw.startsWith("---")) return raw;
  const end = raw.indexOf("\n---", 3);
  if (end === -1) return raw;
  const head = raw.slice(0, end);
  const re = new RegExp(`^(${field}: )"[^"]*"$`, "m");
  if (!re.test(head)) return raw;
  return head.replace(re, `$1"${yamlSafe(value)}"`) + raw.slice(end);
}

/**
 * 在「## 开发者回复」下追加一轮回复（管理页回信用）。
 * 首轮自动移除"（暂无）"占位；正文做 # 标题转义防伪造。
 */
export function appendDeveloperReply(
  raw: string,
  time: string,
  text: string
): string {
  const m = raw.match(/^## 开发者回复\s*$/m);
  if (!m || m.index === undefined) return raw;
  const start = m.index + m[0].length;
  const rest = raw.slice(start);
  const nextH2 = rest.search(/^## /m);
  const insertAt = nextH2 === -1 ? raw.length : start + nextH2;

  let before = raw.slice(0, insertAt);
  before = before.replace(/（暂无）\s*$/, "").replace(/\s+$/, "\n");
  const after = raw.slice(insertAt).trimStart();
  const clean = cleanUserText(text);
  return `${before}\n### ${time} 开发者\n\n${clean}\n${after ? `\n${after}` : ""}`;
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
    `tier: "${
      input.category === "issue" && input.attachments?.length ? "detailed" : "basic"
    }"`, // 问题路径含日志附件 ⇒ detailed（02 §1）；功能路径恒 basic
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
    parts.push(section("截图", renderScreenshotLines(id, input.screenshots)));
    parts.push(section("附件", renderAttachmentLines(id, input.attachments)));
  } else {
    parts.push(section("想要的功能", cleanUserText(input.description)));
    parts.push(section("想解决的问题", NOT_PROVIDED_PLACEHOLDER));
    parts.push(section("使用场景", cleanUserText(input.scenario ?? "")));
    parts.push(
      section("现状的替代办法", cleanUserText(input.workaround ?? ""))
    );
    parts.push(section("环境信息", envFeature));
    parts.push(section("截图", renderScreenshotLines(id, input.screenshots)));
  }
  parts.push(`## 开发者回复\n\n${NO_REPLY_PLACEHOLDER}`);

  return `${fm.join("\n")}\n\n${parts.join("\n\n")}\n`;
}

/** 引用 ref 的第三段 = 已安全化的文件名（服务端归位时同一来源） */
function basename(ref: string): string {
  return ref.split("/").pop() ?? "file";
}

/** 截图分区：![截图 n](feedback/assets/{id}/s{n}-{安全化原名})；无则"（无）" */
function renderScreenshotLines(
  id: string,
  shots?: { ref: string }[]
): string {
  if (!shots?.length) return NONE_PLACEHOLDER;
  return shots
    .map(
      (s, i) => `![截图 ${i + 1}](feedback/assets/${id}/s${i + 1}-${basename(s.ref)})`
    )
    .join("\n\n");
}

/** 附件分区：[文件名](feedback/assets/{id}/a{n}-{安全化原名})；无则"（无）" */
function renderAttachmentLines(
  id: string,
  files?: { ref: string }[]
): string {
  if (!files?.length) return NONE_PLACEHOLDER;
  return files
    .map(
      (f, i) =>
        `[${basename(f.ref)}](feedback/assets/${id}/a${i + 1}-${basename(f.ref)})`
    )
    .join("\n\n");
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

export interface BodySection {
  title: string;
  text: string;
}

/** 把正文按 "## 标题" 切成分区（保持原文顺序，详情页渲染用） */
export function splitSections(body: string): BodySection[] {
  const out: BodySection[] = [];
  const lines = body.split("\n");
  let cur: BodySection | null = null;
  const buf: string[] = [];
  const flush = () => {
    if (cur) out.push({ title: cur.title, text: buf.join("\n").trim() });
    buf.length = 0;
  };
  for (const line of lines) {
    const m = line.match(/^## (.+)$/);
    if (m) {
      flush();
      cur = { title: m[1].trim(), text: "" };
    } else if (cur) {
      buf.push(line);
    }
  }
  flush();
  return out;
}

export interface ReplyRound {
  time: string; // "2026-09-19 16:40"
  text: string;
}

/** 从「## 开发者回复」分区解析全部回复轮次（### 时间 开发者），按原文正序 */
export function extractReplyRounds(body: string): ReplyRound[] {
  const m = body.match(/^## 开发者回复\s*$/m);
  if (!m || m.index === undefined) return [];
  const rest = body.slice(m.index + m[0].length);
  const nextH2 = rest.search(/^## /m);
  const section = (nextH2 === -1 ? rest : rest.slice(0, nextH2)).trim();
  if (!section || section === NO_REPLY_PLACEHOLDER) return [];
  const parts = section.split(/^### /m).slice(1); // 首段是分区占位文本
  return parts
    .map((p) => {
      const nl = p.indexOf("\n");
      const heading = (nl === -1 ? p : p.slice(0, nl)).trim(); // "2026-09-19 16:40 开发者"
      const time = heading.replace(/\s*开发者\s*$/, "").trim();
      const text = (nl === -1 ? "" : p.slice(nl + 1)).trim();
      return { time, text };
    })
    .filter((r) => r.time && r.text);
}

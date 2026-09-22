// ===== 枚举与中文映射（单一事实来源）=====
// 规则：枚举值一律英文小写入库；用户可见文案一律简体中文（见 CLAUDE.md）。

/**
 * 产品注册表（v0.1.1 R3 参数化收口）：加第二款产品时在此扩容并做 UI 分流，
 * 仓库路径经 feedbackPath/assetsPath 收口，禁止散落硬编码。
 */
export const PRODUCT_IDS = ["aisc-issues"] as const;
export const CURRENT_PRODUCT = PRODUCT_IDS[0];

/** 反馈条目根目录（私有反馈仓库）：每条反馈一个子目录，md 与附件同目录 */
export const ISSUES_DIR = "issues";

/** 问题路径 md 文件名 / 功能路径 md 文件名（同目录） */
export const ISSUE_MD_NAME = "反馈.md";
export const FEATURE_MD_NAME = "需求.md";

/** 仓库根索引文件（反馈/需求两表，v0.1.2） */
export const INDEX_PATH = "索引.md";

/** 服务端上传暂存区（v0.1.2 起迁至 issues/_pending） */
export const PENDING_BASE = "issues/_pending";

/** 条目目录：issues/{目录名} */
export function itemDirPath(id: string): string {
  return `${ISSUES_DIR}/${id}`;
}

/** 条目 md 的两个候选路径（问题/功能文件名不同，依次探测） */
export function itemMdCandidates(id: string): string[] {
  return [`${itemDirPath(id)}/${ISSUE_MD_NAME}`, `${itemDirPath(id)}/${FEATURE_MD_NAME}`];
}

/** affects 投票计数的写入上限（防异常值，02-design §1.1） */
export const AFFECTS_MAX = 999_999;

export const TYPE_VALUES = ["bug", "feature", "ux", "question", "other"] as const;
export const ISSUE_TYPE_VALUES = ["bug", "ux", "question", "other"] as const; // 问题路径卡片（不含 feature）
export const SEVERITY_VALUES = ["blocker", "normal", "low"] as const;
export const STATUS_VALUES = [
  "submitted",
  "in-progress",
  "replied",
  "resolved",
  "wontfix",
  "duplicate",
  "hidden",
] as const;
export const TIER_VALUES = ["basic", "detailed"] as const;

export type TypeValue = (typeof TYPE_VALUES)[number];
export type IssueTypeValue = (typeof ISSUE_TYPE_VALUES)[number];
export type SeverityValue = (typeof SEVERITY_VALUES)[number];
export type StatusValue = (typeof STATUS_VALUES)[number];
export type TierValue = (typeof TIER_VALUES)[number];

/** 表单限制（服务端与前端共用同一张表） */
export const LIMITS = {
  title: 50,
  description: 2000,
  steps: 2000,
  expected: 1000,
  actual: 1000,
  scenario: 500,
  workaround: 500,
  nickname: 20,
  ua: 300,
  platform: 50,
  url: 500,
} as const;

/** type 中文文案 */
export const TYPE_LABELS: Record<TypeValue, string> = {
  bug: "程序出错或闪退",
  feature: "功能建议",
  ux: "用着别扭不顺手",
  question: "不会用有疑问",
  other: "其他",
};

/** 问题路径 4 类卡片副文案（01 §4.1） */
export const ISSUE_TYPE_SUBTEXT: Record<IssueTypeValue, string> = {
  bug: "崩溃、报错、功能坏了",
  ux: "能用，但别扭、看不懂",
  question: "不确定怎么用，想问一下",
  other: "以上都不是",
};

/** severity 中文文案（仅问题路径；功能路径服务端固定 normal 不展示） */
export const SEVERITY_LABELS: Record<SeverityValue, string> = {
  blocker: "完全没法用了",
  normal: "能用但别扭",
  low: "小问题",
};

/**
 * status 状态双映射：同一枚举两套文案，按 category 派生值选套（02 §2.1）。
 * category === "issue" 用 issue 列，category === "feature" 用 feature 列。
 */
export const STATUS_LABELS: Record<
  StatusValue,
  { issue: string; feature: string }
> = {
  submitted: { issue: "已收到", feature: "已收到" },
  "in-progress": { issue: "处理中", feature: "开发中" },
  replied: { issue: "已回复", feature: "已回复" },
  resolved: { issue: "已解决", feature: "已上线" },
  wontfix: { issue: "暂不处理", feature: "暂不计划" },
  duplicate: { issue: "重复", feature: "重复" },
  hidden: { issue: "已隐藏", feature: "已隐藏" },
};

/** 按路径取状态中文文案 */
export function statusLabel(
  status: StatusValue,
  category: "issue" | "feature"
): string {
  return STATUS_LABELS[status][category];
}

/** 条目目录名格式：{YYYYMMDD}-{概述}-{提出者}（v0.1.2；中文目录名） */
export const ID_PATTERN = /^\d{8}-[A-Za-z0-9一-龥._-]{1,120}$/;

/** 空态文案（v0.1.1 R4 基线演进：不含任何时限承诺） */
export const EMPTY_REPLY_TEXT = "还没有回复，过几天再来看看。";
export const NO_REPLY_DETAIL_TEXT = "开发者还没有回复，过几天再来看看。";
export const HIDDEN_TEXT = "该反馈已被隐藏，无法查看。";
export const NO_REPLY_PLACEHOLDER = "（暂无）";
export const NOT_PROVIDED_PLACEHOLDER = "（未提供）";
export const NONE_PLACEHOLDER = "（无）";

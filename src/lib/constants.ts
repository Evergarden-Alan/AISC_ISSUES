// ===== 枚举与中文映射（单一事实来源）=====
// 规则：枚举值一律英文小写入库；用户可见文案一律简体中文（见 CLAUDE.md）。

export const PRODUCT_ID = "aisc-issues" as const;

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

/** 空态与 SLA 文案（定稿，01 §3） */
export const SLA_TEXT = "我们通常在 3 个工作日内回复";
export const EMPTY_REPLY_TEXT = `${SLA_TEXT}。`;
export const NO_REPLY_DETAIL_TEXT = `开发者还没有回复。${SLA_TEXT}，请过几天再来看看。`;
export const HIDDEN_TEXT = "该反馈已被隐藏，无法查看。";
export const NO_REPLY_PLACEHOLDER = "（暂无）";
export const NOT_PROVIDED_PLACEHOLDER = "（未提供）";
export const NONE_PLACEHOLDER = "（无）";

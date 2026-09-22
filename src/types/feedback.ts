import type {
  SeverityValue,
  StatusValue,
  TierValue,
  TypeValue,
} from "../lib/constants.ts";

// 数据面类型（02 §1）。category 为派生值，不写入 frontmatter。

export type Category = "issue" | "feature";

export const deriveCategory = (type: TypeValue): Category =>
  type === "feature" ? "feature" : "issue";

export interface FeedbackFrontmatter {
  id: string; // 20260921-143025-a3f9kz
  product: "aisc-issues";
  title: string;
  type: TypeValue;
  severity: SeverityValue; // 功能路径恒为 "normal"
  status: StatusValue;
  tier: TierValue; // 功能路径恒为 "basic"
  created_at: string; // "2026-09-21T14:30:25+08:00"
  updated_at: string;
  nickname?: string; // 选填称呼 ≤20 字（v0.1.0 起 contact 已移除）
  duplicate_of?: string; // 仅 status = duplicate
  archived: boolean; // 恒为 false（v1）
}

/** 服务端校验后的提交输入（已按路径裁剪） */
export interface ValidatedFeedback {
  category: Category;
  type: TypeValue; // 问题路径 ∈ {bug,ux,question,other}；功能路径固定 feature
  severity: SeverityValue; // 功能路径由服务端覆写 "normal"
  title: string;
  description: string;
  steps?: string; // 仅问题路径且 type=bug 写入正文
  expected?: string;
  actual?: string;
  scenario?: string; // 仅功能路径
  workaround?: string; // 仅功能路径
  nickname?: string;
  screenshots?: { ref: string; originalName: string }[]; // _pending 引用，≤3
  attachments?: { ref: string; originalName: string }[]; // 仅问题路径，≤3；非空 ⇒ tier=detailed
  env: {
    ua?: string;
    platform?: string;
    url?: string;
  };
}

/** 回信区条目（首页双 Tab，02 §2.1 收录口径） */
export interface ReplyItem {
  id: string;
  title: string;
  type: TypeValue;
  status: StatusValue;
  category: Category;
  excerpt: string; // 最新一轮回复摘要 ≈100 字
  updatedAt: string; // updated_at 原值（ISO +08:00）
}

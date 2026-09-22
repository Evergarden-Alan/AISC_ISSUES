import { test } from "node:test";
import assert from "node:assert/strict";
import {
  STATUS_LABELS,
  TYPE_LABELS,
  SEVERITY_LABELS,
  statusLabel,
  CURRENT_PRODUCT,
  PRODUCT_IDS,
  ISSUES_DIR,
  INDEX_PATH,
  itemDirPath,
  itemMdCandidates,
  TYPE_VALUES,
  STATUS_VALUES,
  SEVERITY_VALUES,
  TIER_VALUES,
} from "../src/lib/constants.ts";

// 状态双映射（04 §6：constants 双映射表单测）

test("type 5 枚举与中文文案一一对应", () => {
  assert.deepEqual([...TYPE_VALUES].sort(), ["bug", "feature", "other", "question", "ux"]);
  assert.equal(TYPE_LABELS.bug, "程序出错或闪退");
  assert.equal(TYPE_LABELS.feature, "功能建议");
  assert.equal(TYPE_LABELS.ux, "用着别扭不顺手");
  assert.equal(TYPE_LABELS.question, "不会用有疑问");
  assert.equal(TYPE_LABELS.other, "其他");
});

test("status 双映射：问题路径文案", () => {
  assert.equal(statusLabel("submitted", "issue"), "已收到");
  assert.equal(statusLabel("in-progress", "issue"), "处理中");
  assert.equal(statusLabel("replied", "issue"), "已回复");
  assert.equal(statusLabel("resolved", "issue"), "已解决");
  assert.equal(statusLabel("wontfix", "issue"), "暂不处理");
  assert.equal(statusLabel("duplicate", "issue"), "重复");
  assert.equal(statusLabel("hidden", "issue"), "已隐藏");
});

test("status 双映射：功能路径文案（开发中/已上线/暂不计划）", () => {
  assert.equal(statusLabel("submitted", "feature"), "已收到");
  assert.equal(statusLabel("in-progress", "feature"), "开发中");
  assert.equal(statusLabel("replied", "feature"), "已回复");
  assert.equal(statusLabel("resolved", "feature"), "已上线");
  assert.equal(statusLabel("wontfix", "feature"), "暂不计划");
  assert.equal(statusLabel("duplicate", "feature"), "重复");
  assert.equal(statusLabel("hidden", "feature"), "已隐藏");
});

test("severity 三档中文文案", () => {
  assert.equal(SEVERITY_LABELS.blocker, "完全没法用了");
  assert.equal(SEVERITY_LABELS.normal, "能用但别扭");
  assert.equal(SEVERITY_LABELS.low, "小问题");
});

test("schema 常量完备：7 状态 × 双映射、3 严重度、2 档位", () => {
  assert.equal(STATUS_VALUES.length, 7);
  for (const s of STATUS_VALUES) {
    assert.ok(STATUS_LABELS[s].issue, `status ${s} 缺问题文案`);
    assert.ok(STATUS_LABELS[s].feature, `status ${s} 缺功能文案`);
  }
  assert.equal(SEVERITY_VALUES.length, 3);
  assert.equal(TIER_VALUES.length, 2);
  assert.deepEqual([...PRODUCT_IDS], ["aisc-issues"]);
  assert.equal(CURRENT_PRODUCT, "aisc-issues");
});

test("v0.1.2 路径收口：issues/{目录}/（md 与附件同目录）", () => {
  assert.equal(ISSUES_DIR, "issues");
  assert.equal(INDEX_PATH, "索引.md");
  assert.equal(itemDirPath("20260921-导出闪退-阿明"), "issues/20260921-导出闪退-阿明");
  assert.deepEqual(itemMdCandidates("20260921-导出闪退-阿明"), [
    "issues/20260921-导出闪退-阿明/反馈.md",
    "issues/20260921-导出闪退-阿明/需求.md",
  ]);
});

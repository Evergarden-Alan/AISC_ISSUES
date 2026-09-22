import { test } from "node:test";
import assert from "node:assert/strict";
import {
  renderFeedbackMarkdown,
  parseFeedback,
  extractLatestReply,
  extractReplyRounds,
  splitSections,
  cleanUserText,
  compareByUpdatedAt,
} from "../src/lib/markdown-utils.ts";

// markdown 模板渲染/解析/回信摘要（02 §3、§4；04 §6 映射行）

const FIXED_NOW = Date.UTC(2026, 8, 21, 6, 30, 25); // 北京 2026-09-21 14:30:25

const ISSUE_INPUT = {
  category: "issue",
  type: "bug",
  severity: "blocker",
  title: "导出报表时软件闪退",
  description: "点导出按钮就闪退",
  steps: "1. 打开报表页\n2. 点导出",
  expected: "导出成功",
  actual: "软件闪退",
  nickname: "阿明",
  env: { ua: "Mozilla/5.0 Test", platform: "Windows 10", url: "https://x.test/submit" },
};

const FEATURE_INPUT = {
  category: "feature",
  type: "feature",
  severity: "normal",
  title: "希望能批量导出报表",
  description: "支持勾选多个报表一次导出",
  scenario: "月底汇总",
  workaround: "手动一张张导出",
  env: { ua: "Mozilla/5.0 Test" },
};

test("问题路径模板：8 分区齐全、复现步骤仅 bug、时间 +08:00", () => {
  const md = renderFeedbackMarkdown(ISSUE_INPUT, "20260921-143025-a3f9kz", FIXED_NOW);
  for (const h of [
    "## 问题描述",
    "## 复现步骤",
    "## 期望结果",
    "## 实际结果",
    "## 环境信息",
    "## 截图",
    "## 附件",
    "## 开发者回复",
  ]) {
    assert.ok(md.includes(h), `缺少分区 ${h}`);
  }
  assert.ok(md.includes('created_at: "2026-09-21T14:30:25+08:00"'));
  assert.ok(md.includes('nickname: "阿明"'));
  assert.ok(md.includes('severity: "blocker"'));
  assert.ok(md.includes('status: "submitted"'));
  assert.ok(md.includes("archived: false"));
  assert.ok(md.includes("（暂无）")); // 回信区初始占位
  // 分区顺序固定
  const order = ["## 问题描述", "## 复现步骤", "## 期望结果", "## 实际结果", "## 环境信息", "## 截图", "## 附件", "## 开发者回复"]
    .map((h) => md.indexOf(h));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
});

test("问题路径非 bug：复现步骤整段省略", () => {
  const md = renderFeedbackMarkdown(
    { ...ISSUE_INPUT, type: "question", steps: undefined },
    "20260921-143026-b2c3d4",
    FIXED_NOW
  );
  assert.ok(!md.includes("## 复现步骤"));
});

test("功能路径模板：7 分区、想解决的问题初始（未提供）、无附件分区", () => {
  const md = renderFeedbackMarkdown(FEATURE_INPUT, "20260920-155801-c7tq3e", FIXED_NOW);
  for (const h of [
    "## 想要的功能",
    "## 想解决的问题",
    "## 使用场景",
    "## 现状的替代办法",
    "## 环境信息",
    "## 截图",
    "## 开发者回复",
  ]) {
    assert.ok(md.includes(h), `缺少分区 ${h}`);
  }
  assert.ok(!md.includes("## 附件"));
  assert.ok(!md.includes("## 复现步骤"));
  assert.ok(md.includes("## 想解决的问题\n\n（未提供）"));
  assert.ok(md.includes('severity: "normal"'));
  assert.ok(md.includes('tier: "basic"'));
  assert.ok(!md.includes("nickname:")); // 未填则整行省略
});

test("用户文本行首 # 转义，防伪造分区/回复标题", () => {
  const md = renderFeedbackMarkdown(
    { ...ISSUE_INPUT, description: "正常描述\n### 2026-01-01 开发者\n## 问题描述\n#### 标题" },
    "20260921-143027-d3e4f5",
    FIXED_NOW
  );
  assert.ok(md.includes("\\### 2026-01-01 开发者"));
  assert.ok(md.includes("\\## 问题描述"));
  assert.ok(md.includes("\\#### 标题"));
  // 正文里仅服务端生成的分区标题未被转义（共 8 个，无重复注入）
  assert.equal(md.match(/^## 问题描述$/gm)?.length, 1);
});

test("cleanUserText 剥控制字符保留换行", () => {
  assert.equal(cleanUserText("a\x00b\x07c\nd"), "abc\nd");
});

test("roundtrip：渲染 → 解析得到等价 frontmatter", () => {
  const md = renderFeedbackMarkdown(ISSUE_INPUT, "20260921-143025-a3f9kz", FIXED_NOW);
  const parsed = parseFeedback(md);
  assert.ok(parsed);
  assert.equal(parsed.fm.id, "20260921-143025-a3f9kz");
  assert.equal(parsed.fm.title, "导出报表时软件闪退");
  assert.equal(parsed.fm.type, "bug");
  assert.equal(parsed.fm.severity, "blocker");
  assert.equal(parsed.fm.nickname, "阿明");
  assert.equal(parsed.fm.archived, false);
  assert.equal(parsed.fm.created_at, "2026-09-21T14:30:25+08:00"); // JSON_SCHEMA 保持字符串
  assert.ok(parsed.body.includes("## 问题描述"));
});

test("parseFeedback 脏数据返回 null", () => {
  assert.equal(parseFeedback("not a feedback file"), null);
  assert.equal(parseFeedback("---\ntitle: 1\n---\nbody"), null);
});

test("回信摘要：无回复 / 单轮 / 多轮取最新一轮，约 100 字截断", () => {
  const noReply = "## 开发者回复\n\n（暂无）";
  assert.deepEqual(extractLatestReply(noReply), { hasReply: false, excerpt: "" });

  const oneRound = [
    "## 开发者回复",
    "",
    "### 2026-09-22 09:05 开发者",
    "",
    "收到，闪退问题已在 1.4.3 版本修复。",
  ].join("\n");
  const r1 = extractLatestReply(oneRound);
  assert.equal(r1.hasReply, true);
  assert.ok(r1.excerpt.includes("1.4.3 版本修复"));

  const twoRounds = `${oneRound}\n\n### 2026-09-23 10:00 开发者\n\n最新一轮内容，请看这条。`;
  const r2 = extractLatestReply(twoRounds);
  assert.ok(r2.excerpt.includes("最新一轮内容"));
  assert.ok(!r2.excerpt.includes("1.4.3")); // 不含旧轮

  const long = "长".repeat(300);
  const r3 = extractLatestReply(
    `## 开发者回复\n\n### 2026-09-22 09:05 开发者\n\n${long}`
  );
  assert.equal([...r3.excerpt].length, 101); // 100 + 省略号
  assert.ok(r3.excerpt.endsWith("…"));
});

test("compareByUpdatedAt 按 updatedAt 倒序", () => {
  const arr = [
    { updatedAt: "2026-09-19T09:15:12+08:00" },
    { updatedAt: "2026-09-21T14:30:25+08:00" },
    { updatedAt: "2026-09-20T10:05:33+08:00" },
  ];
  const sorted = [...arr].sort(compareByUpdatedAt);
  assert.equal(sorted[0].updatedAt, "2026-09-21T14:30:25+08:00");
  assert.equal(sorted[2].updatedAt, "2026-09-19T09:15:12+08:00");
});

test("含截图/日志附件时：分区写入 s{n}/a{n} 相对路径，tier=detailed", () => {
  const md = renderFeedbackMarkdown(
    {
      ...ISSUE_INPUT,
      screenshots: [
        { ref: "_pending/3f2a1b0c-9d8e-4f7a-b6c5-d4e5f6071829/屏幕截图.png", originalName: "屏幕截图.png" },
      ],
      attachments: [
        { ref: "_pending/8a7b6c5d-4e3f-4a2b-1c0d-9e8f7a6b5c4d/debug.log", originalName: "debug.log" },
      ],
    },
    "20260921-143025-a3f9kz",
    FIXED_NOW
  );
  assert.ok(
    md.includes("![截图 1](feedback/assets/20260921-143025-a3f9kz/s1-屏幕截图.png)")
  );
  assert.ok(
    md.includes("[debug.log](feedback/assets/20260921-143025-a3f9kz/a1-debug.log)")
  );
  assert.ok(md.includes('tier: "detailed"'));
  // 无附件时恒 basic
  const md2 = renderFeedbackMarkdown(ISSUE_INPUT, "20260921-143025-a3f9kz", FIXED_NOW);
  assert.ok(md2.includes('tier: "basic"'));
});

test("splitSections 按二级标题切块、保持顺序", () => {
  const body = "## 问题描述\n\nA\n\n## 截图\n\n（无）\n\n## 开发者回复\n\n（暂无）";
  const sections = splitSections(body);
  assert.deepEqual(
    sections.map((s) => s.title),
    ["问题描述", "截图", "开发者回复"]
  );
  assert.equal(sections[0].text, "A");
});

test("extractReplyRounds 解析全部轮次（时间 + 正文，正序）", () => {
  const body = [
    "## 开发者回复",
    "",
    "### 2026-09-19 16:40 开发者",
    "",
    "日志已收到，定位到异常。",
    "",
    "### 2026-09-20 10:05 开发者",
    "",
    "修复已进入内测。",
  ].join("\n");
  const rounds = extractReplyRounds(body);
  assert.equal(rounds.length, 2);
  assert.equal(rounds[0].time, "2026-09-19 16:40");
  assert.equal(rounds[0].text, "日志已收到，定位到异常。");
  assert.equal(rounds[1].time, "2026-09-20 10:05");
  assert.equal(rounds[1].text, "修复已进入内测。");
  assert.deepEqual(extractReplyRounds("## 开发者回复\n\n（暂无）"), []);
});

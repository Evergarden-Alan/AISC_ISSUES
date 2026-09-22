import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  appendDeveloperReply,
  extractReplyRounds,
  parseFeedback,
  removeLastDeveloperReply,
  renderFeedbackMarkdown,
} from "../src/lib/markdown-utils.ts";

// 回复撤回 / 编辑（v0.1.1 T3.1；02-design §7.1）——单轮 / 多轮 / 无轮 / 占位 / 不碰 frontmatter

const FIXED_NOW = Date.UTC(2026, 8, 21, 6, 30, 25);

const BASE = renderFeedbackMarkdown(
  {
    category: "issue",
    type: "bug",
    severity: "blocker",
    title: "导出报表时软件闪退",
    description: "点导出按钮就闪退",
    env: { ua: "UA", platform: "Win", url: "https://x.test/submit" },
  },
  "20260921-143025-a3f9kz",
  FIXED_NOW
);

function withRounds(texts) {
  let raw = BASE;
  for (const t of texts) raw = appendDeveloperReply(raw, t[0], t[1]);
  return raw;
}

test("单轮移除：正文回写「（暂无）」，返回被移除轮次", () => {
  const raw = withRounds([["2026-09-21 15:00", "收到，我们在查。"]]);
  const r = removeLastDeveloperReply(raw);
  assert.equal(r.removed, true);
  assert.deepEqual(r.round, { time: "2026-09-21 15:00", text: "收到，我们在查。" });
  assert.ok(r.raw.includes("## 开发者回复\n\n（暂无）"));
  assert.ok(!r.raw.includes("收到，我们在查。"));
  assert.ok(r.raw.endsWith("（暂无）\n"));
});

test("多轮：只移最后一轮，其余轮次与顺序不动", () => {
  const raw = withRounds([
    ["2026-09-21 15:00", "第一轮"],
    ["2026-09-22 09:30", "已修复，请更新"],
  ]);
  const r = removeLastDeveloperReply(raw);
  assert.equal(r.removed, true);
  assert.deepEqual(r.round, { time: "2026-09-22 09:30", text: "已修复，请更新" });
  assert.ok(r.raw.includes("第一轮"));
  assert.ok(!r.raw.includes("已修复，请更新"));
  const rounds = extractReplyRounds(parseFeedback(r.raw).body);
  assert.equal(rounds.length, 1);
  assert.equal(rounds[0].text, "第一轮");
});

test("编辑 = 移除最后一轮 + 以原轮次时间戳写回（其余轮次不动）", () => {
  const raw = withRounds([
    ["2026-09-21 15:00", "第一轮"],
    ["2026-09-22 09:30", "已修复，请更新到 v1.2"],
  ]);
  const r = removeLastDeveloperReply(raw);
  assert.equal(r.removed, true);
  const edited = appendDeveloperReply(r.raw, r.round.time, "已修复，请更新到 v1.3");
  const rounds = extractReplyRounds(parseFeedback(edited).body);
  assert.equal(rounds.length, 2);
  assert.equal(rounds[0].time, "2026-09-21 15:00");
  assert.equal(rounds[1].time, "2026-09-22 09:30"); // 原时间戳保留
  assert.equal(rounds[1].text, "已修复，请更新到 v1.3"); // 内容已更新
});

test("无轮（占位态）与无分区：removed:false 原样返回、不崩", () => {
  for (const raw of [BASE, "没有回复分区的内容", ""]) {
    const r = removeLastDeveloperReply(raw);
    assert.equal(r.removed, false);
    assert.equal(r.raw, raw);
    assert.equal(r.round, null);
  }
});

test("不触碰 frontmatter（含 affects 行）与其他分区", () => {
  const raw = readFileSync(
    new URL("./fixtures/feedback/20260922-100001-vote007.md", import.meta.url),
    "utf-8"
  );
  const withReply = appendDeveloperReply(raw, "2026-09-22 10:00", "收到");
  const r = removeLastDeveloperReply(withReply);
  assert.equal(r.removed, true);
  const fm = parseFeedback(r.raw).fm;
  assert.equal(fm.affects, 7);
  assert.equal(fm.id, "20260922-100001-vote007");
  assert.equal(fm.status, "submitted");
  assert.ok(r.raw.includes("## 问题描述"));
});

test("cleanUserText 在编辑写回时同样生效（# 标题转义）", () => {
  const raw = withRounds([["2026-09-21 15:00", "原内容"]]);
  const r = removeLastDeveloperReply(raw);
  const edited = appendDeveloperReply(r.raw, r.round.time, "# 伪造分区\n正文");
  assert.ok(edited.includes("\\# 伪造分区"));
  assert.ok(!edited.includes("\n# 伪造分区"));
});

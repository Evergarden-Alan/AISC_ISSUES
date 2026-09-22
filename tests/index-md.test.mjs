import { test } from "node:test";
import assert from "node:assert/strict";
import { buildIndexMd } from "../src/lib/index-md.ts";

// 仓库根索引 索引.md 构建（v0.1.2）：反馈/需求两表、序号按时间升序、含时间列、单元格清洗

const E = (category, title, status, createdAt) => ({ category, title, status, createdAt });

test("两表分离：反馈与需求各自成表", () => {
  const md = buildIndexMd([
    E("issue", "导出报表时软件闪退", "in-progress", "2026-09-21T14:30:25+08:00"),
    E("feature", "希望能批量导出", "submitted", "2026-09-22T09:00:00+08:00"),
  ]);
  assert.ok(md.includes("## 反馈"));
  assert.ok(md.includes("## 需求"));
  assert.ok(md.includes("| 1 | 导出报表时软件闪退 | 2026-09-21 14:30 | 处理中 |"));
  assert.ok(md.includes("| 1 | 希望能批量导出 | 2026-09-22 09:00 | 已收到 |")); // 两表独立编号
});

test("序号按 createdAt 升序；状态双映射按 category 取词", () => {
  const md = buildIndexMd([
    E("feature", "功能B", "resolved", "2026-09-23T00:00:00+08:00"),
    E("feature", "功能A", "submitted", "2026-09-22T00:00:00+08:00"),
    E("issue", "问题一", "resolved", "2026-09-20T00:00:00+08:00"),
    E("issue", "问题二", "wontfix", "2026-09-21T00:00:00+08:00"),
  ]);
  const issuePart = md.split("## 需求")[0];
  const featPart = md.split("## 需求")[1];
  assert.ok(
    issuePart.indexOf("| 1 | 问题一 | 2026-09-20 00:00 | 已解决 |") <
      issuePart.indexOf("| 2 | 问题二 | 2026-09-21 00:00 | 暂不处理 |")
  );
  assert.ok(
    featPart.indexOf("| 1 | 功能A | 2026-09-22 00:00 | 已收到 |") <
      featPart.indexOf("| 2 | 功能B | 2026-09-23 00:00 | 已上线 |")
  );
});

test("单元格清洗：竖线/换行不破坏表格；空表有占位行", () => {
  const md = buildIndexMd([
    E("issue", "标题|带竖线\n换行", "submitted", "2026-09-22T00:00:00+08:00"),
  ]);
  assert.ok(md.includes("| 1 | 标题／带竖线 换行 | 2026-09-22 00:00 | 已收到 |"));
  assert.ok(!md.includes("标题|带竖线"));

  const empty = buildIndexMd([]);
  assert.ok(empty.includes("| - | 暂无 | - | - |"));
});

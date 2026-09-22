import { STATUS_LABELS, type StatusValue } from "./constants.ts";

// 仓库根索引 索引.md 构建（v0.1.2）：反馈/需求两张表（序号/关键字/时间/当前进度）。
// 每次新提交与每日 cron 全量重建，「当前进度」直接取各条目 md 的 status 中文映射。

export interface IndexEntry {
  category: "issue" | "feature";
  title: string;
  status: StatusValue;
  createdAt: string; // ISO +08:00，用于排序定序号
}

/** 单元格清洗：竖线与换行会破坏 markdown 表格 */
function cell(s: string): string {
  return s.replace(/\|/g, "／").replace(/[\r\n]+/g, " ").trim();
}

function table(entries: IndexEntry[]): string {
  const rows = entries
    .slice()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((e, i) => {
      const time = e.createdAt.slice(0, 16).replace("T", " "); // "2026-09-22 18:19"（分钟粒度）
      return `| ${i + 1} | ${cell(e.title)} | ${time} | ${STATUS_LABELS[e.status][e.category]} |`;
    });
  return [
    "| 序号 | 关键字 | 时间 | 当前进度 |",
    "|---|---|---|---|",
    ...(rows.length > 0 ? rows : ["| - | 暂无 | - | - |"]),
  ].join("\n");
}

export function buildIndexMd(entries: IndexEntry[]): string {
  return [
    "# 反馈索引",
    "",
    "本文件由反馈站自动维护：每条反馈一个目录（日期-概述-提出者），目录内为反馈.md / 需求.md 与全部附件。",
    "「当前进度」对应各目录 md 的 status 字段；开发者修改 md 后，最迟在下一次用户提交或每日自动任务时同步到本表。",
    "",
    "## 反馈",
    "",
    table(entries.filter((e) => e.category === "issue")),
    "",
    "## 需求",
    "",
    table(entries.filter((e) => e.category === "feature")),
    "",
  ].join("\n");
}

// +08:00 北京时间工具（02 §9：全站统一 +08:00，禁止 Z/UTC/无偏移写法）

const PARTS_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

export function beijingParts(ms: number): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of PARTS_FMT.formatToParts(new Date(ms))) {
    if (p.type !== "literal") out[p.type] = p.value;
  }
  return out;
}

/** 文件名时间戳："20260921-143025" */
export function beijingStamp(ms: number): string {
  const p = beijingParts(ms);
  return `${p.year}${p.month}${p.day}-${p.hour}${p.minute}${p.second}`;
}

/** frontmatter ISO 8601："2026-09-21T14:30:25+08:00" */
export function beijingIso(ms: number): string {
  const p = beijingParts(ms);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}+08:00`;
}

/** 正文环境信息里的提交时间："2026-09-21 14:30:25" */
export function beijingClock(ms: number): string {
  const p = beijingParts(ms);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

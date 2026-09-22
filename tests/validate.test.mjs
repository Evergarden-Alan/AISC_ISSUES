import { test } from "node:test";
import assert from "node:assert/strict";
import { validateSubmission } from "../src/lib/validate.ts";
import { LIMITS } from "../src/lib/constants.ts";

// 分路径请求体校验（03 §3.1；04 §6 映射行：nickname ≤20 边界、路径区分校验）

const KEY = "0f1e2d3c-4b5a-4678-9abc-def012345678";

const ISSUE_OK = {
  idempotencyKey: KEY,
  website: "",
  type: "bug",
  severity: "normal",
  title: "导出按钮点不动",
  description: "点击导出没有任何反应",
  steps: "1. 打开\n2. 点导出",
  expected: "弹出保存框",
  actual: "无反应",
  nickname: "阿明",
  env: { ua: "UA", platform: "Win", url: "https://x/submit" },
};

const FEATURE_OK = {
  idempotencyKey: KEY,
  website: "",
  type: "feature",
  title: "希望能批量导出",
  description: "一次导出多个报表",
  scenario: "月底汇总",
  workaround: "手动导出",
  env: {},
};

test("问题路径合法输入通过，category 派生正确", () => {
  const r = validateSubmission(ISSUE_OK);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.value.category, "issue");
    assert.equal(r.idempotencyKey, KEY);
    assert.equal(r.value.nickname, "阿明");
  }
});

test("功能路径：severity 缺省通过且覆写 normal", () => {
  const r = validateSubmission(FEATURE_OK);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.value.category, "feature");
    assert.equal(r.value.severity, "normal");
  }
});

test("问题路径缺 severity → 「请选择影响程度」", () => {
  const rest = { ...ISSUE_OK };
  delete rest.severity;
  const r = validateSubmission(rest);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error, "请选择影响程度");
});

test("问题路径非法 severity → 拒绝", () => {
  const r = validateSubmission({ ...ISSUE_OK, severity: "urgent" });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error, "请选择影响程度");
});

test("type=feature 即功能路径（severity 覆写）；非法 type 值拒绝", () => {
  // 服务端仅凭 type 区分路径：feature 请求即功能路径（03 §3.1），
  // 「问题路径不出现 feature」由表单 UI 保证，服务端无需也无法另行拒绝。
  const r1 = validateSubmission({ ...ISSUE_OK, type: "feature" });
  assert.equal(r1.ok, true);
  if (r1.ok) {
    assert.equal(r1.value.category, "feature");
    assert.equal(r1.value.severity, "normal");
  }
  const r2 = validateSubmission({ ...ISSUE_OK, type: "perf" });
  assert.equal(r2.ok, false);
  if (!r2.ok) assert.equal(r2.error, "请选择问题类型");
});

test("功能路径出现日志附件引用 → 400（日志上传仅问题路径提供）", () => {
  const r = validateSubmission({
    ...FEATURE_OK,
    attachments: [{ ref: "_pending/3f2a1b0c-9d8e-4f7a-b6c5-d4e5f6071829/a.log", originalName: "a.log" }],
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.error.includes("附件"));
});

test("问题路径合法截图/附件引用通过；功能路径截图（参考图）也通过", () => {
  const uuid = "3f2a1b0c-9d8e-4f7a-b6c5-d4e5f6071829";
  const r1 = validateSubmission({
    ...ISSUE_OK,
    screenshots: [{ ref: `_pending/${uuid}/屏幕截图.png`, originalName: "屏幕截图.png" }],
    attachments: [{ ref: `_pending/${uuid}/debug.log`, originalName: "debug.log" }],
  });
  assert.equal(r1.ok, true);
  if (r1.ok) {
    assert.equal(r1.value.screenshots?.length, 1);
    assert.equal(r1.value.attachments?.length, 1);
  }
  const r2 = validateSubmission({
    ...FEATURE_OK,
    screenshots: [{ ref: `_pending/${uuid}/参考图.webp`, originalName: "参考图.webp" }],
  });
  assert.equal(r2.ok, true);
});

test("引用校验：非法 ref / 超数量 / 扩展名不符均拒绝", () => {
  const uuid = "3f2a1b0c-9d8e-4f7a-b6c5-d4e5f6071829";
  const r1 = validateSubmission({
    ...ISSUE_OK,
    screenshots: [{ ref: "_pending/not-a-uuid/a.png", originalName: "a.png" }],
  });
  assert.equal(r1.ok, false);
  if (!r1.ok) assert.ok(r1.error.includes("过期"));

  const shots = Array.from({ length: 11 }, (_, i) => ({
    ref: `_pending/${uuid}/${i}.png`,
    originalName: `${i}.png`,
  }));
  const r2 = validateSubmission({ ...ISSUE_OK, screenshots: shots });
  assert.equal(r2.ok, false);
  if (!r2.ok) assert.ok(r2.error.includes("10"));

  const r3 = validateSubmission({
    ...ISSUE_OK,
    attachments: [{ ref: `_pending/${uuid}/virus.exe`, originalName: "virus.exe" }],
  });
  assert.equal(r3.ok, false);
  if (!r3.ok) assert.ok(r3.error.includes("类型不支持"));

  // 10 张恰好通过
  const r4 = validateSubmission({
    ...ISSUE_OK,
    screenshots: shots.slice(0, 10),
  });
  assert.equal(r4.ok, true);
});

test("白名单外字段 → 整体 400", () => {
  const r = validateSubmission({ ...ISSUE_OK, admin: true });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error, "提交内容格式不正确");
});

test("幂等键缺失/非 UUID → 拒绝", () => {
  const r1 = validateSubmission({ ...ISSUE_OK, idempotencyKey: "" });
  assert.equal(r1.ok, false);
  if (!r1.ok) assert.equal(r1.error, "提交标识缺失，请刷新页面重试");
  const r2 = validateSubmission({ ...ISSUE_OK, idempotencyKey: "abc" });
  assert.equal(r2.ok, false);
});

test("标题边界：50 字通过、51 字拒绝", () => {
  const t50 = "标".repeat(50);
  const t51 = `${t50}标`;
  assert.equal(validateSubmission({ ...ISSUE_OK, title: t50 }).ok, true);
  const r = validateSubmission({ ...ISSUE_OK, title: t51 });
  assert.equal(r.ok, false);
});

test("描述超 2000 字拒绝；steps 仅 bug 路径采集", () => {
  const long = "长".repeat(LIMITS.description + 1);
  const r = validateSubmission({ ...ISSUE_OK, description: long });
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.error.includes("2000"));

  const ux = validateSubmission({ ...ISSUE_OK, type: "ux", steps: "这些步骤应被忽略" });
  assert.equal(ux.ok, true);
  if (ux.ok) assert.equal(ux.value.steps, undefined);
});

test("nickname 边界：20 字通过、21 字拒绝（04 §6 映射行）", () => {
  const n20 = "名".repeat(20);
  const n21 = `${n20}名`;
  assert.equal(validateSubmission({ ...ISSUE_OK, nickname: n20 }).ok, true);
  const r = validateSubmission({ ...ISSUE_OK, nickname: n21 });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error, "称呼不能超过 20 字");
});

test("scenario/workaround 仅功能路径写入；超 500 字拒绝", () => {
  const r1 = validateSubmission(ISSUE_OK); // 问题路径传 scenario 字段被忽略（键在白名单）
  assert.equal(r1.ok, true);
  if (r1.ok) assert.equal(r1.value.scenario, undefined);

  const long = "场".repeat(501);
  const r2 = validateSubmission({ ...FEATURE_OK, scenario: long });
  assert.equal(r2.ok, false);
  if (!r2.ok) assert.ok(r2.error.includes("500"));
});

test("env 超长字段服务端截断不拒绝", () => {
  const r = validateSubmission({
    ...ISSUE_OK,
    env: { ua: "U".repeat(1000), platform: "P".repeat(100), url: "h".repeat(1000) },
  });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.value.env.ua.length, LIMITS.ua);
    assert.equal(r.value.env.platform.length, LIMITS.platform);
    assert.equal(r.value.env.url.length, LIMITS.url);
  }
});

test("非对象/数组请求体拒绝", () => {
  assert.equal(validateSubmission(null).ok, false);
  assert.equal(validateSubmission([1, 2]).ok, false);
  assert.equal(validateSubmission("hello").ok, false);
});

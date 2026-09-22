import {
  ISSUE_TYPE_VALUES,
  LIMITS,
  SEVERITY_VALUES,
  TYPE_VALUES,
} from "./constants.ts";
import {
  FILE_EXTS,
  IMAGE_EXTS,
  PENDING_REF_PATTERN,
  extOf,
} from "./attachments.ts";
import type { Category, ValidatedFeedback } from "../types/feedback.ts";

// 请求体校验（03 §3.1 校验表为唯一入口，按路径区分）。纯函数，前后端共用限值。

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ValidateResult =
  | { ok: true; value: ValidatedFeedback; idempotencyKey: string }
  | { ok: false; error: string };

export interface PendingRef {
  ref: string;
  originalName: string;
}

class ValidationError extends Error {}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function lenOk(s: string, max: number): boolean {
  return [...s].length <= max; // 按字符计（汉字算 1）
}

/** 选填文本：空 → undefined；超长 → 抛 ValidationError */
function opt(v: unknown, max: number): string | undefined {
  const s = str(v).trim();
  if (!s) return undefined;
  if (!lenOk(s, max)) {
    throw new ValidationError(`内容过长，请删减到 ${max} 字以内`);
  }
  return s;
}

export function validateSubmission(body: unknown): ValidateResult {
  try {
    return { ok: true, ...doValidate(body) };
  } catch (e) {
    if (e instanceof ValidationError) return { ok: false, error: e.message };
    throw e;
  }
}

function doValidate(body: unknown): {
  value: ValidatedFeedback;
  idempotencyKey: string;
} {
  if (!isPlainObject(body)) throw new ValidationError("提交内容格式不正确");

  // —— 白名单外字段整体拒绝（03 §3.1）——
  const ALLOWED = new Set([
    "idempotencyKey",
    "website", // 蜜罐：路由层先行处理，仍属白名单键
    "type",
    "severity",
    "title",
    "description",
    "steps",
    "expected",
    "actual",
    "scenario",
    "workaround",
    "nickname",
    "screenshots",
    "attachments",
    "env",
    "turnstileToken", // v0.1.1 M2-1：可选，是否校验由路由层按开关判定
  ]);
  for (const key of Object.keys(body)) {
    if (!ALLOWED.has(key)) throw new ValidationError("提交内容格式不正确");
  }

  // —— turnstile token（仅形态校验：string 且 ≤2048；缺失合法 = 前端降级场景）——
  const tsToken = body.turnstileToken;
  if (tsToken !== undefined) {
    if (typeof tsToken !== "string" || tsToken.length > 2048) {
      throw new ValidationError("提交内容格式不正确");
    }
  }

  // —— 幂等键 ——
  const idempotencyKey = str(body.idempotencyKey);
  if (!UUID_V4.test(idempotencyKey)) {
    throw new ValidationError("提交标识缺失，请刷新页面重试");
  }

  // —— 路径与类型 ——
  const type = str(body.type);
  if (!TYPE_VALUES.includes(type as never)) {
    throw new ValidationError("请选择问题类型");
  }
  const category: Category = type === "feature" ? "feature" : "issue";
  if (category === "issue" && !ISSUE_TYPE_VALUES.includes(type as never)) {
    throw new ValidationError("请选择问题类型");
  }

  // —— 附件引用（M2 起支持；按路径与类别校验，03 §3.1）——
  // 功能路径出现日志附件引用即 400（日志上传仅问题路径提供）；截图/参考图两条路径均可。
  const hasShots = Array.isArray(body.screenshots);
  const hasFiles = Array.isArray(body.attachments);
  if (category === "feature" && hasFiles && (body.attachments as unknown[]).length > 0) {
    throw new ValidationError("日志附件仅问题反馈路径支持，功能建议请勿上传附件");
  }
  const screenshots = hasShots
    ? parseRefs(body.screenshots, [...IMAGE_EXTS], 10, "截图")
    : undefined;
  const attachments =
    category === "issue" && hasFiles
      ? parseRefs(body.attachments, [...FILE_EXTS], 3, "日志附件")
      : undefined;

  // —— severity：仅问题路径必填；功能路径覆写 normal ——
  let severity = str(body.severity);
  if (category === "issue") {
    if (!SEVERITY_VALUES.includes(severity as never)) {
      throw new ValidationError("请选择影响程度");
    }
  } else {
    severity = "normal";
  }

  // —— 必填文本 ——
  const title = str(body.title).trim();
  if (!title) throw new ValidationError("请用一句话概括（50 字以内）");
  if (!lenOk(title, LIMITS.title)) throw new ValidationError("不能超过 50 字");

  const description = str(body.description).trim();
  if (!description) throw new ValidationError("请填写详细描述（2000 字以内）");
  if (!lenOk(description, LIMITS.description)) {
    throw new ValidationError("详细描述不能超过 2000 字");
  }

  // —— 选填文本（按路径归属；非归属路径传入值一律忽略）——
  const steps =
    category === "issue" && type === "bug" ? opt(body.steps, LIMITS.steps) : undefined;
  const expected =
    category === "issue" ? opt(body.expected, LIMITS.expected) : undefined;
  const actual =
    category === "issue" ? opt(body.actual, LIMITS.actual) : undefined;
  const scenario =
    category === "feature" ? opt(body.scenario, LIMITS.scenario) : undefined;
  const workaround =
    category === "feature" ? opt(body.workaround, LIMITS.workaround) : undefined;

  const nickname = str(body.nickname).trim();
  if (nickname && !lenOk(nickname, LIMITS.nickname)) {
    throw new ValidationError("称呼不能超过 20 字");
  }

  // —— 环境信息（自动采集，非表单项；服务端截断）——
  const envRaw = isPlainObject(body.env) ? body.env : {};
  const env = {
    ua: str(envRaw.ua).slice(0, LIMITS.ua) || undefined,
    platform: str(envRaw.platform).slice(0, LIMITS.platform) || undefined,
    url: str(envRaw.url).slice(0, LIMITS.url) || undefined,
  };

  const value: ValidatedFeedback = {
    category,
    type: type as ValidatedFeedback["type"],
    severity: severity as ValidatedFeedback["severity"],
    title,
    description,
    steps,
    expected,
    actual,
    scenario,
    workaround,
    nickname: nickname || undefined,
    screenshots: screenshots?.length ? screenshots : undefined,
    attachments: attachments?.length ? attachments : undefined,
    env,
  };
  return { value, idempotencyKey };
}

/** 引用列表校验：≤max 个；ref 匹配 _pending/{uuid}/{安全化名}；扩展名白名单 */
function parseRefs(
  v: unknown,
  allowedExts: string[],
  max: number,
  label: string
): PendingRef[] {
  if (!Array.isArray(v)) throw new ValidationError(`${label}格式不正确`);
  if (v.length > max) throw new ValidationError(`${label}最多 ${max} 个`);
  return v.map((item) => {
    if (typeof item !== "object" || item === null) {
      throw new ValidationError(`${label}格式不正确`);
    }
    const { ref, originalName } = item as Record<string, unknown>;
    if (typeof ref !== "string" || !PENDING_REF_PATTERN.test(ref)) {
      throw new ValidationError(`${label}上传已过期，请删除后重新上传`);
    }
    if (!allowedExts.includes(extOf(ref))) {
      throw new ValidationError(`${label}文件类型不支持`);
    }
    const name =
      typeof originalName === "string" && originalName.trim()
        ? originalName.trim().slice(0, 100)
        : ref.split("/").pop() ?? "file";
    return { ref, originalName: name };
  });
}

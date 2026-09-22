import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { clientIp, sameOrigin } from "@/lib/guards";
import { hitVoteLimit } from "@/lib/rate-limit";
import { AFFECTS_MAX, ID_PATTERN, itemMdCandidates } from "@/lib/constants";
import {
  GitHubApiError,
  decodeBase64Utf8,
  githubGetFile,
  githubPutFileBytes,
  withConflictRetry,
} from "@/lib/github-client";
import {
  affectsOf,
  parseFeedback,
  setFrontmatterIntField,
} from "@/lib/markdown-utils";

// POST /api/vote —— 「我也遇到 / 我想要」+1 投票（v0.1.1 M4；v0.1.2 适配目录布局）
// 只改 affects 一行：不更新 updated_at / status / 正文（防投票刷乱回信区与列表排序）。
// 去重口径：按（IP, 反馈）1 次/小时的粗粒度限频，接受少量重复不精确（01-scope M4-1⑥ 明示）。
// v0.1.2：id = 目录名；md 可能是 反馈.md 或 需求.md，写回时沿用 GET 到的那一个。

export const runtime = "nodejs";
export const maxDuration = 30;

function fail(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function POST(req: NextRequest) {
  // ① Origin 同源校验
  if (!sameOrigin(req)) return fail("请通过本网站提交", 403);

  // ② 请求体白名单：仅 {id}
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail("请求格式不正确");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return fail("请求格式不正确");
  }
  const keys = Object.keys(body);
  if (keys.length !== 1 || keys[0] !== "id") return fail("请求格式不正确");

  // ③ 目录名格式
  const id = (body as Record<string, unknown>).id;
  if (typeof id !== "string" || !ID_PATTERN.test(id)) {
    return fail("反馈编号格式不正确");
  }

  // ④ IP 限频：同（IP, 反馈）1 次/小时
  if (!(await hitVoteLimit(clientIp(req), id))) {
    return fail("感谢支持，同一反馈 1 小时内只能助力一次", 429);
  }

  // ⑤ 存在性 + affects+1 读改写（冲突由 withConflictRetry 重读重写）
  try {
    const affects = await withConflictRetry(async () => {
      let mdPath = "";
      let raw = "";
      let sha = "";
      for (const path of itemMdCandidates(id)) {
        const file = await githubGetFile(path);
        if (file?.content) {
          mdPath = path;
          raw = decodeBase64Utf8(file.content);
          sha = file.sha ?? "";
          break;
        }
      }
      if (!mdPath) throw new Error("NOT_FOUND");
      const parsed = parseFeedback(raw);
      if (!parsed) throw new Error("NOT_FOUND");
      const next = Math.min(affectsOf(parsed.fm) + 1, AFFECTS_MAX);
      const md = setFrontmatterIntField(raw, "affects", next);
      await githubPutFileBytes(
        mdPath,
        Buffer.from(md, "utf-8"),
        `vote: ${id} → ${next}`,
        sha
      );
      return next;
    });
    revalidateTag("issues", "max"); // 首页/详情读缓存即时失效
    return NextResponse.json({ ok: true, affects });
  } catch (e) {
    if (e instanceof Error && e.message === "NOT_FOUND") {
      return fail("该反馈不存在", 404);
    }
    console.error(
      "[api/vote] 写入失败：",
      e instanceof GitHubApiError ? `GitHub API ${e.status}` : e
    );
    return fail("提交没有成功，请稍后重试", 500);
  }
}

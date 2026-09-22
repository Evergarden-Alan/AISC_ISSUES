// 纯 HTTP 层：鉴权 / Contents API 封装 / 错误脱敏（03 §4）
// 安全红线：PAT 只在本模块出现；对外错误只抛状态码，绝不带响应体细节。

const API_BASE = "https://api.github.com";
const API_VERSION = "2022-11-28";

export class GitHubApiError extends Error {
  status: number;
  constructor(status: number) {
    super(`GitHub API error ${status}`); // 脱敏：不含 GitHub 原始报错
    this.name = "GitHubApiError";
    this.status = status;
  }
}

export function getConfig(): { pat: string; owner: string; repo: string } {
  const pat = process.env.GITHUB_PAT;
  const owner = process.env.REPO_OWNER;
  const repo = process.env.REPO_NAME;
  if (!pat || !owner || !repo) {
    throw new GitHubApiError(0); // 缺环境变量：按配置错误处理，调用方转为 500 中文文案
  }
  return { pat, owner, repo };
}

function baseHeaders(pat: string): HeadersInit {
  return {
    Authorization: `Bearer ${pat}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": API_VERSION,
  };
}

/** JSON 请求（读路径带 ISR 缓存 revalidate，写路径 no-store） */
export async function githubJson<T>(
  path: string,
  init: RequestInit & { revalidate?: number } = {}
): Promise<{ status: number; data: T | null }> {
  const { pat } = getConfig();
  const { revalidate, ...rest } = init;
  const headers = { ...baseHeaders(pat), ...(rest.headers ?? {}) };
  const res = await fetch(`${API_BASE}${path}`, {
    ...rest,
    headers,
    cache: revalidate ? undefined : ("no-store" as RequestCache),
    ...(revalidate ? { next: { revalidate } } : {}),
  });
  if (res.status === 304) return { status: 304, data: null };
  if (!res.ok) throw new GitHubApiError(res.status);
  const data = res.status === 204 ? null : ((await res.json()) as T);
  return { status: res.status, data };
}

export interface ContentsItem {
  name: string;
  path: string;
  type: "file" | "dir";
  content?: string;
  encoding?: string;
  sha?: string;
}

/** 列目录；404 返回 null（目录尚未创建不算错误） */
export async function githubListDir(
  dirPath: string,
  revalidate?: number
): Promise<ContentsItem[] | null> {
  try {
    const { data } = await githubJson<ContentsItem[]>(
      `/repos/${getConfig().owner}/${getConfig().repo}/contents/${dirPath}`,
      revalidate ? { revalidate } : {}
    );
    return Array.isArray(data) ? data : null;
  } catch (e) {
    if (e instanceof GitHubApiError && e.status === 404) return null;
    throw e;
  }
}

/** 读文件（Contents JSON，content 为 base64）；404 返回 null */
export async function githubGetFile(
  filePath: string,
  revalidate?: number
): Promise<ContentsItem | null> {
  try {
    const { data } = await githubJson<ContentsItem>(
      `/repos/${getConfig().owner}/${getConfig().repo}/contents/${filePath}`,
      revalidate ? { revalidate } : {}
    );
    return data;
  } catch (e) {
    if (e instanceof GitHubApiError && e.status === 404) return null;
    throw e;
  }
}

/**
 * 带重试的读文件：GitHub Contents API 写后立即读存在短暂不一致（PUT 成功但
 * GET 短暂 404），对「刚上传就要取回」的场景按固定间隔重试后再判缺失。
 * 仅对 null（404）重试；其余错误立即抛出。
 */
export async function githubGetFileRetry(
  filePath: string,
  opts: { revalidate?: number; attempts?: number; delayMs?: number } = {}
): Promise<ContentsItem | null> {
  const attempts = opts.attempts ?? 4;
  const delayMs = opts.delayMs ?? 700;
  for (let i = 0; ; i++) {
    const item = await githubGetFile(filePath, opts.revalidate);
    if (item?.content || i >= attempts - 1) return item;
    await sleep(delayMs);
  }
}

/**
 * 以 raw 方式读文件字节。
 * 关键：Contents API 以 JSON 方式读文件时，>1MB 的文件【不返回 content 字段】，
 * 只有 raw accept 才能拿到任意大小文件的完整字节——附件读取必须走这里。
 * 404 返回 null。
 */
export async function githubGetFileBytes(
  filePath: string
): Promise<Buffer | null> {
  if (filePath.includes("..") || filePath.startsWith("/")) {
    throw new GitHubApiError(400);
  }
  const { pat, owner, repo } = getConfig();
  const res = await fetch(
    `${API_BASE}/repos/${owner}/${repo}/contents/${filePath}`,
    {
      headers: {
        Authorization: `Bearer ${pat}`,
        Accept: "application/vnd.github.raw",
        "X-GitHub-Api-Version": API_VERSION,
      },
      cache: "no-store",
    }
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new GitHubApiError(res.status);
  return Buffer.from(await res.arrayBuffer());
}

/** githubGetFileBytes 的带重试版（应对写后读短暂 404） */
export async function githubGetFileBytesRetry(
  filePath: string,
  opts: { attempts?: number; delayMs?: number } = {}
): Promise<Buffer | null> {
  const attempts = opts.attempts ?? 4;
  const delayMs = opts.delayMs ?? 700;
  for (let i = 0; ; i++) {
    const buf = await githubGetFileBytes(filePath);
    if (buf || i >= attempts - 1) return buf;
    await sleep(delayMs);
  }
}

/** 读文件元数据（object 方式：任意大小 ≤100MB 都能拿到 sha，content 为空） */
export async function githubGetFileMeta(
  filePath: string
): Promise<{ sha: string; size?: number } | null> {
  if (filePath.includes("..") || filePath.startsWith("/")) {
    throw new GitHubApiError(400);
  }
  const { pat, owner, repo } = getConfig();
  const res = await fetch(
    `${API_BASE}/repos/${owner}/${repo}/contents/${filePath}`,
    {
      headers: {
        Authorization: `Bearer ${pat}`,
        Accept: "application/vnd.github.object",
        "X-GitHub-Api-Version": API_VERSION,
      },
      cache: "no-store",
    }
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new GitHubApiError(res.status);
  const data = (await res.json()) as { sha?: string; size?: number };
  return data.sha ? { sha: data.sha, size: data.size } : null;
}

export function decodeBase64Utf8(b64: string): string {
  return Buffer.from(b64, "base64").toString("utf-8");
}

/** 新建/更新文件（Contents API PUT）。无 sha 即新建；返回新 sha */
export async function githubPutFile(
  filePath: string,
  contentUtf8: string,
  message: string
): Promise<string> {
  return githubPutFileBytes(filePath, Buffer.from(contentUtf8, "utf-8"), message);
}

/** 二进制版 PUT（截图/日志等附件） */
export async function githubPutFileBytes(
  filePath: string,
  bytes: Buffer,
  message: string
): Promise<string> {
  // 双保险断言（沿参考项目）：拒路径穿越
  if (filePath.includes("..") || filePath.startsWith("/")) {
    throw new GitHubApiError(400);
  }
  const { pat, owner, repo } = getConfig();
  const res = await fetch(
    `${API_BASE}/repos/${owner}/${repo}/contents/${filePath}`,
    {
      method: "PUT",
      headers: baseHeaders(pat),
      cache: "no-store",
      body: JSON.stringify({
        message,
        content: bytes.toString("base64"),
      }),
    }
  );
  if (!res.ok) throw new GitHubApiError(res.status);
  const data = (await res.json()) as { content?: { sha?: string } };
  return data.content?.sha ?? "";
}

/** 删除文件；目标不存在（404）视为已删除，静默通过 */
export async function githubDeleteFile(
  filePath: string,
  sha: string,
  message: string
): Promise<void> {
  if (filePath.includes("..") || filePath.startsWith("/")) {
    throw new GitHubApiError(400);
  }
  const { pat, owner, repo } = getConfig();
  const res = await fetch(
    `${API_BASE}/repos/${owner}/${repo}/contents/${filePath}`,
    {
      method: "DELETE",
      headers: baseHeaders(pat),
      cache: "no-store",
      body: JSON.stringify({ message, sha }),
    }
  );
  if (!res.ok && res.status !== 404) throw new GitHubApiError(res.status);
}

/**
 * 409/422 冲突重试壳（更新场景：先 GET 最新 sha 再 PUT）。创建场景的
 * 「换随机串重试」在 feedback.ts 编排层实现，不经过此壳。
 */
export async function withConflictRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const status = e instanceof GitHubApiError ? e.status : 0;
      if ((status === 409 || status === 422) && attempt < 2) continue;
      throw e;
    }
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

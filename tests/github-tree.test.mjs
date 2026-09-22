import { test } from "node:test";
import assert from "node:assert/strict";
import { githubListFeedbackMdPaths } from "../src/lib/github-client.ts";

// Git Trees API 两步枚举（02-design §4.1；03-tasks T1.3）——mock fetch，不访问网络

process.env.GITHUB_PAT ||= "test-pat";
process.env.REPO_OWNER ||= "test-owner";
process.env.REPO_NAME ||= "test-repo";

const REAL_FETCH = globalThis.fetch;

function mockFetch(queue) {
  let i = 0;
  return async () => {
    const item = queue[Math.min(i, queue.length - 1)];
    i += 1;
    if (item.throw) throw new Error("network down");
    return {
      ok: !item.status || item.status === 200,
      status: item.status ?? 200,
      json: async () => item.data,
    };
  };
}

const ROOT_TREE = {
  sha: "root-sha",
  tree: [
    { path: "README.md", type: "blob", sha: "s0" },
    { path: "feedback", type: "tree", sha: "feedback-sha" },
    { path: ".github", type: "tree", sha: "s2" },
  ],
  truncated: false,
};

const SUB_TREE = {
  sha: "feedback-sha",
  tree: [
    { path: "20260921-143025-a3f9kz.md", type: "blob", sha: "b1" },
    { path: "20260922-100001-vote007.md", type: "blob", sha: "b2" },
    { path: "assets", type: "tree", sha: "b3" },
  ],
  truncated: false,
};

test("两步调用：定位 feedback 子树 → 仅返回直接子层 .md（拼 feedback/ 前缀）", async () => {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    const isRoot = calls.length === 1;
    return {
      ok: true,
      status: 200,
      json: async () => (isRoot ? ROOT_TREE : SUB_TREE),
    };
  };
  try {
    const files = await githubListFeedbackMdPaths();
    assert.deepEqual(files, [
      "feedback/20260921-143025-a3f9kz.md",
      "feedback/20260922-100001-vote007.md",
    ]);
    assert.equal(calls.length, 2);
    assert.match(calls[0], /\/git\/trees\/HEAD$/);
    assert.match(calls[1], /\/git\/trees\/feedback-sha$/);
    assert.ok(!calls[1].includes("recursive"), "不得使用 recursive=1");
  } finally {
    globalThis.fetch = REAL_FETCH;
  }
});

test("根树无 feedback 目录（空仓库）→ 返回 []", async () => {
  globalThis.fetch = mockFetch([
    {
      data: {
        sha: "root-sha",
        tree: [{ path: "README.md", type: "blob", sha: "s0" }],
        truncated: false,
      },
    },
  ]);
  try {
    assert.deepEqual(await githubListFeedbackMdPaths(), []);
  } finally {
    globalThis.fetch = REAL_FETCH;
  }
});

test("子树 truncated=true → 抛错（回退信号）", async () => {
  globalThis.fetch = mockFetch([
    { data: ROOT_TREE },
    { data: { ...SUB_TREE, truncated: true } },
  ]);
  try {
    await assert.rejects(() => githubListFeedbackMdPaths());
  } finally {
    globalThis.fetch = REAL_FETCH;
  }
});

test("403 / 404 / 网络异常 → 抛错（回退信号）", async () => {
  for (const status of [403, 404]) {
    globalThis.fetch = mockFetch([{ status }]);
    try {
      await assert.rejects(() => githubListFeedbackMdPaths());
    } finally {
      globalThis.fetch = REAL_FETCH;
    }
  }
  globalThis.fetch = mockFetch([{ throw: true }]);
  try {
    await assert.rejects(() => githubListFeedbackMdPaths());
  } finally {
    globalThis.fetch = REAL_FETCH;
  }
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { turnstileEnabled, verifyTurnstileToken } from "../src/lib/turnstile.ts";

// Turnstile 三值开关与 siteverify 校验（02-design §5；mock fetch，不访问网络）

function setEnv(enabled, secret, site) {
  if (enabled === undefined) delete process.env.TURNSTILE_ENABLED;
  else process.env.TURNSTILE_ENABLED = enabled;
  if (secret === undefined) delete process.env.TURNSTILE_SECRET_KEY;
  else process.env.TURNSTILE_SECRET_KEY = secret;
  if (site === undefined) delete process.env.TURNSTILE_SITE_KEY;
  else process.env.TURNSTILE_SITE_KEY = site;
}

test("turnstileEnabled 三值矩阵：缺一即关；仅严格 true 开", () => {
  setEnv("false", "sec", "site");
  assert.equal(turnstileEnabled(), false);
  setEnv("true", "", "site");
  assert.equal(turnstileEnabled(), false);
  setEnv("true", "sec", "");
  assert.equal(turnstileEnabled(), false);
  setEnv("True", "sec", "site");
  assert.equal(turnstileEnabled(), false);
  setEnv("1", "sec", "site");
  assert.equal(turnstileEnabled(), false);
  setEnv(undefined, "sec", "site");
  assert.equal(turnstileEnabled(), false);
  setEnv("true", undefined, "site");
  assert.equal(turnstileEnabled(), false);
  setEnv("true", "sec", undefined);
  assert.equal(turnstileEnabled(), false);
  setEnv("true", "sec", "site");
  assert.equal(turnstileEnabled(), true);
  setEnv(undefined, undefined, undefined);
});

const REAL_FETCH = globalThis.fetch;

function okFetch() {
  return async () => ({
    ok: true,
    status: 200,
    json: async () => ({ success: true }),
  });
}

test("siteverify success:true → 通过且 token 记入已用集合（重放拒绝）", async () => {
  setEnv("true", "sec", "site");
  globalThis.fetch = okFetch();
  try {
    assert.equal(await verifyTurnstileToken("tok-ok", "1.2.3.4"), true);
    assert.equal(await verifyTurnstileToken("tok-ok", "1.2.3.4"), false); // 重放
  } finally {
    globalThis.fetch = REAL_FETCH;
    setEnv(undefined, undefined, undefined);
  }
});

test("siteverify success:false → 拒绝", async () => {
  setEnv("true", "sec", "site");
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ success: false }),
  });
  try {
    assert.equal(await verifyTurnstileToken("tok-bad", "1.2.3.4"), false);
  } finally {
    globalThis.fetch = REAL_FETCH;
    setEnv(undefined, undefined, undefined);
  }
});

test("网络异常 / 超时 / 非 2xx → fail-closed 拒绝", async () => {
  setEnv("true", "sec", "site");
  globalThis.fetch = async () => {
    throw new Error("boom");
  };
  try {
    assert.equal(await verifyTurnstileToken("t1", "ip"), false);
  } finally {
    globalThis.fetch = REAL_FETCH;
  }
  globalThis.fetch = async () => ({
    ok: false,
    status: 503,
    json: async () => ({}),
  });
  try {
    assert.equal(await verifyTurnstileToken("t2", "ip"), false);
  } finally {
    globalThis.fetch = REAL_FETCH;
    setEnv(undefined, undefined, undefined);
  }
});

test("请求体带 secret / response / remoteip（表单编码）", async () => {
  setEnv("true", "my-secret", "site");
  let captured = null;
  globalThis.fetch = async (url, init) => {
    captured = { url: String(url), body: init?.body };
    return { ok: true, status: 200, json: async () => ({ success: true }) };
  };
  try {
    await verifyTurnstileToken("tok-cap", "8.8.8.8");
    assert.match(captured.url, /siteverify$/);
    assert.match(String(captured.body), /secret=my-secret/);
    assert.match(String(captured.body), /response=tok-cap/);
    assert.match(String(captured.body), /remoteip=8\.8\.8\.8/);
  } finally {
    globalThis.fetch = REAL_FETCH;
    setEnv(undefined, undefined, undefined);
  }
});

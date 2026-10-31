import assert from "node:assert/strict";
import test from "node:test";
import { createApiJson } from "../src/shared/api-client.js";

test("apiJson posts JSON with same-origin credentials and returns body", { concurrency: false }, async () => {
  const calls = [];
  const original = global.fetch;
  global.fetch = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, json: async () => ({ ok: true, value: 1 }) };
  };
  try {
    const apiJson = createApiJson();
    const body = await apiJson("/api/x", { method: "POST", body: "{}" });
    assert.deepEqual(body, { ok: true, value: 1 });
    assert.equal(calls[0].url, "/api/x");
    assert.equal(calls[0].init.credentials, "same-origin");
    assert.equal(calls[0].init.headers["Content-Type"], "application/json");
  } finally {
    global.fetch = original;
  }
});

test("apiJson throws ApiError-like error with status/code/details on non-ok", { concurrency: false }, async () => {
  const original = global.fetch;
  global.fetch = async () => ({ ok: false, status: 409, json: async () => ({ code: "CONFLICT", message: "stale", details: { revision: 3 } }) });
  try {
    const apiJson = createApiJson();
    await assert.rejects(apiJson("/api/x"), (error) => error.status === 409 && error.code === "CONFLICT" && error.message === "stale" && error.details.revision === 3);
  } finally {
    global.fetch = original;
  }
});

test("apiJson uses fallback message when body has none", { concurrency: false }, async () => {
  const original = global.fetch;
  global.fetch = async () => ({ ok: false, status: 500, json: async () => { throw new Error("bad json"); } });
  try {
    await assert.rejects(createApiJson({ fallbackMessage: "请求失败，请重试。 " })("/api/x"), /请求失败/);
    await assert.rejects(createApiJson()("/api/x"), /Request failed\./);
  } finally {
    global.fetch = original;
  }
});

test("apiJson short-circuits to demoHandler without fetching", { concurrency: false }, async () => {
  const original = global.fetch;
  global.fetch = async () => { throw new Error("must not fetch"); };
  try {
    const apiJson = createApiJson({ demoHandler: async (url) => ({ demo: url }) });
    assert.deepEqual(await apiJson("/api/y"), { demo: "/api/y" });
  } finally {
    global.fetch = original;
  }
});

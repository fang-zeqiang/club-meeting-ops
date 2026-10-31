import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import { checkExternalPublicUrl, pinnedLookup } from "../server/external-public-url.js";

const publicLookup = async () => [{ address: "8.8.8.8", family: 4 }];
const DOCS_URL = "https://docs.qq.com/slide/DTEST";

test("network errors during the provider fetch return unknown instead of a hard block", async () => {
  const result = await checkExternalPublicUrl(DOCS_URL, {
    lookup: publicLookup,
    fetchImpl: async () => { throw Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }); },
  });
  assert.equal(result.status, "unknown");
  assert.equal(result.provider, "tencent-docs");
  assert.match(result.reason, /could not be checked automatically/);
});

test("timeouts and redirect anomalies return unknown", async () => {
  const timeout = await checkExternalPublicUrl(DOCS_URL, {
    lookup: publicLookup,
    fetchImpl: async () => { throw new DOMException("The operation was aborted due to timeout", "TimeoutError"); },
  });
  assert.equal(timeout.status, "unknown");

  const noLocation = await checkExternalPublicUrl(DOCS_URL, {
    lookup: publicLookup,
    fetchImpl: async () => new Response(null, { status: 302 }),
  });
  assert.equal(noLocation.status, "unknown");

  const loop = await checkExternalPublicUrl(DOCS_URL, {
    lookup: publicLookup,
    fetchImpl: async () => new Response(null, { status: 302, headers: { Location: DOCS_URL } }),
  });
  assert.equal(loop.status, "unknown");
});

test("transient HTTP statuses are unknown while definitive 4xx stays unreachable", async () => {
  for (const status of [429, 500, 503]) {
    const result = await checkExternalPublicUrl(DOCS_URL, { lookup: publicLookup, fetchImpl: async () => new Response("", { status }) });
    assert.equal(result.status, "unknown", `HTTP ${status}`);
  }
  for (const status of [401, 403, 404]) {
    const result = await checkExternalPublicUrl(DOCS_URL, { lookup: publicLookup, fetchImpl: async () => new Response("", { status }) });
    assert.equal(result.status, "unreachable", `HTTP ${status}`);
  }
});

test("login walls stay private and SSRF checks still reject redirects to private addresses", async () => {
  const privateResult = await checkExternalPublicUrl(DOCS_URL, {
    lookup: publicLookup,
    fetchImpl: async () => new Response("请登录后申请权限", { status: 200 }),
  });
  assert.equal(privateResult.status, "private");

  // 跨 provider 重定向不再跟随；同 provider 重定向若解析到内网地址仍被 SSRF 拦截
  const crossProvider = await checkExternalPublicUrl(DOCS_URL, {
    lookup: publicLookup,
    fetchImpl: async () => new Response(null, { status: 302, headers: { Location: "https://evil.example/internal" } }),
  });
  assert.equal(crossProvider.status, "unknown");
  let lookups = 0;
  await assert.rejects(() => checkExternalPublicUrl(DOCS_URL, {
    lookup: async () => (lookups++ === 0 ? [{ address: "8.8.8.8", family: 4 }] : [{ address: "10.0.0.1", family: 4 }]),
    fetchImpl: async () => new Response(null, { status: 302, headers: { Location: "https://docs.qq.com/slide/next" } }),
  }), (error) => error.code === "EXTERNAL_URL_SSRF_BLOCKED");
});

test("pinned lookup works with Node autoSelectFamily (lookup called with all: true)", async () => {
  const server = http.createServer((_request, response) => response.end("ok"));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    for (const address of [{ address: "127.0.0.1", family: 4 }, { address: "127.0.0.1" }]) {
      const status = await new Promise((resolve, reject) => {
        const request = http.request(`http://pinned.invalid:${port}/`, { lookup: pinnedLookup(address) }, (response) => {
          response.resume();
          resolve(response.statusCode);
        });
        request.on("error", reject);
        request.end();
      });
      assert.equal(status, 200);
    }
  } finally {
    server.close();
  }

  const single = await new Promise((resolve) => pinnedLookup({ address: "8.8.8.8", family: 4 })("x", {}, (...args) => resolve(args)));
  assert.deepEqual(single, [null, "8.8.8.8", 4]);
});

test("provider checks stay on the provider host when the path starts with //", async () => {
  const lookedUp = [];
  const fetched = [];
  await checkExternalPublicUrl("https://docs.qq.com//evil.example/slide", {
    lookup: async (hostname) => { lookedUp.push(hostname); return [{ address: "8.8.8.8", family: 4 }]; },
    fetchImpl: async (url) => { fetched.push(new URL(url).hostname); return new Response("<title>腾讯文档</title>", { status: 200 }); },
  });
  assert.deepEqual([...new Set(lookedUp)], ["docs.qq.com"]);
  assert.deepEqual(fetched, ["docs.qq.com"]);
});

import assert from "node:assert/strict";
import test from "node:test";

import mcpHandler from "../server/mcp.js";
import { clearMcpAccessCache } from "../server/mcp-auth.js";

const PERSONAL_TOKEN = `vpe_${"c".repeat(43)}`;
const CONFIG = {
  FEISHU_APP_ID: "app",
  FEISHU_APP_SECRET: "secret",
  BITABLE_APP_TOKEN: "base",
  BITABLE_MEETINGS_TABLE_ID: "meetings",
  BITABLE_TEMPLATES_TABLE_ID: "templates",
  BITABLE_BLOCKS_TABLE_ID: "blocks",
  BITABLE_ITEMS_TABLE_ID: "items",
  BITABLE_MEMBERS_TABLE_ID: "members",
  BITABLE_ROLES_TABLE_ID: "roles",
  BITABLE_ASSETS_TABLE_ID: "assets",
  BITABLE_MCP_TOKENS_TABLE_ID: "mcp-tokens",
  AGENDA_SESSION_SECRET: "test-session-secret",
};

function listResponse(fields, rows) {
  return new Response(JSON.stringify({
    code: 0,
    data: { fields, record_id_list: rows.map((_, index) => `rec_${index}`), data: rows, has_more: false },
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

// 以 global.fetch 为模型缝：token、MCP 鉴权表、海报资产表、会议表各自返回脚本化数据。
function installFetch() {
  global.fetch = async (url) => {
    const target = String(url);
    if (target.includes("/auth/v3/tenant_access_token/internal")) {
      return new Response(JSON.stringify({ code: 0, tenant_access_token: "tenant", expire: 7200 }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (target.includes("/tables/mcp-tokens/records")) return listResponse(["Name", "Token", "Enabled", "Note"], [["Test Officer", PERSONAL_TOKEN, true, ""]]);
    if (target.includes("/tables/assets/records")) {
      return listResponse(["asset_key", "image"], [["future_poster_1", [{ file_token: "poster-token-1", name: "p1.png", type: "image/png", size: 10 }]]]);
    }
    if (target.includes("/tables/meetings/records")) return listResponse(["meeting_id", "meeting_number"], []);
    throw new Error(`Unexpected fetch: ${target}`);
  };
}

async function callTool(name, args) {
  const response = {
    statusCode: 200,
    headers: {},
    body: "",
    status(code) { this.statusCode = code; return this; },
    setHeader(key, value) { this.headers[key.toLowerCase()] = value; return this; },
    end(body = "") { this.body = String(body); return this; },
  };
  await mcpHandler({
    method: "POST",
    query: {},
    headers: { authorization: `Bearer ${PERSONAL_TOKEN}`, host: "localhost", "content-type": "application/json" },
    body: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } },
  }, response);
  return JSON.parse(response.body).result;
}

const originalFetch = global.fetch;
test.beforeEach(() => {
  Object.assign(process.env, CONFIG);
  clearMcpAccessCache();
  installFetch();
});
test.afterEach(() => {
  global.fetch = originalFetch;
});

test("vpe_log_user_intent treats blank missing_capability as omitted when satisfied", { concurrency: false }, async () => {
  for (const blank of ["", "   "]) {
    const result = await callTool("vpe_log_user_intent", { intent_summary: "查了下周会议空缺", satisfied: true, missing_capability: blank });
    assert.equal(result.isError, false, JSON.stringify(result.structuredContent));
    assert.deepEqual(result.structuredContent, { recorded: true });
  }
});

test("vpe_log_user_intent still rejects invalid non-empty missing_capability", { concurrency: false }, async () => {
  const result = await callTool("vpe_log_user_intent", { intent_summary: "查了下周会议空缺", satisfied: false, missing_capability: "line one\nline two" });
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.code, "INVALID_MISSING_CAPABILITY");
});

test("vpe_log_user_intent schema tells agents to omit or send empty string when satisfied", { concurrency: false }, async () => {
  const response = {
    body: "",
    status() { return this; },
    setHeader() { return this; },
    end(body = "") { this.body = String(body); return this; },
  };
  await mcpHandler({
    method: "POST",
    query: {},
    headers: { authorization: `Bearer ${PERSONAL_TOKEN}`, host: "localhost", "content-type": "application/json" },
    body: { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
  }, response);
  const tool = JSON.parse(response.body).result.tools.find(({ name }) => name === "vpe_log_user_intent");
  assert.match(tool.inputSchema.properties.missing_capability.description, /省略或传空串/);
});

test("vpe_get_future_posters text content exposes each slot version", { concurrency: false }, async () => {
  const result = await callTool("vpe_get_future_posters", {});
  assert.equal(result.isError, false, JSON.stringify(result.structuredContent));
  const [slot1, slot2] = result.structuredContent.posters;
  assert.ok(slot1.version);
  assert.equal(slot2.version, "");
  const text = result.content[0].text;
  assert.match(text, new RegExp(`Slot 1[^\\n]*version="${slot1.version}"`));
  assert.match(text, /Slot 2[^\n]*version=""/);
});

test("vpe_prepare_future_poster_upload text content carries upload URL, method, content type, size and expiry", { concurrency: false }, async () => {
  const posters = await callTool("vpe_get_future_posters", {});
  const version = posters.structuredContent.posters[0].version;
  const result = await callTool("vpe_prepare_future_poster_upload", { slot: 1, expected_version: version, filename: "poster.png" });
  assert.equal(result.isError, false, JSON.stringify(result.structuredContent));
  const data = result.structuredContent;
  const text = result.content[0].text;
  assert.ok(text.includes(data.uploadUrl), "text must contain the full uploadUrl");
  assert.match(text, /PUT/);
  assert.match(text, /image\/png/);
  assert.match(text, /image\/jpeg/);
  assert.ok(text.includes(String(data.maxBytes)));
  assert.ok(text.includes(data.expiresAt));
});

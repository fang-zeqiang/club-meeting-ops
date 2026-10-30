import assert from "node:assert/strict";
import test from "node:test";

import rolesHandler from "../api/members.js";
import { createSessionToken } from "../server/auth.js";

function responseMock() {
  return {
    statusCode: 200,
    headers: {},
    body: "",
    status(code) { this.statusCode = code; return this; },
    setHeader(name, value) { this.headers[name.toLocaleLowerCase()] = value; return this; },
    end(body = "") { this.body = String(body); return this; },
  };
}

test("roles API requires Agenda authentication", async () => {
  const response = responseMock();
  await rolesHandler({ method: "GET", query: { view: "roles" }, headers: {} }, response);
  assert.equal(response.statusCode, 401);
  assert.equal(JSON.parse(response.body).code, "UNAUTHENTICATED");
});

test("roles API rejects cross-origin writes before touching Base", async () => {
  process.env.AGENDA_SESSION_SECRET = "roles-api-test-secret";
  const response = responseMock();
  await rolesHandler({
    method: "POST",
    query: { view: "roles" },
    headers: {
      cookie: `agenda_session=${createSessionToken()}`,
      origin: "https://forged.example",
      host: "localhost",
    },
    body: { name: "Workshop Host" },
  }, response);
  assert.equal(response.statusCode, 403);
  assert.equal(JSON.parse(response.body).code, "INVALID_ORIGIN");
});

test("roles API exposes SOP URLs without fetching SOP content", { concurrency: false }, async () => {
  Object.assign(process.env, {
    AGENDA_SESSION_SECRET: "roles-api-test-secret",
    FEISHU_APP_ID: "test-app-id", FEISHU_APP_SECRET: "test-app-secret", BITABLE_APP_TOKEN: "test-base",
    BITABLE_MEETINGS_TABLE_ID: "meetings", BITABLE_BLOCKS_TABLE_ID: "blocks", BITABLE_ITEMS_TABLE_ID: "items",
    BITABLE_MEMBERS_TABLE_ID: "members", BITABLE_TEMPLATES_TABLE_ID: "templates", BITABLE_ASSETS_TABLE_ID: "assets", BITABLE_ROLES_TABLE_ID: "roles",
  });
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    const path = new URL(url).pathname;
    if (path.endsWith("/tenant_access_token/internal")) return new Response(JSON.stringify({ code: 0, tenant_access_token: "test-token", expire: 7200 }), { headers: { "content-type": "application/json" } });
    assert.match(path, /\/tables\/roles\/records/);
    return new Response(JSON.stringify({ code: 0, data: { fields: ["role_name", "aliases", "active", "sort_order", "sop_url"], record_id_list: ["role1"], data: [["Timer", "", true, 10, "https://example.com/timer-sop"]], has_more: false } }), { headers: { "content-type": "application/json" } });
  };
  try {
    const response = responseMock();
    await rolesHandler({ method: "GET", query: { view: "roles" }, headers: { cookie: `agenda_session=${createSessionToken()}` } }, response);
    assert.equal(response.statusCode, 200);
    assert.equal(JSON.parse(response.body).roles[0].sopUrl, "https://example.com/timer-sop");
  } finally {
    global.fetch = originalFetch;
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import healthHandler from "../api/health.js";

function responseMock() {
  return {
    statusCode: 200,
    body: "",
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

const envKeys = [
  "FEISHU_APP_ID",
  "FEISHU_APP_SECRET",
  "BITABLE_APP_TOKEN",
  "BITABLE_MEETINGS_TABLE_ID",
  "BITABLE_TEMPLATES_TABLE_ID",
  "BITABLE_BLOCKS_TABLE_ID",
  "BITABLE_ITEMS_TABLE_ID",
  "BITABLE_MEMBERS_TABLE_ID",
  "BITABLE_ASSETS_TABLE_ID",
  "BITABLE_MCP_TOKENS_TABLE_ID",
  "BITABLE_ROLES_TABLE_ID",
  "AGENDA_EDIT_PASSCODE_HASH",
  "BOOKING_PASSCODE_HASH",
  "AGENDA_SESSION_SECRET",
];

test("health reports local-only when template persistence is not configured", () => {
  const previous = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  try {
    envKeys.forEach((key) => delete process.env[key]);
    process.env.FEISHU_APP_ID = "app";
    process.env.FEISHU_APP_SECRET = "secret";
    process.env.BITABLE_APP_TOKEN = "token";
    process.env.BITABLE_MEETINGS_TABLE_ID = "meetings";
    process.env.BITABLE_BLOCKS_TABLE_ID = "blocks";
    process.env.BITABLE_ITEMS_TABLE_ID = "items";
    process.env.BITABLE_MEMBERS_TABLE_ID = "members";
    process.env.BITABLE_ASSETS_TABLE_ID = "assets";
    process.env.BITABLE_MCP_TOKENS_TABLE_ID = "mcp-tokens";
    process.env.BITABLE_ROLES_TABLE_ID = "roles";
    process.env.AGENDA_EDIT_PASSCODE_HASH = "hash";
    process.env.AGENDA_SESSION_SECRET = "session";

    const response = responseMock();
    healthHandler({}, response);
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.persistence, "local-only");
    assert.equal(response.body.booking, "not-configured");
    assert.equal(response.body.mcp, "ready");
  } finally {
    Object.entries(previous).forEach(([key, value]) => {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    });
  }
});

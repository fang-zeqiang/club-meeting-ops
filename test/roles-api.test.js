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

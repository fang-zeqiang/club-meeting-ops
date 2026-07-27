import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import votingHandler from "../api/meetings/[id]/images/voting.js";
import assetHandler from "../api/assets/[kind].js";
import { createSessionToken } from "../server/auth.js";
import { MAX_QR_IMAGE_BYTES } from "../server/qr-image.js";

function responseMock() {
  return {
    statusCode: 200,
    headers: {},
    body: "",
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(name, value) {
      this.headers[name.toLocaleLowerCase()] = value;
      return this;
    },
    end(body = "") {
      this.body = Buffer.isBuffer(body) ? body : String(body);
      return this;
    },
  };
}

function authorizedRequest(overrides = {}) {
  process.env.AGENDA_SESSION_SECRET = "media-api-test-secret";
  const token = createSessionToken();
  return {
    method: "POST",
    query: { id: "meeting_test" },
    headers: {
      cookie: `agenda_session=${token}`,
      origin: "http://localhost",
      host: "localhost",
      "content-type": "image/png",
      "content-length": "4",
      "x-file-name": "vote.png",
      "x-expected-revision": "1",
    },
    body: Buffer.from("nope"),
    ...overrides,
  };
}

function png(width, height) {
  const buffer = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer);
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

test("media API requires an authenticated session", async () => {
  const response = responseMock();
  await votingHandler({ method: "GET", query: { id: "meeting_test" }, headers: {} }, response);
  assert.equal(response.statusCode, 401);
  assert.equal(JSON.parse(response.body).code, "UNAUTHENTICATED");
});

test("media API rejects unsupported or forged image content before storage", async () => {
  const response = responseMock();
  const request = authorizedRequest({
    headers: { ...authorizedRequest().headers, "content-type": "text/plain" },
  });
  await votingHandler(request, response);
  assert.equal(response.statusCode, 415);
  assert.equal(JSON.parse(response.body).code, "UNSUPPORTED_IMAGE_TYPE");
});

test("media API rejects bodies over 2 MB before storage", async () => {
  const response = responseMock();
  const request = authorizedRequest();
  request.headers["content-length"] = String(MAX_QR_IMAGE_BYTES + 1);
  request.body = Buffer.alloc(1);
  await votingHandler(request, response);
  assert.equal(response.statusCode, 413);
  assert.equal(JSON.parse(response.body).code, "IMAGE_TOO_LARGE");
});

test("media API rejects images outside the 5% square tolerance", async () => {
  const response = responseMock();
  const request = authorizedRequest();
  request.body = png(500, 400);
  request.headers["content-length"] = String(request.body.length);
  await votingHandler(request, response);
  assert.equal(response.statusCode, 400);
  assert.equal(JSON.parse(response.body).code, "IMAGE_NOT_SQUARE");
});

test("media API enforces same-origin writes", async () => {
  const response = responseMock();
  const request = authorizedRequest();
  request.headers.origin = "https://example.com";
  await votingHandler(request, response);
  assert.equal(response.statusCode, 403);
  assert.equal(JSON.parse(response.body).code, "INVALID_ORIGIN");
});

test("future poster reads are public only for presentation while writes stay protected", async () => {
  const source = await readFile(new URL("../api/assets/[kind].js", import.meta.url), "utf8");
  assert.match(source, /request\.method === "GET"[\s\S]*view[\s\S]*=== "presentation"[\s\S]*startsWith\("future-poster-"\)/);
  assert.match(source, /if \(!publicPosterRead && !requireSession\(request, response\)\) return/);
  assert.match(source, /"future-poster-1"[\s\S]*"future-poster-2"/);
  assert.match(source, /config\.kind === "club-intro-photo"/);
});

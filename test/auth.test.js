import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  createBookingSessionToken,
  createSessionToken,
  verifyBookingPasscode,
  verifyBookingSessionToken,
  verifyPasscode,
  verifySessionToken,
} from "../server/auth.js";
import sessionHandler from "../api/session.js";

function responseRecorder() {
  const headers = {};
  return {
    headers,
    response: {
      status(code) {
        this.statusCode = code;
        return this;
      },
      setHeader(name, value) {
        headers[name] = value;
        return this;
      },
      end(body) {
        this.body = JSON.parse(body);
      },
    },
  };
}

test("session tokens are signed and expire", () => {
  process.env.AGENDA_SESSION_SECRET = "test-session-secret";
  const now = Date.UTC(2026, 5, 27, 8, 0, 0);
  const token = createSessionToken(now);
  assert.equal(verifySessionToken(token, now + 1000), true);
  assert.equal(verifySessionToken(`${token}broken`, now + 1000), false);
  assert.equal(verifySessionToken(token, now + 13 * 60 * 60 * 1000), false);
});

test("passcodes use a scrypt digest", () => {
  const salt = "0011223344556677";
  const digest = crypto.scryptSync("correct horse", salt, 64).toString("hex");
  process.env.AGENDA_EDIT_PASSCODE_HASH = `scrypt$${salt}$${digest}`;
  assert.equal(verifyPasscode("correct horse"), true);
  assert.equal(verifyPasscode("wrong"), false);
});

test("booking PIN uses a separate signed session", () => {
  const salt = "8899aabbccddeeff";
  process.env.BOOKING_PASSCODE_HASH = `scrypt$${salt}$${crypto.scryptSync("2468", salt, 64).toString("hex")}`;
  process.env.AGENDA_SESSION_SECRET = "test-session-secret";
  const now = Date.UTC(2026, 6, 17, 8, 0, 0);
  const token = createBookingSessionToken(now);
  assert.equal(verifyBookingPasscode("2468"), true);
  assert.equal(verifyBookingPasscode("wrong"), false);
  assert.equal(verifyBookingSessionToken(token, now + 1000), true);
  assert.equal(verifySessionToken(token, now + 1000), false);
});

test("local HTTP login creates a cookie the browser can return", async () => {
  const salt = "0011223344556677";
  const passcode = "local-passcode";
  process.env.AGENDA_EDIT_PASSCODE_HASH = `scrypt$${salt}$${crypto.scryptSync(passcode, salt, 64).toString("hex")}`;
  process.env.AGENDA_SESSION_SECRET = "test-session-secret";
  const { headers, response } = responseRecorder();

  await sessionHandler({
    method: "POST",
    headers: { host: "localhost:5173", origin: "http://localhost:5173" },
    body: { passcode },
  }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.authenticated, true);
  assert.doesNotMatch(headers["Set-Cookie"], /; Secure/);
});

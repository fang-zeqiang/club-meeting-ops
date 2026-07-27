import crypto from "node:crypto";
import { sendJson } from "./http.js";

const COOKIE_NAME = "agenda_session";
const BOOKING_COOKIE_NAME = "booking_session";
const SESSION_TTL_SECONDS = 12 * 60 * 60;

function encode(value) {
  return Buffer.from(value).toString("base64url");
}

function signature(value, secret = process.env.AGENDA_SESSION_SECRET) {
  if (!secret) return "";
  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
}

export function createSessionToken(now = Date.now()) {
  const payload = encode(JSON.stringify({ exp: Math.floor(now / 1000) + SESSION_TTL_SECONDS }));
  return `${payload}.${signature(payload)}`;
}

export function verifySessionToken(token, now = Date.now()) {
  if (!token || !process.env.AGENDA_SESSION_SECRET) return false;
  const [payload, suppliedSignature] = token.split(".");
  if (!payload || !suppliedSignature) return false;
  const expectedSignature = signature(payload);
  const supplied = Buffer.from(suppliedSignature);
  const expected = Buffer.from(expectedSignature);
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return false;

  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return Number(decoded.exp) > Math.floor(now / 1000);
  } catch {
    return false;
  }
}

export function verifyPasscode(passcode) {
  return verifyStoredPasscode(passcode, process.env.AGENDA_EDIT_PASSCODE_HASH);
}

export function verifyBookingPasscode(passcode) {
  return verifyStoredPasscode(passcode, process.env.BOOKING_PASSCODE_HASH);
}

function verifyStoredPasscode(passcode, stored = "") {
  const [algorithm, salt, digest] = stored.split("$");
  if (algorithm !== "scrypt" || !salt || !digest || typeof passcode !== "string") return false;
  const expected = Buffer.from(digest, "hex");
  const actual = crypto.scryptSync(passcode, salt, expected.length);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

export function sessionCookie(token, { secure = true } = {}) {
  return `${COOKIE_NAME}=${token}; Path=/; Max-Age=${SESSION_TTL_SECONDS}; HttpOnly${secure ? "; Secure" : ""}; SameSite=Lax`;
}

export function clearSessionCookie({ secure = true } = {}) {
  return `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly${secure ? "; Secure" : ""}; SameSite=Lax`;
}

export function createBookingSessionToken(now = Date.now()) {
  const payload = encode(JSON.stringify({ exp: Math.floor(now / 1000) + SESSION_TTL_SECONDS }));
  return `${payload}.${signature(`booking:${payload}`)}`;
}

export function verifyBookingSessionToken(token, now = Date.now()) {
  if (!token || !process.env.AGENDA_SESSION_SECRET) return false;
  const [payload, suppliedSignature] = token.split(".");
  if (!payload || !suppliedSignature) return false;
  const expectedSignature = signature(`booking:${payload}`);
  const supplied = Buffer.from(suppliedSignature);
  const expected = Buffer.from(expectedSignature);
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return false;

  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return Number(decoded.exp) > Math.floor(now / 1000);
  } catch {
    return false;
  }
}

export function bookingSessionCookie(token, { secure = true } = {}) {
  return `${BOOKING_COOKIE_NAME}=${token}; Path=/; Max-Age=${SESSION_TTL_SECONDS}; HttpOnly${secure ? "; Secure" : ""}; SameSite=Lax`;
}

export function clearBookingSessionCookie({ secure = true } = {}) {
  return `${BOOKING_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly${secure ? "; Secure" : ""}; SameSite=Lax`;
}

function cookies(request) {
  return Object.fromEntries(
    String(request.headers.cookie || "")
      .split(";")
      .map((part) => part.trim().split("="))
      .filter(([key]) => key),
  );
}

export function getSession(request) {
  return verifySessionToken(cookies(request)[COOKIE_NAME]);
}

export function getBookingSession(request) {
  return verifyBookingSessionToken(cookies(request)[BOOKING_COOKIE_NAME]);
}

export function requireSession(request, response) {
  if (getSession(request)) return true;
  sendJson(response, 401, { code: "UNAUTHENTICATED", message: "Please sign in to continue." });
  return false;
}

export function requireBookingSession(request, response) {
  if (getBookingSession(request)) return true;
  sendJson(response, 401, { code: "UNAUTHENTICATED", message: "请输入会员 PIN。" });
  return false;
}

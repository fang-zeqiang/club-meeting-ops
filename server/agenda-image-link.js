import crypto from "node:crypto";

// 长图分享的免登录短时链接：HMAC 签名 + 过期时间，复用 mcp-auth.js 的模式（同一把 AGENDA_SESSION_SECRET）。
function secret() {
  const value = String(process.env.AGENDA_SESSION_SECRET || "");
  if (!value) throw new Error("AGENDA_SESSION_SECRET is not configured.");
  return value;
}

function hmac(value) {
  return crypto.createHmac("sha256", secret()).update(`agenda-image-link:${value}`).digest("base64url");
}

export function signAgendaImageLink(meetingId, ttlSeconds = 24 * 60 * 60, now = Date.now()) {
  const exp = Math.floor(now / 1000) + ttlSeconds;
  return { exp, sig: hmac(`${meetingId}.${exp}`) };
}

export function verifyAgendaImageLink(meetingId, sig, exp, now = Date.now()) {
  const expNumber = Number(exp);
  if (!Number.isInteger(expNumber) || expNumber <= Math.floor(now / 1000)) return false;
  const supplied = Buffer.from(String(sig || ""));
  const expected = Buffer.from(hmac(`${meetingId}.${expNumber}`));
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

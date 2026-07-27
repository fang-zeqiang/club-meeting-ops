import crypto from "node:crypto";

import { ApiError, createRecord, getBitableConfig, listRecords } from "./bitable.js";
import { readJson, requestOrigin, sendJson } from "./http.js";
import { asText } from "./meeting-schema.js";

const ACCESS_TTL_SECONDS = 60 * 60;
const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;
const CODE_TTL_SECONDS = 5 * 60;
const TOKEN_CACHE_TTL_MS = 60 * 1000;
const PERSONAL_TOKEN_PATTERN = /^vpe_[A-Za-z0-9_-]{43}$/;
let accessCache = null;

function signingSecret() {
  const value = String(process.env.AGENDA_SESSION_SECRET || "");
  if (!value) throw new ApiError(503, "MCP_NOT_CONFIGURED", "AGENDA_SESSION_SECRET is not configured.");
  return value;
}

function hmac(value) {
  return crypto.createHmac("sha256", signingSecret()).update(`agenda-mcp-oauth:${value}`).digest("base64url");
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function signedValue(prefix, payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${prefix}${encoded}.${hmac(`${prefix}${encoded}`)}`;
}

function verifySignedValue(value, prefix, type, now = Date.now()) {
  const raw = String(value || "");
  if (!raw.startsWith(prefix)) throw new ApiError(401, "INVALID_OAUTH_TOKEN", "OAuth token is invalid.");
  const [encoded, suppliedSignature] = raw.slice(prefix.length).split(".");
  if (!encoded || !suppliedSignature || !safeEqual(suppliedSignature, hmac(`${prefix}${encoded}`))) {
    throw new ApiError(401, "INVALID_OAUTH_TOKEN", "OAuth token is invalid.");
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw new ApiError(401, "INVALID_OAUTH_TOKEN", "OAuth token is invalid.");
  }
  if (payload.typ !== type || !Number.isInteger(payload.exp) || payload.exp <= Math.floor(now / 1000)) {
    throw new ApiError(401, "OAUTH_TOKEN_EXPIRED", "OAuth token is invalid or expired.");
  }
  return payload;
}

function isEnabled(value) {
  return value === true || value === 1 || String(value).toLocaleLowerCase() === "true";
}

async function accessEntries(now = Date.now()) {
  if (accessCache?.expiresAt > now) return accessCache.entries;
  const tableId = getBitableConfig().mcpTokensTableId;
  if (!tableId) throw new ApiError(503, "MCP_NOT_CONFIGURED", "BITABLE_MCP_TOKENS_TABLE_ID is not configured.");
  try {
    const records = await listRecords(tableId);
    const seen = new Set();
    const duplicates = new Set();
    const entries = records.flatMap((record) => {
      const token = asText(record.fields.Token).trim();
      if (!isEnabled(record.fields.Enabled) || !PERSONAL_TOKEN_PATTERN.test(token)) return [];
      if (seen.has(token)) duplicates.add(token);
      seen.add(token);
      return [{ id: record.record_id, name: asText(record.fields.Name).trim() || "VPE officer", token }];
    }).filter((entry) => !duplicates.has(entry.token));
    accessCache = { entries, expiresAt: now + TOKEN_CACHE_TTL_MS };
    return entries;
  } catch (error) {
    if (error instanceof ApiError && error.code === "MCP_NOT_CONFIGURED") throw error;
    throw new ApiError(503, "MCP_AUTH_UNAVAILABLE", "MCP access validation is temporarily unavailable.");
  }
}

export function clearMcpAccessCache() {
  accessCache = null;
}

export async function registerMcpTrial(rawName, rawToken) {
  const name = String(rawName || "").trim().replace(/\s+/g, " ");
  const token = String(rawToken || "");
  if (name.length < 2 || name.length > 80 || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new ApiError(400, "INVALID_MCP_NAME", "Name must contain 2 to 80 characters.");
  }
  if (!PERSONAL_TOKEN_PATTERN.test(token)) {
    throw new ApiError(400, "INVALID_MCP_TOKEN", "Token format is invalid.");
  }
  const tableId = getBitableConfig().mcpTokensTableId;
  if (!tableId) throw new ApiError(503, "MCP_NOT_CONFIGURED", "BITABLE_MCP_TOKENS_TABLE_ID is not configured.");
  const existing = (await listRecords(tableId)).find((record) => safeEqual(asText(record.fields.Token).trim(), token));
  if (existing) return { name: asText(existing.fields.Name).trim() || name, enabled: isEnabled(existing.fields.Enabled), created: false };
  await createRecord(tableId, {
    Name: name,
    Token: token,
    Enabled: false,
    Note: "Self-service trial request · pending VPE approval",
  });
  return { name, enabled: false, created: true };
}

async function principalForPersonalToken(token) {
  if (!PERSONAL_TOKEN_PATTERN.test(String(token || ""))) return null;
  return (await accessEntries()).find((entry) => safeEqual(entry.token, token)) || null;
}

async function enabledPrincipal(id) {
  return (await accessEntries()).find((entry) => entry.id === id) || null;
}

export async function authenticateMcpBearer(token) {
  const supplied = String(token || "");
  if (supplied.startsWith("vpe_oauth_")) {
    const payload = verifySignedValue(supplied, "vpe_oauth_", "access");
    return enabledPrincipal(payload.sub);
  }
  return principalForPersonalToken(supplied);
}

export function mcpOAuthChallenge(request) {
  return `Bearer resource_metadata="${requestOrigin(request)}/.well-known/oauth-protected-resource/api/mcp", scope="mcp"`;
}

function clientHash(clientId) {
  return crypto.createHash("sha256").update(String(clientId)).digest("base64url");
}

function validRedirectUri(value) {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.hash) return false;
    if (url.protocol === "https:") return true;
    return url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

function registeredClient(clientId) {
  const payload = verifySignedValue(clientId, "vpe_client_", "client");
  if (!Array.isArray(payload.redirectUris) || !payload.redirectUris.every(validRedirectUri)) {
    throw new ApiError(400, "INVALID_CLIENT", "OAuth client is invalid.");
  }
  return payload;
}

function oauthError(response, status, error, description) {
  return sendJson(response, status, { error, error_description: description });
}

async function readForm(request) {
  if (request.body && typeof request.body === "object") return request.body;
  let raw = "";
  for await (const chunk of request) raw += chunk;
  return Object.fromEntries(new URLSearchParams(raw));
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function authorizationParams(input) {
  const responseType = String(input.response_type || "");
  const clientId = String(input.client_id || "");
  const redirectUri = String(input.redirect_uri || "");
  const challenge = String(input.code_challenge || "");
  const challengeMethod = String(input.code_challenge_method || "");
  const state = String(input.state || "");
  const scope = String(input.scope || "mcp offline_access");
  const client = registeredClient(clientId);
  if (responseType !== "code" || !client.redirectUris.includes(redirectUri)) {
    throw new ApiError(400, "INVALID_OAUTH_REQUEST", "OAuth request is invalid.");
  }
  if (challengeMethod !== "S256" || !/^[A-Za-z0-9_-]{43,128}$/.test(challenge)) {
    throw new ApiError(400, "INVALID_OAUTH_REQUEST", "PKCE S256 is required.");
  }
  return { client, clientId, redirectUri, challenge, state, scope };
}

function sendAuthorizationPage(response, input, error = "") {
  const params = authorizationParams(input);
  response.status(200);
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
  response.end(`<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>连接 VPE Agenda</title><style>
:root{font-family:system-ui,sans-serif;color:#12233f;background:#eaf2f8}*{box-sizing:border-box}body{min-height:100vh;margin:0;display:grid;place-items:center;padding:24px}
main{width:min(100%,440px);padding:32px;border:1px solid #cbd7e4;border-radius:18px;background:white;box-shadow:0 18px 44px #12233f20}
small{color:#3157d5;font-weight:800}h1{margin:10px 0 8px;font-size:32px}p{color:#65738a;line-height:1.6}label{display:grid;gap:8px;margin:24px 0 12px;font-weight:700}
input,button{width:100%;min-height:48px;border-radius:10px;font:inherit}input{padding:0 12px;border:1px solid #9eacbd}button{border:0;color:white;background:#3157d5;font-weight:800}.error{min-height:20px;color:#c94652;font-size:13px}
</style></head><body><main><small>VPE AGENDA MCP</small><h1>连接 Future Posters</h1>
<p>输入管理员私聊发送的个人 Token。连接身份：${escapeHtml(params.client.name || "ChatGPT")}。</p>
<form method="post" action="/oauth/authorize">
${["response_type", "client_id", "redirect_uri", "code_challenge", "code_challenge_method", "state", "scope", "resource"].map((key) => `<input type="hidden" name="${key}" value="${escapeHtml(input[key] || "")}">`).join("")}
<label>个人 Token<input name="token" type="password" required autocomplete="off" pattern="vpe_[A-Za-z0-9_-]{43}"></label>
<p class="error" role="alert">${escapeHtml(error)}</p><button type="submit">连接到 ChatGPT</button>
</form></main></body></html>`);
}

function sendAuthorizationSuccess(response, redirect, clientName) {
  const href = escapeHtml(redirect.href);
  response.status(200);
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'");
  response.end(`<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="1;url=${href}"><title>认证成功 · VPE Agenda</title><style>
:root{font-family:system-ui,sans-serif;color:#12233f;background:#eaf2f8}*{box-sizing:border-box}body{min-height:100vh;margin:0;display:grid;place-items:center;padding:24px}
main{width:min(100%,440px);padding:36px;border:1px solid #cbd7e4;border-radius:18px;background:white;box-shadow:0 18px 44px #12233f20;text-align:center}
i{display:grid;width:58px;height:58px;margin:0 auto 18px;place-items:center;border-radius:50%;color:white;background:#2c8b69;font:700 30px system-ui}
h1{margin:0 0 8px;font-size:32px}p{margin:0 0 24px;color:#65738a;line-height:1.6}a{display:grid;min-height:48px;place-items:center;border-radius:10px;color:white;background:#3157d5;font-weight:800;text-decoration:none}
</style></head><body><main role="status"><i aria-hidden="true">✓</i><h1>认证成功</h1>
<p>即将返回 ${escapeHtml(clientName || "ChatGPT")}。</p><a id="oauth-continue" href="${href}">立即返回</a>
</main></body></html>`);
}

async function handleRegister(request, response) {
  if (request.method !== "POST") return oauthError(response, 405, "invalid_request", "Use POST.");
  const body = await readJson(request).catch(() => ({}));
  const redirectUris = Array.isArray(body.redirect_uris) ? [...new Set(body.redirect_uris.map(String))] : [];
  if (!redirectUris.length || redirectUris.length > 10 || !redirectUris.every(validRedirectUri)) {
    return oauthError(response, 400, "invalid_redirect_uri", "redirect_uris must contain valid HTTPS or loopback URLs.");
  }
  const now = Math.floor(Date.now() / 1000);
  const clientId = signedValue("vpe_client_", {
    typ: "client",
    name: String(body.client_name || "MCP client").slice(0, 100),
    redirectUris,
    exp: now + 3650 * 24 * 60 * 60,
  });
  return sendJson(response, 201, {
    client_id: clientId,
    client_id_issued_at: now,
    client_name: String(body.client_name || "MCP client").slice(0, 100),
    redirect_uris: redirectUris,
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
  });
}

async function handleAuthorize(request, response) {
  if (request.method === "GET") {
    try {
      return sendAuthorizationPage(response, request.query || {});
    } catch (error) {
      return oauthError(response, error.statusCode || 400, "invalid_request", error.message);
    }
  }
  if (request.method !== "POST") return oauthError(response, 405, "invalid_request", "Use GET or POST.");
  const body = await readForm(request);
  let params;
  try {
    params = authorizationParams(body);
  } catch (error) {
    return oauthError(response, error.statusCode || 400, "invalid_request", error.message);
  }
  const principal = await principalForPersonalToken(String(body.token || ""));
  if (!principal) return sendAuthorizationPage(response, body, "Token 无效或已停用。");
  const code = signedValue("vpe_code_", {
    typ: "code",
    sub: principal.id,
    name: principal.name,
    cid: clientHash(params.clientId),
    redirectUri: params.redirectUri,
    challenge: params.challenge,
    scope: params.scope,
    exp: Math.floor(Date.now() / 1000) + CODE_TTL_SECONDS,
  });
  const redirect = new URL(params.redirectUri);
  redirect.searchParams.set("code", code);
  if (params.state) redirect.searchParams.set("state", params.state);
  return sendAuthorizationSuccess(response, redirect, params.client.name);
}

function issueTokens({ sub, name, cid, scope = "mcp offline_access" }) {
  const now = Math.floor(Date.now() / 1000);
  return {
    access_token: signedValue("vpe_oauth_", { typ: "access", sub, name, cid, exp: now + ACCESS_TTL_SECONDS }),
    token_type: "Bearer",
    expires_in: ACCESS_TTL_SECONDS,
    refresh_token: signedValue("vpe_refresh_", { typ: "refresh", sub, name, cid, scope, exp: now + REFRESH_TTL_SECONDS }),
    scope,
  };
}

async function handleToken(request, response) {
  if (request.method !== "POST") return oauthError(response, 405, "invalid_request", "Use POST.");
  const body = await readForm(request);
  try {
    if (body.grant_type === "authorization_code") {
      const code = verifySignedValue(body.code, "vpe_code_", "code");
      if (code.cid !== clientHash(body.client_id) || code.redirectUri !== body.redirect_uri) throw new Error();
      const verifier = String(body.code_verifier || "");
      const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
      if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || !safeEqual(challenge, code.challenge)) throw new Error();
      if (!await enabledPrincipal(code.sub)) return oauthError(response, 400, "invalid_grant", "Access is disabled.");
      return sendJson(response, 200, issueTokens(code));
    }
    if (body.grant_type === "refresh_token") {
      const refresh = verifySignedValue(body.refresh_token, "vpe_refresh_", "refresh");
      if (refresh.cid !== clientHash(body.client_id)) throw new Error();
      if (!await enabledPrincipal(refresh.sub)) return oauthError(response, 400, "invalid_grant", "Access is disabled.");
      return sendJson(response, 200, issueTokens(refresh));
    }
  } catch {
    return oauthError(response, 400, "invalid_grant", "Authorization grant is invalid or expired.");
  }
  return oauthError(response, 400, "unsupported_grant_type", "Use authorization_code or refresh_token.");
}

export async function handleMcpOAuth(request, response) {
  const baseUrl = requestOrigin(request);
  const action = String(request.query?.oauth || "");
  if (action === "resource-metadata") {
    return sendJson(response, 200, {
      resource: `${baseUrl}/api/mcp`,
      authorization_servers: [baseUrl],
      bearer_methods_supported: ["header"],
      scopes_supported: ["mcp"],
    });
  }
  if (action === "server-metadata") {
    return sendJson(response, 200, {
      issuer: baseUrl,
      authorization_endpoint: `${baseUrl}/oauth/authorize`,
      token_endpoint: `${baseUrl}/oauth/token`,
      registration_endpoint: `${baseUrl}/oauth/register`,
      scopes_supported: ["mcp", "offline_access"],
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
    });
  }
  if (action === "register") return handleRegister(request, response);
  if (action === "authorize") return handleAuthorize(request, response);
  if (action === "token") return handleToken(request, response);
  return oauthError(response, 404, "invalid_request", "OAuth route not found.");
}

import crypto from "node:crypto";

import { ApiError } from "./bitable.js";
import { requestProtocol, readBuffer, readJson, sendJson, verifySameOrigin } from "./http.js";
import { AGENDA_READ_TOOLS, callAgendaReadTool } from "./mcp-agenda-read.js";
import { authenticateMcpBearer, handleMcpOAuth, mcpOAuthChallenge, registerMcpTrial } from "./mcp-auth.js";
import { getGlobalAssetImage, uploadGlobalAssetImage } from "./media-repository.js";
import { listMeetings } from "./meetings-repository.js";
import { validateFuturePosterImage } from "./qr-image.js";
import { groupMeetingsForSwitchboard } from "../workflow-helpers.js";

const PROTOCOL_VERSIONS = new Set(["2025-11-25", "2025-06-18", "2025-03-26"]);
const UPLOAD_TTL_MS = 5 * 60 * 1000;
const MCP_MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const RATE_LIMIT = 60;
const rateBuckets = new Map();
const trialBuckets = new Map();

const TOOLS = Object.freeze([
  ...AGENDA_READ_TOOLS,
  {
    name: "get_future_posters",
    title: "查询演讲俱乐部近期会议与海报",
    description: "Use when the user asks to query, upload, or update Future Posters. Read both global poster slots plus recent meetings. Slot 1 is the required primary poster; slot 2 is optional.",
    inputSchema: { type: "object", additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "prepare_future_poster_upload",
    title: "上传演讲俱乐部会议预告海报",
    description: "Use for natural requests such as “上传到演讲俱乐部 7.28 会议，用来预告 8.11 会议的海报”. 不要搜索 Chrome、Canva 或上传页面；先调用 get_future_posters，再用本工具上传聊天附件。Upload one ChatGPT image attachment directly, or create a five-minute signed URL for a local PNG/JPEG. Slot 1 replaces the required primary poster shown first. Slot 2 replaces the optional second poster. Always pass the exact expected_version; meeting_number is optional and selects that meeting’s public Future Posters short link and Admin link.",
    inputSchema: {
      type: "object",
      properties: {
        slot: { type: "integer", enum: [1, 2], description: "1 = required primary poster; 2 = optional second poster." },
        expected_version: { type: "string", description: "Exact current slot version from get_future_posters; use an empty string when absent." },
        filename: { type: "string", minLength: 1, maxLength: 180, description: "Local poster filename, ending in .png, .jpg, or .jpeg. Optional when images is supplied by ChatGPT." },
        meeting_number: { type: "integer", minimum: 1, description: "Optional Agenda meeting number used for the public Future Posters short link and Admin link." },
        images: {
          type: "array",
          maxItems: 1,
          description: "Optional ChatGPT attachment. When supplied, the server uploads it directly; otherwise it returns a signed PUT URL.",
          items: {
            type: "object",
            properties: {
              file_id: { type: "string" },
              download_url: { type: "string", format: "uri" },
              name: { type: "string" },
              file_name: { type: "string" },
              mime_type: { type: "string" },
              size: { type: "integer" },
            },
            required: ["download_url"],
            additionalProperties: true,
          },
        },
      },
      required: ["slot", "expected_version"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    _meta: { "openai/fileParams": ["images"] },
  },
]);

function secret() {
  const value = String(process.env.AGENDA_SESSION_SECRET || "");
  if (!value) throw new ApiError(503, "MCP_NOT_CONFIGURED", "AGENDA_SESSION_SECRET is not configured.");
  return value;
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function signature(value) {
  return crypto.createHmac("sha256", secret()).update(`agenda-mcp-upload:${value}`).digest("base64url");
}

export function createUploadToken(payload, now = Date.now()) {
  const encoded = Buffer.from(JSON.stringify({ ...payload, exp: now + UPLOAD_TTL_MS })).toString("base64url");
  return `${encoded}.${signature(encoded)}`;
}

export function verifyUploadToken(token, now = Date.now()) {
  const [encoded, suppliedSignature] = String(token || "").split(".");
  if (!encoded || !suppliedSignature || !safeEqual(suppliedSignature, signature(encoded))) {
    throw new ApiError(401, "INVALID_UPLOAD_TOKEN", "The upload URL is invalid.");
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw new ApiError(401, "INVALID_UPLOAD_TOKEN", "The upload URL is invalid.");
  }
  if (!Number.isInteger(payload.exp) || payload.exp <= now) throw new ApiError(401, "UPLOAD_TOKEN_EXPIRED", "The upload URL has expired.");
  if (![1, 2].includes(payload.slot) || typeof payload.expectedVersion !== "string" || typeof payload.fileName !== "string") {
    throw new ApiError(401, "INVALID_UPLOAD_TOKEN", "The upload URL is invalid.");
  }
  return payload;
}

function origin(request) {
  const host = String(request.headers["x-forwarded-host"] || request.headers.host || "");
  if (!host) throw new ApiError(400, "INVALID_HOST", "Request host is missing.");
  return `${requestProtocol(request)}://${host}`;
}

function adminUrl(baseUrl, meetingNumber) {
  return meetingNumber
    ? `${baseUrl}/?meeting=${encodeURIComponent(meetingNumber)}&view=admin&task=future-posters`
    : `${baseUrl}/`;
}

export function recentMeetingSummaries(meetings, baseUrl, now = new Date()) {
  const active = meetings.filter((meeting) => meeting.status !== "archived");
  const { next, nearby } = groupMeetingsForSwitchboard(active, now);
  return [next, ...nearby.slice(0, next ? 2 : 3)].filter(Boolean).map((meeting) => ({
    meetingNumber: meeting.meetingNumber,
    date: meeting.date,
    theme: meeting.theme,
    status: meeting.status,
    adminUrl: adminUrl(baseUrl, meeting.meetingNumber),
  }));
}

function recentMeetingsText(meetings) {
  if (!meetings.length) return "近期会议是：暂无会议。";
  return `近期会议是：\n${meetings.map((meeting) => `- #${meeting.meetingNumber} · ${meeting.date || "日期未定"} · ${meeting.theme || "主题未定"} · ${meeting.status}`).join("\n")}`;
}

function posterUrl(baseUrl, slot, version = "") {
  return `${baseUrl}/api/assets/future-poster-${slot}?view=presentation${version ? `&version=${encodeURIComponent(version)}` : ""}`;
}

function posterShortUrl(baseUrl, meetingNumber) {
  return `${baseUrl}${meetingNumber ? `/m/${encodeURIComponent(meetingNumber)}/posters` : "/posters"}`;
}

function toolResult(data, message) {
  return { content: [{ type: "text", text: message || JSON.stringify(data) }], structuredContent: data, isError: false };
}

function toolError(error) {
  const data = { code: error.code || "TOOL_FAILED", message: error.message || "Tool failed.", ...(error.details ? { details: error.details } : {}) };
  return { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data, isError: true };
}

function validatePrepareArguments(args) {
  const allowed = new Set(["slot", "expected_version", "filename", "meeting_number", "images"]);
  if (!args || typeof args !== "object" || Array.isArray(args) || Object.keys(args).some((key) => !allowed.has(key))) {
    throw new ApiError(400, "INVALID_ARGUMENTS", "Use only slot, expected_version, filename, meeting_number, and images.");
  }
  if (![1, 2].includes(args.slot)) throw new ApiError(400, "INVALID_SLOT", "slot must be 1 or 2.");
  if (typeof args.expected_version !== "string") throw new ApiError(400, "INVALID_VERSION", "expected_version must be a string.");
  const files = args.images == null ? [] : args.images;
  if (!Array.isArray(files) || files.length > 1) throw new ApiError(400, "INVALID_FILE_REFERENCE", "images must contain at most one attachment.");
  const file = files[0];
  if (file != null && (typeof file !== "object" || Array.isArray(file) || typeof file.download_url !== "string")) {
    throw new ApiError(400, "FILE_REFERENCE_UNAVAILABLE", "This client did not provide a downloadable attachment.");
  }
  const fileName = String(args.filename || file?.file_name || file?.name || "").trim();
  if (!fileName || fileName.length > 180 || !/\.(png|jpe?g)$/i.test(fileName)) {
    throw new ApiError(400, "INVALID_FILENAME", "filename must be a PNG or JPEG filename up to 180 characters.");
  }
  if (args.meeting_number != null && (!Number.isInteger(args.meeting_number) || args.meeting_number < 1)) {
    throw new ApiError(400, "INVALID_MEETING_NUMBER", "meeting_number must be a positive integer.");
  }
  return { slot: args.slot, expectedVersion: args.expected_version, fileName, meetingNumber: args.meeting_number || null, file };
}

export async function downloadChatGptFile(file, fileName) {
  let url;
  try {
    url = new URL(file.download_url);
  } catch {
    throw new ApiError(400, "INVALID_FILE_REFERENCE", "Attachment URL is invalid.");
  }
  if (url.protocol !== "https:" || url.username || url.password || !(url.hostname === "files.oaiusercontent.com" || url.hostname.endsWith(".oaiusercontent.com"))) {
    throw new ApiError(400, "INVALID_FILE_REFERENCE", "Attachment URL is not an approved OpenAI file URL.");
  }
  if (Number(file.size || 0) > MCP_MAX_UPLOAD_BYTES) throw new ApiError(413, "IMAGE_TOO_LARGE", "Image exceeds 4 MiB.");
  const response = await fetch(url, { redirect: "error" });
  if (!response.ok) throw new ApiError(502, "FILE_DOWNLOAD_FAILED", "Could not download the ChatGPT attachment.");
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > MCP_MAX_UPLOAD_BYTES) throw new ApiError(413, "IMAGE_TOO_LARGE", "Image exceeds 4 MiB.");
  const reader = response.body?.getReader();
  if (!reader) throw new ApiError(502, "FILE_DOWNLOAD_FAILED", "Attachment body is unavailable.");
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MCP_MAX_UPLOAD_BYTES) {
      await reader.cancel();
      throw new ApiError(413, "IMAGE_TOO_LARGE", "Image exceeds 4 MiB.");
    }
    chunks.push(Buffer.from(value));
  }
  const type = String(file.mime_type || response.headers.get("content-type") || "").split(";", 1)[0].trim().toLocaleLowerCase();
  return { buffer: Buffer.concat(chunks), type, fileName };
}

async function getFuturePosters(request) {
  const baseUrl = origin(request);
  const [poster1, poster2, meetings] = await Promise.all([
    getGlobalAssetImage("future-poster-1"),
    getGlobalAssetImage("future-poster-2"),
    listMeetings(),
  ]);
  const recentMeetings = recentMeetingSummaries(meetings, baseUrl);
  const posters = [poster1.image, poster2.image].map((image, index) => ({
    slot: index + 1,
    role: index ? "optional second poster" : "required primary poster",
    ...image,
    imageUrl: posterUrl(baseUrl, index + 1, image.version),
  }));
  const data = { posters, recentMeetings, adminUrl: adminUrl(baseUrl), reminder: recentMeetingsText(recentMeetings) };
  return toolResult(data, `${data.reminder}\nSlot 1 是必需主海报；Slot 2 是可选第二张海报。`);
}

async function prepareFuturePosterUpload(request, rawArguments) {
  const args = validatePrepareArguments(rawArguments);
  const baseUrl = origin(request);
  const [stored, meetings] = await Promise.all([getGlobalAssetImage(`future-poster-${args.slot}`), listMeetings()]);
  if (stored.image.version !== args.expectedVersion) {
    throw new ApiError(409, "VERSION_CONFLICT", "The poster changed after it was read. Call get_future_posters again.", { currentVersion: stored.image.version });
  }
  if (args.meetingNumber && !meetings.some((meeting) => meeting.meetingNumber === args.meetingNumber && meeting.status !== "archived")) {
    throw new ApiError(404, "MEETING_NOT_FOUND", `Active meeting #${args.meetingNumber} was not found.`);
  }
  if (args.file) {
    const downloaded = await downloadChatGptFile(args.file, args.fileName);
    const image = validateFuturePosterImage(downloaded.buffer, downloaded.type, downloaded.fileName);
    const result = await uploadGlobalAssetImage(`future-poster-${args.slot}`, downloaded.buffer, image, { expectedVersion: args.expectedVersion });
    const recentMeetings = recentMeetingSummaries(meetings, baseUrl);
    const data = {
      slot: args.slot,
      image: result.image,
      imageUrl: posterUrl(baseUrl, args.slot, result.image.version),
      shortUrl: posterShortUrl(baseUrl, args.meetingNumber),
      adminUrl: adminUrl(baseUrl, args.meetingNumber),
      recentMeetings,
      reminder: recentMeetingsText(recentMeetings),
    };
    return toolResult(data, `${data.reminder}\nFuture Poster slot ${args.slot} 已更新。Agenda 已实时读取，无需再次同步。\n查看海报页：${data.shortUrl}`);
  }
  const token = createUploadToken(args);
  const recentMeetings = recentMeetingSummaries(meetings, baseUrl);
  const data = {
    slot: args.slot,
    expectedVersion: args.expectedVersion,
    uploadUrl: `${baseUrl}/api/mcp?upload=${encodeURIComponent(token)}`,
    uploadMethod: "PUT",
    acceptedContentTypes: ["image/png", "image/jpeg"],
    maxBytes: MCP_MAX_UPLOAD_BYTES,
    expiresAt: new Date(Date.now() + UPLOAD_TTL_MS).toISOString(),
    adminUrl: adminUrl(baseUrl, args.meetingNumber),
    recentMeetings,
    reminder: recentMeetingsText(recentMeetings),
  };
  return toolResult(data, `${data.reminder}\n把本地图片原始字节 PUT 到 uploadUrl，并设置正确 Content-Type。成功响应会返回新版本与 Admin 链接。`);
}

async function callTool(request, params) {
  try {
    const agendaResult = await callAgendaReadTool(params?.name, params?.arguments, origin(request));
    if (agendaResult) return toolResult(agendaResult.data, agendaResult.message);
    if (params?.name === "get_future_posters") return await getFuturePosters(request);
    if (params?.name === "prepare_future_poster_upload") return await prepareFuturePosterUpload(request, params.arguments);
    throw new ApiError(400, "UNKNOWN_TOOL", `Unknown tool: ${String(params?.name || "")}`);
  } catch (error) {
    return toolError(error);
  }
}

function rpc(response, id, result) {
  return sendJson(response, 200, { jsonrpc: "2.0", id, result });
}

function rpcError(response, status, id, code, message) {
  return sendJson(response, status, { jsonrpc: "2.0", id: id ?? null, error: { code, message } });
}

async function authorized(request, response) {
  const supplied = String(request.headers.authorization || "").match(/^Bearer\s+(.+)$/i)?.[1] || "";
  try {
    const principal = await authenticateMcpBearer(supplied);
    if (principal) return principal;
  } catch (error) {
    if (error.statusCode === 503) {
      rpcError(response, 503, null, -32000, error.message);
      return null;
    }
  }
  response.setHeader("WWW-Authenticate", mcpOAuthChallenge(request));
  rpcError(response, 401, null, -32001, "Unauthorized.");
  return null;
}

function withinRateLimit(principal) {
  const key = principal.id;
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  bucket.count += 1;
  // ponytail: per-instance limiter; use shared storage if one trusted VPPR client becomes multi-tenant.
  return bucket.count <= RATE_LIMIT;
}

function withinTrialRateLimit(request) {
  const key = String(request.headers["x-forwarded-for"] || request.socket?.remoteAddress || "unknown").split(",", 1)[0].trim();
  const now = Date.now();
  const bucket = trialBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    trialBuckets.set(key, { count: 1, resetAt: now + 60 * 60 * 1000 });
    return true;
  }
  bucket.count += 1;
  // ponytail: per-instance limit; move to shared storage if public abuse appears.
  return bucket.count <= 5;
}

async function handleTrialRegistration(request, response) {
  if (request.method !== "POST") return sendJson(response, 405, { code: "METHOD_NOT_ALLOWED", message: "Use POST." });
  if (!verifySameOrigin(request)) return sendJson(response, 403, { code: "INVALID_ORIGIN", message: "Request origin is not allowed." });
  if (!withinTrialRateLimit(request)) return sendJson(response, 429, { code: "RATE_LIMITED", message: "Too many trial requests. Try again later." });
  if (Number(request.headers["content-length"] || 0) > 2048) return sendJson(response, 413, { code: "REQUEST_TOO_LARGE", message: "Request is too large." });
  try {
    const body = await readJson(request);
    const result = await registerMcpTrial(body.name, body.token);
    return sendJson(response, result.created ? 201 : 200, result);
  } catch (error) {
    return sendJson(response, error.statusCode || 500, {
      code: error.code || "TRIAL_REQUEST_FAILED",
      message: error.statusCode ? error.message : "The server could not complete this request.",
    });
  }
}

async function handleUpload(request, response, token) {
  try {
    const payload = verifyUploadToken(token);
    const type = String(request.headers["content-type"] || "").split(";", 1)[0].trim().toLocaleLowerCase();
    const buffer = await readBuffer(request, MCP_MAX_UPLOAD_BYTES);
    const image = validateFuturePosterImage(buffer, type, payload.fileName);
    const result = await uploadGlobalAssetImage(`future-poster-${payload.slot}`, buffer, image, { expectedVersion: payload.expectedVersion });
    const baseUrl = origin(request);
    const meetings = recentMeetingSummaries(await listMeetings(), baseUrl);
    return sendJson(response, 200, {
      slot: payload.slot,
      image: result.image,
      imageUrl: posterUrl(baseUrl, payload.slot, result.image.version),
      shortUrl: posterShortUrl(baseUrl, payload.meetingNumber),
      adminUrl: adminUrl(baseUrl, payload.meetingNumber),
      recentMeetings: meetings,
      reminder: recentMeetingsText(meetings),
      message: `Future Poster slot ${payload.slot} 已更新。Agenda 已实时读取，无需再次同步。`,
    });
  } catch (error) {
    return sendJson(response, error.statusCode || 500, { code: error.code || "UPLOAD_FAILED", message: error.statusCode ? error.message : "The server could not complete this request.", ...(error.details ? { details: error.details } : {}) });
  }
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");
  if (request.query?.oauth) return handleMcpOAuth(request, response);
  const uploadToken = Array.isArray(request.query?.upload) ? request.query.upload[0] : request.query?.upload;
  if (request.headers.origin && !verifySameOrigin(request)) {
    return request.method === "PUT"
      ? sendJson(response, 403, { code: "INVALID_ORIGIN", message: "Request origin is not allowed." })
      : rpcError(response, 403, null, -32002, "Request origin is not allowed.");
  }
  if (request.query?.trial) return handleTrialRegistration(request, response);
  if (request.method === "PUT" && uploadToken) return handleUpload(request, response, uploadToken);
  const principal = await authorized(request, response);
  if (!principal) return;
  if (!withinRateLimit(principal)) return rpcError(response, 429, null, -32003, "Rate limit exceeded.");
  if (request.method === "GET" || request.method === "DELETE") {
    response.setHeader("Allow", "POST, PUT");
    return rpcError(response, 405, null, -32600, "Method not allowed.");
  }
  if (request.method !== "POST") {
    response.setHeader("Allow", "GET, POST, PUT, DELETE");
    return rpcError(response, 405, null, -32600, "Method not allowed.");
  }
  if (Number(request.headers["content-length"] || 0) > 64 * 1024) return rpcError(response, 413, null, -32600, "MCP request is too large.");

  let message;
  try {
    message = await readJson(request);
  } catch {
    return rpcError(response, 400, null, -32700, "Parse error.");
  }
  if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") return rpcError(response, 400, message?.id, -32600, "Invalid Request.");
  const protocolVersion = request.headers["mcp-protocol-version"];
  if (protocolVersion && !PROTOCOL_VERSIONS.has(String(protocolVersion))) return rpcError(response, 400, message.id, -32602, "Unsupported protocol version.");
  if (message.id == null) {
    response.status(202).end();
    return;
  }
  if (message.method === "initialize") {
    const requested = message.params?.protocolVersion;
    return rpc(response, message.id, {
      protocolVersion: PROTOCOL_VERSIONS.has(requested) ? requested : "2025-11-25",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "vpe-agenda", title: "VPE Agenda Maker", version: "1.1.0" },
      instructions: "会议查询使用 list_meetings；单场概况使用 get_meeting_overview。用户要微信群接龙时调用 generate_signup_text；空缺默认 🈳。用户直接输入 🙋🙋🙋 等重复串时，将完整串原样传入 vacancy_emoji，不再传 vacancy_emoji_count；用户只给一个 emoji 并指定数量时才传 count。只补招时调用 generate_vacancy_call_text。会前检查使用 check_meeting_readiness；分享链接使用 get_meeting_links。这些 Agenda tools 全部只读，不得声称修改成功。Future Poster 查询或上传先调用 get_future_posters；上传使用当前 expected_version 调用 prepare_future_poster_upload。ChatGPT 有附件时传 images；其他客户端 PUT 原始 PNG/JPEG 到签名 URL。上传成功后返回 shortUrl，不截图或核对海报内容。meeting_number 缺省时 Agenda 只读 tools 自动选择最近 active meeting。",
    });
  }
  if (message.method === "ping") return rpc(response, message.id, {});
  if (message.method === "tools/list") return rpc(response, message.id, { tools: TOOLS });
  if (message.method === "tools/call") return rpc(response, message.id, await callTool(request, message.params));
  return rpcError(response, 200, message.id, -32601, "Method not found.");
}

import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

import { generateSignupText, meetingReadiness, meetingVacancies } from "../server/mcp-agenda-read.js";
import mcpHandler, { createUploadToken, downloadChatGptFile, recentMeetingSummaries, verifyUploadToken } from "../server/mcp.js";
import { clearMcpAccessCache } from "../server/mcp-auth.js";

const PERSONAL_TOKEN = `vpe_${"a".repeat(43)}`;
const TRIAL_TOKEN = `vpe_${"b".repeat(43)}`;
let createdMcpRows;
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
      this.headers[name.toLowerCase()] = value;
      return this;
    },
    end(body = "") {
      this.body = String(body);
      return this;
    },
  };
}

function request(body, overrides = {}) {
  return {
    method: "POST",
    query: {},
    headers: {
      authorization: "Bearer test-mcp-token",
      host: "localhost",
      "content-type": "application/json",
    },
    body,
    ...overrides,
  };
}

async function apiFiles(directory = new URL("../api/", import.meta.url)) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => entry.isDirectory() ? apiFiles(new URL(`${entry.name}/`, directory)) : [entry.name]));
  return nested.flat().filter((file) => file.endsWith(".js"));
}

test.beforeEach(() => {
  Object.assign(process.env, CONFIG);
  clearMcpAccessCache();
  createdMcpRows = [];
  global.fetch = async (url, options = {}) => {
    if (String(url).includes("/auth/v3/tenant_access_token/internal")) {
      return new Response(JSON.stringify({ code: 0, tenant_access_token: "tenant", expire: 7200 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (String(url).includes("/tables/mcp-tokens/records")) {
      if (options.method === "POST") {
        const fields = JSON.parse(options.body);
        createdMcpRows.push(fields);
        return new Response(JSON.stringify({
          code: 0,
          data: { fields: Object.keys(fields), record_id_list: ["rec_trial"], data: [Object.values(fields)] },
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({
        code: 0,
        data: {
          fields: ["Name", "Token", "Enabled", "Note"],
          record_id_list: ["rec_officer"],
          data: [["Test Officer", PERSONAL_TOKEN, true, ""]],
          has_more: false,
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
});

test("MCP initializes with Agenda read and poster workflow instructions", async () => {
  const response = responseMock();
  await mcpHandler(request({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } },
  }, { headers: { authorization: `Bearer ${PERSONAL_TOKEN}`, host: "localhost", "content-type": "application/json" } }), response);
  const body = JSON.parse(response.body);
  assert.equal(response.statusCode, 200);
  assert.equal(body.result.protocolVersion, "2025-11-25");
  assert.equal(body.result.serverInfo.name, "vpe-agenda");
  assert.match(body.result.instructions, /generate_signup_text[\s\S]*🈳/);
  assert.equal(body.result.serverInfo.version, "1.3.0");
  assert.match(body.result.instructions, /新增、修改、删除统一调用 change_agenda/);
  assert.match(body.result.instructions, /proposal_id 与 confirmed=true[\s\S]*change_agenda/);
  assert.match(body.result.instructions, /undo_last_agenda_change/);
  assert.match(body.result.instructions, /get_future_posters[\s\S]*prepare_future_poster_upload/);
  assert.match(body.result.instructions, /Role Booking 是官员代理[\s\S]*get_role_booking_context/);
  assert.match(body.result.instructions, /propose_role_booking_change[\s\S]*apply_role_booking_change/);
});

test("MCP lists Agenda read, conversational edit, and poster tools", async () => {
  const response = responseMock();
  await mcpHandler(request(
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    { headers: { authorization: `Bearer ${PERSONAL_TOKEN}`, host: "localhost", "content-type": "application/json" } },
  ), response);
  const tools = JSON.parse(response.body).result.tools;
  assert.deepEqual(tools.slice(0, 7).map(({ name }) => name), [
    "list_meetings",
    "get_meeting_overview",
    "generate_signup_text",
    "list_role_vacancies",
    "generate_vacancy_call_text",
    "check_meeting_readiness",
    "get_meeting_links",
  ]);
  assert.ok(tools.slice(0, 7).every(({ annotations }) => annotations.readOnlyHint && !annotations.destructiveHint));
  const signup = tools.find(({ name }) => name === "generate_signup_text");
  const vacancyCall = tools.find(({ name }) => name === "generate_vacancy_call_text");
  assert.equal(signup.inputSchema.properties.vacancy_emoji_count.maximum, 5);
  assert.equal(vacancyCall.inputSchema.properties.vacancy_emoji_count.maximum, 5);
  const upload = tools.find(({ name }) => name === "prepare_future_poster_upload");
  assert.match(upload.description, /Slot 1[\s\S]*Slot 2/);
  assert.match(upload.inputSchema.properties.meeting_number.description, /optional/i);
  assert.deepEqual(upload._meta["openai/fileParams"], ["images"]);
  assert.equal(upload.inputSchema.properties.images.maxItems, 1);
  assert.deepEqual(tools.slice(7, 9).map(({ name }) => name), [
    "change_agenda",
    "undo_last_agenda_change",
  ]);
  assert.equal(tools.find(({ name }) => name === "change_agenda").annotations.destructiveHint, true);
  assert.equal(tools.find(({ name }) => name === "change_agenda").annotations.idempotentHint, false);
  assert.equal(tools.find(({ name }) => name === "undo_last_agenda_change").annotations.idempotentHint, false);
  assert.deepEqual(tools.slice(9, 15).map(({ name }) => name), [
    "get_role_booking_context",
    "search_pathways_projects",
    "book_role",
    "create_booking_goal",
    "propose_role_booking_change",
    "apply_role_booking_change",
  ]);
  assert.equal(tools.find(({ name }) => name === "book_role").annotations.idempotentHint, true);
  assert.equal(tools.find(({ name }) => name === "propose_role_booking_change").annotations.readOnlyHint, true);
  assert.equal(tools.find(({ name }) => name === "apply_role_booking_change").annotations.destructiveHint, true);
  assert.equal(tools.length, 17);
});

test("MCP tool metadata matches natural Chinese poster upload requests", async () => {
  const response = responseMock();
  await mcpHandler(request(
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    { headers: { authorization: `Bearer ${PERSONAL_TOKEN}`, host: "localhost", "content-type": "application/json" } },
  ), response);
  const tools = JSON.parse(response.body).result.tools;
  const metadata = tools.map(({ title, description }) => `${title} ${description}`).join("\n");
  for (const phrase of ["会议", "海报", "上传", "预告"]) assert.match(metadata, new RegExp(phrase));
  assert.match(metadata, /不要搜索.*(?:Chrome|Canva|上传页面)/);
  assert.match(metadata, /微信群接龙[\s\S]*🈳/);
});

test("poster upload returns a short link without bundling the screenshot renderer", async () => {
  const response = responseMock();
  await mcpHandler(request(
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    { headers: { authorization: `Bearer ${PERSONAL_TOKEN}`, host: "localhost", "content-type": "application/json" } },
  ), response);
  const tools = JSON.parse(response.body).result.tools;
  assert.equal(tools.some(({ name }) => name === "get_future_poster_preview"), false);

  const initializeResponse = responseMock();
  await mcpHandler(request({
    jsonrpc: "2.0",
    id: 3,
    method: "initialize",
    params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } },
  }, { headers: { authorization: `Bearer ${PERSONAL_TOKEN}`, host: "localhost", "content-type": "application/json" } }), initializeResponse);
  assert.match(JSON.parse(initializeResponse.body).result.instructions, /上传成功后返回 shortUrl/);
  assert.match(JSON.parse(initializeResponse.body).result.instructions, /不截图或核对/);

  const source = await readFile(new URL("../server/mcp.js", import.meta.url), "utf8");
  assert.match(source, /shortUrl: posterShortUrl\(baseUrl, args\.meetingNumber\)/);
  assert.doesNotMatch(source, /nextTool/);
  assert.doesNotMatch(source, /@sparticuz\/chromium|puppeteer|screenshot\(/);
});

test("MCP rejects missing bearer auth before processing requests", async () => {
  const response = responseMock();
  await mcpHandler(request({ jsonrpc: "2.0", id: 1, method: "ping" }, { headers: { host: "localhost" } }), response);
  assert.equal(response.statusCode, 401);
  assert.equal(JSON.parse(response.body).error.code, -32001);
  assert.match(response.headers["www-authenticate"], /oauth-protected-resource\/api\/mcp/);
});

test("MCP accepts an enabled personal Token from a token header", async () => {
  const response = responseMock();
  await mcpHandler(request(
    { jsonrpc: "2.0", id: 1, method: "ping" },
    { headers: { token: PERSONAL_TOKEN, host: "localhost", "content-type": "application/json" } },
  ), response);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body).result, {});
});

test("MCP trial request writes a disabled Base token only after same-origin confirmation", async () => {
  const response = responseMock();
  await mcpHandler(request({ name: " Jordan   Lee ", token: TRIAL_TOKEN }, {
    query: { trial: "1" },
    headers: { host: "localhost", origin: "http://localhost", "content-type": "application/json" },
  }), response);
  assert.equal(response.statusCode, 201);
  assert.deepEqual(createdMcpRows, [{
    Name: "Jordan Lee",
    Token: TRIAL_TOKEN,
    Enabled: false,
    Note: "Self-service trial request · pending VPE approval",
  }]);
  assert.deepEqual(JSON.parse(response.body), { name: "Jordan Lee", enabled: false, created: true });

  const rejected = responseMock();
  await mcpHandler(request({ name: "Another User", token: `vpe_${"c".repeat(43)}` }, {
    query: { trial: "1" },
    headers: { host: "localhost", "content-type": "application/json" },
  }), rejected);
  assert.equal(rejected.statusCode, 403);
  assert.equal(createdMcpRows.length, 1);
});

test("OAuth metadata, PKCE exchange, refresh, and MCP bearer access work without stored OAuth rows", async () => {
  const metadataResponse = responseMock();
  await mcpHandler(request(null, {
    method: "GET",
    query: { oauth: "server-metadata" },
    headers: { host: "localhost" },
  }), metadataResponse);
  const metadata = JSON.parse(metadataResponse.body);
  assert.equal(metadata.authorization_endpoint, "http://localhost/oauth/authorize");
  assert.equal(metadata.registration_endpoint, "http://localhost/oauth/register");
  assert.ok(metadata.scopes_supported.includes("offline_access"));

  const registerResponse = responseMock();
  await mcpHandler(request({
    client_name: "ChatGPT",
    redirect_uris: ["https://chatgpt.com/oauth/callback"],
  }, {
    query: { oauth: "register" },
    headers: { host: "localhost", "content-type": "application/json" },
  }), registerResponse);
  const clientId = JSON.parse(registerResponse.body).client_id;
  assert.match(clientId, /^vpe_client_/);

  const verifier = "v".repeat(64);
  const challenge = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
    .then((bytes) => Buffer.from(bytes).toString("base64url"));
  const authorizeResponse = responseMock();
  await mcpHandler(request({
    response_type: "code",
    client_id: clientId,
    redirect_uri: "https://chatgpt.com/oauth/callback",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "state-1",
    scope: "mcp offline_access",
    token: PERSONAL_TOKEN,
  }, {
    query: { oauth: "authorize" },
    headers: { host: "localhost", "content-type": "application/x-www-form-urlencoded" },
  }), authorizeResponse);
  assert.equal(authorizeResponse.statusCode, 200);
  assert.match(authorizeResponse.body, /认证成功[\s\S]*即将返回 ChatGPT/);
  assert.match(authorizeResponse.body, /http-equiv="refresh"/);
  assert.equal(authorizeResponse.headers["cache-control"], "no-store");
  const callbackHref = authorizeResponse.body.match(/id="oauth-continue" href="([^"]+)"/)?.[1].replaceAll("&amp;", "&");
  const callback = new URL(callbackHref);
  assert.equal(callback.searchParams.get("state"), "state-1");

  const tokenResponse = responseMock();
  await mcpHandler(request({
    grant_type: "authorization_code",
    code: callback.searchParams.get("code"),
    client_id: clientId,
    redirect_uri: "https://chatgpt.com/oauth/callback",
    code_verifier: verifier,
  }, {
    query: { oauth: "token" },
    headers: { host: "localhost", "content-type": "application/x-www-form-urlencoded" },
  }), tokenResponse);
  const tokens = JSON.parse(tokenResponse.body);
  assert.match(tokens.access_token, /^vpe_oauth_/);
  assert.match(tokens.refresh_token, /^vpe_refresh_/);
  assert.equal(tokens.expires_in, 3600);

  const mcpResponse = responseMock();
  await mcpHandler(request({ jsonrpc: "2.0", id: 3, method: "ping" }, {
    headers: { authorization: `Bearer ${tokens.access_token}`, host: "localhost", "content-type": "application/json" },
  }), mcpResponse);
  assert.equal(mcpResponse.statusCode, 200);

  const refreshResponse = responseMock();
  await mcpHandler(request({
    grant_type: "refresh_token",
    refresh_token: tokens.refresh_token,
    client_id: clientId,
  }, {
    query: { oauth: "token" },
    headers: { host: "localhost", "content-type": "application/x-www-form-urlencoded" },
  }), refreshResponse);
  assert.match(JSON.parse(refreshResponse.body).access_token, /^vpe_oauth_/);
});

test("signed upload tokens expire and reject tampering", () => {
  const now = Date.now();
  const token = createUploadToken({ slot: 1, expectedVersion: "", fileName: "poster.png", meetingNumber: 103 }, now);
  assert.equal(verifyUploadToken(token, now + 1).meetingNumber, 103);
  assert.throws(() => verifyUploadToken(`${token}x`, now + 1), /invalid/i);
  assert.throws(() => verifyUploadToken(token, now + 5 * 60 * 1000), /expired/i);
});

test("ChatGPT fileParams accepts bounded OpenAI downloads and rejects other hosts", async () => {
  global.fetch = async () => new Response(new Uint8Array([1, 2, 3]), {
    status: 200,
    headers: { "Content-Type": "image/png", "Content-Length": "3" },
  });
  const file = await downloadChatGptFile({
    download_url: "https://files.oaiusercontent.com/file/test",
    mime_type: "image/png",
    size: 3,
  }, "poster.png");
  assert.deepEqual(file.buffer, Buffer.from([1, 2, 3]));
  assert.equal(file.type, "image/png");
  await assert.rejects(
    downloadChatGptFile({ download_url: "https://example.com/poster.png" }, "poster.png"),
    /approved OpenAI file URL/,
  );
});

test("recent meetings reuse Agenda ordering and return at most next plus two nearby", () => {
  const meetings = [
    { meetingNumber: 105, date: "2026-08-20", startTime: "18:00", theme: "Later", status: "draft" },
    { meetingNumber: 104, date: "2026-08-10", startTime: "18:00", theme: "Soon", status: "draft" },
    { meetingNumber: 103, date: "2026-08-01", startTime: "18:00", theme: "Next", status: "draft" },
    { meetingNumber: 102, date: "2026-07-20", startTime: "18:00", theme: "Recent", status: "final" },
  ];
  const result = recentMeetingSummaries(meetings, "https://agenda.example", new Date(2026, 6, 25, 12));
  assert.deepEqual(result.map(({ meetingNumber }) => meetingNumber), [103, 104, 105]);
  assert.equal(result[0].adminUrl, "https://agenda.example/?meeting=103&view=admin&task=future-posters");
});

test("Agenda read helpers merge linked rows, expose vacancies, and never invent people", () => {
  const meeting = {
    meetingNumber: 105,
    date: "2026-08-11",
    startTime: "18:40",
    theme: "Make It Clear",
    venue: "Room 3",
    status: "draft",
    revision: 4,
    meetingManager: "",
    photographer: "Ocean YU",
    wordOfDay: { word: "clarity" },
    votingForm: { formId: "form-105" },
    enableTransitionTime: false,
    blocks: [
      {
        title: "Opening",
        type: "opening",
        items: [
          { id: "president", kind: "role", session: "Presidential Opening", role: "President", duration: 2, member: "", status: "vacant" },
          { id: "timer-intro", kind: "role", session: "Timer Intro", role: "Timer", duration: 2, member: "Abby ZHOU", status: "confirmed", roleAssignmentId: "functional-timer" },
        ],
      },
      {
        title: "Prepared Speeches",
        type: "prepared_speeches",
        items: [
          { id: "speech-1", kind: "speech", session: "Begin Again", role: "Prepared Speaker 1", duration: 7, member: "Jordan LEE", status: "confirmed", evaluator: "Hazel SHANG", evaluatorStatus: "confirmed", pathwaysMode: "custom", speechObjective: "Practice a clear opening." },
          { id: "speech-2", kind: "speech", session: "Second Speech", role: "Prepared Speaker 2", duration: 7, member: "", status: "vacant", evaluator: "", evaluatorStatus: "vacant", pathwaysMode: "custom", speechObjective: "Practice structure." },
        ],
      },
      {
        title: "Evaluation",
        type: "evaluation",
        items: [
          { id: "eval-1", kind: "role", session: "Speech Evaluation 1", role: "Individual Evaluator", duration: 3, member: "Hazel SHANG", status: "confirmed", linkedSpeechId: "speech-1" },
          { id: "eval-2", kind: "role", session: "Speech Evaluation 2", role: "Individual Evaluator", duration: 3, member: "", status: "vacant", linkedSpeechId: "speech-2" },
        ],
      },
      {
        title: "Closing",
        type: "closing",
        items: [
          { id: "timer-report", kind: "role", session: "Timer Report", role: "Timer", duration: 3, member: "Abby ZHOU", status: "confirmed", roleAssignmentId: "functional-timer" },
        ],
      },
    ],
  };

  const vacancies = meetingVacancies(meeting);
  assert.equal(vacancies.total, 4);
  assert.deepEqual(vacancies.support.map(({ label }) => label), ["Meeting Manager"]);
  assert.deepEqual(vacancies.speakers.map(({ label }) => label), ["Prepared Speaker 2"]);
  assert.deepEqual(vacancies.evaluators.map(({ label }) => label), ["Individual Evaluator 2"]);

  const text = generateSignupText(meeting, { includeSpeechDetails: true });
  assert.equal((text.match(/^Timer:/gm) || []).length, 1);
  assert.match(text, /Meeting Manager: 🈳/);
  assert.match(text, /Photographer: Ocean YU/);
  assert.match(text, /^President: 🈳/m);
  assert.match(text, /Prepared Speaker 2: 🈳 — Second Speech/);
  assert.match(text, /Individual Evaluator 2: 🈳/);
  assert.doesNotMatch(text, /undefined|null/);
  assert.match(generateSignupText(meeting, { vacancyEmoji: "🙋", vacancyEmojiCount: 3 }), /Prepared Speaker 2: 🙋🙋🙋/);
  assert.match(generateSignupText(meeting, { vacancyEmoji: "🙋🙋🙋" }), /Prepared Speaker 2: 🙋🙋🙋$/m);

  const ready = meetingReadiness(meeting, { posterPresent: true });
  assert.equal(ready.status, "ready_with_recommendations");
  assert.equal(ready.readyToFinalize, true);
  assert.equal(ready.vacancies.total, 4);
  assert.equal(meetingReadiness(meeting, { posterPresent: false }).status, "risk");
});

test("deployment stays within serverless function limit", async () => {
  assert.ok((await apiFiles()).length <= 15);
});

test("public MCP landing route is linked from the Agenda login", async () => {
  const [appSource, entrySource, pageSource, stylesSource, vercelSource] = await Promise.all([
    readFile(new URL("../app.js", import.meta.url), "utf8"),
    readFile(new URL("../entry.js", import.meta.url), "utf8"),
    readFile(new URL("../mcp-page.js", import.meta.url), "utf8"),
    readFile(new URL("../styles.css", import.meta.url), "utf8"),
    readFile(new URL("../vercel.json", import.meta.url), "utf8"),
  ]);
  const loginSource = appSource.slice(appSource.indexOf("function renderLogin()"), appSource.indexOf("function guestTimeline("));

  assert.match(loginSource, /href="\/mcp"/);
  assert.match(entrySource, /\^\\\/mcp\\\/\?\$[\s\S]*import\("\.\/mcp-page\.js"\)/);
  assert.match(pageSource, /new URL\("\/api\/mcp", window\.location\.origin\)/);
  assert.match(pageSource, /一句话调整[\s\S]*Agenda。[\s\S]*明确就执行/);
  assert.match(pageSource, /PEOPLE[\s\S]*TIME[\s\S]*STRUCTURE/);
  assert.match(pageSource, /把 #105 的 Timer 换成 Abby[\s\S]*第 105 期 · 2026-08-11 已写入并回读[\s\S]*Revision 23 → 24/);
  assert.match(pageSource, /低风险直写[\s\S]*风险分级[\s\S]*冲突保护[\s\S]*一键撤销/);
  assert.match(pageSource, /按 105 期 Agenda 生成接龙，空缺用 🙋🙋🙋/);
  assert.match(pageSource, /新增能力已包含在同一个 MCP[\s\S]*无需创建第二个 Server/);
  assert.match(pageSource, /get_role_booking_context[\s\S]*search_pathways_projects[\s\S]*book_role[\s\S]*create_booking_goal[\s\S]*propose_role_booking_change[\s\S]*apply_role_booking_change/);
  assert.match(pageSource, /已经连接过[\s\S]*重新 Scan Tools[\s\S]*Agenda \+ Role Booking MCP ready/);
  assert.match(pageSource, /MCP_BOOKING_WRITE_ENABLED=true[\s\S]*个人客户端无需配置此变量/);
  assert.doesNotMatch(pageSource, /\d+ (?:个 )?Tools|read-only · \d+ upload|只有海报上传 Tool 会写入/);
  assert.match(pageSource, /CHATGPT WORK[\s\S]*WORKBUDDY[\s\S]*HEADER TOKEN[\s\S]*CODEX[\s\S]*CLAUDE CODE[\s\S]*飞书 AILY[\s\S]*KIMI CODE[\s\S]*OPENCLAW/);
  assert.match(pageSource, /codex mcp add vpe_agenda[\s\S]*--bearer-token-env-var VPE_AGENDA_MCP_TOKEN[\s\S]*codex mcp get vpe_agenda --json/);
  assert.match(pageSource, /openclaw mcp set vpe-agenda[\s\S]*streamable-http[\s\S]*openclaw mcp doctor vpe-agenda --probe/);
  assert.match(pageSource, /data-token-request-dialog[\s\S]*申请会议管理者 Token[\s\S]*data-token-confirm-dialog[\s\S]*是否就用这个版本试用/);
  assert.match(pageSource, /fetch\(`\$\{endpoint\}\?trial=1`[\s\S]*name: trialName[\s\S]*token: token\(\)/);
  assert.match(pageSource, /申请已提交，默认未启用[\s\S]*俱乐部 VPE[\s\S]*Enabled/);
  assert.match(pageSource, /启用后可读取并编辑 Draft 与确认后的 Final meeting/);
  assert.match(pageSource, /await call\(1, "initialize"[\s\S]*await call\(2, "tools\/list"\)/);
  assert.match(pageSource, /get_role_booking_context[\s\S]*book_role[\s\S]*propose_role_booking_change[\s\S]*apply_role_booking_change/);
  assert.match(pageSource, /change_agenda[\s\S]*undo_last_agenda_change/);
  assert.match(pageSource, /Agenda \+ Role Booking MCP ready/);
  assert.match(pageSource, /~\/\.workbuddy\/mcp\.json/);
  assert.match(pageSource, /"type": "http"[\s\S]*"Authorization": "Bearer \$\{value\}"/);
  assert.match(pageSource, /"type": "streamable-http"[\s\S]*"token": "\$\{value\}"/);
  assert.ok(pageSource.indexOf("mcp-agent-prompt") < pageSource.indexOf("mcp-tab-list"));
  assert.match(pageSource, /role="tablist"[\s\S]*role="tab"[\s\S]*role="tabpanel"/);
  assert.match(pageSource, /function activateClient[\s\S]*ArrowLeft[\s\S]*ArrowRight/);
  assert.match(pageSource, /crypto\.getRandomValues/);
  assert.match(pageSource, /Authorization: Bearer/);
  assert.doesNotMatch(pageSource, /[0-9a-f]{64}/i);
  for (const selector of [".mcp-landing", ".mcp-capabilities", ".mcp-edit-card", ".mcp-usage", ".mcp-example-grid", ".mcp-role-booking-guide", ".mcp-connect-endpoint", ".mcp-agent-prompt", ".mcp-tab-list", ".mcp-token-panel", ".mcp-safety-grid"]) {
    assert.ok(stylesSource.includes(selector));
  }
  assert.match(vercelSource, /oauth-protected-resource[\s\S]*oauth-authorization-server[\s\S]*"source": "\/mcp"/);
});

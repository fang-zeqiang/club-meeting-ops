import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

import { evaluationForms, generateSignupText, meetingLinks, meetingPresentations, meetingReadiness, meetingVacancies, referencedMeeting, resolveMeetingSelector, signedAgendaExportUrl, tableTopicsPresentationUrl } from "../server/mcp-agenda-read.js";

test("contest speeches without evaluation session do not create evaluator vacancies", () => {
  const meeting = { meetingType: "contest", meetingManager: "A", photographer: "B", blocks: [
    { type: "prepared_speeches", items: [{ id: "speech", kind: "speech", role: "Prepared Speaker 1", status: "vacant", evaluatorStatus: "vacant" }] },
  ] };
  const vacancies = meetingVacancies(meeting);
  assert.equal(vacancies.speakers.length, 1);
  assert.equal(vacancies.evaluators.length, 0);
});

test("regular speeches without evaluation session retain evaluator vacancy", () => {
  const meeting = { meetingManager: "A", photographer: "B", blocks: [
    { type: "prepared_speeches", items: [{ id: "speech", kind: "speech", role: "Prepared Speaker", status: "vacant", evaluatorStatus: "vacant" }] },
  ] };
  assert.equal(meetingVacancies(meeting).evaluators.length, 1);
});

test("off-agenda Timer is a vacancy but internal Ballot Counter is not a signup slot", () => {
  const meeting = { meetingManager: "A", photographer: "B", offAgendaRoles: [
    { role: "Timer", signupOpen: true },
    { role: "Ballot Counter", signupOpen: false },
  ], blocks: [{ type: "opening", items: [] }] };
  assert.deepEqual(meetingVacancies(meeting).roles.map(({ label }) => label), ["Timer"]);
});

test("contest readiness does not require Pathways, WOD, or public voting", () => {
  const meeting = { meetingType: "contest", date: "2026-11-10", theme: "Demo Speech Craft", startTime: "18:40", meetingManager: "A", photographer: "B", blocks: [
    { type: "prepared_speeches", items: [{ id: "speech", kind: "speech", session: "Prepared Speech 1", role: "Prepared Speaker 1", duration: 9, member: "A", status: "confirmed", evaluatorStatus: "vacant" }] },
  ] };
  const result = meetingReadiness(meeting, { posterPresent: true });
  assert.equal(result.readyToFinalize, true);
  assert.equal(result.blockers.some(({ code }) => code === "missing_speech_details"), false);
  assert.equal(result.recommendations.some(({ code }) => ["missing_word_of_day", "voting_not_prepared"].includes(code)), false);
});

test("contest signup distinguishes eight speeches while keeping canonical role name", () => {
  const meeting = { meetingType: "contest", meetingManager: "A", photographer: "B", blocks: [
    { type: "prepared_speeches", items: [1, 2].map((number) => ({ id: `speech-${number}`, kind: "speech", session: `Prepared Speech ${number}`, role: "Prepared Speaker", status: "vacant" })) },
  ] };
  assert.deepEqual(meetingVacancies(meeting).speakers.map(({ label }) => label), [
    "Prepared Speaker · Prepared Speech 1",
    "Prepared Speaker · Prepared Speech 2",
  ]);
});
import { verifyAgendaImageLink } from "../server/agenda-image-link.js";
import mcpHandler, { createUploadToken, downloadChatGptFile, futurePosterStatusText, recentMeetingSummaries, verifyUploadToken } from "../server/mcp.js";
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
  WOD_BASE_TOKEN: "wod-base",
  WOD_TABLE_ID: "wod-table",
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
  assert.match(body.result.instructions, /vpe_generate_signup_text[\s\S]*🌸🌸🌸/);
  assert.equal(body.result.serverInfo.version, "1.3.0");
  assert.match(body.result.instructions, /新增、修改、删除统一调用 vpe_change_agenda/);
  assert.match(body.result.instructions, /proposal_id 与 confirmed=true[\s\S]*vpe_change_agenda/);
  assert.match(body.result.instructions, /vpe_undo_last_agenda_change/);
  assert.match(body.result.instructions, /vpe_get_future_posters[\s\S]*vpe_prepare_future_poster_upload/);
  assert.match(body.result.instructions, /Role Booking 是官员代理[\s\S]*vpe_get_role_booking_context/);
  assert.match(body.result.instructions, /会员是否存在[\s\S]*vpe_search_members/);
  assert.match(body.result.instructions, /多个同角色空位[\s\S]*label、session 或 speakerName/);
  assert.match(body.result.instructions, /vpe_propose_role_booking_change[\s\S]*vpe_apply_role_booking_change/);
  assert.match(body.result.instructions, /Word of Tonight[\s\S]*vpe_random_wod/);
  assert.match(body.result.instructions, /vpe_search_pathways_projects[\s\S]*custom[\s\S]*later/);
  assert.match(body.result.instructions, /投屏、PPT、幻灯片[\s\S]*presentationUrl[\s\S]*presentations\[\]\.externalPresentationUrl/);
  assert.match(body.result.instructions, /评估表（IE form）[\s\S]*vpe_get_evaluation_forms[\s\S]*Individual Evaluator[\s\S]*Pathway 目标/);
});

test("meetingPresentations lists only prepared speeches carrying an external PPT link", () => {
  const meeting = {
    blocks: [{
      title: "Prepared Speeches",
      items: [
        { kind: "speech", role: "Prepared Speaker 1", member: "Amy", status: "confirmed", session: "Speech A", externalPresentationUrl: "https://slides.example/a" },
        { kind: "speech", role: "Prepared Speaker 2", member: "Ben", status: "confirmed", session: "Speech B", externalPresentationUrl: "" },
        { kind: "role", role: "Timer", member: "Cara", status: "confirmed", session: "Timer", externalPresentationUrl: "https://slides.example/ignore" },
      ],
    }],
  };
  assert.deepEqual(meetingPresentations(meeting), [
    { label: "Prepared Speaker 1", speaker: "Amy", session: "Speech A", slideOrder: 1, externalPresentationUrl: "https://slides.example/a" },
  ]);
});

test("meetingPresentations numbers slideOrder over every speech, not just the ones with a link", () => {
  const meeting = {
    blocks: [{
      title: "Prepared Speeches",
      items: [
        { kind: "speech", role: "Prepared Speaker 1", member: "Amy", status: "confirmed", session: "Speech A", externalPresentationUrl: "" },
        { kind: "speech", role: "Prepared Speaker 2", member: "Ben", status: "confirmed", session: "Speech B", externalPresentationUrl: "https://slides.example/b" },
      ],
    }],
  };
  assert.deepEqual(meetingPresentations(meeting), [
    { label: "Prepared Speaker 2", speaker: "Ben", session: "Speech B", slideOrder: 2, externalPresentationUrl: "https://slides.example/b" },
  ]);
});

test("meetingLinks surfaces the voting form share link and a table topics jump deep link", () => {
  const withVoting = meetingLinks("https://agenda.example", { meetingNumber: 109, votingForm: { shareUrl: "https://vote.example/109" } });
  assert.equal(withVoting.votingUrl, "https://vote.example/109");
  assert.equal(withVoting.tableTopicsUrl, "https://agenda.example/m/109/presentation?jump=tabletopics");
  assert.equal(tableTopicsPresentationUrl("https://agenda.example", { meetingNumber: 109 }), "https://agenda.example/m/109/presentation?jump=tabletopics");

  const withoutVoting = meetingLinks("https://agenda.example", { meetingNumber: 110 });
  assert.equal(withoutVoting.votingUrl, null);
});

test("signedAgendaExportUrl mints a verifiable no-login link for both png and pdf", { concurrency: false }, () => {
  const original = process.env.AGENDA_SESSION_SECRET;
  process.env.AGENDA_SESSION_SECRET = "test-secret";
  try {
    const meeting = { id: "meeting_109", meetingNumber: 109 };
    const png = signedAgendaExportUrl("https://agenda.example", meeting, "png");
    assert.match(png.url, /^https:\/\/agenda\.example\/api\/meetings\/meeting_109\?action=png&sig=[^&]+&exp=\d+$/);
    const pdf = signedAgendaExportUrl("https://agenda.example", meeting, "pdf");
    assert.match(pdf.url, /^https:\/\/agenda\.example\/api\/meetings\/meeting_109\?action=pdf&sig=[^&]+&exp=\d+$/);
    const [, sig, exp] = pdf.url.match(/sig=([^&]+)&exp=(\d+)/);
    assert.equal(verifyAgendaImageLink("meeting_109", sig, Number(exp)), true);
  } finally {
    process.env.AGENDA_SESSION_SECRET = original;
  }
});

test("evaluationForms surfaces the evaluator and Pathway objective, and reports missing forms", () => {
  const catalog = {
    formById: new Map([["form-1", { formId: "form-1", projectId: "IP", variant: "Speech A", pdfUrl: "https://ti.example/form-1.pdf", officialResourceUrl: "https://ti.example/form-1" }]]),
    projectById: new Map([["IP", { projectId: "IP", name: "Ice Breaker" }]]),
  };
  const meeting = {
    blocks: [{
      title: "Prepared Speeches",
      items: [
        { kind: "speech", role: "Prepared Speaker 1", member: "Amy", status: "confirmed", evaluator: "Dana", evaluatorStatus: "confirmed", session: "Speech A", pathwaysMode: "pathways", pathwaysPath: "Presentation Mastery", pathwaysLevel: "1", pathwaysProjectId: "IP", pathwaysFormId: "form-1" },
        { kind: "speech", role: "Prepared Speaker 2", member: "Ben", status: "confirmed", evaluator: "", evaluatorStatus: "vacant", session: "Speech B", pathwaysMode: "custom", speechObjective: "Practice vocal variety." },
        { kind: "speech", role: "Prepared Speaker 3", member: "Cara", status: "confirmed", evaluator: "Eli", evaluatorStatus: "confirmed", session: "Speech C", pathwaysMode: "pathways", pathwaysProjectId: "IP", pathwaysFormId: "missing" },
        { kind: "speech", role: "Prepared Speaker 4", member: "Fay", status: "confirmed", session: "Speech D", pathwaysMode: "" },
      ],
    }],
  };
  const forms = evaluationForms(meeting, catalog);
  assert.deepEqual(forms[0], {
    speechNumber: 1, label: "Prepared Speaker 1", speaker: "Amy", evaluator: "Dana", session: "Speech A",
    pathwaysMode: "pathways", pathwaysObjective: "Presentation Mastery · Level 1",
    available: true, projectId: "IP", projectName: "Ice Breaker", variant: "Speech A", pdfUrl: "https://ti.example/form-1.pdf", officialResourceUrl: "https://ti.example/form-1",
  });
  // custom 目标：目录里没有 generic-evaluation-resource 时报不可用，但目标文本和评估人依然带出来。
  assert.equal(forms[1].available, false);
  assert.equal(forms[1].evaluator, "");
  assert.equal(forms[1].pathwaysObjective, "Practice vocal variety.");
  assert.match(forms[1].reason, /[Gg]eneric/);
  assert.equal(forms[2].available, false);
  assert.equal(forms[2].evaluator, "Eli");
  assert.match(forms[2].reason, /not found in catalog/);
  assert.equal(forms[3].available, false);
  assert.equal(forms[3].pathwaysMode, "");
  assert.equal(forms[3].pathwaysObjective, "");
});

test("evaluationForms falls back to the club's generic evaluation resource for a custom objective", () => {
  const catalog = {
    formById: new Map([["generic-evaluation-resource", { formId: "generic-evaluation-resource", projectId: "", variant: "General", pdfUrl: "https://ti.example/generic.pdf", officialResourceUrl: "https://ti.example/generic" }]]),
    projectById: new Map(),
  };
  const meeting = {
    blocks: [{
      title: "Prepared Speeches",
      items: [{ kind: "speech", role: "Prepared Speaker 1", member: "Ben", status: "confirmed", evaluator: "Dana", evaluatorStatus: "confirmed", session: "Speech B", pathwaysMode: "custom", speechObjective: "Practice vocal variety." }],
    }],
  };
  const [form] = evaluationForms(meeting, catalog);
  assert.equal(form.available, true);
  assert.equal(form.pdfUrl, "https://ti.example/generic.pdf");
  assert.equal(form.pathwaysObjective, "Practice vocal variety.");
  assert.equal(form.evaluator, "Dana");
});

test("future poster status reports global slots, not per-meeting posters", () => {
  assert.equal(futurePosterStatusText([
    { slot: 1, role: "required primary poster", present: true },
    { slot: 2, role: "optional second poster", present: true },
  ]), "海报位状态（全局资产，不绑定任何一期会议）：\n- Slot 1（required primary poster）：已有海报\n- Slot 2（optional second poster）：已有海报");
});

test("MCP lists Agenda read, conversational edit, and poster tools", async () => {
  const response = responseMock();
  await mcpHandler(request(
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    { headers: { authorization: `Bearer ${PERSONAL_TOKEN}`, host: "localhost", "content-type": "application/json" } },
  ), response);
  const tools = JSON.parse(response.body).result.tools;
  assert.deepEqual(tools.slice(0, 7).map(({ name }) => name), [
    "vpe_list_meetings",
    "vpe_get_meeting_overview",
    "vpe_generate_signup_text",
    "vpe_list_role_vacancies",
    "vpe_generate_vacancy_call_text",
    "vpe_check_meeting_readiness",
    "vpe_get_meeting_links",
  ]);
  assert.ok(tools.slice(0, 7).every(({ annotations }) => annotations.readOnlyHint && !annotations.destructiveHint));
  const signup = tools.find(({ name }) => name === "vpe_generate_signup_text");
  const vacancyCall = tools.find(({ name }) => name === "vpe_generate_vacancy_call_text");
  assert.match(signup.description, /🌸🌸🌸/);
  assert.match(vacancyCall.inputSchema.properties.vacancy_emoji.description, /🈳/);
  assert.equal(signup.inputSchema.properties.vacancy_emoji_count.maximum, 5);
  assert.equal(vacancyCall.inputSchema.properties.vacancy_emoji_count.maximum, 5);
  const upload = tools.find(({ name }) => name === "vpe_prepare_future_poster_upload");
  assert.match(upload.description, /Slot 1[\s\S]*Slot 2/);
  assert.match(upload.inputSchema.properties.meeting_number.description, /optional/i);
  assert.deepEqual(upload._meta["openai/fileParams"], ["images"]);
  assert.equal(upload.inputSchema.properties.images.maxItems, 1);
  assert.equal(tools[7].name, "vpe_get_agenda_image");
  assert.equal(tools[7].annotations.readOnlyHint, true);
  assert.equal(tools[8].name, "vpe_get_agenda_pdf");
  assert.equal(tools[8].annotations.readOnlyHint, true);
  assert.equal(tools[9].name, "vpe_get_evaluation_forms");
  assert.equal(tools[9].annotations.readOnlyHint, true);
  assert.deepEqual(tools.slice(10, 13).map(({ name }) => name), [
    "vpe_search_members",
    "vpe_change_agenda",
    "vpe_undo_last_agenda_change",
  ]);
  assert.equal(tools.find(({ name }) => name === "vpe_change_agenda").annotations.destructiveHint, true);
  assert.equal(tools.find(({ name }) => name === "vpe_change_agenda").annotations.idempotentHint, false);
  assert.match(
    tools.find(({ name }) => name === "vpe_change_agenda").description,
    /set_item_field member\/evaluator, or set_meeting_field meetingManager\/photographer/,
  );
  assert.equal(tools.find(({ name }) => name === "vpe_undo_last_agenda_change").annotations.idempotentHint, false);
  assert.deepEqual(tools.slice(13, 20).map(({ name }) => name), [
    "vpe_get_meeting_role_sop",
    "vpe_get_role_booking_context",
    "vpe_search_pathways_projects",
    "vpe_book_role",
    "vpe_create_booking_goal",
    "vpe_propose_role_booking_change",
    "vpe_apply_role_booking_change",
  ]);
  assert.equal(tools.find(({ name }) => name === "vpe_book_role").annotations.idempotentHint, true);
  assert.equal(tools.find(({ name }) => name === "vpe_propose_role_booking_change").annotations.readOnlyHint, true);
  assert.equal(tools.find(({ name }) => name === "vpe_apply_role_booking_change").annotations.destructiveHint, true);
  const wod = tools.find(({ name }) => name === "vpe_random_wod");
  assert.equal(wod.annotations.readOnlyHint, true);
  assert.equal(wod.annotations.destructiveHint, false);
  assert.deepEqual(tools.slice(21, 27).map(({ name }) => name), [
    "vpe_list_wod_words",
    "vpe_add_wod",
    "vpe_update_wod",
    "vpe_remove_wod",
    "vpe_set_meeting_wod",
    "vpe_clear_meeting_wod",
  ]);
  assert.equal(tools.find(({ name }) => name === "vpe_set_meeting_wod").annotations.readOnlyHint, false);
  assert.equal(tools.find(({ name }) => name === "vpe_clear_meeting_wod").annotations.destructiveHint, false);
  assert.deepEqual(tools.slice(27, 32).map(({ name }) => name), [
    "vpe_list_table_topics",
    "vpe_add_table_topic",
    "vpe_remove_table_topic",
    "vpe_update_table_topic",
    "vpe_preview_table_topic_draw",
  ]);
  assert.equal(tools.find(({ name }) => name === "vpe_list_table_topics").annotations.readOnlyHint, true);
  assert.equal(tools.find(({ name }) => name === "vpe_add_table_topic").annotations.readOnlyHint, false);
  assert.equal(tools.find(({ name }) => name === "vpe_update_table_topic").annotations.readOnlyHint, false);
  assert.equal(tools.find(({ name }) => name === "vpe_preview_table_topic_draw").annotations.readOnlyHint, true);
  assert.equal(tools.at(-1).name, "vpe_log_user_intent");
  assert.equal(tools.at(-1).inputSchema.required.includes("intent_summary"), true);
  assert.equal(tools.length, 35);
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
  assert.match(metadata, /微信群接龙[\s\S]*🌸🌸🌸/);
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

test("vpe_change_agenda confirmation message carries the proposal_id so text-only clients can confirm", async () => {
  const editSource = await readFile(new URL("../server/mcp-agenda-edit.js", import.meta.url), "utf8");
  assert.match(editSource, /data\.confirmationRequired[\s\S]*proposal_id="\$\{data\.proposalId\}"[\s\S]*confirmed=true/);
});

test("vpe_log_user_intent records once satisfied, without leaking the bearer token, and stays silent when unconfigured", { concurrency: false }, async () => {
  const unconfigured = responseMock();
  await mcpHandler(request(
    { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "vpe_log_user_intent", arguments: { intent_summary: "查了下周会议空缺", satisfied: true } } },
    { headers: { authorization: `Bearer ${PERSONAL_TOKEN}`, host: "localhost", "content-type": "application/json" } },
  ), unconfigured);
  assert.equal(unconfigured.statusCode, 200);
  assert.deepEqual(JSON.parse(unconfigured.body).result.structuredContent, { recorded: true });

  process.env.BITABLE_MCP_TOOL_CALLS_TABLE_ID = "mcp-calls";
  const logged = [];
  const baseFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    if (String(url).includes("/tables/mcp-calls/records") && options.method === "POST") {
      const fields = JSON.parse(options.body);
      logged.push(fields);
      return new Response(JSON.stringify({
        code: 0,
        data: { fields: Object.keys(fields), record_id_list: ["rec_log"], data: [Object.values(fields)] },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return baseFetch(url, options);
  };
  try {
    const configured = responseMock();
    await mcpHandler(request(
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "vpe_log_user_intent", arguments: { intent_summary: "确认了签到二维码", satisfied: false, missing_capability: "缺一个批量提醒工具" } } },
      { headers: { authorization: `Bearer ${PERSONAL_TOKEN}`, host: "localhost", "content-type": "application/json" } },
    ), configured);
    assert.equal(configured.statusCode, 200);
    assert.equal(logged.length, 1);
    assert.equal(logged[0].tool_name, "vpe_log_user_intent");
    assert.equal(logged[0].status, "ok");
    assert.equal(logged[0].principal_id, "rec_officer");
    assert.equal(logged[0].principal_name, "Test Officer");
    assert.match(logged[0].args_digest, /确认了签到二维码/);
    assert.ok(!Object.values(logged[0]).includes(PERSONAL_TOKEN), "must never store the bearer token");
    assert.ok(!("principal_token" in logged[0]) && !("token" in logged[0]));
  } finally {
    delete process.env.BITABLE_MCP_TOOL_CALLS_TABLE_ID;
  }
});

test("vpe_log_user_intent rejects multiline or oversized summaries before they reach the log", async () => {
  const multiline = responseMock();
  await mcpHandler(request(
    { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "vpe_log_user_intent", arguments: { intent_summary: "line one\nline two", satisfied: true } } },
    { headers: { authorization: `Bearer ${PERSONAL_TOKEN}`, host: "localhost", "content-type": "application/json" } },
  ), multiline);
  assert.equal(JSON.parse(multiline.body).result.isError, true);
  assert.equal(JSON.parse(multiline.body).result.structuredContent.code, "INVALID_INTENT_SUMMARY");

  const tooLong = responseMock();
  await mcpHandler(request(
    { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "vpe_log_user_intent", arguments: { intent_summary: "x".repeat(201), satisfied: true } } },
    { headers: { authorization: `Bearer ${PERSONAL_TOKEN}`, host: "localhost", "content-type": "application/json" } },
  ), tooLong);
  assert.equal(JSON.parse(tooLong.body).result.isError, true);
});

test("MCP records tool_error status and code when a tool call fails validation", { concurrency: false }, async () => {
  process.env.BITABLE_MCP_TOOL_CALLS_TABLE_ID = "mcp-calls";
  const logged = [];
  const baseFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    if (String(url).includes("/tables/mcp-calls/records") && options.method === "POST") {
      const fields = JSON.parse(options.body);
      logged.push(fields);
      return new Response(JSON.stringify({
        code: 0,
        data: { fields: Object.keys(fields), record_id_list: ["rec_log"], data: [Object.values(fields)] },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return baseFetch(url, options);
  };
  try {
    const response = responseMock();
    await mcpHandler(request(
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "does_not_exist", arguments: {} } },
      { headers: { authorization: `Bearer ${PERSONAL_TOKEN}`, host: "localhost", "content-type": "application/json" } },
    ), response);
    assert.equal(logged.length, 1);
    assert.equal(logged[0].tool_name, "does_not_exist");
    assert.equal(logged[0].status, "tool_error");
    assert.equal(logged[0].error_code, "UNKNOWN_TOOL");
  } finally {
    delete process.env.BITABLE_MCP_TOOL_CALLS_TABLE_ID;
  }
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

test("ChatGPT downloads keep the OpenAI host even when the path starts with //", async () => {
  const requested = [];
  global.fetch = async (url) => {
    requested.push(new URL(url));
    return new Response(new Uint8Array([1]), { status: 200, headers: { "Content-Type": "image/png" } });
  };
  await downloadChatGptFile({ download_url: "https://files.oaiusercontent.com//evil.example/file?sig=1", size: 1 }, "poster.png");
  assert.equal(requested[0].hostname, "files.oaiusercontent.com");
  assert.equal(requested[0].search, "?sig=1");
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

test("meeting_reference resolves today and next in Asia/Shanghai without guessing a date", () => {
  const meetings = [
    { meetingNumber: 108, date: "2026-09-08", startTime: "18:40", status: "draft" },
    { meetingNumber: 109, date: "2026-09-15", startTime: "18:40", status: "draft" },
    { meetingNumber: 110, date: "2026-09-15", startTime: "09:00", status: "draft" },
    { meetingNumber: 111, date: "2026-09-01", startTime: "18:40", status: "archived" },
  ];
  const now = new Date("2026-09-08T09:00:00+08:00");
  assert.deepEqual(referencedMeeting(meetings, "today", now).map(({ meetingNumber }) => meetingNumber), [108]);
  assert.deepEqual(referencedMeeting(meetings, "next", now).map(({ meetingNumber }) => meetingNumber), [110, 109]);
  assert.deepEqual(referencedMeeting(meetings, "today", new Date("2026-09-09T09:00:00+08:00")), []);
  assert.throws(() => referencedMeeting(meetings, "yesterday", now), { code: "INVALID_MEETING_REFERENCE" });
});

test("meeting_number plus a consistent meeting_reference resolves instead of rejecting", () => {
  const meetings = [
    { meetingNumber: 112, date: "2026-10-20", startTime: "18:40", status: "draft" },
    { meetingNumber: 113, date: "2026-10-27", startTime: "18:40", status: "draft" },
  ];
  const now = new Date("2026-10-20T14:00:00+08:00");
  assert.equal(resolveMeetingSelector(meetings, 112, "today", now), meetings[0]);
  assert.equal(resolveMeetingSelector(meetings, 113, "next", now), meetings[1]);
  // 指向不同会议时报错里要写清各自指向哪场，Agent 才能据此修正而不是原样重试。
  assert.throws(() => resolveMeetingSelector(meetings, 113, "today", now), {
    code: "INVALID_MEETING_SELECTOR",
    message: /meeting_number=113 is #113 \(2026-10-27\).*"today" is #112 \(2026-10-20\).*only one/,
  });
  assert.throws(() => resolveMeetingSelector(meetings, 112, "today", new Date("2026-10-21T09:00:00+08:00")), {
    code: "INVALID_MEETING_SELECTOR",
    message: /"today" is no meeting/,
  });
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
    photographer: "Avery YU",
    wordOfDay: { word: "clarity" },
    votingForm: { formId: "form-105" },
    enableTransitionTime: false,
    blocks: [
      {
        title: "Opening",
        type: "opening",
        items: [
          { id: "president", kind: "role", session: "Presidential Opening", role: "President", duration: 2, member: "", status: "vacant" },
          { id: "timer-intro", kind: "role", session: "Timer Intro", role: "Timer", duration: 2, member: "Riley HU", status: "confirmed", roleAssignmentId: "functional-timer" },
        ],
      },
      {
        title: "Prepared Speeches",
        type: "prepared_speeches",
        items: [
          { id: "speech-1", kind: "speech", session: "Begin Again", role: "Prepared Speaker 1", duration: 7, member: "Jordan LEE", status: "confirmed", evaluator: "Casey KIM", evaluatorStatus: "confirmed", pathwaysMode: "custom", speechObjective: "Practice a clear opening." },
          { id: "speech-2", kind: "speech", session: "Second Speech", role: "Prepared Speaker 2", duration: 7, member: "", status: "vacant", evaluator: "", evaluatorStatus: "vacant", pathwaysMode: "custom", speechObjective: "Practice structure." },
        ],
      },
      {
        title: "Evaluation",
        type: "evaluation",
        items: [
          { id: "eval-1", kind: "role", session: "Speech Evaluation 1", role: "Individual Evaluator", duration: 3, member: "Casey KIM", status: "confirmed", linkedSpeechId: "speech-1" },
          { id: "eval-2", kind: "role", session: "Speech Evaluation 2", role: "Individual Evaluator", duration: 3, member: "", status: "vacant", linkedSpeechId: "speech-2" },
        ],
      },
      {
        title: "Closing",
        type: "closing",
        items: [
          { id: "timer-report", kind: "role", session: "Timer Report", role: "Timer", duration: 3, member: "Riley HU", status: "confirmed", roleAssignmentId: "functional-timer" },
        ],
      },
    ],
  };

  const vacancies = meetingVacancies(meeting);
  assert.equal(vacancies.total, 3);
  assert.deepEqual(vacancies.support.map(({ label }) => label), ["Meeting Manager"]);
  assert.deepEqual(vacancies.speakers.map(({ label }) => label), ["Prepared Speaker 2"]);
  assert.deepEqual(vacancies.evaluators.map(({ label }) => label), ["Individual Evaluator 2"]);

  const text = generateSignupText(meeting, { includeSpeechDetails: true });
  assert.equal((text.match(/^Timer:/gm) || []).length, 1);
  assert.match(text, /Meeting Manager: 🌸🌸🌸/);
  assert.match(text, /Photographer: Avery YU/);
  assert.doesNotMatch(text, /^President:/m);
  assert.match(text, /Prepared Speaker 2: 🌸🌸🌸 — Second Speech/);
  assert.match(text, /Individual Evaluator 2: 🌸🌸🌸/);
  assert.doesNotMatch(text, /undefined|null/);
  assert.match(generateSignupText(meeting, { vacancyEmoji: "🙋", vacancyEmojiCount: 3 }), /Prepared Speaker 2: 🙋🙋🙋/);
  assert.match(generateSignupText(meeting, { vacancyEmoji: "🙋🙋🙋" }), /Prepared Speaker 2: 🙋🙋🙋$/m);

  const ready = meetingReadiness(meeting, { posterPresent: true });
  assert.equal(ready.status, "ready_with_recommendations");
  assert.equal(ready.readyToFinalize, true);
  assert.equal(ready.vacancies.total, 3);
  assert.equal(meetingReadiness(meeting, { posterPresent: false }).status, "risk");
});

test("signup groups voting roles with Functional Role first", () => {
  const text = generateSignupText({
    meetingNumber: 108,
    blocks: [{ items: [
      { id: "warmup", kind: "role", role: "Warm-up Host", status: "vacant" },
      { id: "tme", kind: "role", role: "TME", member: "Logan", status: "confirmed" },
      { id: "grammarian", kind: "role", role: "Grammarian", status: "vacant" },
      { id: "sharing", kind: "role", role: "Sharing Master", member: "Blake", status: "confirmed" },
      { id: "timer", kind: "role", role: "Timer", status: "vacant" },
      { id: "ge", kind: "role", role: "GE", member: "Quinn", status: "confirmed" },
    ] }],
  });
  const roles = text.split("\n").filter((line) => /^(Timer|Grammarian|TME|GE|Sharing Master|Warm-up Host):/.test(line));
  assert.deepEqual(roles, [
    "Timer: 🌸🌸🌸",
    "Grammarian: 🌸🌸🌸",
    "TME: Logan",
    "GE: Quinn",
    "Warm-up Host: 🌸🌸🌸",
    "Sharing Master: Blake",
  ]);
});

test("Admin supports Future posters and MCP recovery deep links while deployment stays under 15 functions", async () => {
  const orchestrationSource = await readFile(new URL("../src/app/orchestration.js", import.meta.url), "utf8");
  const eventsSource = await readFile(new URL("../src/app/events.js", import.meta.url), "utf8");
  assert.match(orchestrationSource, /\["future-posters", "mcp-changes"\]\.includes\(task\)/);
  assert.match(orchestrationSource, /state\.activeTask = task/);
  assert.match(eventsSource, /data-recover-mcp-change/);
  assert.ok((await apiFiles()).length <= 12);
});

test("public MCP landing route is linked from the Agenda login", async () => {
  const [lifecycleSyncSource, entrySource, pageSource, stylesSource, vercelSource] = await Promise.all([
    readFile(new URL("../src/app/lifecycle-sync.js", import.meta.url), "utf8"),
    readFile(new URL("../entry.js", import.meta.url), "utf8"),
    readFile(new URL("../mcp-page.js", import.meta.url), "utf8"),
    readFile(new URL("../styles.css", import.meta.url), "utf8"),
    readFile(new URL("../vercel.json", import.meta.url), "utf8"),
  ]);
  const loginSource = lifecycleSyncSource.slice(lifecycleSyncSource.indexOf("function renderLogin()"), lifecycleSyncSource.indexOf("function guestTimeline("));

  assert.match(loginSource, /href="\/mcp"/);
  assert.match(entrySource, /\^\\\/mcp\\\/\?\$[\s\S]*import\("\.\/mcp-page\.js"\)/);
  assert.match(pageSource, /new URL\("\/api\/mcp", window\.location\.origin\)/);
  assert.match(pageSource, /一句话调整[\s\S]*Agenda。[\s\S]*明确就执行/);
  assert.match(pageSource, /PEOPLE[\s\S]*TIME[\s\S]*STRUCTURE/);
  assert.match(pageSource, /把 #105 的 Timer 换成 Abby[\s\S]*第 105 期 · 2026-08-11 已写入并回读[\s\S]*Revision 23 → 24/);
  assert.match(pageSource, /低风险直写[\s\S]*风险分级[\s\S]*冲突保护[\s\S]*一键撤销/);
  assert.match(pageSource, /按 105 期 Agenda 生成接龙，空缺用 🙋🙋🙋/);
  assert.match(pageSource, /新增能力已包含在同一个 MCP[\s\S]*无需创建第二个 Server/);
  assert.match(pageSource, /vpe_get_role_booking_context[\s\S]*vpe_search_pathways_projects[\s\S]*vpe_book_role[\s\S]*vpe_create_booking_goal[\s\S]*vpe_propose_role_booking_change[\s\S]*vpe_apply_role_booking_change/);
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
  assert.match(pageSource, /vpe_get_role_booking_context[\s\S]*vpe_book_role[\s\S]*vpe_propose_role_booking_change[\s\S]*vpe_apply_role_booking_change/);
  assert.match(pageSource, /vpe_change_agenda[\s\S]*vpe_undo_last_agenda_change/);
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

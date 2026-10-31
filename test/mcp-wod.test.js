import assert from "node:assert/strict";
import test from "node:test";

import { autofillWod, callWodTool, createWod, formatWod, listWodWords, pickWod, removeWod, rowsFromBitablePage, updateWod } from "../server/mcp-wod.js";

const WORD = {
  单词名: "Unrehearsed",
  音标: "/ˌʌnrɪˈhɜːrst/",
  词性: "adjective",
  单词释义: "Not practiced or planned in advance; spontaneous and natural.",
  单词例句: "Your life is an unrehearsed movie.",
};

test("maps a Feishu Base matrix page to WOD records", () => {
  assert.deepEqual(rowsFromBitablePage({ fields: Object.keys(WORD), data: [Object.values(WORD)] }), [WORD]);
});

test("formats a meeting-ready WOD", () => {
  assert.equal(formatWod(WORD), [
    "Unrehearsed (adjective)",
    "Pronunciation: /ˌʌnrɪˈhɜːrst/",
    "Meaning: Not practiced or planned in advance; spontaneous and natural.",
    "Example: Your life is an unrehearsed movie.",
  ].join("\n"));
});

test("selects a supplied WOD index", () => {
  assert.equal(pickWod(["first", "second"], () => 1), "second");
});

test("vpe_random_wod reads the configured Base and returns structured content", async () => {
  process.env.FEISHU_APP_ID = "app";
  process.env.FEISHU_APP_SECRET = "secret";
  process.env.BITABLE_APP_TOKEN = "agenda-base";
  process.env.BITABLE_MEETINGS_TABLE_ID = "meetings";
  process.env.BITABLE_TEMPLATES_TABLE_ID = "templates";
  process.env.BITABLE_BLOCKS_TABLE_ID = "blocks";
  process.env.BITABLE_ITEMS_TABLE_ID = "items";
  process.env.BITABLE_MEMBERS_TABLE_ID = "members";
  process.env.BITABLE_ASSETS_TABLE_ID = "assets";
  process.env.WOD_BASE_TOKEN = "wod-base";
  process.env.WOD_TABLE_ID = "wod-table";
  global.fetch = async (url) => {
    if (String(url).includes("/auth/v3/tenant_access_token/internal")) {
      return new Response(JSON.stringify({ code: 0, tenant_access_token: "tenant", expire: 7200 }), { status: 200 });
    }
    if (String(url).includes("/bases/wod-base/tables/wod-table/records")) {
      return new Response(JSON.stringify({ code: 0, data: { fields: Object.keys(WORD), record_id_list: ["rec_wod_1"], data: [Object.values(WORD)], has_more: false } }), { status: 200 });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  const result = await callWodTool("vpe_random_wod", {});
  assert.equal(result.data.totalWords, 1);
  assert.equal(result.data.单词名, "Unrehearsed");
  assert.match(result.message, /^Unrehearsed \(adjective\)/);
});

test("WOD catalog exposes opaque keys and supports CRUD by key", { concurrency: false }, async () => {
  Object.assign(process.env, {
    FEISHU_APP_ID: "app",
    FEISHU_APP_SECRET: "secret",
    BITABLE_APP_TOKEN: "agenda-base",
    BITABLE_MEETINGS_TABLE_ID: "meetings",
    BITABLE_TEMPLATES_TABLE_ID: "templates",
    BITABLE_BLOCKS_TABLE_ID: "blocks",
    BITABLE_ITEMS_TABLE_ID: "items",
    BITABLE_MEMBERS_TABLE_ID: "members",
    BITABLE_ASSETS_TABLE_ID: "assets",
    WOD_BASE_TOKEN: "wod-base",
    WOD_TABLE_ID: "wod-table",
  });
  const originalFetch = global.fetch;
  const rows = [{ record_id: "rec_wod_1", fields: { ...WORD } }];
  global.fetch = async (url, options = {}) => {
    const text = String(url);
    if (text.includes("/auth/v3/tenant_access_token/internal")) return new Response(JSON.stringify({ code: 0, tenant_access_token: "tenant", expire: 7200 }), { status: 200 });
    if (!text.includes("/bases/wod-base/tables/wod-table/records")) throw new Error(`Unexpected fetch: ${url}`);
    if ((options.method || "GET") === "GET") {
      return new Response(JSON.stringify({ code: 0, data: { fields: Object.keys(WORD), record_id_list: rows.map(({ record_id }) => record_id), data: rows.map(({ fields }) => Object.values(fields)), has_more: false } }), { status: 200 });
    }
    if (options.method === "POST") {
      const fields = JSON.parse(options.body);
      rows.push({ record_id: "rec_wod_2", fields });
      return new Response(JSON.stringify({ code: 0, data: { record_id: "rec_wod_2", fields: Object.keys(fields), data: [Object.values(fields)] } }), { status: 200 });
    }
    const recordId = text.match(/records\/([^?]+)/)?.[1];
    if (options.method === "PATCH") {
      Object.assign(rows.find((row) => row.record_id === recordId).fields, JSON.parse(options.body));
      return new Response(JSON.stringify({ code: 0, data: { record: rows.find((row) => row.record_id === recordId) } }), { status: 200 });
    }
    if (options.method === "DELETE") {
      rows.splice(rows.findIndex((row) => row.record_id === recordId), 1);
      return new Response(JSON.stringify({ code: 0, data: {} }), { status: 200 });
    }
    throw new Error(`Unexpected fetch: ${options.method} ${url}`);
  };
  try {
    const [listed] = await listWodWords();
    assert.match(listed.wodKey, /^[a-f0-9]{16}$/);
    assert.equal("recordId" in listed, false);
    await assert.rejects(() => createWod({ 单词名: "x" }), (error) => error.code === "INVALID_WOD");
    const created = await createWod({ ...WORD, 单词名: "Clarity" });
    const updated = await updateWod(created.wodKey, { ...WORD, 单词名: "Focus" });
    assert.equal(updated.单词名, "Focus");
    await removeWod(created.wodKey);
    assert.equal((await listWodWords()).some((word) => word.wodKey === created.wodKey), false);
  } finally {
    global.fetch = originalFetch;
  }
});

test("set meeting WOD accepts direct word fields and never touches the WOD word bank", { concurrency: false }, async () => {
  Object.assign(process.env, {
    FEISHU_APP_ID: "app", FEISHU_APP_SECRET: "secret", BITABLE_APP_TOKEN: "agenda-base",
    BITABLE_MEETINGS_TABLE_ID: "meetings", BITABLE_TEMPLATES_TABLE_ID: "templates", BITABLE_BLOCKS_TABLE_ID: "blocks",
    BITABLE_ITEMS_TABLE_ID: "items", BITABLE_MEMBERS_TABLE_ID: "members", BITABLE_ASSETS_TABLE_ID: "assets",
    WOD_BASE_TOKEN: "wod-base", WOD_TABLE_ID: "wod-table",
  });
  const meeting = { record_id: "rec_meeting", fields: {
    meeting_id: "meeting_109", meeting_number: 109, starts_at: Date.parse("2026-09-12T18:40:00+08:00"), theme: "Direct", meeting_type: "regular_meeting", status: "draft", venue: "Room", voting_code: "DEMO-109", voting_qr_source: "system", table_topics_speakers_json: "[]", enable_transition_time: false, photographer_member_id: "", photographer_name: "", meeting_manager_member_id: "", meeting_manager_name: "", wod_word: "", wod_pronunciation: "", wod_part_of_speech: "", wod_definition: "", wod_example: "", revision: 3,
  } };
  const block = { record_id: "rec_block", fields: { block_id: "block_1", meeting_id: "meeting_109", meeting: [{ id: "rec_meeting" }], order_index: 0, block_type: "custom", title: "Opening", notes: "" } };
  const item = { record_id: "rec_item", fields: { item_id: "item_1", meeting_id: "meeting_109", block: [{ id: "rec_block" }], order_index: 0, item_kind: "role", session_title: "Welcome", role_title: "Host", duration_min: 3, member: [], member_name_snapshot: "", evaluator: [], evaluator_name_snapshot: "", speech_objective: "", status: "confirmed" } };
  const tables = new Map([["meetings", [meeting]], ["blocks", [block]], ["items", [item]], ["members", []]]);
  const matrix = (records) => {
    const fields = [...new Set(records.flatMap((record) => Object.keys(record.fields)))];
    return { code: 0, data: { fields, record_id_list: records.map((record) => record.record_id), data: records.map((record) => fields.map((field) => record.fields[field])), has_more: false } };
  };
  const originalFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    const text = String(url);
    if (text.includes("/auth/v3/tenant_access_token/internal")) return new Response(JSON.stringify({ code: 0, tenant_access_token: "tenant", expire: 7200 }), { status: 200 });
    if (text.includes("wod-base")) throw new Error("Direct meeting WOD must not read the WOD base.");
    const tableId = [...tables.keys()].find((id) => text.includes(`/tables/${id}/records`));
    if ((options.method || "GET") === "GET" && tableId) return new Response(JSON.stringify(matrix(tables.get(tableId))), { status: 200 });
    if (options.method === "PATCH" && tableId === "meetings") {
      Object.assign(meeting.fields, JSON.parse(options.body));
      return new Response(JSON.stringify({ code: 0, data: { record_id: meeting.record_id } }), { status: 200 });
    }
    throw new Error(`Unexpected fetch: ${options.method || "GET"} ${url}`);
  };
  try {
    const set = await callWodTool("vpe_set_meeting_wod", {
      meeting_number: 109,
      word: "recount", pronunciation: "/rɪˈkaʊnt/", part_of_speech: "verb",
      definition: "To tell someone about something that happened, especially in detail.",
      example: "In the meeting she recounted the whole trip.",
    });
    assert.equal(set.data.wordOfDay.word, "recount");
    assert.equal(meeting.fields.wod_word, "recount");
    assert.equal(meeting.fields.wod_part_of_speech, "verb");
    await assert.rejects(
      () => callWodTool("vpe_set_meeting_wod", { meeting_number: 109, word: "half", pronunciation: "x", part_of_speech: "n", definition: "d", example: "e", wod_key: "a".repeat(16) }),
      (error) => error.code === "INVALID_ARGUMENTS",
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test("set and clear meeting WOD copy or remove all five snapshot fields", { concurrency: false }, async () => {
  Object.assign(process.env, {
    FEISHU_APP_ID: "app", FEISHU_APP_SECRET: "secret", BITABLE_APP_TOKEN: "agenda-base",
    BITABLE_MEETINGS_TABLE_ID: "meetings", BITABLE_TEMPLATES_TABLE_ID: "templates", BITABLE_BLOCKS_TABLE_ID: "blocks",
    BITABLE_ITEMS_TABLE_ID: "items", BITABLE_MEMBERS_TABLE_ID: "members", BITABLE_ASSETS_TABLE_ID: "assets",
    WOD_BASE_TOKEN: "wod-base", WOD_TABLE_ID: "wod-table",
  });
  const meeting = { record_id: "rec_meeting", fields: {
    meeting_id: "meeting_105", meeting_number: 105, starts_at: Date.parse("2026-09-12T18:40:00+08:00"), theme: "Snapshot", meeting_type: "regular_meeting", status: "draft", venue: "Room", voting_code: "DEMO-105", voting_qr_source: "system", table_topics_speakers_json: "[]", enable_transition_time: false, photographer_member_id: "", photographer_name: "", meeting_manager_member_id: "", meeting_manager_name: "", wod_word: "", wod_pronunciation: "", wod_part_of_speech: "", wod_definition: "", wod_example: "", revision: 7,
  } };
  const block = { record_id: "rec_block", fields: { block_id: "block_1", meeting_id: "meeting_105", meeting: [{ id: "rec_meeting" }], order_index: 0, block_type: "custom", title: "Opening", notes: "" } };
  const item = { record_id: "rec_item", fields: { item_id: "item_1", meeting_id: "meeting_105", block: [{ id: "rec_block" }], order_index: 0, item_kind: "role", session_title: "Welcome", role_title: "Host", duration_min: 3, member: [], member_name_snapshot: "", evaluator: [], evaluator_name_snapshot: "", speech_objective: "", status: "confirmed" } };
  const source = { record_id: "rec_wod_1", fields: { ...WORD } };
  const tables = new Map([["meetings", [meeting]], ["blocks", [block]], ["items", [item]], ["members", []]]);
  const matrix = (records) => {
    const fields = [...new Set(records.flatMap((record) => Object.keys(record.fields)))];
    return { code: 0, data: { fields, record_id_list: records.map((record) => record.record_id), data: records.map((record) => fields.map((field) => record.fields[field])), has_more: false } };
  };
  const originalFetch = global.fetch;
  let meetingWrites = 0;
  let conflictOnWodRead = false;
  global.fetch = async (url, options = {}) => {
    const text = String(url);
    if (text.includes("/auth/v3/tenant_access_token/internal")) return new Response(JSON.stringify({ code: 0, tenant_access_token: "tenant", expire: 7200 }), { status: 200 });
    if (text.includes("/bases/wod-base/tables/wod-table/records")) {
      if (conflictOnWodRead) meeting.fields.revision += 1;
      return new Response(JSON.stringify(matrix([source])), { status: 200 });
    }
    const tableId = [...tables.keys()].find((id) => text.includes(`/tables/${id}/records`));
    if ((options.method || "GET") === "GET" && tableId) return new Response(JSON.stringify(matrix(tables.get(tableId))), { status: 200 });
    if (options.method === "PATCH" && tableId === "meetings") {
      meetingWrites += 1;
      Object.assign(meeting.fields, JSON.parse(options.body));
      return new Response(JSON.stringify({ code: 0, data: { record_id: meeting.record_id } }), { status: 200 });
    }
    throw new Error(`Unexpected fetch: ${options.method || "GET"} ${url}`);
  };
  try {
    const key = (await listWodWords())[0].wodKey;
    const set = await callWodTool("vpe_set_meeting_wod", { meeting_number: 105, wod_key: key });
    assert.deepEqual(set.data.wordOfDay, { word: "Unrehearsed", pronunciation: "/ˌʌnrɪˈhɜːrst/", partOfSpeech: "adjective", definition: "Not practiced or planned in advance; spontaneous and natural.", usage: "", example: "Your life is an unrehearsed movie." });
    assert.equal(meeting.fields.wod_definition, "Not practiced or planned in advance; spontaneous and natural.");
    source.fields.单词释义 = "Changed source record.";
    assert.equal(meeting.fields.wod_definition, "Not practiced or planned in advance; spontaneous and natural.");
    const cleared = await callWodTool("vpe_clear_meeting_wod", { meeting_number: 105 });
    assert.deepEqual(cleared.data.wordOfDay, { word: "", pronunciation: "", partOfSpeech: "", definition: "", usage: "", example: "" });
    assert.equal(meetingWrites, 2);
    conflictOnWodRead = true;
    const writesBeforeConflict = meetingWrites;
    await assert.rejects(() => callWodTool("vpe_set_meeting_wod", { meeting_number: 105, wod_key: key }), (error) => error.code === "REVISION_CONFLICT");
    assert.equal(meetingWrites, writesBeforeConflict);
  } finally {
    global.fetch = originalFetch;
  }
});

test("set meeting WOD with only a word fills the card from AI without reading the word bank", { concurrency: false }, async () => {
  Object.assign(process.env, {
    FEISHU_APP_ID: "app", FEISHU_APP_SECRET: "secret", BITABLE_APP_TOKEN: "agenda-base",
    BITABLE_MEETINGS_TABLE_ID: "meetings", BITABLE_TEMPLATES_TABLE_ID: "templates", BITABLE_BLOCKS_TABLE_ID: "blocks",
    BITABLE_ITEMS_TABLE_ID: "items", BITABLE_MEMBERS_TABLE_ID: "members", BITABLE_ASSETS_TABLE_ID: "assets",
    WOD_BASE_TOKEN: "wod-base", WOD_TABLE_ID: "wod-table", DEEPSEEK_API_KEY: "deepseek-key",
  });
  const meeting = { record_id: "rec_meeting", fields: {
    meeting_id: "meeting_112", meeting_number: 112, starts_at: Date.parse("2026-10-20T18:40:00+08:00"), theme: "Auto", meeting_type: "regular_meeting", status: "draft", venue: "Room", voting_code: "DEMO-112", voting_qr_source: "system", table_topics_speakers_json: "[]", enable_transition_time: false, photographer_member_id: "", photographer_name: "", meeting_manager_member_id: "", meeting_manager_name: "", wod_word: "", wod_pronunciation: "", wod_part_of_speech: "", wod_definition: "", wod_usage: "", wod_example: "", revision: 1,
  } };
  const block = { record_id: "rec_block", fields: { block_id: "block_1", meeting_id: "meeting_112", meeting: [{ id: "rec_meeting" }], order_index: 0, block_type: "custom", title: "Opening", notes: "" } };
  const tables = new Map([["meetings", [meeting]], ["blocks", [block]], ["items", []], ["members", []]]);
  const matrix = (records) => {
    const fields = [...new Set(records.flatMap((record) => Object.keys(record.fields)))];
    return { code: 0, data: { fields, record_id_list: records.map((record) => record.record_id), data: records.map((record) => fields.map((field) => record.fields[field])), has_more: false } };
  };
  const generated = { pronunciation: "/rɪˈzɪliənt/", partOfSpeech: "adjective", definition: "Able to recover quickly from difficulties.", usage: "Describe people or teams that bounce back.", example: "Our club stayed resilient after losing the venue." };
  let deepseekCalls = 0;
  const originalFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    const text = String(url);
    if (text.includes("/auth/v3/tenant_access_token/internal")) return new Response(JSON.stringify({ code: 0, tenant_access_token: "tenant", expire: 7200 }), { status: 200 });
    if (new URL(text).hostname === "api.deepseek.com") {
      deepseekCalls += 1;
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(generated) } }] }), { status: 200 });
    }
    const tableId = [...tables.keys()].find((id) => text.includes(`/tables/${id}/records`));
    if ((options.method || "GET") === "GET" && tableId) return new Response(JSON.stringify(matrix(tables.get(tableId))), { status: 200 });
    if (options.method === "PATCH" && tableId === "meetings") {
      Object.assign(meeting.fields, JSON.parse(options.body));
      return new Response(JSON.stringify({ code: 0, data: { record_id: meeting.record_id } }), { status: 200 });
    }
    throw new Error(`Unexpected fetch: ${options.method || "GET"} ${url}`);
  };
  try {
    const wordOnly = await callWodTool("vpe_set_meeting_wod", { meeting_number: 112, word: "unrehearsed" });
    assert.equal(deepseekCalls, 1);
    assert.equal(wordOnly.data.source, "ai");
    assert.equal(meeting.fields.wod_word, "unrehearsed");
    assert.equal(meeting.fields.wod_definition, generated.definition);

    const fromAi = await callWodTool("vpe_set_meeting_wod", { meeting_number: 112, word: "resilient", example: "We stay resilient." });
    assert.equal(deepseekCalls, 2);
    assert.equal(fromAi.data.source, "ai");
    assert.equal(meeting.fields.wod_word, "resilient");
    assert.equal(meeting.fields.wod_usage, generated.usage);
    assert.equal(meeting.fields.wod_example, "We stay resilient.");
    assert.match(fromAi.message, /AI 生成/);
    assert.match(fromAi.message, /Able to recover quickly/);
  } finally {
    global.fetch = originalFetch;
    delete process.env.DEEPSEEK_API_KEY;
  }
});

test("autofill goes straight to AI even when the word bank is configured", { concurrency: false }, async () => {
  Object.assign(process.env, {
    FEISHU_APP_ID: "app", FEISHU_APP_SECRET: "secret", BITABLE_APP_TOKEN: "agenda-base",
    BITABLE_MEETINGS_TABLE_ID: "meetings", BITABLE_TEMPLATES_TABLE_ID: "templates", BITABLE_BLOCKS_TABLE_ID: "blocks",
    BITABLE_ITEMS_TABLE_ID: "items", BITABLE_MEMBERS_TABLE_ID: "members", BITABLE_ASSETS_TABLE_ID: "assets",
    WOD_BASE_TOKEN: "wod-base", WOD_TABLE_ID: "wod-table",
  });
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    const text = String(url);
    if (text.includes("/auth/v3/tenant_access_token/internal")) return new Response(JSON.stringify({ code: 0, tenant_access_token: "tenant", expire: 7200 }), { status: 200 });
    throw new Error(`Unexpected fetch: ${url}`);
  };
  try {
    const generated = { word: "Communication", pronunciation: "/kəˌmjuːnɪˈkeɪʃn/", partOfSpeech: "noun", definition: "Sharing information.", usage: "", example: "Clear communication matters." };
    const result = await autofillWod("Communication", { generate: async () => generated });
    assert.deepEqual(result, { source: "ai", wordOfDay: generated });
  } finally {
    global.fetch = originalFetch;
  }
});

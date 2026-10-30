import assert from "node:assert/strict";
import test from "node:test";

import { TABLE_TOPICS_TOOLS, callTableTopicsTool } from "../server/mcp-table-topics.js";

test("Table Topics MCP exposes an in-place update tool", () => {
  const tool = TABLE_TOPICS_TOOLS.find(({ name }) => name === "vpe_update_table_topic");

  assert.equal(tool.annotations.readOnlyHint, false);
  assert.equal(tool.inputSchema.properties.topic_key.minLength, 1);
  assert.equal(tool.inputSchema.properties.topic_text.maxLength, 500);
  assert.match(tool.description, /保密/);
  assert.deepEqual(tool.inputSchema.required, ["topic_key", "topic_text"]);
  assert.equal(tool.inputSchema.oneOf, undefined);
  assert.deepEqual(tool.inputSchema.anyOf, [
    { required: ["meeting_number"] },
    { required: ["meeting_reference"] },
  ]);
});

test("Table Topics update rejects an omitted meeting selector before reading a meeting", async () => {
  await assert.rejects(
    callTableTopicsTool("vpe_update_table_topic", { topic_key: "topic-key", topic_text: "更新" }),
    (error) => error.code === "INVALID_MEETING_SELECTOR",
  );
});

test("Table Topics write tools echo key/text and a presentation deep link; preview never consumes the pool", { concurrency: false }, async () => {
  Object.assign(process.env, {
    FEISHU_APP_ID: "app", FEISHU_APP_SECRET: "secret", BITABLE_APP_TOKEN: "agenda-base",
    BITABLE_MEETINGS_TABLE_ID: "meetings", BITABLE_TEMPLATES_TABLE_ID: "templates", BITABLE_BLOCKS_TABLE_ID: "blocks",
    BITABLE_ITEMS_TABLE_ID: "items", BITABLE_MEMBERS_TABLE_ID: "members", BITABLE_ASSETS_TABLE_ID: "assets",
    BITABLE_TABLE_TOPICS_TABLE_ID: "table_topics",
  });
  const meeting = { record_id: "rec_meeting", fields: {
    meeting_id: "meeting_109", meeting_number: 109, starts_at: Date.parse("2999-09-12T18:40:00+08:00"), theme: "Topics", meeting_type: "regular_meeting", status: "draft", venue: "Room", voting_code: "DEMO-109", voting_qr_source: "system", table_topics_speakers_json: "[]", enable_transition_time: false, photographer_member_id: "", photographer_name: "", meeting_manager_member_id: "", meeting_manager_name: "", wod_word: "", wod_pronunciation: "", wod_part_of_speech: "", wod_definition: "", wod_example: "", revision: 3,
  } };
  const block = { record_id: "rec_block", fields: { block_id: "block_1", meeting_id: "meeting_109", meeting: [{ id: "rec_meeting" }], order_index: 0, block_type: "custom", title: "Opening", notes: "" } };
  const item = { record_id: "rec_item", fields: { item_id: "item_1", meeting_id: "meeting_109", block: [{ id: "rec_block" }], order_index: 0, item_kind: "role", session_title: "Welcome", role_title: "Host", duration_min: 3, member: [], member_name_snapshot: "", evaluator: [], evaluator_name_snapshot: "", speech_objective: "", status: "confirmed" } };
  const tables = new Map([["meetings", [meeting]], ["blocks", [block]], ["items", [item]], ["members", []]]);
  const matrix = (records) => {
    const fields = [...new Set(records.flatMap((record) => Object.keys(record.fields)))];
    return { code: 0, data: { fields, record_id_list: records.map((record) => record.record_id), data: records.map((record) => fields.map((field) => record.fields[field])), has_more: false } };
  };

  let topics = [];
  let nextId = 1;
  const originalFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    const text = String(url);
    if (text.includes("/auth/v3/tenant_access_token/internal")) return new Response(JSON.stringify({ code: 0, tenant_access_token: "tenant", expire: 7200 }), { status: 200 });
    if (text.includes("/tables/table_topics/records/search")) {
      return new Response(JSON.stringify({ code: 0, data: { items: topics.map((topic) => ({ record_id: topic.record_id, fields: topic.fields })), has_more: false } }), { status: 200 });
    }
    if (text.includes("/tables/table_topics/records/batch_delete")) {
      const ids = new Set(JSON.parse(options.body).record_id_list);
      topics = topics.filter((topic) => !ids.has(topic.record_id));
      return new Response(JSON.stringify({ code: 0 }), { status: 200 });
    }
    if (text.includes("/tables/table_topics/records/") && options.method === "PATCH") {
      const recordId = text.match(/\/records\/([^/?]+)/)[1];
      const patch = JSON.parse(options.body);
      Object.assign(topics.find((topic) => topic.record_id === recordId).fields, patch);
      return new Response(JSON.stringify({ code: 0, data: { record_id: recordId, fields: Object.keys(patch), data: [Object.values(patch)] } }), { status: 200 });
    }
    if (text.includes("/tables/table_topics/records") && options.method === "POST") {
      const fields = JSON.parse(options.body);
      const record = { record_id: `rec_topic_${nextId++}`, fields };
      topics.push(record);
      return new Response(JSON.stringify({ code: 0, data: { record_id: record.record_id, fields: Object.keys(fields), data: [Object.values(fields)] } }), { status: 200 });
    }
    const tableId = [...tables.keys()].find((id) => text.includes(`/tables/${id}/records`));
    if ((options.method || "GET") === "GET" && tableId) return new Response(JSON.stringify(matrix(tables.get(tableId))), { status: 200 });
    throw new Error(`Unexpected fetch: ${options.method || "GET"} ${url}`);
  };

  try {
    meeting.fields.starts_at = Date.parse("2000-09-12T18:40:00+08:00");
    await assert.rejects(
      callTableTopicsTool("vpe_add_table_topic", { meeting_number: 109, topic_text: "过去会议" }, { id: "mcp" }, "https://agenda.example"),
      (error) => error.code === "MEETING_LOCKED",
    );
    meeting.fields.starts_at = Date.parse("2999-09-12T18:40:00+08:00");
    const added = await callTableTopicsTool("vpe_add_table_topic", { meeting_number: 109, topic_text: "如果能重来" }, { id: "mcp" }, "https://agenda.example");
    assert.match(added.message, /key=[0-9a-f]{16}/);
    assert.match(added.message, /如果能重来/);
    assert.equal(added.data.tableTopicsUrl, "https://agenda.example/m/109/presentation?jump=tabletopics");
    const key = added.data.topic.key;

    meeting.fields.status = "final";
    await assert.rejects(
      callTableTopicsTool("vpe_update_table_topic", { meeting_number: 109, topic_key: key, topic_text: "Final 不可改" }, {}, "https://agenda.example"),
      (error) => error.code === "MEETING_LOCKED",
    );
    meeting.fields.status = "draft";

    const listed = await callTableTopicsTool("vpe_list_table_topics", { meeting_number: 109 }, {}, "https://agenda.example");
    assert.match(listed.message, new RegExp(`key=${key}`));

    const updated = await callTableTopicsTool("vpe_update_table_topic", { meeting_number: 109, topic_key: key, topic_text: "换个话题" }, {}, "https://agenda.example");
    assert.match(updated.message, /换个话题/);
    assert.match(updated.message, /jump=tabletopics/);

    const preview = await callTableTopicsTool("vpe_preview_table_topic_draw", { meeting_number: 109 }, {}, "https://agenda.example");
    assert.match(preview.message, /预览抽取/);
    assert.equal(preview.data.topicText, "换个话题");
    const stillThere = await callTableTopicsTool("vpe_list_table_topics", { meeting_number: 109 }, {}, "https://agenda.example");
    assert.equal(stillThere.data.topics.length, 1);

    const removed = await callTableTopicsTool("vpe_remove_table_topic", { meeting_number: 109, topic_key: key }, {}, "https://agenda.example");
    assert.match(removed.message, /换个话题/);
    assert.match(removed.message, /剩余 0 条/);
    assert.match(removed.message, /jump=tabletopics/);
  } finally {
    global.fetch = originalFetch;
  }
});

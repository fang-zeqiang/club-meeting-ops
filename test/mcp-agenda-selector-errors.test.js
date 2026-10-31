import assert from "node:assert/strict";
import test from "node:test";

import { createAgendaEditService } from "../server/mcp-agenda-edit.js";
import { callTableTopicsTool } from "../server/mcp-table-topics.js";
import { shanghaiDate } from "../workflow-helpers.js";

const principal = { id: "token_record_1", name: "Test Officer" };
const BASE_URL = "https://agenda.example";

function meetingRecord(id, meetingNumber, date) {
  return {
    id,
    meetingNumber,
    date,
    startTime: "18:40",
    theme: "Momentum",
    status: "draft",
    revision: 5,
    enableTransitionTime: false,
    meetingManagerMemberId: "",
    meetingManager: "",
    photographerMemberId: "",
    photographer: "",
    blocks: [
      {
        id: `${id}_opening`,
        type: "opening",
        title: "Opening",
        notes: "",
        items: [
          { id: `${id}_timer`, kind: "role", session: "Timer Intro", role: "Timer", duration: 2, memberId: "", member: "", evaluatorId: "", evaluator: "", evaluatorStatus: "", roleAssignmentId: "", linkedSpeechId: "", externalPresentationUrl: "", status: "vacant" },
          { id: `${id}_ge`, kind: "role", session: "General Evaluation", role: "General Evaluator", duration: 5, memberId: "", member: "", evaluatorId: "", evaluator: "", evaluatorStatus: "", roleAssignmentId: "", linkedSpeechId: "", externalPresentationUrl: "", status: "vacant" },
        ],
      },
    ],
  };
}

// 两场会议：#112 在"今天"（2026-10-20，上海时区），#113 在下一周。
function harness() {
  const meetings = new Map([
    ["meeting_112", meetingRecord("meeting_112", 112, "2026-10-20")],
    ["meeting_113", meetingRecord("meeting_113", 113, "2026-10-27")],
  ]);
  const writes = [];
  const audits = [];
  const service = createAgendaEditService({
    listMeetings: async () => [...meetings.values()].map(({ id, meetingNumber, date, startTime, status }) => ({ id, meetingNumber, date, startTime, status })),
    getMeeting: async (id) => structuredClone(meetings.get(id)),
    getMembers: async () => [],
    getAgendaRoles: async () => [],
    checkExternalPublicUrl: async (url) => ({ url, finalUrl: url, provider: "other", status: "unknown", reason: "", checkedAt: "2026-10-20T04:00:00.000Z" }),
    getGlobalAssetImage: async () => ({ image: { present: true } }),
    updateMeeting: async (id, next, expectedRevision) => {
      writes.push(id);
      const saved = { ...structuredClone(next), revision: expectedRevision + 1 };
      meetings.set(id, saved);
      return structuredClone(saved);
    },
    findAgendaAudit: async (operationId) => audits.find((audit) => audit.operationId === operationId) || null,
    listAgendaAudits: async () => structuredClone(audits),
    createAgendaAudit: async (entry) => {
      const audit = { ...structuredClone(entry), recordId: `audit_${audits.length + 1}`, status: "prepared", result: null };
      audits.push(audit);
      return structuredClone(audit);
    },
    updateAgendaAudit: async (recordId, fields) => {
      const audit = audits.find((candidate) => candidate.recordId === recordId);
      if (fields.status) audit.status = fields.status;
      if (fields.result_json) audit.result = JSON.parse(fields.result_json);
      return { record_id: recordId, fields };
    },
    now: () => Date.parse("2026-10-20T04:00:00Z"),
  });
  return { service, meetings, writes, audits };
}

test.beforeEach(() => {
  process.env.AGENDA_SESSION_SECRET = "agenda-selector-test-secret";
  process.env.MCP_AGENDA_WRITE_ENABLED = "true";
});

const themeChange = [{ op: "set_meeting_field", field: "theme", value: "Focus" }];

test("vpe_change_agenda accepts meeting_number with a consistent meeting_date or meeting_reference", async () => {
  const { service, meetings, audits } = harness();
  const result = await service.change({ meeting_number: 112, meeting_date: "2026-10-20", changes: themeChange }, principal, BASE_URL);
  assert.equal(result.meetingLabel, "第 112 期 · 2026-10-20");
  assert.equal(meetings.get("meeting_112").theme, "Focus");
  assert.equal(meetings.get("meeting_113").theme, "Momentum");
  // 审计照常落表。
  assert.equal(audits.length, 1);

  const viaReference = await service.change({ meeting_number: 113, meeting_reference: "next", changes: themeChange }, principal, BASE_URL);
  assert.equal(viaReference.meetingLabel, "第 113 期 · 2026-10-27");

  const allThree = await service.change({ meeting_number: 112, meeting_date: "2026-10-20", meeting_reference: "today", changes: [{ op: "set_meeting_field", field: "theme", value: "Again" }] }, principal, BASE_URL);
  assert.equal(allThree.meetingLabel, "第 112 期 · 2026-10-20");
});

test("vpe_change_agenda rejects disagreeing meeting selectors and names what each one resolved to", async () => {
  const { service, writes } = harness();
  await assert.rejects(
    service.change({ meeting_number: 113, meeting_date: "2026-10-20", changes: themeChange }, principal, BASE_URL),
    (error) => error.code === "INVALID_MEETING_SELECTOR"
      && /meeting_number=113 is 第 113 期 · 2026-10-27/.test(error.message)
      && /meeting_date=2026-10-20 is 第 112 期 · 2026-10-20/.test(error.message),
  );
  await assert.rejects(
    service.change({ meeting_number: 112, meeting_reference: "next", changes: themeChange }, principal, BASE_URL),
    (error) => error.code === "INVALID_MEETING_SELECTOR"
      && /meeting_number=112 is 第 112 期 · 2026-10-20/.test(error.message)
      && /meeting_reference=next is 第 113 期 · 2026-10-27/.test(error.message),
  );
  await assert.rejects(
    service.change({ meeting_number: 112, meeting_date: "2026-10-21", changes: themeChange }, principal, BASE_URL),
    (error) => error.code === "INVALID_MEETING_SELECTOR" && /meeting_date=2026-10-21 is no meeting/.test(error.message),
  );
  await assert.rejects(
    service.change({ changes: themeChange }, principal, BASE_URL),
    (error) => error.code === "INVALID_MEETING_SELECTOR",
  );
  assert.deepEqual(writes, []);
});

test("set_item_field with an unknown key names the key and the allowed keys", async () => {
  const { service, writes } = harness();
  await assert.rejects(
    service.change({
      meeting_number: 112,
      changes: [{ op: "set_item_field", target: "Timer Intro", field: "externalPresentationUrl", external_presentation_url: "https://example.com/deck" }],
    }, principal, BASE_URL),
    (error) => error.code === "INVALID_OPERATION"
      && /does not accept external_presentation_url/.test(error.message)
      && /Allowed keys: op, target, target_id, field, value/.test(error.message)
      && /put the new value in value/i.test(error.message),
  );
  assert.deepEqual(writes, []);
});

test("AGENDA_TARGET_NOT_FOUND lists candidate targets and explains how to target", async () => {
  const { service } = harness();
  const error = await service.change({
    meeting_number: 112,
    changes: [{ op: "set_item_field", target: "Timer Alice", field: "duration", value: 3 }],
  }, principal, BASE_URL).catch((caught) => caught);
  assert.equal(error.code, "AGENDA_TARGET_NOT_FOUND");
  assert.deepEqual(error.details.candidates.map(({ id }) => id), ["meeting_112_timer", "meeting_112_ge"]);
  assert.match(error.message, /one item title, role, member, or Session/);
  assert.match(error.message, /target_id/);

  const byId = await service.change({
    meeting_number: 112,
    changes: [{ op: "remove_item", target_id: "missing-id" }],
  }, principal, BASE_URL).catch((caught) => caught);
  assert.equal(byId.code, "AGENDA_TARGET_NOT_FOUND");
  assert.equal(byId.details.candidates.length, 2);
});

test("AGENDA_TARGET_AMBIGUOUS keeps candidates with ids", async () => {
  const { service } = harness();
  const error = await service.change({ meeting_number: 112, changes: [{ op: "remove_item", target: "Opening" }] }, principal, BASE_URL).catch((caught) => caught);
  assert.equal(error.code, "AGENDA_TARGET_AMBIGUOUS");
  assert.deepEqual(error.details.candidates.map(({ id }) => id), ["meeting_112_timer", "meeting_112_ge"]);
  assert.match(error.message, /target_id/);
});

test("PROPOSAL_SIGNATURE_INVALID tells the agent to pass proposal_id back unchanged", async () => {
  const { service, writes } = harness();
  const proposal = await service.change({ meeting_number: 112, changes: [{ op: "set_meeting_field", field: "status", value: "final" }] }, principal, BASE_URL);
  assert.equal(proposal.confirmationRequired, true);
  await assert.rejects(
    service.change({ proposal_id: proposal.proposalId.slice(0, -4), confirmed: true }, principal, BASE_URL),
    (error) => error.code === "PROPOSAL_SIGNATURE_INVALID" && /exactly as returned/.test(error.message) && /truncat/.test(error.message),
  );
  assert.deepEqual(writes, []);
});

test("EXPLICIT_CONFIRMATION_REQUIRED gate is unchanged", async () => {
  const { service, writes } = harness();
  const proposal = await service.change({ meeting_number: 112, changes: [{ op: "set_meeting_field", field: "status", value: "final" }] }, principal, BASE_URL);
  for (const args of [
    { proposal_id: proposal.proposalId },
    { proposal_id: proposal.proposalId, confirmed: false },
    { proposal_id: proposal.proposalId, confirmed: true, meeting_number: 112 },
    { proposal_id: proposal.proposalId, confirmed: true, changes: themeChange },
  ]) {
    await assert.rejects(service.change(args, principal, BASE_URL), (error) => error.code === "EXPLICIT_CONFIRMATION_REQUIRED");
  }
  assert.deepEqual(writes, []);
});

test("Table Topics update accepts consistent meeting_number + meeting_reference and rejects disagreeing ones", { concurrency: false }, async () => {
  Object.assign(process.env, {
    FEISHU_APP_ID: "app", FEISHU_APP_SECRET: "secret", BITABLE_APP_TOKEN: "agenda-base",
    BITABLE_MEETINGS_TABLE_ID: "meetings", BITABLE_TEMPLATES_TABLE_ID: "templates", BITABLE_BLOCKS_TABLE_ID: "blocks",
    BITABLE_ITEMS_TABLE_ID: "items", BITABLE_MEMBERS_TABLE_ID: "members", BITABLE_ASSETS_TABLE_ID: "assets",
    BITABLE_TABLE_TOPICS_TABLE_ID: "table_topics",
  });
  // "today" 依赖真实时钟，会议日期按当前上海日期生成。
  const today = shanghaiDate(new Date());
  const meetingFields = (id, number, date) => ({
    meeting_id: id, meeting_number: number, starts_at: Date.parse(`${date}T18:40:00+08:00`), theme: "Topics", meeting_type: "regular_meeting", status: "draft", venue: "Room", voting_code: `DEMO-${number}`, voting_qr_source: "system", table_topics_speakers_json: "[]", enable_transition_time: false, photographer_member_id: "", photographer_name: "", meeting_manager_member_id: "", meeting_manager_name: "", wod_word: "", wod_pronunciation: "", wod_part_of_speech: "", wod_definition: "", wod_example: "", revision: 3,
  });
  const tables = new Map([
    ["meetings", [
      { record_id: "rec_m1", fields: meetingFields("meeting_120", 120, today) },
      { record_id: "rec_m2", fields: meetingFields("meeting_121", 121, "2099-01-01") },
    ]],
    ["blocks", []], ["items", []], ["members", []],
  ]);
  const matrix = (records) => {
    const fields = [...new Set(records.flatMap((record) => Object.keys(record.fields)))];
    return { code: 0, data: { fields, record_id_list: records.map((record) => record.record_id), data: records.map((record) => fields.map((field) => record.fields[field])), has_more: false } };
  };
  const topics = [{ record_id: "rec_topic_1", fields: { topic_key: "topic-key-1", meeting_id: "meeting_120", topic_text: "旧话题" } }];
  const patches = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    const text = String(url);
    if (text.includes("/auth/v3/tenant_access_token/internal")) return new Response(JSON.stringify({ code: 0, tenant_access_token: "tenant", expire: 7200 }), { status: 200 });
    if (text.includes("/tables/table_topics/records/search")) {
      return new Response(JSON.stringify({ code: 0, data: { items: topics.map((topic) => ({ record_id: topic.record_id, fields: topic.fields })), has_more: false } }), { status: 200 });
    }
    if (text.includes("/tables/table_topics/records/") && options.method === "PATCH") {
      const recordId = text.match(/\/records\/([^/?]+)/)[1];
      const patch = JSON.parse(options.body);
      patches.push(recordId);
      Object.assign(topics.find((topic) => topic.record_id === recordId).fields, patch);
      return new Response(JSON.stringify({ code: 0, data: { record_id: recordId, fields: Object.keys(patch), data: [Object.values(patch)] } }), { status: 200 });
    }
    const tableId = [...tables.keys()].find((id) => text.includes(`/tables/${id}/records`));
    if ((options.method || "GET") === "GET" && tableId) return new Response(JSON.stringify(matrix(tables.get(tableId))), { status: 200 });
    throw new Error(`Unexpected fetch: ${options.method || "GET"} ${url}`);
  };
  try {
    const listed = await callTableTopicsTool("vpe_list_table_topics", { meeting_number: 120 }, {}, BASE_URL);
    const key = listed.data.topics[0].key;
    const updated = await callTableTopicsTool("vpe_update_table_topic", { meeting_number: 120, meeting_reference: "today", topic_key: key, topic_text: "新话题" }, {}, BASE_URL);
    assert.match(updated.message, /新话题/);
    assert.equal(patches.length, 1);

    await assert.rejects(
      callTableTopicsTool("vpe_update_table_topic", { meeting_number: 121, meeting_reference: "today", topic_key: key, topic_text: "不该写入" }, {}, BASE_URL),
      (error) => error.code === "INVALID_MEETING_SELECTOR"
        && /meeting_number=121 is #121 \(2099-01-01\)/.test(error.message)
        && new RegExp(`"today" is #120 \\(${today}\\)`).test(error.message),
    );
    assert.equal(patches.length, 1);
  } finally {
    global.fetch = originalFetch;
  }
});

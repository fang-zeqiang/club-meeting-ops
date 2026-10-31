import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import { createTopic, createTopics, deleteTopic, drawTopic, listTopics, topicsRemainingCount, updateTopic } from "../server/table-topics-repository.js";

const TABLE_ID = "tbl_table_topics";
const MEETING_ID = "meeting_1";

function publicKey(recordId) {
  return crypto.createHash("sha256").update(recordId).digest("hex").slice(0, 16);
}

function searchResponse(records) {
  return { code: 0, data: { items: records.map((record) => ({ record_id: record.record_id, fields: record.fields })), has_more: false } };
}

function createResponse(recordId, fields) {
  return { code: 0, data: { record_id: recordId, fields: Object.keys(fields), data: [Object.values(fields)] } };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function seedEnv() {
  Object.assign(process.env, {
    FEISHU_APP_ID: "app",
    FEISHU_APP_SECRET: "secret",
    BITABLE_APP_TOKEN: "base",
    BITABLE_MEETINGS_TABLE_ID: "meetings",
    BITABLE_TEMPLATES_TABLE_ID: "templates",
    BITABLE_BLOCKS_TABLE_ID: "blocks",
    BITABLE_ITEMS_TABLE_ID: "items",
    BITABLE_MEMBERS_TABLE_ID: "members",
    BITABLE_ASSETS_TABLE_ID: "assets",
    BITABLE_TABLE_TOPICS_TABLE_ID: TABLE_ID,
  });
}

function mockTenantAndSearch(records) {
  global.fetch = async (url, options = {}) => {
    if (String(url).includes("/auth/v3/tenant_access_token/internal")) {
      return jsonResponse({ code: 0, tenant_access_token: "tenant", expire: 7200 });
    }
    if (String(url).includes(`/tables/${TABLE_ID}/records/search`)) return jsonResponse(searchResponse(records));
    throw new Error(`Unexpected fetch: ${url}`);
  };
}

test("listTopics sorts by sort_order and never exposes the raw record id", { concurrency: false }, async () => {
  seedEnv();
  const records = [
    { record_id: "rec_b", fields: { meeting_id: MEETING_ID, topic_text: "第二题", sort_order: 2, created_by: "admin", created_at: "2026-01-01T00:00:00.000Z" } },
    { record_id: "rec_a", fields: { meeting_id: MEETING_ID, topic_text: "第一题", sort_order: 1, created_by: "admin", created_at: "2026-01-01T00:00:00.000Z" } },
  ];
  mockTenantAndSearch(records);
  const topics = await listTopics(MEETING_ID);
  assert.deepEqual(topics.map((topic) => topic.topicText), ["第一题", "第二题"]);
  assert.equal(topics[0].key, publicKey("rec_a"));
  assert.equal(topics.some((topic) => "recordId" in topic === false), false);
});

test("createTopic rejects empty or oversized text and assigns the next sort_order", { concurrency: false }, async () => {
  seedEnv();
  const existing = [{ record_id: "rec_a", fields: { meeting_id: MEETING_ID, topic_text: "第一题", sort_order: 5, created_by: "admin", created_at: "2026-01-01T00:00:00.000Z" } }];
  let created;
  global.fetch = async (url, options = {}) => {
    if (String(url).includes("/auth/v3/tenant_access_token/internal")) return jsonResponse({ code: 0, tenant_access_token: "tenant", expire: 7200 });
    if (String(url).includes(`/tables/${TABLE_ID}/records/search`)) return jsonResponse(searchResponse(existing));
    if (String(url).includes(`/tables/${TABLE_ID}/records`) && options.method === "POST") {
      created = JSON.parse(options.body);
      return jsonResponse(createResponse("rec_new", created));
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
  await assert.rejects(createTopic(MEETING_ID, "  ", "admin"), (error) => error.code === "INVALID_TOPIC_TEXT");
  await assert.rejects(createTopic(MEETING_ID, "x".repeat(501), "admin"), (error) => error.code === "INVALID_TOPIC_TEXT");
  const topic = await createTopic(MEETING_ID, "  新话题  ", "member_ttm");
  assert.equal(created.topic_text, "新话题");
  assert.equal(created.sort_order, 6);
  assert.equal(created.created_by, "member_ttm");
  assert.equal(topic.topicText, "新话题");
});

test("createTopics writes every line in order and caps the batch", { concurrency: false }, async () => {
  seedEnv();
  const existing = [{ record_id: "rec_a", fields: { meeting_id: MEETING_ID, topic_text: "第一题", sort_order: 2, created_by: "admin", created_at: "2026-01-01T00:00:00.000Z" } }];
  const created = [];
  global.fetch = async (url, options = {}) => {
    if (String(url).includes("/auth/v3/tenant_access_token/internal")) return jsonResponse({ code: 0, tenant_access_token: "tenant", expire: 7200 });
    if (String(url).includes(`/tables/${TABLE_ID}/records/search`)) return jsonResponse(searchResponse(existing));
    if (String(url).includes(`/tables/${TABLE_ID}/records`) && options.method === "POST") {
      const fields = JSON.parse(options.body);
      created.push(fields);
      return jsonResponse(createResponse(`rec_new_${created.length}`, fields));
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
  const topics = await createTopics(MEETING_ID, ["  批量一  ", "", "批量二"], "member_ttm");
  assert.deepEqual(topics.map((topic) => topic.topicText), ["批量一", "批量二"]);
  assert.deepEqual(created.map((fields) => fields.sort_order), [3, 4]);
  await assert.rejects(createTopics(MEETING_ID, ["  ", ""], "member_ttm"), (error) => error.code === "INVALID_TOPIC_TEXT");
  await assert.rejects(createTopics(MEETING_ID, Array.from({ length: 51 }, (_, index) => `话题${index}`), "member_ttm"), (error) => error.code === "TOO_MANY_TOPICS");
  await assert.rejects(createTopics(MEETING_ID, ["x".repeat(501)], "member_ttm"), (error) => error.code === "INVALID_TOPIC_TEXT");
});

test("deleteTopic resolves the public key back to a record id, 404s when unknown", { concurrency: false }, async () => {
  seedEnv();
  const records = [{ record_id: "rec_a", fields: { meeting_id: MEETING_ID, topic_text: "第一题", sort_order: 1, created_by: "admin", created_at: "2026-01-01T00:00:00.000Z" } }];
  let deletedIds;
  global.fetch = async (url, options = {}) => {
    if (String(url).includes("/auth/v3/tenant_access_token/internal")) return jsonResponse({ code: 0, tenant_access_token: "tenant", expire: 7200 });
    if (String(url).includes(`/tables/${TABLE_ID}/records/search`)) return jsonResponse(searchResponse(records));
    if (String(url).includes(`/tables/${TABLE_ID}/records/batch_delete`)) {
      deletedIds = JSON.parse(options.body).record_id_list;
      return jsonResponse({ code: 0 });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
  await assert.rejects(deleteTopic(MEETING_ID, "not-a-real-key"), (error) => error.code === "TOPIC_NOT_FOUND");
  const deleted = await deleteTopic(MEETING_ID, publicKey("rec_a"));
  assert.deepEqual(deletedIds, ["rec_a"]);
  assert.equal(deleted.topicText, "第一题");
});

test("updateTopic trims text and updates only the selected topic text", { concurrency: false }, async () => {
  seedEnv();
  const records = [{ record_id: "rec_a", fields: { meeting_id: MEETING_ID, topic_text: "第一题", sort_order: 1, created_by: "admin", created_at: "2026-01-01T00:00:00.000Z" } }];
  let sentFields;
  global.fetch = async (url, options = {}) => {
    if (String(url).includes("/auth/v3/tenant_access_token/internal")) return jsonResponse({ code: 0, tenant_access_token: "tenant", expire: 7200 });
    if (String(url).includes(`/tables/${TABLE_ID}/records/search`)) return jsonResponse(searchResponse(records));
    if (String(url).includes(`/tables/${TABLE_ID}/records/rec_a`) && options.method === "PATCH") {
      sentFields = JSON.parse(options.body);
      return jsonResponse({ code: 0, data: { record_id: "rec_a", fields: ["topic_text"], data: [[sentFields.topic_text]] } });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  const updated = await updateTopic(MEETING_ID, publicKey("rec_a"), "  更新后的话题  ");

  assert.equal(updated.topicText, "更新后的话题");
  assert.equal(updated.sortOrder, 1);
  assert.deepEqual(sentFields, { topic_text: "更新后的话题" });
});

test("updateTopic rejects invalid or out-of-meeting keys without writing", { concurrency: false }, async () => {
  seedEnv();
  const records = [
    { record_id: "rec_a", fields: { meeting_id: MEETING_ID, topic_text: "第一题", sort_order: 1, created_by: "admin", created_at: "2026-01-01T00:00:00.000Z" } },
    { record_id: "rec_other_meeting", fields: { meeting_id: "meeting_2", topic_text: "别期话题", sort_order: 1, created_by: "admin", created_at: "2026-01-01T00:00:00.000Z" } },
  ];
  let writes = 0;
  global.fetch = async (url, options = {}) => {
    if (String(url).includes("/auth/v3/tenant_access_token/internal")) return jsonResponse({ code: 0, tenant_access_token: "tenant", expire: 7200 });
    if (String(url).includes(`/tables/${TABLE_ID}/records/search`)) {
      const meetingId = JSON.parse(options.body).filter.conditions[0].value[0];
      return jsonResponse(searchResponse(records.filter((record) => record.fields.meeting_id === meetingId)));
    }
    if (options.method === "PATCH") writes += 1;
    throw new Error(`Unexpected fetch: ${url}`);
  };

  await assert.rejects(updateTopic(MEETING_ID, publicKey("rec_a"), "  "), (error) => error.code === "INVALID_TOPIC_TEXT");
  await assert.rejects(updateTopic(MEETING_ID, publicKey("rec_a"), "x".repeat(501)), (error) => error.code === "INVALID_TOPIC_TEXT");
  await assert.rejects(updateTopic(MEETING_ID, publicKey("rec_other_meeting"), "更新"), (error) => error.code === "TOPIC_NOT_FOUND");

  assert.equal(writes, 0);
});

test("drawTopic excludes already-drawn keys and reports NO_TOPICS_LEFT once exhausted", { concurrency: false }, async () => {
  seedEnv();
  const records = [
    { record_id: "rec_a", fields: { meeting_id: MEETING_ID, topic_text: "第一题", sort_order: 1, created_by: "admin", created_at: "2026-01-01T00:00:00.000Z" } },
    { record_id: "rec_b", fields: { meeting_id: MEETING_ID, topic_text: "第二题", sort_order: 2, created_by: "admin", created_at: "2026-01-01T00:00:00.000Z" } },
  ];
  mockTenantAndSearch(records);
  const first = await drawTopic(MEETING_ID, []);
  assert.equal(first.remaining, 1);
  const second = await drawTopic(MEETING_ID, [first.key]);
  assert.equal(second.remaining, 0);
  assert.notEqual(second.key, first.key);
  await assert.rejects(drawTopic(MEETING_ID, [first.key, second.key]), (error) => error.code === "NO_TOPICS_LEFT");
});

test("topicsRemainingCount never returns topic text", { concurrency: false }, async () => {
  seedEnv();
  mockTenantAndSearch([
    { record_id: "rec_a", fields: { meeting_id: MEETING_ID, topic_text: "第一题", sort_order: 1, created_by: "admin", created_at: "2026-01-01T00:00:00.000Z" } },
  ]);
  assert.equal(await topicsRemainingCount(MEETING_ID), 1);
});

test("missing table configuration fails loudly instead of silently skipping", { concurrency: false }, async () => {
  seedEnv();
  delete process.env.BITABLE_TABLE_TOPICS_TABLE_ID;
  await assert.rejects(listTopics(MEETING_ID), (error) => error.code === "TABLE_TOPICS_NOT_CONFIGURED");
});

import crypto from "node:crypto";

import { ApiError, batchCreateRecords, batchDeleteRecords, fieldEquals, getBitableConfig, listRecords, updateRecord } from "./bitable.js";
import { asText } from "./meeting-schema.js";

const TOPIC_TEXT_MAX = 500;
const TOPIC_BATCH_MAX = 50;

function tableId() {
  const value = getBitableConfig().tableTopicsTableId;
  if (!value) throw new ApiError(503, "TABLE_TOPICS_NOT_CONFIGURED", "BITABLE_TABLE_TOPICS_TABLE_ID is not configured.");
  return value;
}

// 与 presentation-repository.js 的 publicKey 同一套脱敏模式：对外只暴露记录 id 的哈希，正文不随公开投影外泄。
function publicKey(recordId) {
  return crypto.createHash("sha256").update(String(recordId || "")).digest("hex").slice(0, 16);
}

function topicFromRecord(record) {
  return {
    key: publicKey(record.record_id),
    recordId: record.record_id,
    topicText: asText(record.fields.topic_text),
    sortOrder: Number(record.fields.sort_order || 0),
    createdBy: asText(record.fields.created_by),
    createdAt: asText(record.fields.created_at),
  };
}

export async function listTopics(meetingId) {
  const records = await listRecords(tableId(), { filter: fieldEquals("meeting_id", meetingId) });
  return records.map(topicFromRecord).sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt));
}

export async function createTopics(meetingId, topicTexts, createdBy) {
  const texts = (Array.isArray(topicTexts) ? topicTexts : [topicTexts]).map((value) => String(value || "").trim()).filter(Boolean);
  if (!texts.length) throw new ApiError(400, "INVALID_TOPIC_TEXT", "话题内容不能为空。");
  if (texts.length > TOPIC_BATCH_MAX) throw new ApiError(400, "TOO_MANY_TOPICS", `一次最多录入 ${TOPIC_BATCH_MAX} 条话题。`);
  if (texts.some((text) => text.length > TOPIC_TEXT_MAX)) throw new ApiError(400, "INVALID_TOPIC_TEXT", `话题内容不能超过 ${TOPIC_TEXT_MAX} 个字符。`);
  const existing = await listTopics(meetingId);
  const firstSortOrder = existing.length ? Math.max(...existing.map((topic) => topic.sortOrder)) + 1 : 1;
  const createdAt = new Date().toISOString();
  const records = await batchCreateRecords(tableId(), texts.map((text, index) => ({
    meeting_id: meetingId,
    topic_text: text,
    sort_order: firstSortOrder + index,
    created_by: String(createdBy || ""),
    created_at: createdAt,
  })), () => ({ entity: "table-topics", meetingId }));
  return records.map(topicFromRecord);
}

export async function createTopic(meetingId, topicText, createdBy) {
  const [topic] = await createTopics(meetingId, [topicText], createdBy);
  return topic;
}

export async function deleteTopic(meetingId, key) {
  const topics = await listTopics(meetingId);
  const target = topics.find((topic) => topic.key === key);
  if (!target) throw new ApiError(404, "TOPIC_NOT_FOUND", "话题不存在或已被删除。");
  await batchDeleteRecords(tableId(), [target.recordId], { entity: "table-topics", meetingId });
  return target;
}

export async function updateTopic(meetingId, key, topicText) {
  const text = String(topicText || "").trim();
  if (!text) throw new ApiError(400, "INVALID_TOPIC_TEXT", "话题内容不能为空。");
  if (text.length > TOPIC_TEXT_MAX) throw new ApiError(400, "INVALID_TOPIC_TEXT", `话题内容不能超过 ${TOPIC_TEXT_MAX} 个字符。`);
  const topics = await listTopics(meetingId);
  const target = topics.find((topic) => topic.key === key);
  if (!target) throw new ApiError(404, "TOPIC_NOT_FOUND", "话题不存在或已被删除。");
  await updateRecord(tableId(), target.recordId, { topic_text: text }, { entity: "table-topics", meetingId });
  return { ...target, topicText: text };
}

export async function topicsRemainingCount(meetingId) {
  return (await listTopics(meetingId)).length;
}

export async function drawTopic(meetingId, excludeKeys = []) {
  const excluded = new Set(excludeKeys);
  const pool = (await listTopics(meetingId)).filter((topic) => !excluded.has(topic.key));
  if (!pool.length) throw new ApiError(409, "NO_TOPICS_LEFT", "话题已抽完。");
  const picked = pool[crypto.randomInt(pool.length)];
  return { key: picked.key, topicText: picked.topicText, remaining: pool.length - 1 };
}

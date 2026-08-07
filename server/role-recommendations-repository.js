import crypto from "node:crypto";

import { ApiError, batchDeleteRecords, fieldEquals, getBitableConfig, listRecords, createRecord, updateRecord } from "./bitable.js";
import { bookingAssignments } from "./booking-repository.js";
import { getMeeting, getMembers, listDetailedMeetings } from "./meetings-repository.js";
import { getRoleCatalog } from "./roles-repository.js";
import { asText } from "./meeting-schema.js";
import { buildRoleRecommendations, canTransitionOutreach, hasOtherMeetingOutreach, normalizeRecommendationRecords } from "../role-recommendations.js";

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const OUTREACH_STATUS = new Set(["dismissed", "copied", "contacted", "accepted", "declined", "no_response", "booked", "cancelled", "closed"]);
const EXCLUSION_SCOPES = new Set(["meeting", "selected_meetings", "standing"]);
const EXCLUSION_REASONS = new Set(["确定无法参加", "暂不邀约", "已离职但仍是会员", "其他"]);

function requiredTables() {
  const config = getBitableConfig();
  const missing = ["memberDevelopmentProfilesTableId", "recommendationExclusionsTableId", "roleOutreachTableId"].filter((key) => !config[key]);
  if (missing.length) throw new ApiError(503, "RECOMMENDATIONS_NOT_CONFIGURED", "角色推荐数据表尚未配置。", { missing });
  return config;
}

function recordFields(records) {
  return records.map((record) => ({ recordId: record.record_id, ...record.fields }));
}

function clean(value, max = 160) {
  const result = String(value || "").trim();
  if (!result || result.length > max || /[\u0000-\u001f\u007f]/u.test(result)) return "";
  return result;
}

function baseDateTime(now = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(now);
}

async function findOutreach(tableId, key) {
  const records = await listRecords(tableId, { filter: fieldEquals("outreach_key", key) });
  return records[0] || null;
}

function outreachKey(meetingId, assignmentId, memberId) {
  return `${meetingId}:${assignmentId}:${memberId}`;
}

function safeReasonSnapshot(value) {
  const reasons = Array.isArray(value?.reasons) ? value.reasons.map((item) => clean(item, 140)).filter(Boolean).slice(0, 2) : [];
  const risk = clean(value?.risk, 180);
  return { reasons, ...(risk ? { risk } : {}) };
}

export async function getRoleRecommendations(meetingId, now = new Date()) {
  const config = requiredTables();
  const profilePromise = listRecords(config.memberDevelopmentProfilesTableId).then(recordFields);
  const outreachPromise = listRecords(config.roleOutreachTableId).then(recordFields);
  const [meeting, meetings, members, catalog, exclusionRecords, profileResult, outreachResult] = await Promise.all([
    getMeeting(meetingId),
    listDetailedMeetings(),
    getMembers(),
    getRoleCatalog(),
    listRecords(config.recommendationExclusionsTableId).then(recordFields),
    profilePromise.then((value) => ({ value })).catch(() => ({ error: true, value: [] })),
    outreachPromise.then((value) => ({ value })).catch(() => ({ error: true, value: [] })),
  ]);
  const normalized = normalizeRecommendationRecords({ profiles: profileResult.value, exclusions: exclusionRecords, outreach: outreachResult.value });
  const result = buildRoleRecommendations({
    meeting,
    meetings,
    members,
    catalog,
    ...normalized,
    now,
    assignmentsForMeeting: (value) => bookingAssignments(value, catalog, { includeRecommendationRoles: true }),
  });
  const dismissed = normalized.outreach.filter((item) => item.meetingId === meetingId && item.status === "dismissed").map((item) => ({
    assignmentId: item.assignmentId,
    memberId: item.memberId,
    displayName: members.find((member) => member.id === item.memberId)?.displayName || item.memberId,
    role: result.roles.find((role) => role.assignmentId === item.assignmentId)?.role || "当前角色",
    reason: "当前空缺不考虑",
  }));
  return {
    ...result,
    dismissed,
    developmentDataAvailable: !profileResult.error,
    outreachWritable: !outreachResult.error,
    meeting: { id: meeting.id, meetingNumber: meeting.meetingNumber, date: meeting.date, startTime: meeting.startTime, theme: meeting.theme, status: meeting.status, revision: meeting.revision },
  };
}

export async function updateRecommendationExclusion(meetingId, input, now = new Date()) {
  const { recommendationExclusionsTableId } = requiredTables();
  const memberId = clean(input?.memberId);
  const scope = clean(input?.scope);
  const reason = clean(input?.reason);
  const note = String(input?.note || "").trim().slice(0, 500);
  if (!memberId || !EXCLUSION_SCOPES.has(scope) || !EXCLUSION_REASONS.has(reason)) {
    throw new ApiError(400, "INVALID_RECOMMENDATION_EXCLUSION", "请选择有效会员、范围和原因。");
  }
  const requestedMeetings = Array.isArray(input?.meetingIds) ? input.meetingIds.map((item) => clean(item)).filter(Boolean) : [];
  const meetingIds = scope === "standing" ? [] : scope === "meeting" ? [meetingId] : [...new Set(requestedMeetings)];
  if (scope === "selected_meetings" && !meetingIds.length) throw new ApiError(400, "INVALID_RECOMMENDATION_EXCLUSION", "请至少选择一场会议。");
  const timestamp = baseDateTime(now);
  const exclusionId = crypto.randomUUID();
  await createRecord(recommendationExclusionsTableId, {
    exclusion_id: exclusionId,
    member_id: memberId,
    scope,
    meeting_ids_json: JSON.stringify(meetingIds),
    reason,
    note,
    active: true,
    created_at: timestamp,
    updated_at: timestamp,
  }, { entity: "recommendation-exclusion", exclusionId });
  const stored = (await listRecords(recommendationExclusionsTableId, { filter: fieldEquals("exclusion_id", exclusionId) }))[0];
  if (!stored || asText(stored.fields.member_id) !== memberId) throw new ApiError(502, "WRITE_VERIFICATION_FAILED", "排期排除写入后未能验证。");
  return { exclusionId };
}

export async function restoreRecommendationExclusion(exclusionId) {
  const { recommendationExclusionsTableId } = requiredTables();
  const id = clean(exclusionId);
  const records = await listRecords(recommendationExclusionsTableId, { filter: fieldEquals("exclusion_id", id) });
  if (records.length !== 1) throw new ApiError(404, "EXCLUSION_NOT_FOUND", "未找到要恢复的排期排除。");
  await batchDeleteRecords(recommendationExclusionsTableId, [records[0].record_id], { entity: "recommendation-exclusion", exclusionId: id });
  return { restored: true };
}

export async function restoreDismissedCandidate(meetingId, assignmentId, memberId) {
  const { roleOutreachTableId } = requiredTables();
  const key = outreachKey(meetingId, clean(assignmentId), clean(memberId));
  const record = await findOutreach(roleOutreachTableId, key);
  if (!record || asText(record.fields.status) !== "dismissed") throw new ApiError(404, "DISMISSAL_NOT_FOUND", "未找到要恢复的忽略记录。");
  await batchDeleteRecords(roleOutreachTableId, [record.record_id], { entity: "role-outreach", outreachKey: key });
  return { restored: true };
}

export async function updateRoleOutreach(meetingId, input, now = new Date()) {
  const { roleOutreachTableId } = requiredTables();
  const assignmentId = clean(input?.assignmentId);
  const memberId = clean(input?.memberId);
  const status = clean(input?.status);
  if (!assignmentId || !memberId || !OUTREACH_STATUS.has(status)) throw new ApiError(400, "INVALID_ROLE_OUTREACH", "沟通状态请求无效。");
  const key = outreachKey(meetingId, assignmentId, memberId);
  if (status === "copied") {
    const meetingOutreach = normalizeRecommendationRecords({ outreach: recordFields(await listRecords(roleOutreachTableId, { filter: fieldEquals("meeting_id", meetingId) })) }).outreach;
    if (hasOtherMeetingOutreach(meetingOutreach, { meetingId, assignmentId, memberId })) {
      throw new ApiError(409, "MEMBER_ALREADY_CONTACTED", "该候选人本期已有其他角色邀约，请刷新候选列表。");
    }
  }
  const current = await findOutreach(roleOutreachTableId, key);
  const from = asText(current?.fields?.status) || "suggested";
  if (status === "copied" && from !== "suggested") return { key, status: from, unchanged: true };
  if (!canTransitionOutreach(from, status)) throw new ApiError(409, "INVALID_OUTREACH_TRANSITION", `不能从 ${from} 更新为 ${status}。`);
  const timestamp = baseDateTime(now);
  const fields = {
    outreach_key: key,
    meeting_id: meetingId,
    assignment_id: assignmentId,
    member_id: memberId,
    status,
    updated_at: timestamp,
  };
  const snapshot = safeReasonSnapshot(input?.safeReasonSnapshot);
  if (snapshot.reasons.length || snapshot.risk || !current) fields.safe_reason_snapshot_json = JSON.stringify(snapshot);
  if (!current) fields.created_at = timestamp;
  if (status === "dismissed") fields.dismissed_at = timestamp;
  if (status === "copied") fields.copied_at = timestamp;
  if (status === "contacted") fields.contacted_at = timestamp;
  if (["accepted", "declined", "no_response"].includes(status)) fields.replied_at = timestamp;
  if (status === "booked") fields.booked_at = timestamp;
  if (["cancelled", "closed"].includes(status)) fields.closed_at = timestamp;
  if (current) await updateRecord(roleOutreachTableId, current.record_id, fields, { entity: "role-outreach", outreachKey: key });
  else await createRecord(roleOutreachTableId, fields, { entity: "role-outreach", outreachKey: key });
  const stored = await findOutreach(roleOutreachTableId, key);
  const storedStatus = asText(stored?.fields?.status);
  if (storedStatus !== status) throw new ApiError(502, "WRITE_VERIFICATION_FAILED", "沟通状态写入后未能验证。");
  return { key, status: storedStatus, updatedAt: asText(stored.fields.updated_at) };
}

export async function markRoleOutreachBooked(meetingId, input, now = new Date()) {
  const assignmentId = clean(input?.assignmentId);
  const memberId = clean(input?.memberId);
  const [meeting, catalog] = await Promise.all([getMeeting(meetingId), getRoleCatalog()]);
  const assignment = bookingAssignments(meeting, catalog, { includeRecommendationRoles: true }).find((item) => item.id === assignmentId);
  if (!assignment || assignment.memberId !== memberId || assignment.status !== "confirmed") {
    throw new ApiError(409, "AGENDA_ASSIGNMENT_NOT_VERIFIED", "Agenda 尚未确认该会员的角色分配。");
  }
  const result = await updateRoleOutreach(meetingId, { assignmentId, memberId, status: "booked" }, now);
  const { roleOutreachTableId } = requiredTables();
  const records = await listRecords(roleOutreachTableId, { filter: fieldEquals("meeting_id", meetingId) });
  const closable = records.filter((record) => asText(record.fields.assignment_id) === assignmentId
    && asText(record.fields.member_id) !== memberId
    && ["copied", "contacted", "no_response", "declined", "cancelled"].includes(asText(record.fields.status)));
  for (const record of closable) {
    await updateRoleOutreach(meetingId, {
      assignmentId,
      memberId: asText(record.fields.member_id),
      status: "closed",
    }, now);
  }
  return result;
}

export async function polishOutreachDraft(input, { apiKey = process.env.DEEPSEEK_API_KEY, fetchImpl = fetch, timeoutMs = 20_000 } = {}) {
  if (!apiKey) throw new ApiError(503, "DEEPSEEK_NOT_CONFIGURED", "DeepSeek 尚未配置。");
  const draft = String(input?.draft || "").trim();
  const tone = ["自然", "更简短", "更鼓励"].includes(input?.tone) ? input.tone : "自然";
  if (!draft || draft.length > 1500) throw new ApiError(400, "INVALID_OUTREACH_DRAFT", "邀请草稿长度无效。");
  if (String(input?.memberName || "") && draft.includes(String(input.memberName))) throw new ApiError(400, "PRIVATE_NAME_IN_MODEL_INPUT", "发送给 DeepSeek 的草稿不能包含会员姓名。");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(DEEPSEEK_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          { role: "system", content: "Polish this private club role invitation. Keep every fact and placeholder unchanged. Do not add promises, scores, sources, or personal data. Return only the revised draft." },
          { role: "user", content: `Tone: ${tone}\nDraft:\n${draft}` },
        ],
        temperature: 0.3,
      }),
    });
    const body = await response.json().catch(() => ({}));
    const text = String(body?.choices?.[0]?.message?.content || "").trim();
    if (!response.ok || !text || text.length > 1800 || (draft.includes("{{NAME}}") && !text.includes("{{NAME}}"))) {
      throw new ApiError(502, "DEEPSEEK_INVALID_RESPONSE", "DeepSeek 润色失败，标准稿仍可使用。");
    }
    return { draft: text };
  } catch (error) {
    if (error?.name === "AbortError") throw new ApiError(504, "DEEPSEEK_TIMEOUT", "DeepSeek 润色超时，标准稿仍可使用。");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

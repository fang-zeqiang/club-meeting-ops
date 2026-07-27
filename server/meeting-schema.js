import { ApiError } from "./bitable.js";

const BLOCK_TYPES = new Set(["opening", "table_topics", "prepared_speeches", "evaluation", "break", "closing", "custom"]);
const ITEM_KINDS = new Set(["role", "speech", "break"]);
const MEETING_STATUSES = new Set(["draft", "final", "archived"]);
const REVIEW_STATUSES = new Set(["pending", "completed", "skipped"]);

export function normalizeBlockType(value) {
  const normalized = asText(value);
  return BLOCK_TYPES.has(normalized) ? normalized : "custom";
}

export function normalizeItemKind(value) {
  const normalized = asText(value);
  return ITEM_KINDS.has(normalized) ? normalized : "role";
}

function requiredText(value, label) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new ApiError(400, "INVALID_MEETING", `${label} is required.`);
  return normalized;
}

function externalPresentationUrl(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  if (normalized.length > 2048) throw new ApiError(400, "INVALID_MEETING", "External presentation URL is too long.");
  try {
    const url = new URL(normalized);
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password) throw new Error();
    return url.href;
  } catch {
    throw new ApiError(400, "INVALID_MEETING", "External presentation URL must be a valid HTTPS URL.");
  }
}

export function normalizeItemStatus(value) {
  const normalized = asText(value).trim().toLocaleLowerCase();
  if (normalized === "pending") return "pending";
  if (normalized === "confirmed" || normalized.startsWith("confirm")) return "confirmed";
  return "vacant";
}

export function normalizeMeeting(input) {
  if (!input || typeof input !== "object") throw new ApiError(400, "INVALID_MEETING", "Meeting payload is required.");
  const blocks = Array.isArray(input.blocks) ? input.blocks : [];
  if (!blocks.length) throw new ApiError(400, "INVALID_MEETING", "A meeting needs at least one block.");

  const status = MEETING_STATUSES.has(input.status) ? input.status : "draft";
  const meeting = {
    id: requiredText(input.id, "Meeting ID"),
    meetingNumber: Number(input.meetingNumber),
    date: status === "draft" ? String(input.date || "").trim() : requiredText(input.date, "Meeting date"),
    startTime: requiredText(input.startTime, "Start time"),
    theme: status === "draft" ? String(input.theme || "").trim() : requiredText(input.theme, "Theme"),
    meetingType: String(input.meetingType || "regular_meeting"),
    status,
    venue: String(input.venue || "").trim(),
    votingCode: String(input.votingCode || "").trim(),
    qrSource: input.qrSource === "manual" ? "manual" : "system",
    tableTopicsSpeakers: [...new Set((Array.isArray(input.tableTopicsSpeakers) ? input.tableTopicsSpeakers : [])
      .map((name) => String(name || "").trim()).filter(Boolean))],
    votingForm: input.votingForm && typeof input.votingForm === "object" ? input.votingForm : null,
    review: input.review && typeof input.review === "object" ? input.review : null,
    reviewStatus: REVIEW_STATUSES.has(input.reviewStatus) ? input.reviewStatus : "pending",
    qualityScore: input.qualityScore == null || input.qualityScore === "" || !Number.isFinite(Number(input.qualityScore)) ? null : Number(input.qualityScore),
    qualityMetrics: input.qualityMetrics && typeof input.qualityMetrics === "object" ? input.qualityMetrics : null,
    reviewCompletedAt: String(input.reviewCompletedAt || "").trim(),
    enableTransitionTime: Boolean(input.enableTransitionTime),
    photographerMemberId: String(input.photographerMemberId || "").trim(),
    photographer: String(input.photographer || "").trim(),
    meetingManagerMemberId: String(input.meetingManagerMemberId || "").trim(),
    meetingManager: String(input.meetingManager || "").trim(),
    wordOfDay: {
      word: String(input.wordOfDay?.word || "").trim(),
      pronunciation: String(input.wordOfDay?.pronunciation || "").trim(),
      example: String(input.wordOfDay?.example || "").trim(),
    },
    revision: Number(input.revision || 0),
    blocks: blocks.map((block, blockIndex) => ({
      id: requiredText(block.id, "Block ID"),
      type: normalizeBlockType(block.type),
      title: requiredText(block.title, "Block title"),
      notes: String(block.notes || ""),
      orderIndex: blockIndex,
      items: (Array.isArray(block.items) ? block.items : []).map((item, itemIndex) => {
        const duration = Number(item.duration);
        if (!Number.isFinite(duration) || duration <= 0) throw new ApiError(400, "INVALID_MEETING", "Item duration must be greater than zero.");
        const kind = normalizeItemKind(item.kind);
        return {
          id: requiredText(item.id, "Item ID"),
          kind,
          session: status === "draft" && kind !== "break"
            ? String(item.session || "").trim()
            : requiredText(item.session, "Session title"),
          role: kind === "break" ? "" : requiredText(item.role, "Role title"),
          duration,
          memberId: String(item.memberId || ""),
          member: String(item.member || ""),
          evaluatorId: String(item.evaluatorId || ""),
          evaluator: String(item.evaluator || ""),
          evaluatorStatus: kind === "speech" ? normalizeItemStatus(item.evaluatorStatus) : "",
          roleAssignmentId: String(item.roleAssignmentId || "").trim(),
          linkedSpeechId: String(item.linkedSpeechId || "").trim(),
          pathwaysMode: ["pathways", "custom"].includes(item.pathwaysMode) ? item.pathwaysMode : "",
          pathwaysPath: String(item.pathwaysPath || "").trim(),
          pathwaysLevel: String(item.pathwaysLevel || "").trim(),
          pathwaysProjectId: String(item.pathwaysProjectId || "").trim(),
          pathwaysFormId: String(item.pathwaysFormId || "").trim(),
          speechObjective: String(item.speechObjective || ""),
          externalPresentationUrl: kind === "break" ? "" : externalPresentationUrl(item.externalPresentationUrl),
          status: kind === "break" ? "" : normalizeItemStatus(item.status),
          orderIndex: itemIndex,
        };
      }),
    })),
  };
  if (!Number.isInteger(meeting.meetingNumber) || meeting.meetingNumber <= 0) {
    throw new ApiError(400, "INVALID_MEETING", "Meeting number must be a positive integer.");
  }
  if ((meeting.date && !/^\d{4}-\d{2}-\d{2}$/.test(meeting.date)) || !/^\d{2}:\d{2}$/.test(meeting.startTime)) {
    throw new ApiError(400, "INVALID_MEETING", "Meeting date or start time is invalid.");
  }
  return meeting;
}

export function asText(value) {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map((part) => (typeof part === "object" ? part.text || part.name || "" : part)).join("");
  if (value.text != null) return asText(value.text);
  if (value.value) return asText(value.value);
  return "";
}

export function linkedIds(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((part) => (typeof part === "string" ? part : part.record_id || part.id)).filter(Boolean);
  return (value.link_record_ids || value.record_ids || []).filter(Boolean);
}

export function startsAtTimestamp(date, time) {
  if (!date) return "";
  return Date.parse(`${date}T${time}:00+08:00`);
}

export function splitStartsAt(value) {
  const raw = asText(value);
  if (!raw) return { date: "", startTime: "18:40" };
  const timestamp = /^\d+$/.test(raw)
    ? Number(raw)
    : Date.parse(`${raw.replace(" ", "T").slice(0, 19)}+08:00`);
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) throw new ApiError(502, "INVALID_BITABLE_DATE", "Meeting start time returned by Base is invalid.");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, startTime: `${get("hour")}:${get("minute")}` };
}

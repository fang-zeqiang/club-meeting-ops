import crypto from "node:crypto";
import { ApiError, createRecord, fieldEquals, getBitableConfig, listRecords, updateRecord } from "./bitable.js";
import { asText } from "./meeting-schema.js";
import { upgradeAgenda } from "../agenda-upgrade.js";

function requiredText(value, label) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new ApiError(400, "INVALID_TEMPLATE", `${label} is required.`);
  if (normalized.length > 120) throw new ApiError(400, "INVALID_TEMPLATE", `${label} must be 120 characters or fewer.`);
  return normalized;
}

function normalizeTemplateBlock(block) {
  return {
    type: String(block.type || "custom"),
    title: requiredText(block.title, "Block title"),
    notes: String(block.notes || ""),
    items: (Array.isArray(block.items) ? block.items : []).map((item) => ({
      ...(item.id || item.templateItemId ? { templateItemId: String(item.templateItemId || item.id) } : {}),
      kind: String(item.kind || "role"),
      session: requiredText(item.session, "Session title"),
      role: item.kind === "break" ? "" : requiredText(item.role, "Role title"),
      duration: normalizeDuration(item.duration),
      ...(item.kind === "speech" ? {
        evaluatorStatus: String(item.evaluatorStatus || "vacant"),
        pathwaysMode: ["pathways", "custom"].includes(item.pathwaysMode) ? item.pathwaysMode : "",
        pathwaysPath: String(item.pathwaysPath || ""),
        pathwaysLevel: String(item.pathwaysLevel || ""),
        pathwaysProjectId: String(item.pathwaysProjectId || ""),
        pathwaysFormId: String(item.pathwaysFormId || ""),
      } : {}),
      ...(item.roleAssignmentId ? { roleAssignmentId: String(item.roleAssignmentId) } : {}),
      ...(item.linkedSpeechId ? { linkedSpeechId: String(item.linkedSpeechId) } : {}),
      speechObjective: String(item.speechObjective || ""),
      status: item.kind === "break" ? "" : String(item.status || "vacant"),
    })),
  };
}

function normalizeDuration(value) {
  const duration = Number(value);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new ApiError(400, "INVALID_TEMPLATE", "Template item duration must be greater than zero.");
  }
  return duration;
}

export function templateFromMeeting(meeting, name) {
  const blocks = Array.isArray(meeting?.blocks) ? meeting.blocks : [];
  if (!blocks.length) throw new ApiError(400, "INVALID_TEMPLATE", "A template needs at least one block.");
  const normalizedName = requiredText(name, "Template name");
  return {
    id: `template_${crypto.randomUUID()}`,
    name: normalizedName,
    meetingType: String(meeting.meetingType || "regular_meeting"),
    sourceMeetingId: requiredText(meeting.id, "Source meeting ID"),
    createdAt: new Date().toISOString(),
    blocks: blocks.map(normalizeTemplateBlock),
  };
}

function parseTemplateStructure(value) {
  try {
    const parsed = JSON.parse(String(value || "{}"));
    const blocks = Array.isArray(parsed.blocks) ? parsed.blocks : [];
    if (!blocks.length) throw new Error("missing blocks");
    return { blocks: blocks.map(normalizeTemplateBlock) };
  } catch {
    throw new ApiError(502, "INVALID_TEMPLATE", "Template structure stored in Base is invalid.");
  }
}

function assembleTemplate(record) {
  const structure = parseTemplateStructure(asText(record.fields.structure_json));
  const template = {
    id: asText(record.fields.template_id),
    name: asText(record.fields.name),
    meetingType: asText(record.fields.meeting_type) || "regular_meeting",
    sourceMeetingId: asText(record.fields.source_meeting_id),
    createdAt: asText(record.fields.created_at),
    blocks: structure.blocks,
  };
  return { ...template, blocks: upgradeAgenda({ id: template.id, status: "draft", blocks: template.blocks }).blocks };
}

export async function listTemplates() {
  const { templatesTableId } = getBitableConfig();
  return (await listRecords(templatesTableId))
    .map(assembleTemplate)
    .sort((a, b) => `${b.createdAt}`.localeCompare(`${a.createdAt}`));
}

export async function getTemplate(templateId) {
  const templates = await listTemplates();
  const template = templates.find((candidate) => candidate.id === templateId);
  if (!template) throw new ApiError(404, "TEMPLATE_NOT_FOUND", "Template not found.");
  return template;
}

export async function createTemplateFromMeeting(meeting, name) {
  const { templatesTableId } = getBitableConfig();
  const template = templateFromMeeting(meeting, name);
  await createRecord(templatesTableId, {
    template_id: template.id,
    name: template.name,
    meeting_type: template.meetingType,
    source_meeting_id: template.sourceMeetingId,
    created_at: template.createdAt,
    structure_json: JSON.stringify({ blocks: template.blocks }),
  });
  return template;
}

export async function renameTemplate(templateId, name) {
  const { templatesTableId } = getBitableConfig();
  const record = (await listRecords(templatesTableId, { filter: fieldEquals("template_id", templateId) }))[0];
  if (!record) throw new ApiError(404, "TEMPLATE_NOT_FOUND", "Template not found.");
  const normalizedName = requiredText(name, "Template name");
  await updateRecord(templatesTableId, record.record_id, { name: normalizedName });
  return { ...assembleTemplate({ ...record, fields: { ...record.fields, name: normalizedName } }), name: normalizedName };
}

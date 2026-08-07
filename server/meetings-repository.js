import crypto from "node:crypto";
import {
  ApiError,
  batchCreateRecords,
  batchDeleteRecords,
  batchUpdateRecords,
  createRecord,
  createBitableField,
  fieldEquals,
  getBitableConfig,
  listBitableFields,
  listRecords,
  updateRecord,
} from "./bitable.js";
import { assignMeetingPresident, OFFICER_ROLES, normalizeOfficerAssignments } from "../officer-roles.js";
import {
  asText,
  linkedIds,
  normalizeBlockType,
  normalizeItemKind,
  normalizeItemStatus,
  normalizeMeeting,
  splitStartsAt,
  startsAtTimestamp,
} from "./meeting-schema.js";
import { imageDescriptor } from "./qr-image.js";
import { currentAuthorization, votingBaseEditUrl } from "./resource-access.js";
import { upgradeAgenda } from "../agenda-upgrade.js";
import { buildQualityMetrics, qualityScore } from "../meeting-quality.js";
import { getPathwaysCatalog, resolveSpeechDetails } from "./pathways-repository.js";

const REVIEW_FIELDS = Object.freeze({
  review: "review_json",
  status: "review_status",
  score: "quality_score",
  metrics: "quality_metrics_json",
  completedAt: "review_completed_at",
});

const meetingFields = (meeting, revision = meeting.revision) => ({
  meeting_id: meeting.id,
  meeting_number: meeting.meetingNumber,
  starts_at: startsAtTimestamp(meeting.date, meeting.startTime),
  theme: meeting.theme,
  meeting_type: meeting.meetingType,
  status: meeting.status,
  venue: meeting.venue,
  voting_code: meeting.votingCode,
  voting_qr_source: meeting.qrSource,
  table_topics_speakers_json: JSON.stringify(meeting.tableTopicsSpeakers || []),
  voting_form_json: meeting.votingForm ? JSON.stringify(meeting.votingForm) : "",
  enable_transition_time: meeting.enableTransitionTime,
  photographer_member_id: meeting.photographerMemberId,
  photographer_name: meeting.photographer,
  meeting_manager_member_id: meeting.meetingManagerMemberId,
  meeting_manager_name: meeting.meetingManager,
  wod_word: meeting.wordOfDay.word,
  wod_pronunciation: meeting.wordOfDay.pronunciation,
  wod_example: meeting.wordOfDay.example,
  revision,
});

const memberFromRecord = (record) => ({
  id: asText(record.fields.member_id),
  displayName: asText(record.fields.display_name),
  englishName: asText(record.fields.english_name),
  pathwaysLevel: asText(record.fields.pathways_level),
  pathwaysVerifiedAt: asText(record.fields.pathways_verified_at),
  officerRoles: Array.isArray(record.fields.officer_roles) ? record.fields.officer_roles : [],
  memberType: record.fields.member_type || "member",
  active: record.fields.active !== false,
  customerId: asText(record.fields.customer_id),
  email: asText(record.fields.email),
  mobilePhone: asText(record.fields.mobile_phone),
  membershipStatus: record.fields.membership_status || "",
  currentPosition: asText(record.fields.current_position),
  pathwaysEnrolled: Boolean(record.fields.pathways_enrolled),
  recordId: record.record_id,
});

function relation(recordId) {
  return recordId ? [{ id: recordId }] : [];
}

function memberRecordId(item, key, membersById, membersByName) {
  return membersById.get(item[`${key}Id`])?.recordId || membersByName.get(item[key])?.recordId || "";
}

function memberNameForField(record, idField, nameField, membersById) {
  const memberId = asText(record.fields[idField]);
  return membersById.get(memberId)?.displayName || asText(record.fields[nameField]);
}

function blockFields(block, meetingRecordId, meetingId) {
  return {
    block_id: block.id,
    meeting_id: meetingId,
    meeting: relation(meetingRecordId),
    order_index: block.orderIndex,
    block_type: block.type,
    title: block.title,
    notes: block.notes,
  };
}

function itemFields(item, blockRecordId, meetingId, blockId, membersById, membersByName) {
  return {
    item_id: item.id,
    meeting_id: meetingId,
    block_id: blockId,
    block: relation(blockRecordId),
    order_index: item.orderIndex,
    item_kind: item.kind,
    session_title: item.session,
    role_title: item.role,
    duration_min: item.duration,
    member: relation(memberRecordId(item, "member", membersById, membersByName)),
    member_name_snapshot: item.member,
    evaluator: relation(memberRecordId(item, "evaluator", membersById, membersByName)),
    evaluator_name_snapshot: item.evaluator,
    evaluator_status: item.evaluatorStatus,
    role_assignment_id: item.roleAssignmentId,
    linked_speech_id: item.linkedSpeechId,
    pathways_mode: item.pathwaysMode,
    pathways_path: item.pathwaysPath,
    pathways_level: item.pathwaysLevel,
    pathways_project_id: item.pathwaysProjectId,
    pathways_form_id: item.pathwaysFormId,
    speech_objective: item.speechObjective,
    external_presentation_url: item.externalPresentationUrl,
    status: item.status,
  };
}

const LINK_FIELDS = new Set(["meeting", "block", "member", "evaluator"]);

function fieldValuesEqual(fieldName, current, desired) {
  if (["meeting_id", "block_id"].includes(fieldName) && !asText(current)) return true;
  if (fieldName === "voting_qr_source" && !asText(current) && desired === "system") return true;
  if (fieldName === "table_topics_speakers_json" && !asText(current) && desired === "[]") return true;
  if (fieldName === "voting_form_json" && !asText(current) && !desired) return true;
  if (LINK_FIELDS.has(fieldName)) {
    const currentIds = linkedIds(current).slice().sort();
    const desiredIds = linkedIds(desired).slice().sort();
    return JSON.stringify(currentIds) === JSON.stringify(desiredIds);
  }
  if (typeof desired === "boolean") return Boolean(current) === desired;
  if (typeof desired === "number") return Number(current) === desired;
  if (Array.isArray(desired)) return JSON.stringify(current || []) === JSON.stringify(desired);
  return asText(current) === asText(desired);
}

export function recordFieldsChanged(currentFields, desiredFields) {
  return Object.entries(desiredFields).some(([fieldName, desired]) => !fieldValuesEqual(fieldName, currentFields[fieldName], desired));
}

function meetingResponse(meeting, meetingRecord, revision) {
  return {
    ...meeting,
    revision,
    votingQr: imageDescriptor(meetingRecord.fields.voting_qr_image),
    systemVotingQr: imageDescriptor(meetingRecord.fields.system_voting_qr_image),
    blocks: meeting.blocks.map(({ orderIndex, ...block }) => ({
      ...block,
      items: block.items.map(({ orderIndex: itemOrderIndex, ...item }) => item),
    })),
  };
}

function isRecordNotFound(error) {
  return error instanceof ApiError && error.code === "BITABLE_REQUEST_FAILED" && Number(error.details?.feishuCode) === 800030201;
}

function revisionConflict(currentRevision, error) {
  return new ApiError(409, "REVISION_CONFLICT", "Meeting data changed while it was being saved. Reload and try again.", {
    currentRevision,
    reason: "BITABLE_RECORD_NOT_FOUND",
    requestId: error.details?.requestId,
    entity: error.details?.entity,
    meetingId: error.details?.meetingId,
    blockId: error.details?.blockId,
    itemId: error.details?.itemId,
  });
}

async function loadStore(meetingId = "") {
  const config = getBitableConfig();
  const meetingOptions = meetingId ? { filter: fieldEquals("meeting_id", meetingId) } : {};
  const [meetings, blocks, items, memberRecords] = await Promise.all([
    listRecords(config.meetingsTableId, meetingOptions),
    meetingId ? listRecords(config.blocksTableId, { filter: fieldEquals("meeting_id", meetingId) }) : listRecords(config.blocksTableId),
    meetingId ? listRecords(config.itemsTableId, { filter: fieldEquals("meeting_id", meetingId) }) : listRecords(config.itemsTableId),
    listRecords(config.membersTableId),
  ]);
  const members = memberRecords.map(memberFromRecord);
  if (meetingId && meetings.length && !blocks.length) {
    const [legacyBlocks, legacyItems] = await Promise.all([listRecords(config.blocksTableId), listRecords(config.itemsTableId)]);
    return { config, meetings, blocks: legacyBlocks, items: legacyItems, members };
  }
  return { config, meetings, blocks, items, members };
}

function assembleMeeting(meetingRecord, store) {
  const memberByRecordId = new Map(store.members.map((member) => [member.recordId, member]));
  const membersById = new Map(store.members.map((member) => [member.id, member]));
  const resolveMember = (item, linkField, snapshotField) => {
    const linkedId = linkedIds(item.fields[linkField])[0];
    const linked = memberByRecordId.get(linkedId);
    if (linked) return linked;
    const snapshot = asText(item.fields[snapshotField]).split(",")[0].trim().toLocaleLowerCase();
    return store.members.find((member) => member.displayName.split(",")[0].trim().toLocaleLowerCase() === snapshot);
  };
  const meetingBlocks = store.blocks
    .filter((block) => linkedIds(block.fields.meeting).includes(meetingRecord.record_id))
    .sort((a, b) => Number(a.fields.order_index || 0) - Number(b.fields.order_index || 0));
  const startsAt = splitStartsAt(meetingRecord.fields.starts_at);
  const parseJson = (value, fallback) => {
    try { return JSON.parse(asText(value) || ""); } catch { return fallback; }
  };
  const storedVotingForm = parseJson(meetingRecord.fields.voting_form_json, null);
  const qualityMetrics = parseJson(meetingRecord.fields[REVIEW_FIELDS.metrics], null);
  const votingForm = storedVotingForm?.tableId ? {
    ...storedVotingForm,
    editUrl: storedVotingForm.editUrl || votingBaseEditUrl(process.env.BITABLE_VOTING_APP_TOKEN, storedVotingForm.tableId),
    authorization: currentAuthorization(storedVotingForm.authorization),
  } : storedVotingForm;

  const assembledMeeting = {
    id: asText(meetingRecord.fields.meeting_id),
    meetingNumber: Number(meetingRecord.fields.meeting_number || 0),
    ...startsAt,
    theme: asText(meetingRecord.fields.theme),
    meetingType: meetingRecord.fields.meeting_type || "regular_meeting",
    status: asText(meetingRecord.fields.status) || "draft",
    venue: asText(meetingRecord.fields.venue),
    votingCode: asText(meetingRecord.fields.voting_code),
    qrSource: asText(meetingRecord.fields.voting_qr_source) === "manual" ? "manual" : "system",
    tableTopicsSpeakers: parseJson(meetingRecord.fields.table_topics_speakers_json, []),
    votingForm,
    review: parseJson(meetingRecord.fields[REVIEW_FIELDS.review], null),
    reviewStatus: asText(meetingRecord.fields[REVIEW_FIELDS.status]) || "pending",
    qualityScore: asText(meetingRecord.fields[REVIEW_FIELDS.score]) === "" ? null : Number(meetingRecord.fields[REVIEW_FIELDS.score]),
    qualityMetrics,
    reviewCompletedAt: asText(meetingRecord.fields[REVIEW_FIELDS.completedAt]),
    enableTransitionTime: Boolean(meetingRecord.fields.enable_transition_time),
    photographerMemberId: asText(meetingRecord.fields.photographer_member_id),
    photographer: memberNameForField(meetingRecord, "photographer_member_id", "photographer_name", membersById),
    meetingManagerMemberId: asText(meetingRecord.fields.meeting_manager_member_id),
    meetingManager: memberNameForField(meetingRecord, "meeting_manager_member_id", "meeting_manager_name", membersById),
    votingQr: imageDescriptor(meetingRecord.fields.voting_qr_image),
    systemVotingQr: imageDescriptor(meetingRecord.fields.system_voting_qr_image),
    wordOfDay: {
      word: asText(meetingRecord.fields.wod_word),
      pronunciation: asText(meetingRecord.fields.wod_pronunciation),
      example: asText(meetingRecord.fields.wod_example),
    },
    revision: Number(meetingRecord.fields.revision || 0),
    blocks: meetingBlocks.map((block) => ({
      id: asText(block.fields.block_id),
      type: normalizeBlockType(block.fields.block_type),
      title: asText(block.fields.title),
      notes: asText(block.fields.notes),
      items: store.items
        .filter((item) => linkedIds(item.fields.block).includes(block.record_id))
        .sort((a, b) => Number(a.fields.order_index || 0) - Number(b.fields.order_index || 0))
        .map((item) => {
          const member = resolveMember(item, "member", "member_name_snapshot");
          const evaluator = resolveMember(item, "evaluator", "evaluator_name_snapshot");
          const kind = normalizeItemKind(item.fields.item_kind);
          return {
            id: asText(item.fields.item_id),
            kind,
            session: asText(item.fields.session_title),
            role: asText(item.fields.role_title),
            duration: Number(item.fields.duration_min || 0),
            memberId: member?.id || "",
            member: asText(item.fields.member_name_snapshot) || member?.displayName || "",
            evaluatorId: evaluator?.id || "",
            evaluator: asText(item.fields.evaluator_name_snapshot) || evaluator?.displayName || "",
            evaluatorStatus: kind === "speech" ? normalizeItemStatus(item.fields.evaluator_status) : "",
            roleAssignmentId: asText(item.fields.role_assignment_id),
            linkedSpeechId: asText(item.fields.linked_speech_id),
            pathwaysMode: asText(item.fields.pathways_mode),
            pathwaysPath: asText(item.fields.pathways_path),
            pathwaysLevel: asText(item.fields.pathways_level),
            pathwaysProjectId: asText(item.fields.pathways_project_id),
            pathwaysFormId: asText(item.fields.pathways_form_id),
            speechObjective: asText(item.fields.speech_objective),
            externalPresentationUrl: asText(item.fields.external_presentation_url),
            status: kind === "break" ? "" : normalizeItemStatus(item.fields.status),
          };
        }),
    })),
  };
  return upgradeAgenda(assembledMeeting);
}

export async function listMeetings() {
  const config = getBitableConfig();
  const meetings = await listRecords(config.meetingsTableId);
  return meetings
    .map((record) => {
      const startsAt = splitStartsAt(record.fields.starts_at);
      return {
        id: asText(record.fields.meeting_id),
        meetingNumber: Number(record.fields.meeting_number || 0),
        ...startsAt,
        theme: asText(record.fields.theme),
        status: asText(record.fields.status) || "draft",
        revision: Number(record.fields.revision || 0),
      };
    })
    .sort((a, b) => Number(b.meetingNumber || 0) - Number(a.meetingNumber || 0) || `${b.date} ${b.startTime}`.localeCompare(`${a.date} ${a.startTime}`));
}

export async function listDetailedMeetings() {
  const store = await loadStore();
  return store.meetings.map((record) => assembleMeeting(record, store));
}

export async function getMeeting(meetingId) {
  const store = await loadStore(meetingId);
  const record = store.meetings.find((candidate) => asText(candidate.fields.meeting_id) === meetingId);
  if (!record) throw new ApiError(404, "MEETING_NOT_FOUND", "Meeting not found.");
  return assembleMeeting(record, store);
}

export async function resolveMeetingId(identifier) {
  const value = asText(identifier);
  if (!/^\d+$/.test(value)) return value;
  const { meetingsTableId } = getBitableConfig();
  const matches = (await listRecords(meetingsTableId))
    .filter((record) => Number(record.fields.meeting_number) === Number(value) && asText(record.fields.status) !== "archived");
  if (matches.length !== 1) throw new ApiError(matches.length ? 409 : 404, "MEETING_NUMBER_NOT_FOUND", `Expected one active meeting #${value}, found ${matches.length}.`);
  return asText(matches[0].fields.meeting_id);
}

export async function getMembers() {
  const { membersTableId } = getBitableConfig();
  return (await listRecords(membersTableId))
    .map(memberFromRecord)
    .filter((member) => member.active)
    .sort((a, b) => a.displayName.localeCompare(b.displayName))
    .map(({ recordId, ...member }) => member);
}

export async function createGuestMember(input) {
  const displayName = String(input?.displayName || "").trim();
  const email = String(input?.email || "").trim();
  if (displayName.length < 2 || displayName.length > 80) {
    throw new ApiError(400, "INVALID_GUEST", "Guest name must contain 2 to 80 characters.");
  }
  const { membersTableId } = getBitableConfig();
  const records = await listRecords(membersTableId);
  const existing = records.map(memberFromRecord).find((member) => member.displayName.toLocaleLowerCase() === displayName.toLocaleLowerCase());
  if (existing) {
    const { recordId, ...member } = existing;
    return member;
  }
  const record = await createRecord(membersTableId, {
    member_id: `guest_${crypto.randomUUID()}`,
    display_name: displayName,
    english_name: displayName,
    pathways_level: "",
    officer_roles: [],
    member_type: "guest_placeholder",
    active: true,
    email,
    membership_status: "Guest",
    current_position: "",
    pathways_enrolled: false,
  });
  const { recordId, ...member } = memberFromRecord(record);
  return member;
}

export async function updateOfficerAssignments(input) {
  const assignments = normalizeOfficerAssignments(input);
  const { membersTableId } = getBitableConfig();
  const records = await listRecords(membersTableId);
  const members = records.map(memberFromRecord);
  const membersById = new Map(members.map((member) => [member.id, member]));

  Object.entries(assignments).forEach(([role, memberId]) => {
    if (!OFFICER_ROLES.includes(role)) {
      throw new ApiError(400, "INVALID_OFFICER_ROLE", `Unsupported officer role: ${role}.`);
    }
    if (memberId && !membersById.has(memberId)) {
      throw new ApiError(400, "MEMBER_NOT_FOUND", `Officer assignment member not found for ${role}.`);
    }
  });

  const assignedRolesByMemberId = new Map();
  Object.entries(assignments).forEach(([role, memberId]) => {
    if (!memberId) return;
    const roles = assignedRolesByMemberId.get(memberId) || [];
    roles.push(role);
    assignedRolesByMemberId.set(memberId, roles);
  });

  const updates = members
    .map((member) => {
      const preservedRoles = (Array.isArray(member.officerRoles) ? member.officerRoles : [])
        .filter((role) => !OFFICER_ROLES.includes(role));
      const nextRoles = [...preservedRoles, ...(assignedRolesByMemberId.get(member.id) || [])];
      const currentRoles = JSON.stringify((Array.isArray(member.officerRoles) ? member.officerRoles : []).slice().sort());
      const desiredRoles = JSON.stringify(nextRoles.slice().sort());
      if (currentRoles === desiredRoles) return null;
      return { record_id: member.recordId, fields: { officer_roles: nextRoles } };
    })
    .filter(Boolean);

  await batchUpdateRecords(membersTableId, updates);
  return getMembers();
}

async function resolvePathwaysItems(input, current = null) {
  const next = structuredClone(input);
  const currentItems = new Map((current?.blocks || []).flatMap((block) => block.items || []).map((item) => [item.id, item]));
  let catalog;
  for (const item of (next.blocks || []).flatMap((block) => block.items || []).filter((candidate) => candidate.kind === "speech")) {
    const previous = currentItems.get(item.id);
    const selectionUnchanged = item.pathwaysMode === "pathways"
      && previous?.pathwaysMode === "pathways"
      && ["pathwaysPath", "pathwaysProjectId", "pathwaysFormId"].every((key) => String(item[key] || "") === String(previous[key] || ""));
    if (selectionUnchanged) {
      item.pathwaysLevel = previous.pathwaysLevel;
      item.speechObjective = previous.speechObjective;
      continue;
    }
    if (!item.pathwaysMode && previous && !previous.pathwaysMode && String(item.speechObjective || "") === String(previous.speechObjective || "")) continue;
    if (!item.pathwaysMode && !previous && String(item.speechObjective || "")) continue;
    if (item.pathwaysMode === "pathways") catalog ||= await getPathwaysCatalog();
    Object.assign(item, resolveSpeechDetails(catalog || {}, item));
  }
  return next;
}

export async function createMeeting(input) {
  const meeting = normalizeMeeting(await resolvePathwaysItems(input));
  const store = await loadStore();
  assignMeetingPresident(meeting, store.members);
  if (store.meetings.some((record) => asText(record.fields.meeting_id) === meeting.id)) {
    throw new ApiError(409, "MEETING_ID_EXISTS", "A meeting with this ID already exists.");
  }
  if (store.meetings.some((record) => Number(record.fields.meeting_number) === meeting.meetingNumber && record.fields.status !== "archived")) {
    throw new ApiError(409, "MEETING_NUMBER_EXISTS", "An active meeting with this number already exists.");
  }

  const membersById = new Map(store.members.map((member) => [member.id, member]));
  const membersByName = new Map(store.members.map((member) => [member.displayName, member]));
  const parent = await createRecord(store.config.meetingsTableId, meetingFields(meeting, 1), { entity: "meeting", meetingId: meeting.id });
  const blocks = await batchCreateRecords(
    store.config.blocksTableId,
    meeting.blocks.map((block) => blockFields(block, parent.record_id, meeting.id)),
    (_, index) => ({ entity: "block", meetingId: meeting.id, blockId: meeting.blocks[index]?.id }),
  );
  const storedBlocks = await listRecords(store.config.blocksTableId, { filter: fieldEquals("meeting_id", meeting.id) });
  const blockRecordIds = new Map(meeting.blocks.map((block, index) => [
    block.id,
    blocks[index].record_id || storedBlocks.find((record) => asText(record.fields.block_id) === block.id)?.record_id,
  ]));
  await batchCreateRecords(
    store.config.itemsTableId,
    meeting.blocks.flatMap((block) => block.items.map((item) => itemFields(item, blockRecordIds.get(block.id), meeting.id, block.id, membersById, membersByName))),
    (_, index) => {
      const flatItems = meeting.blocks.flatMap((block) => block.items.map((item) => ({ blockId: block.id, itemId: item.id })));
      return { entity: "item", meetingId: meeting.id, blockId: flatItems[index]?.blockId, itemId: flatItems[index]?.itemId };
    },
  );
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const created = await getMeeting(meeting.id);
    const expectedItems = meeting.blocks.reduce((sum, block) => sum + block.items.length, 0);
    const actualItems = created.blocks.reduce((sum, block) => sum + block.items.length, 0);
    if (actualItems === expectedItems || attempt === 3) return created;
    await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
  }
  throw new ApiError(502, "MEETING_READ_AFTER_WRITE_FAILED", "Meeting was created but could not be read back completely.");
}

async function updateMeetingInternal(meetingId, input, expectedRevision, allowRecordRefresh) {
  const store = await loadStore(meetingId);
  const meetingRecord = store.meetings.find((record) => asText(record.fields.meeting_id) === meetingId);
  if (!meetingRecord) throw new ApiError(404, "MEETING_NOT_FOUND", "Meeting not found.");
  const currentRevision = Number(meetingRecord.fields.revision || 0);
  if (Number(expectedRevision) !== currentRevision) {
    throw new ApiError(409, "REVISION_CONFLICT", "This meeting was changed in another session.", { currentRevision });
  }
  const current = assembleMeeting(meetingRecord, store);
  const meeting = normalizeMeeting({ ...(await resolvePathwaysItems(input, current)), id: meetingId });
  assignMeetingPresident(meeting, store.members);

  const existingBlocks = store.blocks.filter((block) => linkedIds(block.fields.meeting).includes(meetingRecord.record_id));
  const existingBlocksById = new Map(existingBlocks.map((block) => [asText(block.fields.block_id), block]));
  const existingBlockUpdates = meeting.blocks.filter((block) => {
    const existing = existingBlocksById.get(block.id);
    return existing && recordFieldsChanged(existing.fields, blockFields(block, meetingRecord.record_id, meetingId));
  }).map((block) => ({
      blockId: block.id,
      record_id: existingBlocksById.get(block.id).record_id,
      fields: blockFields(block, meetingRecord.record_id, meetingId),
    }));
  const newBlocks = meeting.blocks.filter((block) => !existingBlocksById.has(block.id));
  const desiredBlockIds = new Set(meeting.blocks.map((block) => block.id));
  const blocksToDelete = existingBlocks.filter((block) => !desiredBlockIds.has(asText(block.fields.block_id)));
  const metadataChanged = recordFieldsChanged(meetingRecord.fields, meetingFields(meeting, currentRevision));

  try {
    await batchUpdateRecords(
      store.config.blocksTableId,
      existingBlockUpdates.map(({ record_id, fields }) => ({ record_id, fields })),
      (_, index) => ({ entity: "block", meetingId, blockId: existingBlockUpdates[index]?.blockId }),
    );
    const createdBlocks = await batchCreateRecords(
      store.config.blocksTableId,
      newBlocks.map((block) => blockFields(block, meetingRecord.record_id, meetingId)),
      (_, index) => ({ entity: "block", meetingId, blockId: newBlocks[index]?.id }),
    );
    const blockRecordIds = new Map(existingBlocks.map((record) => [asText(record.fields.block_id), record.record_id]));
    createdBlocks.forEach((record, index) => blockRecordIds.set(newBlocks[index].id, record.record_id));

    const originalBlockRecordIds = new Set(existingBlocks.map((block) => block.record_id));
    const existingItems = store.items.filter((item) => linkedIds(item.fields.block).some((id) => originalBlockRecordIds.has(id)));
    const existingItemsById = new Map(existingItems.map((item) => [asText(item.fields.item_id), item]));
    const membersById = new Map(store.members.map((member) => [member.id, member]));
    const membersByName = new Map(store.members.map((member) => [member.displayName, member]));
    const desiredItems = meeting.blocks.flatMap((block) => block.items.map((item) => ({
      item,
      blockId: block.id,
      blockRecordId: blockRecordIds.get(block.id),
    })));

    const existingItemUpdates = desiredItems
      .filter(({ item, blockId, blockRecordId }) => {
        const existing = existingItemsById.get(item.id);
        return existing && recordFieldsChanged(existing.fields, itemFields(item, blockRecordId, meetingId, blockId, membersById, membersByName));
      })
      .map(({ item, blockId, blockRecordId }) => ({
        itemId: item.id,
        blockId,
        record_id: existingItemsById.get(item.id).record_id,
        fields: itemFields(item, blockRecordId, meetingId, blockId, membersById, membersByName),
      }));
    await batchUpdateRecords(
      store.config.itemsTableId,
      existingItemUpdates.map(({ record_id, fields }) => ({ record_id, fields })),
      (_, index) => ({ entity: "item", meetingId, blockId: existingItemUpdates[index]?.blockId, itemId: existingItemUpdates[index]?.itemId }),
    );
    const newItemCreates = desiredItems
      .filter(({ item }) => !existingItemsById.has(item.id))
      .map(({ item, blockId, blockRecordId }) => ({
        itemId: item.id,
        blockId,
        fields: itemFields(item, blockRecordId, meetingId, blockId, membersById, membersByName),
      }));
    await batchCreateRecords(
      store.config.itemsTableId,
      newItemCreates.map(({ fields }) => fields),
      (_, index) => ({ entity: "item", meetingId, blockId: newItemCreates[index]?.blockId, itemId: newItemCreates[index]?.itemId }),
    );

    const desiredItemIds = new Set(desiredItems.map(({ item }) => item.id));
    const itemsToDelete = existingItems.filter((item) => !desiredItemIds.has(asText(item.fields.item_id)));
    await batchDeleteRecords(
      store.config.itemsTableId,
      itemsToDelete.map((item) => item.record_id),
      { entity: "item", meetingId },
    );
    await batchDeleteRecords(
      store.config.blocksTableId,
      blocksToDelete.map((block) => block.record_id),
      { entity: "block", meetingId },
    );

    const hasChanges = metadataChanged
      || existingBlockUpdates.length > 0
      || newBlocks.length > 0
      || blocksToDelete.length > 0
      || existingItemUpdates.length > 0
      || newItemCreates.length > 0
      || itemsToDelete.length > 0;
    if (!hasChanges) return meetingResponse(meeting, meetingRecord, currentRevision);

    const nextRevision = currentRevision + 1;
    await updateRecord(store.config.meetingsTableId, meetingRecord.record_id, meetingFields(meeting, nextRevision), {
      entity: "meeting",
      meetingId,
    });
    return meetingResponse(meeting, meetingRecord, nextRevision);
  } catch (error) {
    if (!isRecordNotFound(error)) throw error;

    const refreshedStore = await loadStore(meetingId);
    const refreshedMeeting = refreshedStore.meetings.find((record) => asText(record.fields.meeting_id) === meetingId);
    if (!refreshedMeeting) throw new ApiError(404, "MEETING_NOT_FOUND", "Meeting not found.");
    const refreshedRevision = Number(refreshedMeeting.fields.revision || 0);
    if (refreshedRevision !== currentRevision || !allowRecordRefresh) throw revisionConflict(refreshedRevision, error);

    const refreshedBlocks = refreshedStore.blocks.filter((block) => linkedIds(block.fields.meeting).includes(refreshedMeeting.record_id));
    const refreshedBlockRecordIds = new Set(refreshedBlocks.map((block) => block.record_id));
    const replacement = error.details?.entity === "block"
      ? refreshedBlocks.find((block) => asText(block.fields.block_id) === error.details?.blockId)
      : error.details?.entity === "item"
        ? refreshedStore.items.find((item) => asText(item.fields.item_id) === error.details?.itemId
          && linkedIds(item.fields.block).some((id) => refreshedBlockRecordIds.has(id)))
        : null;
    if (!replacement || replacement.record_id === error.details?.recordId) throw revisionConflict(refreshedRevision, error);
    return updateMeetingInternal(meetingId, input, expectedRevision, false);
  }
}

export async function updateMeeting(meetingId, input, expectedRevision) {
  return updateMeetingInternal(meetingId, input, expectedRevision, true);
}

async function ensureReviewFields(config) {
  const fields = await listBitableFields(config.appToken, config.meetingsTableId);
  const existing = new Set(fields.map((field) => field.field_name || field.name));
  const desired = [
    { field_name: REVIEW_FIELDS.review, type: 1 },
    { field_name: REVIEW_FIELDS.status, type: 1 },
    { field_name: REVIEW_FIELDS.score, type: 2 },
    { field_name: REVIEW_FIELDS.metrics, type: 1 },
    { field_name: REVIEW_FIELDS.completedAt, type: 1 },
  ];
  for (const field of desired) {
    if (!existing.has(field.field_name)) await createBitableField(config.appToken, config.meetingsTableId, field);
  }
}

export async function updateMeetingReview(meetingId, input = {}) {
  const store = await loadStore(meetingId);
  const meetingRecord = store.meetings.find((record) => asText(record.fields.meeting_id) === meetingId);
  if (!meetingRecord) throw new ApiError(404, "MEETING_NOT_FOUND", "Meeting not found.");
  await ensureReviewFields(store.config);
  const meeting = assembleMeeting(meetingRecord, store);
  const previousReview = meeting.review && typeof meeting.review === "object" ? meeting.review : {};
  const action = input.action === "skip" ? "skip" : "complete";
  const now = new Date().toISOString();
  const review = {
    ...previousReview,
    highlights: Array.isArray(input.review?.highlights) ? input.review.highlights.map((item) => String(item || "").trim()).filter(Boolean) : previousReview.highlights || [],
    issues: Array.isArray(input.review?.issues) ? input.review.issues.map((item) => String(item || "").trim()).filter(Boolean) : previousReview.issues || [],
    improvements: Array.isArray(input.review?.improvements) ? input.review.improvements.map((item) => String(item || "").trim()).filter(Boolean) : previousReview.improvements || [],
    skippedReason: action === "skip" ? String(input.review?.skippedReason || "").trim() : "",
    updatedAt: now,
  };
  if (action === "skip" && !review.skippedReason) throw new ApiError(400, "REVIEW_SKIP_REASON_REQUIRED", "Skip reason is required.");
  const metrics = buildQualityMetrics(meeting, input.context || {});
  const status = action === "skip" ? "skipped" : "completed";
  await updateRecord(store.config.meetingsTableId, meetingRecord.record_id, {
    [REVIEW_FIELDS.review]: JSON.stringify(review),
    [REVIEW_FIELDS.status]: status,
    [REVIEW_FIELDS.score]: qualityScore(metrics),
    [REVIEW_FIELDS.metrics]: JSON.stringify(metrics),
    [REVIEW_FIELDS.completedAt]: now,
  }, { entity: "meeting-review", meetingId });
  return { review, reviewStatus: status, qualityScore: qualityScore(metrics), qualityMetrics: metrics, reviewCompletedAt: now };
}

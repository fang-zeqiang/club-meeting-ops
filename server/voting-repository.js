import crypto from "node:crypto";
import QRCode from "qrcode";
import {
  ApiError, batchDeleteRecords, bitableRequest, createBitableField, createBitableTable,
  createBitableView, fieldEquals, getBitableConfig, getBitableForm, listBitableFields, listBitableTables,
  listBitableViews, listRecords, updateBitableField, updateBitableForm, updateBitableFormField, updateRecord,
  uploadBitableImage,
} from "./bitable.js";
import { asText } from "./meeting-schema.js";
import { getMeeting } from "./meetings-repository.js";
import { currentAuthorization, ensureResourceEditors, votingBaseEditUrl } from "./resource-access.js";
import { ROLE_AWARD_POOLS, roleAwardConfig, roleAwardIssues, roleIdentity } from "../role-awards.js";
import { AWARD_DEFINITIONS } from "../award-order.js";

export const AWARDS = Object.freeze(Object.fromEntries(AWARD_DEFINITIONS.map(({ key, field }) => [key, field])));
export const FEEDBACK_FIELDS = Object.freeze({
  rating: "How did you like this meeting?",
  comments: "What comments or suggestions would you like to share with us?",
});
const RATING_OPTIONS = [1, 2, 3, 4, 5].map((value) => ({ name: "🌟".repeat(value), value }));
const locks = new Map();
export const VOTING_POOL_PREFIX = "Voting Pool v1";
const VOTING_POOL_DESCRIPTION = "agenda-voting-pool:v1";

async function runTasks(tasks) {
  const results = [];
  for (const task of tasks) results.push(await task());
  return results;
}

function votingToken() {
  const token = process.env.BITABLE_VOTING_APP_TOKEN;
  if (!token) throw new ApiError(503, "VOTING_NOT_CONFIGURED", "BITABLE_VOTING_APP_TOKEN is not configured.");
  return token;
}

function unique(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function tableTopicsCandidates(values) {
  return unique(values || []).map((name) => ({ id: `table-topics:${name.toLocaleLowerCase()}`, memberId: "", name, context: "", label: name }));
}

export function candidateChangeSummary(next = {}, previous = {}) {
  const added = [];
  const removed = [];
  for (const { key, field: award } of AWARD_DEFINITIONS) {
    const before = previous[key] || [];
    const after = next[key] || [];
    added.push(...after
      .filter((item) => !before.some((stored) => stored.id === item.id && stored.label === item.label))
      .map((item) => ({ award, label: item.label })));
    removed.push(...before
      .filter((item) => !after.some((candidate) => candidate.id === item.id && candidate.label === item.label))
      .map((item) => ({ award, label: item.label })));
  }
  return { addedCount: added.length, removedCount: removed.length, added, removed };
}

export function candidateChangePlan(next, previous, responseCount) {
  const changes = candidateChangeSummary(next, previous);
  const changed = Boolean(changes.addedCount || changes.removedCount);
  return { changed, responseResetRequired: changed && responseCount > 0, responseCount, changes };
}

function assertResponseResetConfirmed(plan, confirmed) {
  if (!plan.responseResetRequired || confirmed) return;
  throw new ApiError(409, "VOTING_RESPONSE_RESET_REQUIRED", "Candidate changes require all existing voting responses to be deleted.", {
    responseCount: plan.responseCount,
    candidateChanges: plan.changes,
  });
}

export function candidatesFromMeeting(meeting) {
  const items = meeting.blocks.flatMap((block) => block.items || []);
  const speeches = meeting.blocks.flatMap((block) => block.type === "prepared_speeches"
    ? block.items.filter((item) => item.kind === "speech") : []);
  const configuredRoleTaker = roleAwardConfig(meeting.votingForm).roleTakerRoleIds;
  const roleCandidates = (roles, key) => {
    const seen = new Set();
    return items.map((item) => ({ item, identity: roleIdentity(item.role, item.roleId) }))
      .filter(({ item, identity }) => item.kind === "role" && roles.has(identity.id) && item.status === "confirmed" && item.member)
      .filter((item) => {
        const fallback = key === "functionalRole" ? `${item.identity.id}:${item.item.member.trim().toLocaleLowerCase()}` : item.item.id;
        const candidateId = item.item.roleAssignmentId || fallback;
        if (seen.has(candidateId)) return false;
        seen.add(candidateId);
        return true;
      })
      .map(({ item, identity }) => ({
        id: item.roleAssignmentId || (key === "functionalRole" ? `${identity.id}:${item.member.trim().toLocaleLowerCase()}` : item.id),
        memberId: item.memberId || "",
        name: item.member,
        context: identity.label,
        label: `${identity.label} — ${item.member}`,
      }));
  };
  const evaluators = new Map();
  speeches.filter((item) => item.evaluatorStatus === "confirmed" && item.evaluator).forEach((item) => {
    const id = item.evaluatorId || item.evaluator.trim().toLocaleLowerCase();
    const current = evaluators.get(id) || { id, memberId: item.evaluatorId || "", name: item.evaluator, evaluated: [] };
    current.evaluated.push(item.member || item.session);
    evaluators.set(id, current);
  });
  return {
    roleTaker: roleCandidates(new Set([...ROLE_AWARD_POOLS.roleTaker, ...configuredRoleTaker]), "roleTaker"),
    facilitator: roleCandidates(new Set(ROLE_AWARD_POOLS.facilitator), "facilitator"),
    functionalRole: roleCandidates(new Set(ROLE_AWARD_POOLS.functionalRole), "functionalRole"),
    tableTopicsSpeaker: tableTopicsCandidates(meeting.tableTopicsSpeakers),
    preparedSpeaker: speeches.filter((item) => item.status === "confirmed" && item.member).map((item) => ({
      id: item.id, memberId: item.memberId || "", name: item.member, context: item.session,
      label: `${item.member} — ${item.session}`,
    })),
    evaluator: [...evaluators.values()].map((item) => ({
      id: `evaluator:${item.id}`, memberId: item.memberId, name: item.name,
      context: `Evaluated: ${item.evaluated.join(" / ")}`,
      label: `${item.name} — Evaluated: ${item.evaluated.join(" / ")}`,
    })),
  };
}

export function feedbackFromRecords(records) {
  const distribution = Object.fromEntries(RATING_OPTIONS.map(({ value }) => [value, 0]));
  const comments = [];
  let ratingTotal = 0;
  let ratingCount = 0;
  records.forEach((record) => {
    const stars = RATING_OPTIONS.find(({ name }) => name === asText(record.fields?.[FEEDBACK_FIELDS.rating]))?.value;
    if (stars) {
      distribution[stars] += 1;
      ratingTotal += stars;
      ratingCount += 1;
    }
    const comment = asText(record.fields?.[FEEDBACK_FIELDS.comments]).trim();
    if (comment) comments.push(comment.slice(0, 1000));
  });
  return { averageRating: ratingCount ? Number((ratingTotal / ratingCount).toFixed(1)) : null, distribution, comments };
}

async function serialized(meetingId, operation) {
  const previous = locks.get(meetingId) || Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  locks.set(meetingId, current);
  try { return await current; } finally { if (locks.get(meetingId) === current) locks.delete(meetingId); }
}

async function mainMeetingRecord(meetingId) {
  const config = getBitableConfig();
  const record = (await listRecords(config.meetingsTableId, { filter: fieldEquals("meeting_id", meetingId) }))[0];
  if (!record) throw new ApiError(404, "MEETING_NOT_FOUND", "Meeting not found.");
  return { config, record };
}

async function persistMetadata(meetingId, votingForm, extra = {}) {
  const { config, record } = await mainMeetingRecord(meetingId);
  await updateRecord(config.meetingsTableId, record.record_id, {
    voting_form_json: JSON.stringify(votingForm),
    ...extra,
  });
}

async function votingRecords(appToken, tableId) {
  const records = [];
  let pageToken = "";
  do {
    const query = new URLSearchParams({ page_size: "500" });
    if (pageToken) query.set("page_token", pageToken);
    const data = await bitableRequest(`/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/records?${query}`);
    records.push(...(data.items || []));
    pageToken = data.has_more ? data.page_token : "";
  } while (pageToken);
  return records;
}

async function deleteVotingRecords(appToken, tableId, records) {
  for (let index = 0; index < records.length; index += 500) {
    await bitableRequest(`/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/records/batch_delete`, {
      method: "POST", body: JSON.stringify({ records: records.slice(index, index + 500).map((record) => record.record_id) }),
    });
  }
}

function formShareUrl(form) {
  return form?.shared_url || form?.share_url || form?.url || form?.form?.shared_url || form?.form?.share_url || "";
}

function votingFieldSpecs(candidates = {}) {
  return [
    ...Object.entries(AWARDS).map(([key, name]) => ({ key, name, input: { field_name: name, type: 3, property: { options: (candidates[key] || []).map((option) => ({ name: option.label })) } } })),
    ...Object.entries(FEEDBACK_FIELDS).map(([key, name]) => ({ key, name, input: key === "rating"
      ? { field_name: name, type: 3, property: { options: RATING_OPTIONS.map(({ name: option }) => ({ name: option })) } }
      : { field_name: name, type: 1 } })),
  ];
}

export function tableTopicsFormFieldInput(candidates = {}) {
  if (!(candidates.tableTopicsSpeaker || []).length) return { visible: false };
  const tableTopicsIndex = AWARD_DEFINITIONS.findIndex(({ key }) => key === "tableTopicsSpeaker");
  const index = AWARD_DEFINITIONS.slice(0, tableTopicsIndex)
    .filter(({ key }) => (candidates[key] || []).length).length;
  return { title: AWARDS.tableTopicsSpeaker, required: true, visible: true, index };
}

export async function provisionVotingPoolTable() {
  const appToken = votingToken();
  const fieldSpecs = votingFieldSpecs();
  const inputs = [{ field_name: "Submission", type: 1 }, ...fieldSpecs.map(({ input }) => input)];
  let table;
  try {
    table = await createBitableTable(appToken, `${VOTING_POOL_PREFIX} ${Date.now().toString(36)}`, inputs);
    if (table.field_id_list?.length !== inputs.length) throw new ApiError(502, "VOTING_POOL_FIELDS_MISSING", "Feishu did not return voting pool field IDs.");
    const form = await createBitableView(appToken, table.table_id, "Voting Form", "form");
    const details = await updateBitableForm(appToken, table.table_id, form.view_id, {
      name: "Voting Form", description: VOTING_POOL_DESCRIPTION, shared: true, shared_limit: "anyone_editable", submit_limit_once: false,
    });
    const fieldIds = table.field_id_list;
    await runTasks([
      () => updateBitableFormField(appToken, table.table_id, form.view_id, fieldIds[0], { visible: false }),
      ...Object.values(AWARDS).map((name, index) => () => updateBitableFormField(appToken, table.table_id, form.view_id, fieldIds[index + 1], {
        title: name, required: true, visible: true, index,
      })),
      () => updateBitableFormField(appToken, table.table_id, form.view_id, fieldIds[fieldIds.length - 2], {
        title: FEEDBACK_FIELDS.rating, required: true, visible: true, index: Object.keys(AWARDS).length,
      }),
      () => updateBitableFormField(appToken, table.table_id, form.view_id, fieldIds[fieldIds.length - 1], {
        title: FEEDBACK_FIELDS.comments, description: "Optional · maximum 1000 characters", required: false, visible: true, index: Object.keys(AWARDS).length + 1,
      }),
    ]);
    return { tableId: table.table_id, formId: form.view_id, shareUrl: formShareUrl(details) };
  } catch (error) {
    if (table?.table_id) await bitableRequest(`/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(table.table_id)}`, { method: "DELETE" }).catch(() => {});
    throw error;
  }
}

async function usedVotingTableIds() {
  const { meetingsTableId } = getBitableConfig();
  const ids = new Set();
  for (const record of await listRecords(meetingsTableId)) {
    try {
      const tableId = JSON.parse(asText(record.fields.voting_form_json) || "null")?.tableId;
      if (tableId) ids.add(tableId);
    } catch { /* ignore invalid legacy metadata */ }
  }
  return ids;
}

export async function prepareVotingForm(meetingId) {
  return serialized(meetingId, async () => {
    const meeting = await getMeeting(meetingId);
    const appToken = votingToken();
    const metadata = { ...(meeting.votingForm || {}), fieldIds: { ...(meeting.votingForm?.fieldIds || {}) } };
    delete metadata.baseToken;
    const candidates = candidatesFromMeeting(meeting);
    const candidateChanges = candidateChangeSummary(candidates, metadata.syncedCandidates || {});
    if (metadata.tableId && metadata.formId && metadata.schemaVersion === 2 && meeting.systemVotingQr?.present
      && !candidateChanges.addedCount && !candidateChanges.removedCount) {
      try {
        const form = await getBitableForm(appToken, metadata.tableId, metadata.formId);
        const shareUrl = formShareUrl(form) || metadata.shareUrl;
        if (shareUrl) return {
          prepared: true,
          qrSource: meeting.qrSource,
          votingForm: { ...metadata, shareUrl, editUrl: metadata.editUrl || votingBaseEditUrl(appToken, metadata.tableId), authorization: currentAuthorization(metadata.authorization) },
          candidates,
          candidateChanges,
          roleAwardIssues: roleAwardIssues(meeting),
          needsUpdate: false,
          responseCount: null,
        };
      } catch { /* missing form falls through to idempotent repair */ }
    }
    const legacyNames = { preparedSpeaker: "Best Prepared Speech Speaker", evaluator: "Best Evaluator" };
    const fieldSpecs = votingFieldSpecs(candidates);
    const tableName = `Voting - ${meeting.date} - ${meeting.id}`.slice(0, 100);
    const tables = await listBitableTables(appToken);
    let table = metadata.tableId && tables.find((item) => item.table_id === metadata.tableId);
    if (!table) table = tables.find((item) => item.name === tableName);
    let fieldsReady = false;
    let poolBaseline = metadata.poolSchemaVersion === 1 && !metadata.syncedCandidates;
    let createdFields = null;
    if (!table) {
      // ponytail: process-local claim lock; add a durable claim registry only if concurrent meeting preparation becomes real.
      table = await serialized("__voting_pool__", async () => {
        const used = await usedVotingTableIds();
        return tables.find((item) => String(item.name || "").startsWith(VOTING_POOL_PREFIX) && !used.has(item.table_id));
      });
      if (table) {
        poolBaseline = true;
        metadata.poolSchemaVersion = 1;
        metadata.tableId = table.table_id;
        await persistMetadata(meetingId, metadata);
      } else {
        const inputs = [{ field_name: "Submission", type: 1 }, ...fieldSpecs.map(({ input }) => input)];
        table = await createBitableTable(appToken, tableName, inputs);
        fieldsReady = true;
        delete metadata.poolSchemaVersion;
        if (table.field_id_list?.length === inputs.length) createdFields = inputs.map((field, index) => ({ ...field, field_id: table.field_id_list[index] }));
      }
    }
    metadata.tableId = table.table_id;
    const poolTable = metadata.poolSchemaVersion === 1;

    const [existingFields, views] = await Promise.all([
      createdFields || listBitableFields(appToken, metadata.tableId),
      fieldsReady ? Promise.resolve([]) : listBitableViews(appToken, metadata.tableId),
    ]);
    const fields = await runTasks(fieldSpecs.map(({ key, name, input }) => async () => existingFields.find((item) => item.field_id === metadata.fieldIds[key])
      || existingFields.find((item) => item.field_name === name)
      || existingFields.find((item) => item.field_name === legacyNames[key])
      || createBitableField(appToken, metadata.tableId, input)));
    fieldSpecs.forEach(({ key }, index) => { metadata.fieldIds[key] = fields[index].field_id; });

    let form = metadata.formId && views.find((item) => item.view_id === metadata.formId);
    if (!form) form = views.find((item) => item.view_type === "form");
    if (!form) form = await createBitableView(appToken, metadata.tableId, `Meeting ${meeting.meetingNumber} Voting`, "form");
    metadata.formId = form.view_id;
    const formDetails = poolTable
      ? await getBitableForm(appToken, metadata.tableId, metadata.formId)
      : await updateBitableForm(appToken, metadata.tableId, metadata.formId, {
        name: `Meeting ${meeting.meetingNumber} Voting`, shared: true, shared_limit: "anyone_editable", submit_limit_once: false,
      });
    if (poolTable && formDetails.form?.description !== VOTING_POOL_DESCRIPTION) throw new ApiError(409, "VOTING_POOL_INVALID", "Voting pool table is not fully provisioned.");
    metadata.shareUrl = formShareUrl(formDetails);
    if (!metadata.shareUrl) throw new ApiError(502, "VOTING_SHARE_URL_MISSING", "Feishu did not return a form share URL.");

    const needsQrUpload = !metadata.systemQrMediaId || !meeting.systemVotingQr?.present;
    const [fileToken, responses, authorization] = await Promise.all([
      needsQrUpload ? QRCode.toBuffer(metadata.shareUrl, { type: "png", width: 640, margin: 2, errorCorrectionLevel: "M" })
        .then((png) => uploadBitableImage(png, { fileName: `voting-${meeting.id}.png`, type: "image/png" })) : metadata.systemQrMediaId,
      metadata.schemaVersion !== 2 ? votingRecords(appToken, metadata.tableId) : Promise.resolve([]),
      currentAuthorization(metadata.authorization).status === "ready" ? currentAuthorization(metadata.authorization) : ensureResourceEditors(appToken, "bitable"),
    ]);
    metadata.systemQrMediaId = fileToken;
    if (responses.length) await deleteVotingRecords(appToken, metadata.tableId, responses);
    metadata.schemaVersion = 2;
    metadata.lastSyncedAt = new Date().toISOString();
    metadata.editUrl = votingBaseEditUrl(appToken, metadata.tableId);
    metadata.authorization = authorization;
    await persistMetadata(meetingId, metadata, { ...(needsQrUpload ? { system_voting_qr_image: [{ file_token: fileToken }] } : {}), voting_qr_source: meeting.qrSource || "system" });
    const changes = candidateChangeSummary(candidates, metadata.syncedCandidates || {});
    const synced = fieldsReady || changes.addedCount || changes.removedCount
      ? await syncVotingForm(meetingId, { fieldsReady, knownFields: createdFields || existingFields, knownMeeting: { ...meeting, votingForm: metadata }, knownResponses: poolBaseline ? [] : null, poolBaseline })
      : { votingForm: metadata };
    return {
      prepared: true,
      qrSource: meeting.qrSource,
      votingForm: synced.votingForm,
      candidates,
      candidateChanges: candidateChangeSummary(candidates, synced.votingForm.syncedCandidates || {}),
      roleAwardIssues: roleAwardIssues(meeting),
      needsUpdate: false,
      responseCount: null,
    };
  });
}

export async function syncVotingForm(meetingId, { confirmResponseReset = false, fieldsReady = false, knownFields = null, knownMeeting = null, knownResponses = null, poolBaseline = false } = {}) {
  const run = async () => {
    const meeting = knownMeeting || await getMeeting(meetingId);
    const metadata = meeting.votingForm;
    if (!metadata?.tableId || !metadata?.formId) throw new ApiError(409, "VOTING_FORM_NOT_PREPARED", "Prepare voting form first.");
    const appToken = votingToken();
    const candidates = candidatesFromMeeting(meeting);
    const issues = roleAwardIssues(meeting);
    if (issues.blockers.length) throw new ApiError(409, "ROLE_AWARD_CONFIG_INVALID", issues.blockers.join(" "));
    const responses = knownResponses || await votingRecords(appToken, metadata.tableId);
    const previous = metadata.syncedCandidates || {};
    const poolOptimized = poolBaseline || metadata.poolSchemaVersion === 1;
    const { record } = await mainMeetingRecord(meetingId);
    const plan = candidateChangePlan(candidates, previous, responses.length);
    assertResponseResetConfirmed(plan, confirmResponseReset);
    if (plan.responseResetRequired) await deleteVotingRecords(appToken, metadata.tableId, responses);
    const fieldIds = { ...(metadata.fieldIds || {}) };
    const fields = knownFields || await listBitableFields(appToken, metadata.tableId);
    for (const [key, name] of Object.entries(AWARDS)) {
      let field = fields.find((item) => item.field_id === fieldIds[key]) || fields.find((item) => item.field_name === name);
      if (!field) {
        field = await createBitableField(appToken, metadata.tableId, { field_name: name, type: 3, property: { options: [] } });
        fields.push(field);
      }
      fieldIds[key] = field.field_id;
    }
    for (const [key, name] of Object.entries(FEEDBACK_FIELDS)) {
      let field = fields.find((item) => item.field_id === fieldIds[key]) || fields.find((item) => item.field_name === name);
      if (!field) {
        field = await createBitableField(appToken, metadata.tableId, key === "rating"
          ? { field_name: name, type: 3, property: { options: RATING_OPTIONS.map(({ name: option }) => ({ name: option })) } }
          : { field_name: name, type: 1 });
        fields.push(field);
      }
      fieldIds[key] = field.field_id;
    }
    const managedFieldIds = new Set(Object.values(fieldIds));
    const hiddenFields = (poolOptimized ? [] : fields.filter((item) => !managedFieldIds.has(item.field_id)))
      .map((field) => () => updateBitableFormField(appToken, metadata.tableId, metadata.formId, field.field_id, { visible: false }));
    let index = 0;
    const awardEntries = Object.entries(AWARDS).map(([key, name]) => {
      const options = candidates[key].map((option) => ({ name: option.label }));
      return { key, name, options, fieldIndex: options.length ? index++ : -1 };
    });
    const awardUpdates = awardEntries.map(({ key, name, options, fieldIndex }) => async () => {
      const field = fields.find((item) => item.field_id === fieldIds[key]);
      if (!field) throw new ApiError(409, "VOTING_FIELD_MISSING", `${name} field is missing.`);
      if (poolOptimized) {
        const before = previous[key] || [];
        const changed = before.length !== candidates[key].length || before.some((item, index) => item.id !== candidates[key][index]?.id || item.label !== candidates[key][index]?.label);
        if (changed && (options.length || before.length)) await updateBitableField(appToken, metadata.tableId, field.field_id, { field_name: name, type: 3, property: { ...(field.property || {}), options } });
        if (poolBaseline && !options.length) await updateBitableFormField(appToken, metadata.tableId, metadata.formId, field.field_id, { visible: false });
        else if (!poolBaseline && Boolean(before.length) !== Boolean(options.length)) await updateBitableFormField(appToken, metadata.tableId, metadata.formId, field.field_id,
          options.length ? { title: name, required: true, visible: true, index: fieldIndex } : { visible: false });
        return;
      }
      if (!fieldsReady) await updateBitableField(appToken, metadata.tableId, field.field_id, { field_name: name, type: 3, property: { ...(field.property || {}), options } });
      await updateBitableFormField(appToken, metadata.tableId, metadata.formId, field.field_id,
        options.length ? { title: name, required: true, visible: true, index: fieldIndex } : { visible: false });
    });
    const ratingField = fields.find((item) => item.field_id === fieldIds.rating);
    const commentsField = fields.find((item) => item.field_id === fieldIds.comments);
    if (!ratingField || !commentsField) throw new ApiError(409, "VOTING_FIELD_MISSING", "Meeting feedback fields are missing.");
    const ratingIndex = index++;
    await runTasks([...hiddenFields, ...awardUpdates, async () => {
      if (!poolOptimized && !fieldsReady) await updateBitableField(appToken, metadata.tableId, ratingField.field_id, {
        field_name: FEEDBACK_FIELDS.rating, type: 3, property: { ...(ratingField.property || {}), options: RATING_OPTIONS.map(({ name }) => ({ name })) },
      });
      if (!poolOptimized) await updateBitableFormField(appToken, metadata.tableId, metadata.formId, ratingField.field_id,
        { title: FEEDBACK_FIELDS.rating, required: true, visible: true, index: ratingIndex });
    }, async () => {
      if (!poolOptimized && !fieldsReady) await updateBitableField(appToken, metadata.tableId, commentsField.field_id, { field_name: FEEDBACK_FIELDS.comments, type: 1 });
      if (!poolOptimized) await updateBitableFormField(appToken, metadata.tableId, metadata.formId, commentsField.field_id,
        { title: FEEDBACK_FIELDS.comments, description: "Optional · maximum 1000 characters", required: false, visible: true, index });
    }]);
    const syncedAt = new Date().toISOString();
    const updated = {
      ...metadata,
      fieldIds,
      lastSyncedAt: syncedAt,
      syncedCandidates: candidates,
      awardsNeedReconfirmation: Boolean(metadata.awardsNeedReconfirmation
        || (plan.changed && asText(record.fields.confirmed_awards_json))),
      ...(plan.changed ? {
        lastCandidateChange: {
          at: syncedAt,
          clearedResponseCount: plan.responseResetRequired ? responses.length : 0,
          ...plan.changes,
        },
      } : {}),
    };
    await persistMetadata(meetingId, updated);
    return {
      ok: true,
      clearedResponses: plan.responseResetRequired ? responses.length : 0,
      candidates,
      votingForm: updated,
      awardsNeedReconfirmation: updated.awardsNeedReconfirmation,
    };
  };
  return locks.has(meetingId) ? run() : serialized(meetingId, run);
}

export async function getVotingFormStatus(meetingId) {
  const meeting = await getMeeting(meetingId);
  const responseCount = meeting.votingForm?.tableId ? (await votingRecords(votingToken(), meeting.votingForm.tableId)).length : 0;
  const votingForm = meeting.votingForm ? {
    ...meeting.votingForm,
    editUrl: meeting.votingForm.editUrl || votingBaseEditUrl(votingToken(), meeting.votingForm.tableId),
    authorization: currentAuthorization(meeting.votingForm.authorization),
  } : null;
  const candidates = candidatesFromMeeting(meeting);
  const candidateChanges = candidateChangeSummary(candidates, votingForm?.syncedCandidates);
  return {
    prepared: Boolean(votingForm?.formId),
    qrSource: meeting.qrSource,
    votingForm,
    candidates,
    candidateChanges,
    roleAwardIssues: roleAwardIssues(meeting),
    needsUpdate: Boolean(votingForm?.formId) && Boolean(candidateChanges.addedCount || candidateChanges.removedCount),
    responseCount,
  };
}

export async function saveTableTopicsSpeakers(meetingId, speakers, { confirmResponseReset = false, tableIdHint = "" } = {}) {
  return serialized(meetingId, async () => {
    const next = unique(Array.isArray(speakers) ? speakers : []);
    const appToken = votingToken();
    const targetPromise = mainMeetingRecord(meetingId);
    const hintedRecordsPromise = tableIdHint ? votingRecords(appToken, tableIdHint) : null;
    const [target, hintedRecords] = await Promise.all([targetPromise, hintedRecordsPromise || Promise.resolve(null)]);
    let metadata;
    try { metadata = JSON.parse(asText(target.record.fields.voting_form_json) || "null"); } catch { metadata = null; }
    if (!metadata?.tableId || !metadata?.formId) throw new ApiError(409, "VOTING_FORM_NOT_PREPARED", "Prepare voting form first.");
    if (tableIdHint && tableIdHint !== metadata.tableId) throw new ApiError(409, "VOTING_FORM_CHANGED", "Voting form changed. Refresh and try again.");
    const records = hintedRecords || await votingRecords(appToken, metadata.tableId);
    const previous = metadata.syncedCandidates || {};
    if (!metadata.fieldIds?.tableTopicsSpeaker || !Object.keys(previous).length) {
      const meeting = await getMeeting(meetingId);
      const plan = candidateChangePlan(candidatesFromMeeting({ ...meeting, tableTopicsSpeakers: next }), previous, records.length);
      assertResponseResetConfirmed(plan, confirmResponseReset);
      await updateRecord(target.config.meetingsTableId, target.record.record_id, { table_topics_speakers_json: JSON.stringify(next) });
      const synced = await syncVotingForm(meetingId, { confirmResponseReset, knownResponses: records });
      return { ...synced, tableTopicsSpeakers: next, responseCount: records.length };
    }
    const candidates = { ...previous, tableTopicsSpeaker: tableTopicsCandidates(next) };
    const plan = candidateChangePlan(candidates, previous, records.length);
    assertResponseResetConfirmed(plan, confirmResponseReset);
    if (plan.responseResetRequired) await deleteVotingRecords(appToken, metadata.tableId, records);
    const syncedAt = new Date().toISOString();
    const updated = {
      ...metadata,
      lastSyncedAt: syncedAt,
      syncedCandidates: candidates,
      awardsNeedReconfirmation: Boolean(metadata.awardsNeedReconfirmation || (plan.changed && asText(target.record.fields.confirmed_awards_json))),
      ...(plan.changed ? { lastCandidateChange: { at: syncedAt, clearedResponseCount: plan.responseResetRequired ? records.length : 0, ...plan.changes } } : {}),
    };
    await Promise.all([
      updateBitableField(appToken, metadata.tableId, metadata.fieldIds.tableTopicsSpeaker, {
        field_name: AWARDS.tableTopicsSpeaker,
        type: 3,
        property: { options: candidates.tableTopicsSpeaker.map(({ label }) => ({ name: label })) },
      }),
      updateBitableFormField(appToken, metadata.tableId, metadata.formId, metadata.fieldIds.tableTopicsSpeaker,
        tableTopicsFormFieldInput(candidates)),
      updateRecord(target.config.meetingsTableId, target.record.record_id, {
        table_topics_speakers_json: JSON.stringify(next),
        voting_form_json: JSON.stringify(updated),
      }),
    ]);
    return {
      ok: true,
      clearedResponses: plan.responseResetRequired ? records.length : 0,
      candidates,
      votingForm: updated,
      awardsNeedReconfirmation: updated.awardsNeedReconfirmation,
      tableTopicsSpeakers: next,
      responseCount: records.length,
    };
  });
}

export async function authorizeVotingEditors(meetingId) {
  return serialized(meetingId, async () => {
    const meeting = await getMeeting(meetingId);
    if (!meeting.votingForm?.tableId) throw new ApiError(409, "VOTING_FORM_NOT_PREPARED", "Prepare voting form first.");
    const appToken = votingToken();
    const votingForm = {
      ...meeting.votingForm,
      editUrl: votingBaseEditUrl(appToken, meeting.votingForm.tableId),
      authorization: await ensureResourceEditors(appToken, "bitable"),
    };
    await persistMetadata(meetingId, votingForm);
    return { votingForm };
  });
}

export async function clearVotingResponses(meetingId) {
  return serialized(meetingId, async () => {
    const meeting = await getMeeting(meetingId);
    if (!meeting.votingForm?.tableId) throw new ApiError(409, "VOTING_FORM_NOT_PREPARED", "Prepare voting form first.");
    const records = await votingRecords(votingToken(), meeting.votingForm.tableId);
    await deleteVotingRecords(votingToken(), meeting.votingForm.tableId, records);
    return { deleted: records.length };
  });
}

export function tallyVotingResults(current, synced, records) {
  const awards = Object.fromEntries(Object.entries(AWARDS).map(([key, title]) => {
    const counts = new Map();
    records.forEach((record) => {
      const value = asText(record.fields?.[title]);
      if (value) counts.set(value, (counts.get(value) || 0) + 1);
    });
    const currentCandidates = current[key] || [];
    const candidates = currentCandidates.map((candidate) => ({ ...candidate, votes: counts.get(candidate.label) || 0, historical: false }));
    counts.forEach((votes, label) => {
      if (currentCandidates.some((candidate) => candidate.label === label)) return;
      const candidate = (synced[key] || []).find((item) => item.label === label) || { id: label, name: label, label, memberId: "", context: "" };
      candidates.push({ ...candidate, votes, historical: true });
    });
    candidates.sort((a, b) => b.votes - a.votes || a.label.localeCompare(b.label));
    const top = candidates[0]?.votes || 0;
    return [key, {
      title,
      candidates,
      totalVotes: candidates.reduce((sum, candidate) => sum + candidate.votes, 0),
      winners: top ? candidates.filter((item) => item.votes === top) : [],
    }];
  }));
  const versionPayload = Object.fromEntries(Object.entries(awards).map(([key, award]) => [key,
    award.candidates.map(({ id, label, votes, historical }) => [id, label, votes, historical]),
  ]));
  return {
    responseCount: records.length,
    resultsVersion: crypto.createHash("sha256").update(JSON.stringify([records.length, versionPayload])).digest("hex").slice(0, 16),
    awards,
    feedback: feedbackFromRecords(records),
  };
}

export async function getVotingResults(meetingId) {
  const meeting = await getMeeting(meetingId);
  if (!meeting.votingForm?.tableId) throw new ApiError(409, "VOTING_FORM_NOT_PREPARED", "Prepare voting form first.");
  const records = await votingRecords(votingToken(), meeting.votingForm.tableId);
  const current = candidatesFromMeeting(meeting);
  const synced = meeting.votingForm.syncedCandidates || current;
  return tallyVotingResults(current, synced, records);
}

export async function setVotingQrSource(meetingId, source) {
  if (!["system", "manual"].includes(source)) throw new ApiError(400, "INVALID_QR_SOURCE", "QR source must be system or manual.");
  const { config, record } = await mainMeetingRecord(meetingId);
  await updateRecord(config.meetingsTableId, record.record_id, { voting_qr_source: source });
  return { qrSource: source };
}

import { ApiError, createRecord, fieldEquals, getBitableConfig, listRecords, updateRecord } from "./bitable.js";
import { asText } from "./meeting-schema.js";

function tableId() {
  const value = getBitableConfig().mcpAgendaChangesTableId;
  if (!value) throw new ApiError(503, "MCP_AGENDA_AUDIT_NOT_CONFIGURED", "BITABLE_MCP_AGENDA_CHANGES_TABLE_ID is not configured.");
  return value;
}

function parseJson(value, fallback = null) {
  try { return JSON.parse(asText(value)); } catch { return fallback; }
}

function auditFromRecord(record) {
  return {
    recordId: record.record_id,
    operationId: asText(record.fields.operation_id),
    proposalHash: asText(record.fields.proposal_hash),
    principalId: asText(record.fields.principal_id),
    principalName: asText(record.fields.principal_name),
    meetingId: asText(record.fields.meeting_id),
    meetingNumber: Number(record.fields.meeting_number || 0),
    beforeRevision: Number(record.fields.before_revision || 0),
    afterRevision: Number(record.fields.after_revision || 0),
    operationTypes: asText(record.fields.operation_types),
    changes: parseJson(record.fields.changes_json, {}),
    inverse: parseJson(record.fields.inverse_json, {}),
    createdRole: parseJson(record.fields.created_role_json, []),
    urlCheck: parseJson(record.fields.url_check_json, []),
    result: parseJson(record.fields.result_json, null),
    status: asText(record.fields.status),
    errorCode: asText(record.fields.error_code),
    errorMessage: asText(record.fields.error_message),
    createdAt: asText(record.fields.created_at),
    completedAt: asText(record.fields.completed_at),
    recoveredAt: asText(record.fields.recovered_at),
  };
}

export async function findAgendaAudit(operationId) {
  const records = await listRecords(tableId(), { filter: fieldEquals("operation_id", operationId) });
  if (records.length > 1) throw new ApiError(503, "MCP_AGENDA_AUDIT_INVALID", "Duplicate Agenda audit operation IDs were found.");
  return records[0] ? auditFromRecord(records[0]) : null;
}

export async function listAgendaAudits(meetingId) {
  return (await listRecords(tableId(), { filter: fieldEquals("meeting_id", meetingId) }))
    .map(auditFromRecord)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function createAgendaAudit(entry) {
  const record = await createRecord(tableId(), {
    operation_id: entry.operationId,
    proposal_hash: entry.proposalHash,
    principal_id: entry.principalId,
    principal_name: entry.principalName,
    meeting_id: entry.meetingId,
    meeting_number: entry.meetingNumber,
    before_revision: entry.beforeRevision,
    after_revision: 0,
    operation_types: entry.operationTypes.join(","),
    changes_json: JSON.stringify(entry.changes),
    inverse_json: JSON.stringify(entry.inverse),
    created_role_json: "[]",
    url_check_json: JSON.stringify(entry.urlCheck || []),
    result_json: "",
    status: "prepared",
    error_code: "",
    error_message: "",
    created_at: entry.createdAt,
    completed_at: "",
    recovered_at: "",
  }, { entity: "mcp-agenda-audit", operationId: entry.operationId });
  return auditFromRecord(record);
}

export async function updateAgendaAudit(recordId, fields) {
  return updateRecord(tableId(), recordId, fields, { entity: "mcp-agenda-audit" });
}

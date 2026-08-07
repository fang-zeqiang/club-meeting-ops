import crypto from "node:crypto";

import { externalPresentationUrlError, normalizeExternalPresentationUrl } from "../external-presentation-url.js";
import { ApiError } from "./bitable.js";
import {
  bookingAssignments,
  changeBooking,
  deleteGoal,
  getBookingDashboard,
  listBookingMembers,
  saveGoal,
  shanghaiDate,
} from "./booking-repository.js";
import { checkExternalPublicUrl } from "./external-public-url.js";
import { createAgendaAudit, findAgendaAudit, updateAgendaAudit } from "./mcp-agenda-audit.js";
import { getMeeting, listDetailedMeetings } from "./meetings-repository.js";
import { getPathwaysCatalog, publicPathwaysCatalog, resolveSpeechDetails } from "./pathways-repository.js";
import { getRoleCatalog } from "./roles-repository.js";

const PROPOSAL_TTL_MS = 5 * 60 * 1000;
const READ_ONLY = Object.freeze({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
const WRITE = Object.freeze({ readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true });
const APPLY = Object.freeze({ readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true });
const MEETING_NUMBER = { type: "integer", minimum: 1, description: "Required Agenda meeting number; never infer a nearest meeting." };
const MEMBER_ID = { type: "string", minLength: 1, maxLength: 120, description: "Exact member_id returned by get_role_booking_context." };
const ASSIGNMENT_ID = { type: "string", minLength: 1, maxLength: 160, description: "Exact assignment_id returned by current meeting context." };
const IDEMPOTENCY_KEY = { type: "string", minLength: 8, maxLength: 200, description: "Client-generated stable key for one intended operation." };
const SPEECH_DETAILS = {
  type: "object",
  properties: {
    session: { type: "string", maxLength: 200 },
    pathways_mode: { type: "string", enum: ["pathways", "custom", "later"] },
    pathways_path: { type: "string", maxLength: 120 },
    pathways_project_id: { type: "string", maxLength: 160 },
    pathways_form_id: { type: "string", maxLength: 160 },
    speech_objective: { type: "string", maxLength: 1000 },
  },
  additionalProperties: false,
};

export const BOOKING_TOOLS = Object.freeze([
  {
    name: "get_role_booking_context",
    title: "读取 Role Booking 上下文",
    description: "Resolve one explicit active non-Guest member and read only that member's future bookings, goals, public roles, and optionally one exact meeting's assignment IDs. Never guess a member or meeting.",
    inputSchema: {
      type: "object",
      properties: {
        member_query: { type: "string", minLength: 1, maxLength: 80 },
        member_id: MEMBER_ID,
        meeting_number: MEETING_NUMBER,
        include_all_goals: { type: "boolean", default: false, description: "Use only when the user explicitly asks for all members' goal summary." },
      },
      anyOf: [{ required: ["member_query"] }, { required: ["member_id"] }],
      additionalProperties: false,
    },
    annotations: READ_ONLY,
  },
  {
    name: "search_pathways_projects",
    title: "搜索 Pathways 项目目录",
    description: "Search the active Base-backed Pathways Catalog by query, Path, or Level. Returns stable project/form IDs; never searches the open web.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", maxLength: 120 },
        path: { type: "string", maxLength: 120 },
        level: { type: "string", enum: ["1", "2", "3", "4", "5"] },
        limit: { type: "integer", minimum: 1, maximum: 20, default: 10, description: "Maximum projects to return. Defaults to 10; use hasMore to refine the search." },
      },
      additionalProperties: false,
    },
    annotations: READ_ONLY,
  },
  {
    name: "book_role",
    title: "由官员代会员预约明确空缺角色",
    description: "Immediately book one exact vacant assignment for one explicit member in one future draft meeting. Requires current revision and idempotency key. If the member already has another role, call again only after explicit confirmation with allow_multiple_roles=true.",
    inputSchema: {
      type: "object",
      properties: {
        meeting_number: MEETING_NUMBER,
        expected_revision: { type: "integer", minimum: 0 },
        assignment_id: ASSIGNMENT_ID,
        member_id: MEMBER_ID,
        idempotency_key: IDEMPOTENCY_KEY,
        allow_multiple_roles: { type: "boolean", default: false },
        speech_details: SPEECH_DETAILS,
        external_presentation_url: { type: "string", format: "uri", maxLength: 2048 },
        allow_external_url_risk: { type: "boolean", default: false },
      },
      required: ["meeting_number", "expected_revision", "assignment_id", "member_id", "idempotency_key"],
      additionalProperties: false,
    },
    annotations: WRITE,
  },
  {
    name: "create_booking_goal",
    title: "由官员代会员新建角色目标",
    description: "Immediately create one public-role goal for one explicit member. Requires a stable idempotency key; an active goal for the same member and role is rejected.",
    inputSchema: {
      type: "object",
      properties: {
        member_id: MEMBER_ID,
        role: { type: "string", minLength: 1, maxLength: 80 },
        target_count: { type: "integer", minimum: 1, maximum: 20 },
        due_date: { type: "string", format: "date" },
        idempotency_key: IDEMPOTENCY_KEY,
      },
      required: ["member_id", "role", "target_count", "due_date", "idempotency_key"],
      additionalProperties: false,
    },
    annotations: WRITE,
  },
  {
    name: "propose_role_booking_change",
    title: "提议单个 Role Booking 修改",
    description: "Build one five-minute officer-proxy proposal for cancel, transfer, speech details, Presentation URL, goal edit, or goal delete. Returns complete before/after diff and writes no business data. Show the diff and wait for explicit confirmation.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["cancel_booking", "transfer_booking", "update_speech_details", "update_presentation_url", "update_goal", "delete_goal"] },
        meeting_number: MEETING_NUMBER,
        expected_revision: { type: "integer", minimum: 0 },
        assignment_id: ASSIGNMENT_ID,
        member_id: MEMBER_ID,
        target_member_id: MEMBER_ID,
        goal_id: { type: "string", minLength: 1, maxLength: 160 },
        expected_goal_hash: { type: "string", pattern: "^[a-f0-9]{64}$" },
        goal: {
          type: "object",
          properties: {
            role: { type: "string", minLength: 1, maxLength: 80 },
            target_count: { type: "integer", minimum: 1, maximum: 20 },
            due_date: { type: "string", format: "date" },
          },
          required: ["role", "target_count", "due_date"],
          additionalProperties: false,
        },
        speech_details: SPEECH_DETAILS,
        external_presentation_url: {
          anyOf: [{ const: "" }, { type: "string", format: "uri", maxLength: 2048 }],
          description: "HTTPS Presentation URL, or an empty string to clear the current link.",
        },
      },
      required: ["action", "member_id"],
      additionalProperties: false,
    },
    annotations: { ...READ_ONLY, openWorldHint: true },
  },
  {
    name: "apply_role_booking_change",
    title: "确认后应用 Role Booking 修改",
    description: "Apply one unexpired signed Booking proposal only after the user explicitly confirms its complete diff. Revalidates principal, revision or goal hash, assignment, member, catalog, and URL; audits first and reads back after writing.",
    inputSchema: {
      type: "object",
      properties: { proposal_id: { type: "string", minLength: 20 } },
      required: ["proposal_id"],
      additionalProperties: false,
    },
    annotations: APPLY,
  },
]);

const TOOL_NAMES = new Set(BOOKING_TOOLS.map(({ name }) => name));
const MEETING_ACTIONS = new Set(["cancel_booking", "transfer_booking", "update_speech_details", "update_presentation_url"]);
const GOAL_ACTIONS = new Set(["update_goal", "delete_goal"]);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function hash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

export function goalHash(goal) {
  return hash({
    id: goal?.id || "",
    role: goal?.role || "",
    targetCount: Number(goal?.targetCount || 0),
    dueDate: goal?.dueDate || "",
    createdAt: goal?.createdAt || "",
  });
}

function signingSecret() {
  const value = String(process.env.AGENDA_SESSION_SECRET || "");
  if (!value) throw new ApiError(503, "MCP_NOT_CONFIGURED", "AGENDA_SESSION_SECRET is not configured.");
  return value;
}

function sign(encoded) {
  return crypto.createHmac("sha256", signingSecret()).update(`agenda-mcp-booking:${encoded}`).digest("base64url");
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function createBookingProposal(payload, now = Date.now()) {
  const encoded = Buffer.from(JSON.stringify({ ...payload, expiresAtMs: now + PROPOSAL_TTL_MS })).toString("base64url");
  return `vpe_booking_proposal_${encoded}.${sign(encoded)}`;
}

export function verifyBookingProposal(value, now = Date.now()) {
  const raw = String(value || "");
  if (!raw.startsWith("vpe_booking_proposal_")) throw new ApiError(401, "INVALID_PROPOSAL", "Booking proposal is invalid.");
  const [encoded, supplied] = raw.slice("vpe_booking_proposal_".length).split(".");
  if (!encoded || !supplied || !safeEqual(sign(encoded), supplied)) throw new ApiError(401, "INVALID_PROPOSAL", "Booking proposal is invalid.");
  let payload;
  try { payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")); } catch { throw new ApiError(401, "INVALID_PROPOSAL", "Booking proposal is invalid."); }
  if (!Number.isInteger(payload.expiresAtMs) || payload.expiresAtMs <= now) throw new ApiError(409, "PROPOSAL_EXPIRED", "Booking proposal expired. Read, propose, and confirm again.");
  return payload;
}

function objectArgs(raw, allowed, required = []) {
  const args = raw == null ? {} : raw;
  if (typeof args !== "object" || Array.isArray(args) || Object.keys(args).some((key) => !allowed.includes(key))) {
    throw new ApiError(400, "INVALID_ARGUMENTS", `Use only ${allowed.join(", ") || "an empty object"}.`);
  }
  if (required.some((key) => args[key] == null)) throw new ApiError(400, "INVALID_ARGUMENTS", `Required: ${required.join(", ")}.`);
  return args;
}

function requiredInteger(value, code, label, minimum = 0) {
  if (!Number.isInteger(value) || value < minimum) throw new ApiError(400, code, `${label} must be an integer >= ${minimum}.`);
  return value;
}

function requiredText(value, code, label, max = 200) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text.length > max) throw new ApiError(400, code, `${label} must contain 1 to ${max} characters.`);
  return text;
}

function writeEnabled() {
  if (process.env.MCP_BOOKING_WRITE_ENABLED !== "true") {
    throw new ApiError(503, "MCP_BOOKING_WRITE_DISABLED", "Role Booking MCP writes are disabled.");
  }
}

function publicAssignment(assignment, memberId = "") {
  return {
    assignmentId: assignment.id,
    role: assignment.role,
    status: assignment.status,
    bookable: Boolean(assignment.bookable),
    memberId: assignment.memberId || "",
    memberName: assignment.memberName || "",
    mine: assignment.memberId === memberId || Boolean(assignment.mine),
    speechDetails: assignment.speechDetails || null,
    externalPresentationUrl: assignment.externalPresentationUrl || "",
  };
}

function publicGoal(goal) {
  return { ...goal, goalHash: goalHash(goal) };
}

function publicGoalSummary(goal) {
  return {
    role: goal.role,
    targetCount: goal.targetCount,
    dueDate: goal.dueDate,
    completed: goal.completed,
    booked: goal.booked,
    status: goal.status,
  };
}

function meetingTimeHint(meeting) {
  return { date: meeting.date, startTime: meeting.startTime, message: "Review the meeting timeline for role conflicts." };
}

function speechInput(value = {}) {
  const mode = String(value.pathways_mode || "").trim();
  return {
    session: String(value.session || "").trim(),
    pathwaysMode: mode === "later" ? "" : mode,
    pathwaysPath: String(value.pathways_path || "").trim(),
    pathwaysProjectId: String(value.pathways_project_id || "").trim(),
    pathwaysFormId: String(value.pathways_form_id || "").trim(),
    speechObjective: String(value.speech_objective || "").trim(),
  };
}

function goalInput(value = {}) {
  return {
    ...(value.id ? { id: value.id } : {}),
    role: String(value.role || "").trim(),
    targetCount: Number(value.target_count),
    dueDate: String(value.due_date || "").trim(),
  };
}

function operationId(principal, tool, key) {
  return `booking_${hash({ principalId: principal.id, tool, key })}`;
}

function auditResult(audit, requestHash = "") {
  if (requestHash && audit.changes?.requestHash !== requestHash) {
    throw new ApiError(409, "IDEMPOTENCY_KEY_REUSED", "The idempotency key was already used with different arguments.", { operationId: audit.operationId });
  }
  if (audit.status === "succeeded" && audit.result) return audit.result;
  throw new ApiError(409, "WRITE_STATUS_UNCERTAIN", "A previous Booking operation with this identity did not finish cleanly. Inspect audit and current state before retrying.", { operationId: audit.operationId, status: audit.status });
}

function auditEntry({ operationId: id, requestHash, principal, meeting = null, action, member, targetType, targetId, before, after, warnings = [], urlCheck = [] }, now) {
  return {
    operationId: id,
    proposalHash: requestHash,
    principalId: principal.id,
    principalName: principal.name,
    meetingId: meeting?.id || "",
    meetingNumber: meeting?.meetingNumber || 0,
    beforeRevision: meeting?.revision || 0,
    operationTypes: [`booking:${action}`],
    changes: {
      requestHash,
      booking: true,
      action,
      targetMember: { memberId: member.id, displayName: member.displayName },
      targetType,
      targetId,
      before,
      after,
      warnings,
    },
    inverse: [],
    urlCheck,
    createdAt: new Date(now).toISOString(),
  };
}

async function finishAudit(deps, audit, result, now) {
  try {
    await deps.updateAgendaAudit(audit.recordId, {
      after_revision: result.afterRevision || 0,
      result_json: JSON.stringify(result),
      status: "succeeded",
      completed_at: new Date(now).toISOString(),
    });
  } catch {
    throw new ApiError(502, "WRITE_STATUS_UNCERTAIN", "Business state was written and verified, but audit completion failed.", { operationId: audit.operationId });
  }
}

async function failAudit(deps, audit, error, now) {
  await deps.updateAgendaAudit(audit.recordId, {
    status: "failed",
    error_code: error.code || "BOOKING_WRITE_FAILED",
    error_message: String(error.message || "Booking write failed.").slice(0, 500),
    completed_at: new Date(now).toISOString(),
  }).catch(() => {});
}

export function createBookingService(overrides = {}) {
  const deps = {
    listBookingMembers,
    getBookingDashboard,
    changeBooking,
    saveGoal,
    deleteGoal,
    listDetailedMeetings,
    getMeeting,
    getRoleCatalog,
    getPathwaysCatalog,
    checkExternalPublicUrl,
    findAgendaAudit,
    createAgendaAudit,
    updateAgendaAudit,
    now: () => Date.now(),
    ...overrides,
  };

  async function resolveMember(memberId, memberQuery) {
    const members = await deps.listBookingMembers();
    const id = memberId == null ? "" : requiredText(memberId, "INVALID_MEMBER_ID", "member_id", 120);
    const byId = id ? members.find((member) => member.id === id) : null;
    if (memberId && !byId) throw new ApiError(404, "MEMBER_NOT_FOUND", "Active non-Guest member was not found.");
    let byQuery = null;
    if (memberQuery != null) {
      const query = requiredText(memberQuery, "INVALID_MEMBER_QUERY", "member_query", 80).toLocaleLowerCase();
      const exact = members.filter((member) => member.displayName.toLocaleLowerCase() === query);
      const matches = exact.length ? exact : members.filter((member) => member.displayName.toLocaleLowerCase().includes(query));
      if (matches.length > 1) {
        throw new ApiError(409, "MEMBER_AMBIGUOUS", "Multiple active members match; choose one exact member_id.", {
          candidates: matches.slice(0, 10).map(({ id, displayName }) => ({ memberId: id, displayName })),
        });
      }
      if (!matches.length) throw new ApiError(404, "MEMBER_NOT_FOUND", "Active non-Guest member was not found.");
      [byQuery] = matches;
    }
    if (byId && byQuery && byId.id !== byQuery.id) throw new ApiError(400, "MEMBER_MISMATCH", "member_id and member_query resolve to different members.");
    return byId || byQuery;
  }

  async function memberState(memberId) {
    const member = await resolveMember(memberId);
    const dashboard = await deps.getBookingDashboard(member.id, new Date(deps.now()));
    return { member, dashboard };
  }

  async function meetingState(memberId, number) {
    const { member, dashboard } = await memberState(memberId);
    const meeting = dashboard.meetings.find((candidate) => candidate.meetingNumber === number);
    if (!meeting) throw new ApiError(404, "MEETING_NOT_FOUND", `Future Draft/Final meeting #${number} was not found.`);
    return { member, dashboard, meeting };
  }

  async function getContext(args) {
    const member = await resolveMember(args.member_id, args.member_query);
    if (args.meeting_number != null) requiredInteger(args.meeting_number, "INVALID_MEETING_NUMBER", "meeting_number", 1);
    if (args.include_all_goals != null && typeof args.include_all_goals !== "boolean") throw new ApiError(400, "INVALID_ARGUMENTS", "include_all_goals must be boolean.");
    const dashboard = await deps.getBookingDashboard(member.id, new Date(deps.now()));
    const data = {
      member: { memberId: member.id, displayName: member.displayName },
      reservations: dashboard.reservations.map(({ meetingId: _meetingId, ...reservation }) => reservation),
      goals: dashboard.goals.map(publicGoal),
      roleCatalog: dashboard.roleCatalog,
    };
    if (args.meeting_number != null) {
      const meeting = dashboard.meetings.find((candidate) => candidate.meetingNumber === args.meeting_number);
      if (!meeting) throw new ApiError(404, "MEETING_NOT_FOUND", `Future Draft/Final meeting #${args.meeting_number} was not found.`);
      data.meeting = {
        meetingNumber: meeting.meetingNumber,
        date: meeting.date,
        startTime: meeting.startTime,
        theme: meeting.theme,
        status: meeting.status,
        revision: meeting.revision,
        assignments: meeting.assignments.map((assignment) => publicAssignment(assignment, member.id)),
      };
    } else {
      data.meetings = dashboard.meetings.map(({ id: _id, assignments: _assignments, ...meeting }) => meeting);
    }
    if (args.include_all_goals === true) {
      data.everyoneGoals = dashboard.everyoneGoals.map(({ displayName, goals }) => ({
        displayName,
        goals: goals.map(publicGoalSummary),
      }));
    }
    return data;
  }

  async function searchPathways(args) {
    const catalog = publicPathwaysCatalog(await deps.getPathwaysCatalog());
    const query = String(args.query || "").trim().toLocaleLowerCase();
    const path = String(args.path || "").trim().toLocaleLowerCase();
    const limit = args.limit == null ? 10 : requiredInteger(args.limit, "INVALID_LIMIT", "limit", 1);
    if (limit > 20) throw new ApiError(400, "INVALID_LIMIT", "limit must be an integer from 1 to 20.");
    const matches = catalog.projects.filter((project) => {
      const names = [project.name, project.projectId, project.officialPurpose].join("\n").toLocaleLowerCase();
      const paths = [...project.requiredPaths, ...project.electivePaths];
      return (!query || names.includes(query))
        && (!path || paths.some((candidate) => candidate.toLocaleLowerCase() === path))
        && (!args.level || project.level === args.level);
    });
    const projects = matches.slice(0, limit).map((project) => ({
      projectId: project.projectId,
      name: project.name,
      level: project.level,
      requiredPaths: project.requiredPaths,
      electivePaths: project.electivePaths,
      officialPurpose: project.officialPurpose,
      sourceUrl: project.sourceUrl,
      standardDurationMinutes: null,
      evaluationForms: catalog.forms.filter((form) => form.projectId === project.projectId),
    }));
    return { projects, count: projects.length, hasMore: matches.length > projects.length };
  }

  async function checkedUrl(value, allowUnknown = false) {
    if (!value) return [];
    const formatError = externalPresentationUrlError(value);
    if (formatError) throw new ApiError(400, "INVALID_EXTERNAL_PRESENTATION_URL", formatError);
    const result = await deps.checkExternalPublicUrl(normalizeExternalPresentationUrl(value));
    if (["private", "unreachable"].includes(result.status)) {
      throw new ApiError(409, "INVALID_EXTERNAL_PRESENTATION_URL", result.reason, result);
    }
    if (result.status === "unknown" && !allowUnknown) {
      throw new ApiError(409, "EXTERNAL_URL_RISK_CONFIRMATION_REQUIRED", result.reason, result);
    }
    return [result];
  }

  async function bookRole(args, principal, baseUrl) {
    writeEnabled();
    const number = requiredInteger(args.meeting_number, "INVALID_MEETING_NUMBER", "meeting_number", 1);
    const revision = requiredInteger(args.expected_revision, "INVALID_REVISION", "expected_revision");
    const assignmentId = requiredText(args.assignment_id, "INVALID_ASSIGNMENT_ID", "assignment_id", 160);
    const key = requiredText(args.idempotency_key, "INVALID_IDEMPOTENCY_KEY", "idempotency_key", 200);
    if (key.length < 8) throw new ApiError(400, "INVALID_IDEMPOTENCY_KEY", "idempotency_key must contain at least 8 characters.");
    const request = canonical(args);
    const requestHash = hash(request);
    const id = operationId(principal, "book_role", key);
    const existing = await deps.findAgendaAudit(id);
    if (existing) return auditResult(existing, requestHash);
    const { member, meeting } = await meetingState(args.member_id, number);
    if (meeting.status !== "draft" || meeting.date <= shanghaiDate(new Date(deps.now()))) throw new ApiError(409, "MEETING_LOCKED", "Only a future Draft meeting can be booked.");
    if (Number(meeting.revision) !== revision) throw new ApiError(409, "REVISION_CONFLICT", "Meeting revision changed.", { currentRevision: meeting.revision });
    const assignment = meeting.assignments.find((candidate) => candidate.id === assignmentId);
    if (!assignment) throw new ApiError(404, "ASSIGNMENT_NOT_FOUND", "Assignment was not found in current meeting context.");
    if (assignment.status !== "vacant") throw new ApiError(409, "ROLE_TAKEN", "The assignment is no longer vacant.");
    const existingRoles = meeting.assignments.filter((candidate) => candidate.mine).map((candidate) => candidate.role);
    if (existingRoles.length && args.allow_multiple_roles !== true) {
      throw new ApiError(409, "MULTIPLE_ROLES_CONFIRMATION_REQUIRED", "The target member already has another role in this meeting.", {
        existingRoles,
        timeHint: meetingTimeHint(meeting),
      });
    }
    const speech = assignment.role === "Prepared Speaker" ? speechInput(args.speech_details) : undefined;
    if (args.speech_details && assignment.role !== "Prepared Speaker") throw new ApiError(400, "INVALID_SPEECH_DETAILS", "speech_details is allowed only for Prepared Speaker.");
    if (args.external_presentation_url && !["Prepared Speaker", "TTM"].includes(assignment.role)) {
      throw new ApiError(400, "INVALID_EXTERNAL_PRESENTATION_URL", "Only Prepared Speaker or TTM can maintain Presentation URL.");
    }
    const urlCheck = await checkedUrl(args.external_presentation_url, args.allow_external_url_risk === true);
    const after = { ...publicAssignment(assignment), status: "confirmed", bookable: false, memberId: member.id, memberName: member.displayName };
    const audit = await deps.createAgendaAudit(auditEntry({
      operationId: id,
      requestHash,
      principal,
      meeting,
      action: "book_role",
      member,
      targetType: "assignment",
      targetId: assignment.id,
      before: publicAssignment(assignment),
      after,
      warnings: existingRoles.length ? [{ code: "MULTIPLE_ROLES_CONFIRMED", existingRoles }] : [],
      urlCheck,
    }, deps.now()));
    try {
      await deps.changeBooking("book", {
        meetingId: meeting.id,
        expectedRevision: revision,
        assignmentId: assignment.id,
        memberId: member.id,
        speechDetails: speech,
        externalPresentationUrl: args.external_presentation_url || "",
      });
      const verifiedMeeting = await deps.getMeeting(meeting.id);
      const catalog = await deps.getRoleCatalog();
      const verified = bookingAssignments(verifiedMeeting, catalog).find((candidate) => candidate.id === assignment.id);
      if (!verified || verified.memberId !== member.id || Number(verifiedMeeting.revision) !== revision + 1) {
        throw new ApiError(502, "WRITE_VERIFICATION_FAILED", "Booking write could not be verified.");
      }
      const result = {
        operationId: id,
        meetingNumber: number,
        beforeRevision: revision,
        afterRevision: verifiedMeeting.revision,
        assignment: publicAssignment(verified, member.id),
        verified: true,
        reminder: assignment.role === "Prepared Speaker" ? "Complete speech title, Pathways or Custom objective, and booking goal when ready." : "",
        adminUrl: `${baseUrl}/?meeting=${encodeURIComponent(number)}&view=admin&task=mcp-changes`,
      };
      await finishAudit(deps, audit, result, deps.now());
      return result;
    } catch (error) {
      if (error.code !== "WRITE_STATUS_UNCERTAIN") await failAudit(deps, audit, error, deps.now());
      throw error;
    }
  }

  async function createGoal(args, principal) {
    writeEnabled();
    const key = requiredText(args.idempotency_key, "INVALID_IDEMPOTENCY_KEY", "idempotency_key", 200);
    if (key.length < 8) throw new ApiError(400, "INVALID_IDEMPOTENCY_KEY", "idempotency_key must contain at least 8 characters.");
    const requestHash = hash(canonical(args));
    const id = operationId(principal, "create_booking_goal", key);
    const existing = await deps.findAgendaAudit(id);
    if (existing) return auditResult(existing, requestHash);
    const { member } = await memberState(args.member_id);
    const goal = goalInput(args);
    const catalog = await deps.getRoleCatalog();
    goal.role = catalog.canonicalize(goal.role);
    if (!catalog.isPublic(goal.role)) throw new ApiError(400, "INVALID_GOAL_ROLE", "Role must come from public RoleCatalog.");
    const audit = await deps.createAgendaAudit(auditEntry({
      operationId: id,
      requestHash,
      principal,
      action: "create_booking_goal",
      member,
      targetType: "goal",
      targetId: "",
      before: null,
      after: goal,
    }, deps.now()));
    try {
      const created = await deps.saveGoal(member.id, goal, new Date(deps.now()));
      const verified = (await deps.getBookingDashboard(member.id, new Date(deps.now()))).goals.find((candidate) => candidate.id === created.id);
      if (!verified || goalHash(verified) !== goalHash(created)) throw new ApiError(502, "WRITE_VERIFICATION_FAILED", "Goal write could not be verified.");
      const result = { operationId: id, member: { memberId: member.id, displayName: member.displayName }, goal: publicGoal(verified), verified: true };
      await finishAudit(deps, audit, result, deps.now());
      return result;
    } catch (error) {
      if (error.code !== "WRITE_STATUS_UNCERTAIN") await failAudit(deps, audit, error, deps.now());
      throw error;
    }
  }

  async function prepareSpeech(value) {
    const raw = speechInput(value);
    if (raw.session.length > 200) throw new ApiError(400, "INVALID_SPEECH_DETAILS", "Speech title cannot exceed 200 characters.");
    const catalog = raw.pathwaysMode === "pathways" ? await deps.getPathwaysCatalog() : null;
    return { session: raw.session, ...resolveSpeechDetails(catalog, raw) };
  }

  async function propose(args, principal) {
    const action = String(args.action || "");
    if (!MEETING_ACTIONS.has(action) && !GOAL_ACTIONS.has(action)) throw new ApiError(400, "INVALID_ACTION", "Unsupported Booking proposal action.");
    const member = await resolveMember(args.member_id);
    let payload;
    if (MEETING_ACTIONS.has(action)) {
      const number = requiredInteger(args.meeting_number, "INVALID_MEETING_NUMBER", "meeting_number", 1);
      const revision = requiredInteger(args.expected_revision, "INVALID_REVISION", "expected_revision");
      const assignmentId = requiredText(args.assignment_id, "INVALID_ASSIGNMENT_ID", "assignment_id", 160);
      const state = await meetingState(member.id, number);
      const { meeting } = state;
      if (meeting.status !== "draft" || meeting.date <= shanghaiDate(new Date(deps.now()))) throw new ApiError(409, "MEETING_LOCKED", "Only a future Draft meeting can be changed.");
      if (Number(meeting.revision) !== revision) throw new ApiError(409, "REVISION_CONFLICT", "Meeting revision changed.", { currentRevision: meeting.revision });
      const assignment = meeting.assignments.find((candidate) => candidate.id === assignmentId);
      if (!assignment) throw new ApiError(404, "ASSIGNMENT_NOT_FOUND", "Assignment was not found in current meeting context.");
      if (!assignment.mine) throw new ApiError(403, "NOT_ROLE_OWNER", "The target member does not own this assignment.");
      const before = publicAssignment(assignment, member.id);
      const warnings = [];
      let after;
      let targetMember = null;
      let speechDetails;
      let externalPresentationUrl;
      let urlCheck = [];
      if (action === "cancel_booking") after = { ...before, status: "vacant", bookable: true, memberId: "", memberName: "" };
      if (action === "transfer_booking") {
        targetMember = await resolveMember(requiredText(args.target_member_id, "INVALID_TRANSFER_MEMBER", "target_member_id", 120));
        if (targetMember.id === member.id) throw new ApiError(400, "INVALID_TRANSFER_MEMBER", "Choose another member.");
        const targetState = await meetingState(targetMember.id, number);
        const existingRoles = targetState.meeting.assignments.filter((candidate) => candidate.mine).map((candidate) => candidate.role);
        if (existingRoles.length) warnings.push({
          code: "MULTIPLE_ROLES_CONFIRMED_ON_APPLY",
          existingRoles,
          timeHint: meetingTimeHint(targetState.meeting),
        });
        after = { ...before, memberId: targetMember.id, memberName: targetMember.displayName };
      }
      if (action === "update_speech_details") {
        if (assignment.role !== "Prepared Speaker") throw new ApiError(400, "INVALID_ACTION", "Only Prepared Speaker has speech details.");
        speechDetails = await prepareSpeech(args.speech_details || {});
        after = { ...before, speechDetails };
      }
      if (action === "update_presentation_url") {
        if (!["Prepared Speaker", "TTM"].includes(assignment.role)) throw new ApiError(400, "INVALID_ACTION", "Only Prepared Speaker or TTM can maintain Presentation URL.");
        externalPresentationUrl = normalizeExternalPresentationUrl(args.external_presentation_url);
        urlCheck = await checkedUrl(externalPresentationUrl, true);
        if (urlCheck[0]?.status === "unknown") warnings.push({ code: "EXTERNAL_URL_UNKNOWN", message: urlCheck[0].reason });
        after = { ...before, externalPresentationUrl };
      }
      payload = {
        operationId: crypto.randomUUID(),
        principalId: principal.id,
        principalName: principal.name,
        action,
        member,
        targetMember,
        meetingId: meeting.id,
        meetingNumber: number,
        expectedRevision: revision,
        assignmentId,
        beforeHash: hash(before),
        before,
        after,
        speechDetails,
        externalPresentationUrl,
        warnings,
        urlCheck,
      };
    } else {
      const { dashboard } = await memberState(member.id);
      const goalId = requiredText(args.goal_id, "INVALID_GOAL_ID", "goal_id", 160);
      const goal = dashboard.goals.find((candidate) => candidate.id === goalId);
      if (!goal) throw new ApiError(404, "GOAL_NOT_FOUND", "Goal was not found.");
      const expected = requiredText(args.expected_goal_hash, "INVALID_GOAL_HASH", "expected_goal_hash", 64);
      if (goalHash(goal) !== expected) throw new ApiError(409, "GOAL_CHANGED", "Goal changed after context was read.", { currentGoalHash: goalHash(goal) });
      let after = null;
      if (action === "update_goal") {
        after = { ...goal, ...goalInput(args.goal), id: goal.id, createdAt: goal.createdAt };
        const catalog = await deps.getRoleCatalog();
        after.role = catalog.canonicalize(after.role);
        if (!catalog.isPublic(after.role)) throw new ApiError(400, "INVALID_GOAL_ROLE", "Role must come from public RoleCatalog.");
        if (!Number.isInteger(after.targetCount) || after.targetCount < 1 || after.targetCount > 20 || !/^\d{4}-\d{2}-\d{2}$/.test(after.dueDate)) {
          throw new ApiError(400, "INVALID_GOAL", "Goal count or due date is invalid.");
        }
      }
      payload = {
        operationId: crypto.randomUUID(),
        principalId: principal.id,
        principalName: principal.name,
        action,
        member,
        goalId,
        expectedGoalHash: expected,
        before: publicGoal(goal),
        after: after ? publicGoal(after) : null,
        warnings: [],
        urlCheck: [],
      };
    }
    const proposalId = createBookingProposal(payload, deps.now());
    return {
      proposalId,
      operationId: payload.operationId,
      expiresAt: new Date(deps.now() + PROPOSAL_TTL_MS).toISOString(),
      principal: { id: principal.id, name: principal.name },
      targetMember: { memberId: member.id, displayName: member.displayName },
      action,
      meetingNumber: payload.meetingNumber || null,
      expectedRevision: payload.expectedRevision ?? null,
      assignmentId: payload.assignmentId || null,
      goalId: payload.goalId || null,
      expectedGoalHash: payload.expectedGoalHash || null,
      diff: [{ action, before: payload.before, after: payload.after }],
      warnings: payload.warnings,
      confirmationRequired: true,
    };
  }

  async function apply(proposalId, principal, baseUrl) {
    writeEnabled();
    const payload = verifyBookingProposal(proposalId, deps.now());
    if (payload.principalId !== principal.id) throw new ApiError(403, "PROPOSAL_PRINCIPAL_MISMATCH", "Booking proposal belongs to another MCP principal.");
    const existing = await deps.findAgendaAudit(payload.operationId);
    if (existing) return auditResult(existing);
    let meeting = null;
    let current;
    if (MEETING_ACTIONS.has(payload.action)) {
      await resolveMember(payload.member.id);
      if (payload.targetMember) await resolveMember(payload.targetMember.id);
      meeting = await deps.getMeeting(payload.meetingId);
      if (meeting.status !== "draft" || meeting.date <= shanghaiDate(new Date(deps.now()))) throw new ApiError(409, "MEETING_LOCKED", "Only a future Draft meeting can be changed.");
      if (Number(meeting.revision) !== payload.expectedRevision) throw new ApiError(409, "REVISION_CONFLICT", "Meeting revision changed.", { currentRevision: meeting.revision });
      const catalog = await deps.getRoleCatalog();
      current = bookingAssignments(meeting, catalog).find((candidate) => candidate.id === payload.assignmentId);
      if (!current) throw new ApiError(404, "ASSIGNMENT_NOT_FOUND", "Assignment no longer exists.");
      if (hash(publicAssignment(current, payload.member.id)) !== payload.beforeHash) throw new ApiError(409, "PROPOSAL_STALE", "Assignment changed after proposal.");
      if (payload.action === "update_speech_details" && payload.speechDetails?.pathwaysMode === "pathways") {
        const validated = { session: payload.speechDetails.session, ...resolveSpeechDetails(await deps.getPathwaysCatalog(), payload.speechDetails) };
        if (hash(validated) !== hash(payload.speechDetails)) throw new ApiError(409, "PROPOSAL_STALE", "Pathways project changed after proposal.");
      }
      if (payload.urlCheck?.length) await checkedUrl(payload.externalPresentationUrl, true);
    } else {
      const dashboard = await deps.getBookingDashboard(payload.member.id, new Date(deps.now()));
      current = dashboard.goals.find((goal) => goal.id === payload.goalId);
      if (!current) throw new ApiError(404, "GOAL_NOT_FOUND", "Goal no longer exists.");
      if (goalHash(current) !== payload.expectedGoalHash) throw new ApiError(409, "GOAL_CHANGED", "Goal changed after proposal.");
    }
    const requestHash = hash(proposalId);
    const audit = await deps.createAgendaAudit(auditEntry({
      operationId: payload.operationId,
      requestHash,
      principal,
      meeting,
      action: payload.action,
      member: payload.member,
      targetType: MEETING_ACTIONS.has(payload.action) ? "assignment" : "goal",
      targetId: payload.assignmentId || payload.goalId,
      before: payload.before,
      after: payload.after,
      warnings: payload.warnings,
      urlCheck: payload.urlCheck,
    }, deps.now()));
    try {
      let result;
      if (MEETING_ACTIONS.has(payload.action)) {
        const action = {
          cancel_booking: "cancel",
          transfer_booking: "transfer",
          update_speech_details: "update-speech",
          update_presentation_url: "update-presentation-url",
        }[payload.action];
        await deps.changeBooking(action, {
          meetingId: payload.meetingId,
          expectedRevision: payload.expectedRevision,
          assignmentId: payload.assignmentId,
          memberId: payload.member.id,
          targetMemberId: payload.targetMember?.id,
          speechDetails: payload.speechDetails,
          externalPresentationUrl: payload.externalPresentationUrl,
        });
        const verifiedMeeting = await deps.getMeeting(payload.meetingId);
        const catalog = await deps.getRoleCatalog();
        const verified = bookingAssignments(verifiedMeeting, catalog).find((candidate) => candidate.id === payload.assignmentId);
        const expectedMemberId = payload.action === "cancel_booking" ? "" : payload.action === "transfer_booking" ? payload.targetMember.id : payload.member.id;
        if (!verified || verified.memberId !== expectedMemberId || Number(verifiedMeeting.revision) !== payload.expectedRevision + 1) {
          throw new ApiError(502, "WRITE_VERIFICATION_FAILED", "Booking change could not be verified.");
        }
        result = {
          operationId: payload.operationId,
          meetingNumber: payload.meetingNumber,
          beforeRevision: payload.expectedRevision,
          afterRevision: verifiedMeeting.revision,
          assignment: publicAssignment(verified, expectedMemberId),
          verified: true,
          adminUrl: `${baseUrl}/?meeting=${encodeURIComponent(payload.meetingNumber)}&view=admin&task=mcp-changes`,
        };
      } else if (payload.action === "update_goal") {
        const saved = await deps.saveGoal(payload.member.id, {
          id: payload.goalId,
          role: payload.after.role,
          targetCount: payload.after.targetCount,
          dueDate: payload.after.dueDate,
        }, new Date(deps.now()));
        const verified = (await deps.getBookingDashboard(payload.member.id, new Date(deps.now()))).goals.find((goal) => goal.id === payload.goalId);
        if (!verified || goalHash(verified) !== goalHash(saved)) throw new ApiError(502, "WRITE_VERIFICATION_FAILED", "Goal update could not be verified.");
        result = { operationId: payload.operationId, goal: publicGoal(verified), verified: true };
      } else {
        const deleted = await deps.deleteGoal(payload.member.id, payload.goalId);
        const remains = (await deps.getBookingDashboard(payload.member.id, new Date(deps.now()))).goals.some((goal) => goal.id === payload.goalId);
        if (remains) throw new ApiError(502, "WRITE_VERIFICATION_FAILED", "Goal deletion could not be verified.");
        result = { operationId: payload.operationId, deletedGoal: publicGoal(deleted), verified: true };
      }
      await finishAudit(deps, audit, result, deps.now());
      return result;
    } catch (error) {
      if (error.code !== "WRITE_STATUS_UNCERTAIN") await failAudit(deps, audit, error, deps.now());
      throw error;
    }
  }

  return { getContext, searchPathways, bookRole, createGoal, propose, apply };
}

const bookingService = createBookingService();

export async function callBookingTool(name, rawArguments, principal, baseUrl) {
  if (!TOOL_NAMES.has(name)) return null;
  if (name === "get_role_booking_context") {
    const args = objectArgs(rawArguments, ["member_query", "member_id", "meeting_number", "include_all_goals"]);
    if (!args.member_query && !args.member_id) throw new ApiError(400, "INVALID_ARGUMENTS", "Required: member_query or member_id.");
    const data = await bookingService.getContext(args);
    return { data, message: data.meeting ? `#${data.meeting.meetingNumber} Role Booking context · revision ${data.meeting.revision}。` : `找到 ${data.meetings.length} 场未来会议。写入前明确选择 meeting_number。` };
  }
  if (name === "search_pathways_projects") {
    const args = objectArgs(rawArguments, ["query", "path", "level", "limit"]);
    const data = await bookingService.searchPathways(args);
    return { data, message: `找到 ${data.count} 个 active Pathways projects。` };
  }
  if (name === "book_role") {
    const args = objectArgs(rawArguments, ["meeting_number", "expected_revision", "assignment_id", "member_id", "idempotency_key", "allow_multiple_roles", "speech_details", "external_presentation_url", "allow_external_url_risk"], ["meeting_number", "expected_revision", "assignment_id", "member_id", "idempotency_key"]);
    const data = await bookingService.bookRole(args, principal, baseUrl);
    return { data, message: `#${data.meetingNumber} 已预约并回读验证。revision ${data.beforeRevision} → ${data.afterRevision}。` };
  }
  if (name === "create_booking_goal") {
    const args = objectArgs(rawArguments, ["member_id", "role", "target_count", "due_date", "idempotency_key"], ["member_id", "role", "target_count", "due_date", "idempotency_key"]);
    const data = await bookingService.createGoal(args, principal);
    return { data, message: `${data.member.displayName} 的 ${data.goal.role} 目标已新建并回读验证。` };
  }
  if (name === "propose_role_booking_change") {
    const args = objectArgs(rawArguments, ["action", "meeting_number", "expected_revision", "assignment_id", "member_id", "target_member_id", "goal_id", "expected_goal_hash", "goal", "speech_details", "external_presentation_url"], ["action", "member_id"]);
    const data = await bookingService.propose(args, principal);
    return { data, message: `Role Booking ${data.action} proposal 已生成。请展示完整 diff；明确确认后才调用 apply_role_booking_change。` };
  }
  const args = objectArgs(rawArguments, ["proposal_id"], ["proposal_id"]);
  const data = await bookingService.apply(args.proposal_id, principal, baseUrl);
  return { data, message: data.meetingNumber ? `#${data.meetingNumber} Role Booking 修改已回读验证。revision ${data.beforeRevision} → ${data.afterRevision}。` : "Role Booking 目标修改已回读验证。" };
}

export { bookingService };

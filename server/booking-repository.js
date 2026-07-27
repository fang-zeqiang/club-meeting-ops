import crypto from "node:crypto";
import {
  ApiError,
  createBitableField,
  getBitableConfig,
  listBitableFields,
  listRecords,
  updateRecord,
} from "./bitable.js";
import { asText } from "./meeting-schema.js";
import { getMeeting, listDetailedMeetings, updateMeeting } from "./meetings-repository.js";
import { getPathwaysCatalog, resolveSpeechDetails } from "./pathways-repository.js";
import { getRoleCatalog } from "./roles-repository.js";

const GOALS_FIELD = "booking_goals_json";
const SHANGHAI_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function shanghaiDate(now = new Date()) {
  return SHANGHAI_DATE.format(now);
}

export function canonicalBookingRole(item, catalog) {
  if (item.kind === "speech") return "Prepared Speaker";
  return catalog.canonicalize(item.role);
}

function parseJson(value, fallback = []) {
  try {
    const parsed = JSON.parse(asText(value) || "");
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export function nextPathwayDefaults(enrolled, value) {
  if (!enrolled) return [];
  return asText(value).split("/").map((part) => /^([A-Z]{2})([1-5])$/.exec(part.trim().toUpperCase()))
    .filter((match) => match && match[2] !== "5")
    .map((match) => ({ code: match[1], level: String(Number(match[2]) + 1) }))
    .sort((a, b) => Number(a.level) - Number(b.level));
}

function storedGoals(value, catalog) {
  return parseJson(value).map((goal) => ({ ...goal, role: catalog.canonicalize(goal?.role) })).filter((goal) => goal
    && typeof goal === "object"
    && goal.id
    && catalog.isPublic(goal.role)
    && Number.isInteger(Number(goal.targetCount))
    && /^\d{4}-\d{2}-\d{2}$/.test(String(goal.dueDate || ""))
    && !Number.isNaN(Date.parse(goal.createdAt)));
}

function memberFromRecord(record, catalog) {
  return {
    id: asText(record.fields.member_id),
    displayName: asText(record.fields.display_name),
    memberType: asText(record.fields.member_type) || "member",
    active: record.fields.active !== false,
    pathwayDefaults: nextPathwayDefaults(Boolean(record.fields.pathways_enrolled), record.fields.pathways_level),
    recordId: record.record_id,
    goals: storedGoals(record.fields[GOALS_FIELD], catalog),
  };
}

function publicMember(member) {
  return { id: member.id, displayName: member.displayName };
}

function currentMemberForClient(member) {
  return { ...publicMember(member), pathwayDefaults: member.pathwayDefaults };
}

function isBookingMember(member) {
  return member.active && member.id && member.displayName && !member.memberType.toLocaleLowerCase().includes("guest");
}

async function bookingContext() {
  const { membersTableId } = getBitableConfig();
  const [catalog, records] = await Promise.all([getRoleCatalog(), listRecords(membersTableId)]);
  const members = records
    .map((record) => memberFromRecord(record, catalog))
    .filter(isBookingMember)
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
  return { catalog, members };
}

export async function listBookingMembers() {
  return (await bookingContext()).members.map(publicMember);
}

function memberMatches(assignment, member) {
  if (assignment.memberId) return assignment.memberId === member.id;
  const clean = (value) => String(value || "").split(",")[0].trim().toLocaleLowerCase();
  return clean(assignment.memberName) === clean(member.displayName);
}

export function bookingAssignments(meeting, catalog) {
  const items = meeting.blocks.flatMap((block) => block.items || []);
  const speeches = new Map(items.filter((item) => item.kind === "speech").map((item) => [item.id, item]));
  const groups = new Map();

  for (const item of items) {
    const role = canonicalBookingRole(item, catalog);
    if (item.kind === "break" || !catalog.isPublic(role)) continue;
    const id = item.roleAssignmentId ? `role:${item.roleAssignmentId}` : `item:${item.id}`;
    const group = groups.get(id) || { id, role, itemIds: [], items: [], linkedSpeechId: item.linkedSpeechId || "" };
    group.itemIds.push(item.id);
    group.items.push(item);
    if (item.linkedSpeechId) group.linkedSpeechId = item.linkedSpeechId;
    groups.set(id, group);
  }

  const assignments = [...groups.values()].map((group) => {
    const assigned = group.items.find((item) => item.memberId || item.member) || group.items[0];
    const speaker = group.linkedSpeechId ? speeches.get(group.linkedSpeechId) : null;
    return {
      id: group.id,
      role: group.role,
      memberId: assigned?.memberId || "",
      memberName: assigned?.member || "",
      status: assigned?.memberId || assigned?.member ? "confirmed" : "vacant",
      itemIds: group.itemIds,
      linkedSpeechId: group.linkedSpeechId,
      speechPairId: group.role === "Prepared Speaker" ? group.itemIds[0] : group.linkedSpeechId || "",
      speakerName: speaker?.member || "",
      speechDetails: group.role === "Prepared Speaker" ? speechDetailsForItem(assigned) : null,
    };
  });

  if (catalog.isPublic("Photographer")) assignments.push({
      id: "meeting:photographer",
      role: "Photographer",
      memberId: meeting.photographerMemberId || "",
      memberName: meeting.photographer || "",
      status: meeting.photographerMemberId || meeting.photographer ? "confirmed" : "vacant",
      itemIds: [],
      linkedSpeechId: "",
      speakerName: "",
      speechDetails: null,
    });
  if (catalog.isPublic("Meeting Manager")) assignments.push({
      id: "meeting:manager",
      role: "Meeting Manager",
      memberId: meeting.meetingManagerMemberId || "",
      memberName: meeting.meetingManager || "",
      status: meeting.meetingManagerMemberId || meeting.meetingManager ? "confirmed" : "vacant",
      itemIds: [],
      linkedSpeechId: "",
      speakerName: "",
      speechDetails: null,
    });

  return assignments;
}

export function goalProgress(goal, member, meetings, today = shanghaiDate(), catalog) {
  let completed = 0;
  let booked = 0;
  const createdDate = shanghaiDate(new Date(goal.createdAt));

  for (const meeting of meetings) {
    for (const assignment of bookingAssignments(meeting, catalog)) {
      if (assignment.role !== goal.role || !memberMatches(assignment, member)) continue;
      if (meeting.status === "archived" && meeting.date >= createdDate && meeting.date <= goal.dueDate) completed += 1;
      if (["draft", "final"].includes(meeting.status) && meeting.date > today && meeting.date <= goal.dueDate) booked += 1;
    }
  }

  const targetCount = Number(goal.targetCount);
  const status = completed >= targetCount ? "completed" : goal.dueDate < today ? "missed" : "active";
  return { completed, booked, targetCount, status };
}

function publicGoal(goal, member, meetings, today, catalog) {
  return { ...goal, ...goalProgress(goal, member, meetings, today, catalog) };
}

function assignmentForClient(assignment, meeting, member, goalRoles) {
  return {
    id: assignment.id,
    role: assignment.role,
    memberId: assignment.memberId,
    memberName: assignment.memberName,
    status: assignment.status,
    mine: memberMatches(assignment, member),
    bookable: meeting.status === "draft" && assignment.status === "vacant",
    matchesGoal: goalRoles.has(assignment.role),
    speechPairId: assignment.speechPairId,
    speakerName: assignment.speakerName,
    speechDetails: assignment.speechDetails,
  };
}

export async function getBookingDashboard(memberId, now = new Date()) {
  const [{ catalog, members }, meetings] = await Promise.all([bookingContext(), listDetailedMeetings()]);
  const member = members.find((candidate) => candidate.id === memberId);
  if (!member) throw new ApiError(404, "MEMBER_NOT_FOUND", "请选择有效会员。");
  const today = shanghaiDate(now);
  const goals = member.goals.map((goal) => publicGoal(goal, member, meetings, today, catalog));
  const goalRoles = new Set(goals.filter((goal) => goal.status === "active").map((goal) => goal.role));
  const futureMeetings = meetings
    .filter((meeting) => meeting.date > today && ["draft", "final"].includes(meeting.status))
    .sort((a, b) => a.date.localeCompare(b.date) || a.meetingNumber - b.meetingNumber)
    .map((meeting) => ({
      id: meeting.id,
      meetingNumber: meeting.meetingNumber,
      date: meeting.date,
      startTime: meeting.startTime,
      theme: meeting.theme,
      status: meeting.status,
      revision: meeting.revision,
      assignments: bookingAssignments(meeting, catalog).map((assignment) => assignmentForClient(assignment, meeting, member, goalRoles)),
    }));
  const reservations = futureMeetings.flatMap((meeting) => meeting.assignments
    .filter((assignment) => assignment.mine)
    .map((assignment) => ({ meetingId: meeting.id, meetingNumber: meeting.meetingNumber, date: meeting.date, theme: meeting.theme, role: assignment.role, assignmentId: assignment.id })));

  return {
    currentMember: currentMemberForClient(member),
    members: members.map(publicMember),
    goalRoles: catalog.bookingRoles.map((role) => role.name),
    roleCatalog: catalog.bookingRoles.map(({ name, description, roleUrl, sopUrl, group, advanced, sortOrder }) => ({ name, description, roleUrl, sopUrl, group, advanced, sortOrder })),
    goals,
    reservations,
    everyoneGoals: members.map((candidate) => ({
      ...publicMember(candidate),
      goals: candidate.goals.map((goal) => publicGoal(goal, candidate, meetings, today, catalog)),
    })).filter((candidate) => candidate.goals.length),
    meetings: futureMeetings,
  };
}

function normalizedGoal(input, existing, catalog, now = new Date()) {
  const role = catalog.canonicalize(input?.role);
  const targetCount = Number(input?.targetCount);
  const dueDate = String(input?.dueDate || "").trim();
  if (!catalog.isPublic(role)) throw new ApiError(400, "INVALID_GOAL_ROLE", "请选择可预约角色。");
  if (!Number.isInteger(targetCount) || targetCount < 1 || targetCount > 20) throw new ApiError(400, "INVALID_GOAL_COUNT", "目标次数应为 1 到 20。");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) throw new ApiError(400, "INVALID_GOAL_DATE", "请选择有效截止日期。");
  if (!existing && dueDate < shanghaiDate(now)) throw new ApiError(400, "INVALID_GOAL_DATE", "截止日期不能早于今天。");
  return {
    id: existing?.id || crypto.randomUUID(),
    role,
    targetCount,
    dueDate,
    createdAt: existing?.createdAt || now.toISOString(),
  };
}

async function ensureGoalsField() {
  const config = getBitableConfig();
  const fields = await listBitableFields(config.appToken, config.membersTableId);
  if (!fields.some((field) => (field.field_name || field.name) === GOALS_FIELD)) {
    await createBitableField(config.appToken, config.membersTableId, { field_name: GOALS_FIELD, type: 1 });
  }
  return config.membersTableId;
}

async function saveMemberGoals(member, goals) {
  const tableId = await ensureGoalsField();
  await updateRecord(tableId, member.recordId, { [GOALS_FIELD]: JSON.stringify(goals) }, { entity: "booking-goals", memberId: member.id });
}

export async function saveGoal(memberId, input, now = new Date()) {
  const [{ catalog, members }, meetings] = await Promise.all([bookingContext(), listDetailedMeetings()]);
  const member = members.find((candidate) => candidate.id === memberId);
  if (!member) throw new ApiError(404, "MEMBER_NOT_FOUND", "请选择有效会员。");
  const existing = input?.id ? member.goals.find((goal) => goal.id === input.id) : null;
  if (input?.id && !existing) throw new ApiError(404, "GOAL_NOT_FOUND", "目标不存在。");
  const goal = normalizedGoal(input, existing, catalog, now);
  const duplicate = member.goals.find((candidate) => candidate.id !== goal.id
    && candidate.role === goal.role
    && goalProgress(candidate, member, meetings, shanghaiDate(now), catalog).status === "active");
  if (duplicate) throw new ApiError(409, "GOAL_EXISTS", "该角色已有进行中目标，请编辑原目标。");
  const goals = existing ? member.goals.map((candidate) => candidate.id === goal.id ? goal : candidate) : [...member.goals, goal];
  await saveMemberGoals(member, goals);
  return goal;
}

export async function deleteGoal(memberId, goalId) {
  const { members } = await bookingContext();
  const member = members.find((candidate) => candidate.id === memberId);
  if (!member) throw new ApiError(404, "MEMBER_NOT_FOUND", "请选择有效会员。");
  const deleted = member.goals.find((goal) => goal.id === goalId);
  if (!deleted) throw new ApiError(404, "GOAL_NOT_FOUND", "目标不存在。");
  await saveMemberGoals(member, member.goals.filter((goal) => goal.id !== goalId));
  return deleted;
}

export async function restoreGoal(memberId, input, now = new Date()) {
  const [{ catalog, members }, meetings] = await Promise.all([bookingContext(), listDetailedMeetings()]);
  const member = members.find((candidate) => candidate.id === memberId);
  if (!member) throw new ApiError(404, "MEMBER_NOT_FOUND", "请选择有效会员。");
  if (member.goals.some((goal) => goal.id === input?.id)) return input;
  const goal = normalizedGoal(input, { id: input?.id || crypto.randomUUID(), createdAt: input?.createdAt || now.toISOString() }, catalog, now);
  const duplicate = member.goals.find((candidate) => candidate.role === goal.role
    && goalProgress(candidate, member, meetings, shanghaiDate(now), catalog).status === "active");
  if (duplicate) throw new ApiError(409, "GOAL_EXISTS", "该角色已有进行中目标，无法恢复。");
  await saveMemberGoals(member, [...member.goals, goal]);
  return goal;
}

export function parseSpeechDetails(value = "") {
  const result = { pathwaysProject: "", pathwaysLevel: "", speechObjective: "" };
  const raw = String(value || "");
  const tagged = raw.match(/^\[(Pathways Project|Pathways Level|Speech Objective)\]\s*(.*)$/gm) || [];
  if (!tagged.length) return { ...result, speechObjective: raw };
  tagged.forEach((line) => {
    const match = line.match(/^\[(Pathways Project|Pathways Level|Speech Objective)\]\s*(.*)$/);
    if (match?.[1] === "Pathways Project") result.pathwaysProject = match[2];
    if (match?.[1] === "Pathways Level") result.pathwaysLevel = match[2];
    if (match?.[1] === "Speech Objective") result.speechObjective = match[2];
  });
  return result;
}

function speechDetailsForItem(item = {}) {
  if (item.pathwaysMode || item.pathwaysPath || item.pathwaysProjectId || item.pathwaysFormId) {
    return {
      session: item.session || "",
      pathwaysMode: item.pathwaysMode || "",
      pathwaysPath: item.pathwaysPath || "",
      pathwaysLevel: item.pathwaysLevel || "",
      pathwaysProjectId: item.pathwaysProjectId || "",
      pathwaysFormId: item.pathwaysFormId || "",
      speechObjective: item.speechObjective || "",
    };
  }
  const legacy = parseSpeechDetails(item.speechObjective);
  const tagged = /^\[(Pathways Project|Pathways Level|Speech Objective)\]/m.test(String(item.speechObjective || ""));
  return {
    session: item.session || "",
    pathwaysMode: tagged ? "legacy" : legacy.speechObjective ? "custom" : "",
    pathwaysPath: "",
    pathwaysLevel: legacy.pathwaysLevel,
    pathwaysProjectId: "",
    pathwaysFormId: "",
    speechObjective: legacy.speechObjective,
    legacyProject: legacy.pathwaysProject,
  };
}

export function applyBookingAssignment(meeting, assignment, member, speechDetails, action = "") {
  const clearSpeech = ["cancel", "transfer"].includes(action);
  if (assignment.id === "meeting:photographer") {
    meeting.photographerMemberId = member?.id || "";
    meeting.photographer = member?.displayName || "";
    return;
  }
  if (assignment.id === "meeting:manager") {
    meeting.meetingManagerMemberId = member?.id || "";
    meeting.meetingManager = member?.displayName || "";
    return;
  }

  const itemIds = new Set(assignment.itemIds);
  const items = meeting.blocks.flatMap((block) => block.items || []);
  items.filter((item) => itemIds.has(item.id)).forEach((item) => {
    item.memberId = member?.id || "";
    item.member = member?.displayName || "";
    item.status = member ? "confirmed" : "vacant";
    if (assignment.role === "Prepared Speaker" && (speechDetails || clearSpeech)) Object.assign(item, clearSpeech ? {
      session: "",
      pathwaysMode: "",
      pathwaysPath: "",
      pathwaysLevel: "",
      pathwaysProjectId: "",
      pathwaysFormId: "",
      speechObjective: "",
    } : speechDetails);
  });
  if (assignment.linkedSpeechId) {
    const speech = items.find((item) => item.id === assignment.linkedSpeechId);
    if (speech) {
      speech.evaluatorId = member?.id || "";
      speech.evaluator = member?.displayName || "";
      speech.evaluatorStatus = member ? "confirmed" : "vacant";
    }
  }
}

export async function changeBooking(action, input) {
  const { catalog, members } = await bookingContext();
  const actor = members.find((member) => member.id === input?.memberId);
  if (!actor) throw new ApiError(404, "MEMBER_NOT_FOUND", "请选择有效会员。");
  const meeting = await getMeeting(String(input?.meetingId || ""));
  if (meeting.status !== "draft" || meeting.date <= shanghaiDate()) throw new ApiError(409, "MEETING_LOCKED", "该会议已锁定，不能调整角色。");
  const assignment = bookingAssignments(meeting, catalog).find((candidate) => candidate.id === input?.assignmentId);
  if (!assignment) throw new ApiError(404, "ASSIGNMENT_NOT_FOUND", "角色不存在。");
  let target = actor;
  if (action === "book") {
    if (assignment.status !== "vacant") throw new ApiError(409, "ROLE_TAKEN", "角色刚刚被预约。");
  } else {
    if (!memberMatches(assignment, actor)) throw new ApiError(403, "NOT_ROLE_OWNER", "只能调整自己的预约。");
    if (action === "cancel") target = null;
    if (action === "transfer") {
      target = members.find((member) => member.id === input?.targetMemberId);
      if (!target || target.id === actor.id) throw new ApiError(400, "INVALID_TRANSFER_MEMBER", "请选择其他会员。");
    }
    if (action === "update-speech" && assignment.role !== "Prepared Speaker") throw new ApiError(400, "INVALID_ACTION", "该角色没有演讲信息。");
  }

  const next = structuredClone(meeting);
  let speechDetails;
  if (assignment.role === "Prepared Speaker" && ["book", "update-speech"].includes(action)) {
    const raw = input?.speechDetails || {};
    const pathwaysCatalog = raw.pathwaysMode === "pathways" ? await getPathwaysCatalog() : null;
    const session = String(raw.session || "").trim();
    if (session.length > 200) throw new ApiError(400, "INVALID_SPEECH_DETAILS", "演讲标题不能超过 200 个字符。");
    speechDetails = { session, ...resolveSpeechDetails(pathwaysCatalog, raw) };
  }
  applyBookingAssignment(next, assignment, target, speechDetails, action);
  try {
    return await updateMeeting(meeting.id, next, meeting.revision);
  } catch (error) {
    if (error.code !== "REVISION_CONFLICT") throw error;
    const current = await getMeeting(meeting.id);
    if (current.status !== "draft" || current.date <= shanghaiDate()) throw new ApiError(409, "MEETING_LOCKED", "该会议已锁定，不能调整角色。");
    const currentAssignment = bookingAssignments(current, catalog).find((candidate) => candidate.id === input?.assignmentId);
    if (action === "book" && currentAssignment?.status !== "vacant") throw new ApiError(409, "ROLE_TAKEN", "角色刚刚被预约。");
    throw error;
  }
}

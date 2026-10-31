import assert from "node:assert/strict";
import test from "node:test";

import { applyBookingAssignment, bookingAssignments } from "../server/booking-repository.js";
import {
  BOOKING_TOOLS,
  createBookingProposal,
  createBookingService,
  goalHash,
  verifyBookingProposal,
} from "../server/mcp-booking.js";
import { pathwaysCatalogFromRecords } from "../server/pathways-repository.js";
import { roleCatalogFromRecords } from "../server/roles-repository.js";

const NOW = Date.parse("2026-07-31T04:00:00Z");
const PRINCIPAL = { id: "officer-1", name: "VPE Officer" };
const CATALOG = roleCatalogFromRecords(["Timer", "TTM", "Prepared Speaker", "Individual Evaluator"].map((role_name, index) => ({
  record_id: role_name,
  fields: { role_name, booking_public: true, active: true, sort_order: index },
})));
const SOP_CATALOG = roleCatalogFromRecords([{
  record_id: "timer",
  fields: {
    role_name: "Timer",
    aliases: "计时员",
    description: "Track meeting time.",
    sop_url: { link: "https://example.feishu.cn/docx/timer-sop" },
    booking_public: true,
    active: true,
    sort_order: 1,
  },
}, {
  record_id: "ttm",
  fields: { role_name: "TTM", booking_public: true, active: true, sort_order: 2 },
}, {
  record_id: "private",
  fields: {
    role_name: "Private Role",
    sop_url: { link: "https://example.feishu.cn/docx/private-sop" },
    booking_public: false,
    active: true,
    sort_order: 3,
  },
}]);
const PATHWAYS = pathwaysCatalogFromRecords([{
  record_id: "project-record",
  fields: {
    project_id: "active-listening",
    name: "Active Listening",
    level: "3",
    elective_paths: ["Presentation Mastery"],
    official_purpose: "Practice active listening.",
    source_url: "https://example.com/pathways",
    active: true,
  },
}, {
  record_id: "second-project-record",
  fields: {
    project_id: "storytelling",
    name: "Storytelling",
    level: "3",
    elective_paths: ["Presentation Mastery"],
    official_purpose: "Tell better stories.",
    source_url: "https://example.com/pathways",
    active: true,
  },
}, {
  record_id: "inactive-project-record",
  fields: {
    project_id: "inactive-project",
    name: "Inactive Project",
    level: "2",
    elective_paths: ["Presentation Mastery"],
    official_purpose: "Old.",
    source_url: "https://example.com/pathways",
    active: false,
  },
}], [{
  record_id: "form-record",
  fields: {
    form_id: "active-listening-default",
    project: [{ id: "project-record" }],
    variant: "Default",
    speech_purpose: "Practice active listening.",
    official_resource_url: "https://example.com/resources",
    pdf_url: "https://example.com/form.pdf",
    active: true,
  },
}]);

function sourceMeeting() {
  return {
    id: "meeting-108",
    meetingNumber: 108,
    date: "2026-08-25",
    startTime: "19:00",
    theme: "Test",
    status: "draft",
    revision: 12,
    photographerMemberId: "",
    photographer: "",
    meetingManagerMemberId: "",
    meetingManager: "",
    blocks: [{
      id: "functions",
      type: "opening",
      items: [
        { id: "timer", kind: "role", role: "Timer", roleAssignmentId: "functional-timer", memberId: "", member: "", status: "vacant" },
        { id: "ttm", kind: "role", role: "TTM", memberId: "alice", member: "Alice", status: "confirmed", externalPresentationUrl: "" },
        { id: "speaker", kind: "speech", role: "Prepared Speaker 1", memberId: "", member: "", status: "vacant" },
        { id: "evaluator", kind: "role", session: "Speech Evaluation 1", role: "Individual Evaluator", memberId: "", member: "", status: "vacant", linkedSpeechId: "speaker" },
        { id: "evaluator-2", kind: "role", session: "Speech Evaluation 2", role: "Individual Evaluator", memberId: "", member: "", status: "vacant" },
      ],
    }],
  };
}

function fixture({ auditFails = false, auditCompletionFails = false, verificationFails = false, urlStatus = "public", historyMeetings = [], historyReservations = [] } = {}) {
  const members = [
    { id: "alice", displayName: "Alice" },
    { id: "bob", displayName: "Bob" },
    { id: "amy-1", displayName: "Amy Chen" },
    { id: "amy-2", displayName: "Amy Zhang" },
  ];
  const disabledMemberIds = new Set();
  let pathwaysActive = true;
  let meeting = sourceMeeting();
  const goals = new Map(members.map(({ id }) => [id, []]));
  const audits = new Map();
  let goalSequence = 0;

  function dashboard(memberId) {
    const member = members.find(({ id }) => id === memberId);
    if (!member) throw Object.assign(new Error("missing"), { code: "MEMBER_NOT_FOUND" });
    const assignments = bookingAssignments(meeting, CATALOG).map((assignment) => ({
      ...assignment,
      mine: assignment.memberId === memberId,
      bookable: meeting.status === "draft" && assignment.status === "vacant",
      matchesGoal: false,
    }));
    return {
      currentMember: member,
      members,
      goalRoles: CATALOG.bookingRoles.map(({ name }) => name),
      roleCatalog: CATALOG.bookingRoles.map(({ name }) => ({ name })),
      goals: structuredClone(goals.get(memberId)),
      reservations: assignments.filter(({ mine }) => mine).map(({ id, role }) => ({ meetingId: meeting.id, meetingNumber: 108, date: meeting.date, role, assignmentId: id })),
      historyReservations: structuredClone(historyReservations),
      everyoneGoals: members.map(({ id, displayName }) => ({ id, displayName, goals: structuredClone(goals.get(id)) })).filter(({ goals: value }) => value.length),
      meetings: [{
        id: meeting.id,
        meetingNumber: 108,
        date: meeting.date,
        startTime: meeting.startTime,
        theme: meeting.theme,
        status: meeting.status,
        revision: meeting.revision,
        assignments,
      }],
      historyMeetings: structuredClone(historyMeetings),
    };
  }

  const deps = {
    now: () => NOW,
    listBookingMembers: async () => structuredClone(members.filter(({ id }) => !disabledMemberIds.has(id))),
    getBookingDashboard: async (memberId) => dashboard(memberId),
    listDetailedMeetings: async () => [structuredClone(meeting)],
    getMeeting: async () => {
      const result = structuredClone(meeting);
      if (verificationFails && result.revision > 12) result.revision = 12;
      return result;
    },
    getRoleCatalog: async () => CATALOG,
    getPathwaysCatalog: async () => {
      if (pathwaysActive) return PATHWAYS;
      const projects = PATHWAYS.projects.map((project) => project.projectId === "active-listening" ? { ...project, active: false } : project);
      return { ...PATHWAYS, projects, projectById: new Map(projects.map((project) => [project.projectId, project])) };
    },
    checkExternalPublicUrl: async (url) => ({ url, status: urlStatus, reason: `${urlStatus} check`, checkedAt: new Date(NOW).toISOString() }),
    findAgendaAudit: async (operationId) => structuredClone(audits.get(operationId) || null),
    createAgendaAudit: async (entry) => {
      if (auditFails) throw new Error("audit unavailable");
      const audit = { ...structuredClone(entry), recordId: `audit-${audits.size + 1}`, status: "prepared", result: null };
      audits.set(entry.operationId, audit);
      return structuredClone(audit);
    },
    updateAgendaAudit: async (recordId, fields) => {
      if (auditCompletionFails && fields.status === "succeeded") throw new Error("audit completion unavailable");
      const audit = [...audits.values()].find((candidate) => candidate.recordId === recordId);
      if (fields.status) audit.status = fields.status;
      if (fields.result_json) audit.result = JSON.parse(fields.result_json);
      if (fields.after_revision != null) audit.afterRevision = fields.after_revision;
      return structuredClone(audit);
    },
    changeBooking: async (action, input) => {
      assert.equal(input.expectedRevision, meeting.revision);
      const assignment = bookingAssignments(meeting, CATALOG).find(({ id }) => id === input.assignmentId);
      const actor = members.find(({ id }) => id === input.memberId);
      const target = action === "cancel" ? null : action === "transfer" ? members.find(({ id }) => id === input.targetMemberId) : actor;
      applyBookingAssignment(meeting, assignment, target, input.speechDetails, action, input.externalPresentationUrl);
      meeting.revision += 1;
      return structuredClone(meeting);
    },
    saveGoal: async (memberId, input) => {
      const list = goals.get(memberId);
      const existing = input.id && list.find(({ id }) => id === input.id);
      const goal = {
        id: existing?.id || `goal-${++goalSequence}`,
        role: input.role,
        targetCount: Number(input.targetCount),
        dueDate: input.dueDate,
        createdAt: existing?.createdAt || new Date(NOW).toISOString(),
        completed: 0,
        booked: 0,
        status: "active",
      };
      if (existing) list.splice(list.indexOf(existing), 1, goal);
      else list.push(goal);
      return structuredClone(goal);
    },
    deleteGoal: async (memberId, goalId) => {
      const list = goals.get(memberId);
      const index = list.findIndex(({ id }) => id === goalId);
      const [deleted] = list.splice(index, 1);
      return structuredClone(deleted);
    },
  };
  return {
    service: createBookingService(deps),
    meeting: () => structuredClone(meeting),
    setMeeting(next) { meeting = structuredClone(next); },
    disableMember(memberId) { disabledMemberIds.add(memberId); },
    disablePathways() { pathwaysActive = false; },
    goals,
    audits,
  };
}

test.beforeEach(() => {
  process.env.AGENDA_SESSION_SECRET = "booking-test-secret";
  process.env.MCP_BOOKING_WRITE_ENABLED = "true";
});

test("seven Booking tools expose single-action schemas and safe annotations", () => {
  assert.deepEqual(BOOKING_TOOLS.map(({ name }) => name), [
    "vpe_get_meeting_role_sop",
    "vpe_get_role_booking_context",
    "vpe_search_pathways_projects",
    "vpe_book_role",
    "vpe_create_booking_goal",
    "vpe_propose_role_booking_change",
    "vpe_apply_role_booking_change",
  ]);
  assert.equal(BOOKING_TOOLS[0].annotations.readOnlyHint, true);
  assert.deepEqual(BOOKING_TOOLS[1].inputSchema.properties.view.enum, ["upcoming", "history", "all"]);
  assert.equal(BOOKING_TOOLS[1].inputSchema.properties.limit.maximum, 20);
  assert.equal(BOOKING_TOOLS[3].annotations.idempotentHint, true);
  assert.equal(BOOKING_TOOLS[5].inputSchema.properties.action.type, "string");
  assert.equal(BOOKING_TOOLS[2].inputSchema.properties.limit.maximum, 20);
  assert.equal(BOOKING_TOOLS[5].inputSchema.properties.external_presentation_url.anyOf[0].const, "");
  assert.equal(BOOKING_TOOLS[6].annotations.destructiveHint, true);
});

test("meeting role SOP lookup returns links only, supports aliases, and hides non-public roles", async () => {
  const service = createBookingService({ getRoleCatalog: async () => SOP_CATALOG });
  assert.deepEqual(await service.getMeetingRoleSop({ role: "计时员" }), {
    role: "Timer",
    description: "Track meeting time.",
    sopUrl: "https://example.feishu.cn/docx/timer-sop",
  });
  assert.deepEqual(await service.getMeetingRoleSop(), {
    roles: [{ role: "Timer", description: "Track meeting time.", sopUrl: "https://example.feishu.cn/docx/timer-sop" }],
    count: 1,
  });
  await assert.rejects(() => service.getMeetingRoleSop({ role: "TTM" }), (error) => error.code === "ROLE_SOP_NOT_CONFIGURED");
  await assert.rejects(() => service.getMeetingRoleSop({ role: "Private Role" }), (error) => error.code === "ROLE_NOT_FOUND");
});

test("context returns only explicit member data; all goals require opt-in; ambiguous names stop", async () => {
  const { service, goals } = fixture();
  goals.get("alice").push({ id: "alice-goal", role: "Timer", targetCount: 2, dueDate: "2026-12-31", createdAt: new Date(NOW).toISOString(), completed: 0, booked: 0, status: "active" });
  goals.get("bob").push({ id: "bob-goal", role: "TTM", targetCount: 1, dueDate: "2026-12-31", createdAt: new Date(NOW).toISOString(), completed: 0, booked: 0, status: "active" });
  const context = await service.getContext({ member_id: "alice", meeting_number: 108 });
  assert.equal(context.member.memberId, "alice");
  assert.equal(context.meetings, undefined);
  assert.equal(context.everyoneGoals, undefined);
  assert.equal(context.meeting.assignments[0].assignmentId, "role:functional-timer");
  const evaluators = context.meeting.assignments.filter(({ role }) => role === "Individual Evaluator");
  assert.deepEqual(evaluators.map(({ label, session, speakerName }) => ({ label, session, speakerName })), [
    { label: "Individual Evaluator 1", session: "Speech Evaluation 1", speakerName: "" },
    { label: "Individual Evaluator 2", session: "Speech Evaluation 2", speakerName: "" },
  ]);
  assert.ok(context.goals[0].goalHash);
  assert.equal(JSON.stringify(context).includes("bob-goal"), false);
  const all = await service.getContext({ member_id: "alice", include_all_goals: true });
  assert.equal(all.everyoneGoals.length, 2);
  assert.deepEqual(Object.keys(all.everyoneGoals[0]), ["displayName", "goals"]);
  assert.deepEqual(Object.keys(all.everyoneGoals[0].goals[0]), ["role", "targetCount", "dueDate", "completed", "booked", "status"]);
  await assert.rejects(() => service.getContext({ member_query: "Amy" }), (error) => error.code === "MEMBER_AMBIGUOUS" && error.details.candidates.length === 2);
});

test("context exposes bounded read-only history without changing the default upcoming response", async () => {
  const speechDetails = {
    session: "Listen Better",
    pathwaysMode: "pathways",
    pathwaysPath: "Presentation Mastery",
    pathwaysProjectId: "active-listening",
    pathwaysLevel: "3",
  };
  const historicalAssignment = {
    id: "item:historical-speaker",
    role: "Prepared Speaker",
    memberId: "alice",
    memberName: "Alice",
    mine: true,
    status: "confirmed",
    bookable: false,
    manageable: false,
    speechDetails,
    externalPresentationUrl: "https://docs.qq.com/slide/history",
  };
  const historyMeetings = [
    { id: "meeting-107", meetingNumber: 107, date: "2026-07-20", startTime: "19:00", theme: "Recent", status: "archived", revision: 8, assignments: [historicalAssignment] },
    { id: "meeting-106", meetingNumber: 106, date: "2026-07-13", startTime: "19:00", theme: "Older", status: "archived", revision: 7, assignments: [] },
  ];
  const historyReservations = [{
    meetingId: "meeting-107",
    meetingNumber: 107,
    date: "2026-07-20",
    theme: "Recent",
    role: "Prepared Speaker",
    assignmentId: "item:historical-speaker",
    speechDetails,
    externalPresentationUrl: "https://docs.qq.com/slide/history",
  }];
  const { service } = fixture({ historyMeetings, historyReservations });

  const upcoming = await service.getContext({ member_id: "alice" });
  assert.equal(upcoming.historyMeetings, undefined);
  assert.equal(upcoming.historyReservations, undefined);

  const history = await service.getContext({ member_id: "alice", view: "history", limit: 1 });
  assert.equal(history.meetings, undefined);
  assert.equal(history.reservations, undefined);
  assert.equal(history.historyMeetings.length, 1);
  assert.equal(history.historyMeetings[0].meetingNumber, 107);
  assert.equal(history.historyMeetings[0].editable, false);
  assert.equal(history.historyMeetings[0].lockReason, "historical_meeting");
  assert.equal(history.historyReservations[0].speechDetails.pathwaysProjectName, "Active Listening");
  assert.equal(history.historyReservations[0].externalPresentationUrl, "https://docs.qq.com/slide/history");
  assert.equal(history.historyHasMore, true);
  assert.deepEqual(history.historySummary, {
    meetingCount: 1,
    roleCounts: { "Prepared Speaker": 1 },
    preparedSpeechCount: 1,
    pathwaysProjects: [{
      path: "Presentation Mastery",
      level: "3",
      project: "Active Listening",
      projectId: "active-listening",
      count: 1,
    }],
  });

  const all = await service.getContext({ member_id: "alice", view: "all", limit: 1 });
  assert.equal(all.meetings.length, 1);
  assert.equal(all.historyMeetings.length, 1);
  assert.equal(all.reservations.length, 1);
  assert.equal(all.historyReservations.length, 1);

  const exact = await service.getContext({ member_id: "alice", meeting_number: 107 });
  assert.equal(exact.meeting.meetingNumber, 107);
  assert.equal(exact.meeting.editable, false);
  assert.equal(exact.meeting.assignments[0].bookable, false);
});

test("Pathways search returns active Base projects and stable form IDs only", async () => {
  const { service } = fixture();
  const result = await service.searchPathways({ query: "listening", path: "Presentation Mastery", level: "3" });
  assert.equal(result.count, 1);
  assert.equal(result.projects[0].projectId, "active-listening");
  assert.equal(result.projects[0].evaluationForms[0].formId, "active-listening-default");
  assert.equal(JSON.stringify(result).includes("inactive-project"), false);
  assert.equal(result.hasMore, false);
});

test("Pathways search pages active projects without fetching an unbounded catalog", async () => {
  const { service } = fixture();
  const result = await service.searchPathways({ level: "3", limit: 1 });
  assert.equal(result.projects.length, 1);
  assert.equal(result.count, 1);
  assert.equal(result.hasMore, true);
});

test("immediate booking enforces multiple-role confirmation, revision, idempotency, and readback", async () => {
  const { service, meeting, audits } = fixture();
  const input = {
    meeting_number: 108,
    expected_revision: 12,
    assignment_id: "role:functional-timer",
    member_id: "alice",
    idempotency_key: "booking-key-alice",
  };
  await assert.rejects(
    () => service.bookRole(input, PRINCIPAL, "https://agenda.example"),
    (error) => error.code === "MULTIPLE_ROLES_CONFIRMATION_REQUIRED" && error.details.timeHint.startTime === "19:00",
  );
  const result = await service.bookRole({ ...input, member_id: "bob", idempotency_key: "booking-key-bob" }, PRINCIPAL, "https://agenda.example");
  assert.equal(result.afterRevision, 13);
  assert.equal(result.assignment.memberId, "bob");
  assert.equal(meeting().revision, 13);
  assert.equal(audits.size, 1);
  const replay = await service.bookRole({ ...input, member_id: "bob", idempotency_key: "booking-key-bob" }, PRINCIPAL, "https://agenda.example");
  assert.deepEqual(replay, result);
  await assert.rejects(
    () => service.bookRole({ ...input, member_id: "bob", assignment_id: "item:speaker", idempotency_key: "booking-key-bob" }, PRINCIPAL, "https://agenda.example"),
    (error) => error.code === "IDEMPOTENCY_KEY_REUSED",
  );
});

test("same-day Draft booking and proposal remain writable through apply", async () => {
  const direct = fixture();
  const sameDay = direct.meeting();
  sameDay.date = "2026-07-31";
  direct.setMeeting(sameDay);
  const booked = await direct.service.bookRole({
    meeting_number: 108,
    expected_revision: 12,
    assignment_id: "role:functional-timer",
    member_id: "bob",
    idempotency_key: "same-day-booking-key",
  }, PRINCIPAL, "https://agenda.example");
  assert.equal(booked.assignment.memberId, "bob");

  const proposed = fixture();
  const assigned = proposed.meeting();
  assigned.date = "2026-07-31";
  assigned.blocks[0].items[0].memberId = "bob";
  assigned.blocks[0].items[0].member = "Bob";
  assigned.blocks[0].items[0].status = "confirmed";
  proposed.setMeeting(assigned);
  const proposal = await proposed.service.propose({
    action: "cancel_booking",
    meeting_number: 108,
    expected_revision: 12,
    assignment_id: "role:functional-timer",
    member_id: "bob",
  }, PRINCIPAL);
  const applied = await proposed.service.apply(proposal.proposalId, PRINCIPAL, "https://agenda.example");
  assert.equal(applied.assignment.status, "vacant");
});

test("meeting writes fail closed on disabled gate, stale revision, taken role, and audit outage", async () => {
  const input = {
    meeting_number: 108,
    expected_revision: 11,
    assignment_id: "role:functional-timer",
    member_id: "bob",
    idempotency_key: "failure-key",
  };
  const first = fixture();
  await assert.rejects(() => first.service.bookRole(input, PRINCIPAL, "https://agenda.example"), (error) => error.code === "REVISION_CONFLICT");
  process.env.MCP_BOOKING_WRITE_ENABLED = "false";
  await assert.rejects(() => first.service.bookRole({ ...input, expected_revision: 12 }, PRINCIPAL, "https://agenda.example"), (error) => error.code === "MCP_BOOKING_WRITE_DISABLED");
  process.env.MCP_BOOKING_WRITE_ENABLED = "true";
  const unavailable = fixture({ auditFails: true });
  await assert.rejects(() => unavailable.service.bookRole({ ...input, expected_revision: 12 }, PRINCIPAL, "https://agenda.example"), /audit unavailable/);
  assert.equal(unavailable.meeting().revision, 12);
  const occupied = fixture();
  const next = occupied.meeting();
  next.blocks[0].items[0].memberId = "alice";
  next.blocks[0].items[0].member = "Alice";
  next.blocks[0].items[0].status = "confirmed";
  occupied.setMeeting(next);
  await assert.rejects(() => occupied.service.bookRole({ ...input, expected_revision: 12 }, PRINCIPAL, "https://agenda.example"), (error) => error.code === "ROLE_TAKEN");
  const finalState = fixture();
  const finalMeeting = finalState.meeting();
  finalMeeting.status = "final";
  finalState.setMeeting(finalMeeting);
  await assert.rejects(() => finalState.service.bookRole({ ...input, expected_revision: 12 }, PRINCIPAL, "https://agenda.example"), (error) => error.code === "MEETING_LOCKED");
  for (const date of ["2026-07-30"]) {
    const dated = fixture();
    const meeting = dated.meeting();
    meeting.date = date;
    dated.setMeeting(meeting);
    await assert.rejects(() => dated.service.bookRole({ ...input, expected_revision: 12 }, PRINCIPAL, "https://agenda.example"), (error) => error.code === "MEETING_LOCKED");
  }
  const verification = fixture({ verificationFails: true });
  await assert.rejects(() => verification.service.bookRole({ ...input, expected_revision: 12 }, PRINCIPAL, "https://agenda.example"), (error) => error.code === "WRITE_VERIFICATION_FAILED");
  assert.equal([...verification.audits.values()][0].status, "failed");
  const uncertain = fixture({ auditCompletionFails: true });
  await assert.rejects(() => uncertain.service.bookRole({ ...input, expected_revision: 12 }, PRINCIPAL, "https://agenda.example"), (error) => error.code === "WRITE_STATUS_UNCERTAIN");
  assert.equal(uncertain.meeting().revision, 13);
});

test("Prepared Speaker can book Decide later and receives a completion reminder", async () => {
  const { service } = fixture();
  const result = await service.bookRole({
    meeting_number: 108,
    expected_revision: 12,
    assignment_id: "item:speaker",
    member_id: "bob",
    idempotency_key: "speaker-later-key",
  }, PRINCIPAL, "https://agenda.example");
  assert.equal(result.assignment.speechDetails.pathwaysMode, "");
  assert.match(result.reminder, /speech title/i);
  assert.match(result.reminder, /goal/i);
});

test("direct booking validates Pathways speech details like the proposal path", async () => {
  const { service } = fixture();
  await assert.rejects(
    () => service.bookRole({
      meeting_number: 108,
      expected_revision: 12,
      assignment_id: "item:speaker",
      member_id: "bob",
      idempotency_key: "speaker-invalid-path-key",
      speech_details: {
        session: "Listen Better",
        pathways_mode: "pathways",
        pathways_path: "Wrong Path",
        pathways_project_id: "active-listening",
        pathways_form_id: "active-listening-default",
      },
    }, PRINCIPAL, "https://agenda.example"),
    (error) => error.code === "INVALID_PATHWAYS_PATH",
  );
});

test("direct booking normalizes Custom speech details and clears Pathways identifiers", async () => {
  const { service } = fixture();
  const result = await service.bookRole({
    meeting_number: 108,
    expected_revision: 12,
    assignment_id: "item:speaker",
    member_id: "bob",
    idempotency_key: "speaker-custom-key",
    speech_details: {
      session: "My Custom Talk",
      pathways_mode: "custom",
      pathways_path: "Should Be Dropped",
      pathways_project_id: "active-listening",
      pathways_form_id: "active-listening-default",
      speech_objective: "Practice storytelling.",
    },
  }, PRINCIPAL, "https://agenda.example");
  assert.equal(result.assignment.speechDetails.pathwaysMode, "custom");
  assert.equal(result.assignment.speechDetails.pathwaysProjectId, "");
  assert.equal(result.assignment.speechDetails.pathwaysFormId, "");
  assert.equal(result.assignment.speechDetails.speechObjective, "Practice storytelling.");
});

test("cancel proposal writes nothing, binds principal/revision, applies once, and restores vacancy", async () => {
  const state = fixture();
  const next = state.meeting();
  next.blocks[0].items[0].memberId = "bob";
  next.blocks[0].items[0].member = "Bob";
  next.blocks[0].items[0].status = "confirmed";
  state.setMeeting(next);
  const proposal = await state.service.propose({
    action: "cancel_booking",
    meeting_number: 108,
    expected_revision: 12,
    assignment_id: "role:functional-timer",
    member_id: "bob",
  }, PRINCIPAL);
  assert.equal(state.meeting().revision, 12);
  assert.equal(proposal.diff[0].before.memberId, "bob");
  assert.equal(proposal.diff[0].after.status, "vacant");
  await assert.rejects(() => state.service.apply(proposal.proposalId, { id: "other", name: "Other" }, "https://agenda.example"), (error) => error.code === "PROPOSAL_PRINCIPAL_MISMATCH");
  const applied = await state.service.apply(proposal.proposalId, PRINCIPAL, "https://agenda.example");
  assert.equal(applied.afterRevision, 13);
  assert.equal(applied.assignment.status, "vacant");
  assert.deepEqual(await state.service.apply(proposal.proposalId, PRINCIPAL, "https://agenda.example"), applied);
});

test("transfer, Presentation URL, and speech-detail proposals each apply one exact action", async () => {
  const state = fixture();
  const seeded = state.meeting();
  seeded.blocks[0].items[2].memberId = "alice";
  seeded.blocks[0].items[2].member = "Alice";
  seeded.blocks[0].items[2].status = "confirmed";
  seeded.blocks[0].items[0].memberId = "bob";
  seeded.blocks[0].items[0].member = "Bob";
  seeded.blocks[0].items[0].status = "confirmed";
  state.setMeeting(seeded);
  const transfer = await state.service.propose({
    action: "transfer_booking",
    meeting_number: 108,
    expected_revision: 12,
    assignment_id: "item:ttm",
    member_id: "alice",
    target_member_id: "bob",
  }, PRINCIPAL);
  assert.equal(transfer.warnings[0].timeHint.startTime, "19:00");
  const transferred = await state.service.apply(transfer.proposalId, PRINCIPAL, "https://agenda.example");
  assert.equal(transferred.assignment.memberId, "bob");

  const link = await state.service.propose({
    action: "update_presentation_url",
    meeting_number: 108,
    expected_revision: 13,
    assignment_id: "item:ttm",
    member_id: "bob",
    external_presentation_url: "https://docs.qq.com/doc/test",
  }, PRINCIPAL);
  const linked = await state.service.apply(link.proposalId, PRINCIPAL, "https://agenda.example");
  assert.equal(linked.assignment.externalPresentationUrl, "https://docs.qq.com/doc/test");

  const clear = await state.service.propose({
    action: "update_presentation_url",
    meeting_number: 108,
    expected_revision: 14,
    assignment_id: "item:ttm",
    member_id: "bob",
    external_presentation_url: "",
  }, PRINCIPAL);
  const cleared = await state.service.apply(clear.proposalId, PRINCIPAL, "https://agenda.example");
  assert.equal(cleared.assignment.externalPresentationUrl, "");

  const speech = await state.service.propose({
    action: "update_speech_details",
    meeting_number: 108,
    expected_revision: 15,
    assignment_id: "item:speaker",
    member_id: "alice",
    speech_details: {
      session: "Listen Better",
      pathways_mode: "pathways",
      pathways_path: "Presentation Mastery",
      pathways_project_id: "active-listening",
      pathways_form_id: "active-listening-default",
    },
  }, PRINCIPAL);
  const updated = await state.service.apply(speech.proposalId, PRINCIPAL, "https://agenda.example");
  assert.equal(updated.assignment.speechDetails.session, "Listen Better");
  assert.equal(updated.assignment.speechDetails.pathwaysProjectId, "active-listening");
});

test("apply stops on a changed meeting revision and requires a new proposal", async () => {
  const state = fixture();
  const seeded = state.meeting();
  seeded.blocks[0].items[0].memberId = "bob";
  seeded.blocks[0].items[0].member = "Bob";
  seeded.blocks[0].items[0].status = "confirmed";
  state.setMeeting(seeded);
  const proposal = await state.service.propose({
    action: "cancel_booking",
    meeting_number: 108,
    expected_revision: 12,
    assignment_id: "role:functional-timer",
    member_id: "bob",
  }, PRINCIPAL);
  const changed = state.meeting();
  changed.revision = 13;
  state.setMeeting(changed);
  await assert.rejects(() => state.service.apply(proposal.proposalId, PRINCIPAL, "https://agenda.example"), (error) => error.code === "REVISION_CONFLICT");
});

test("apply revalidates transfer member and Pathways project", async () => {
  const transferState = fixture();
  const transfer = await transferState.service.propose({
    action: "transfer_booking",
    meeting_number: 108,
    expected_revision: 12,
    assignment_id: "item:ttm",
    member_id: "alice",
    target_member_id: "bob",
  }, PRINCIPAL);
  transferState.disableMember("bob");
  await assert.rejects(
    () => transferState.service.apply(transfer.proposalId, PRINCIPAL, "https://agenda.example"),
    (error) => error.code === "MEMBER_NOT_FOUND",
  );
  assert.equal(transferState.meeting().revision, 12);

  const speechState = fixture();
  const seeded = speechState.meeting();
  seeded.blocks[0].items[2].memberId = "alice";
  seeded.blocks[0].items[2].member = "Alice";
  seeded.blocks[0].items[2].status = "confirmed";
  speechState.setMeeting(seeded);
  const speech = await speechState.service.propose({
    action: "update_speech_details",
    meeting_number: 108,
    expected_revision: 12,
    assignment_id: "item:speaker",
    member_id: "alice",
    speech_details: {
      session: "Listen Better",
      pathways_mode: "pathways",
      pathways_path: "Presentation Mastery",
      pathways_project_id: "active-listening",
      pathways_form_id: "active-listening-default",
    },
  }, PRINCIPAL);
  speechState.disablePathways();
  await assert.rejects(
    () => speechState.service.apply(speech.proposalId, PRINCIPAL, "https://agenda.example"),
    (error) => error.code === "INVALID_PATHWAYS_PROJECT",
  );
  assert.equal(speechState.meeting().revision, 12);
});

test("goal create/edit/delete uses hashes, proposals, idempotency, and audit", async () => {
  const { service, goals } = fixture();
  const created = await service.createGoal({
    member_id: "bob",
    role: "Timer",
    target_count: 2,
    due_date: "2026-12-31",
    idempotency_key: "goal-create-key",
  }, PRINCIPAL);
  assert.equal(created.goal.role, "Timer");
  assert.deepEqual(await service.createGoal({
    member_id: "bob",
    role: "Timer",
    target_count: 2,
    due_date: "2026-12-31",
    idempotency_key: "goal-create-key",
  }, PRINCIPAL), created);
  const edit = await service.propose({
    action: "update_goal",
    member_id: "bob",
    goal_id: created.goal.id,
    expected_goal_hash: created.goal.goalHash,
    goal: { role: "Timer", target_count: 3, due_date: "2026-11-30" },
  }, PRINCIPAL);
  const edited = await service.apply(edit.proposalId, PRINCIPAL, "https://agenda.example");
  assert.equal(edited.goal.targetCount, 3);
  await assert.rejects(() => service.propose({
    action: "delete_goal",
    member_id: "bob",
    goal_id: created.goal.id,
    expected_goal_hash: created.goal.goalHash,
  }, PRINCIPAL), (error) => error.code === "GOAL_CHANGED");
  const current = goals.get("bob")[0];
  const remove = await service.propose({
    action: "delete_goal",
    member_id: "bob",
    goal_id: current.id,
    expected_goal_hash: goalHash(current),
  }, PRINCIPAL);
  const deleted = await service.apply(remove.proposalId, PRINCIPAL, "https://agenda.example");
  assert.equal(deleted.deletedGoal.id, current.id);
  assert.equal(goals.get("bob").length, 0);
});

test("external URL unknown requires explicit risk for immediate booking and is warned in proposal", async () => {
  const immediate = fixture({ urlStatus: "unknown" });
  await assert.rejects(() => immediate.service.bookRole({
    meeting_number: 108,
    expected_revision: 12,
    assignment_id: "item:speaker",
    member_id: "bob",
    idempotency_key: "unknown-url-key",
    external_presentation_url: "https://example.com/slides",
  }, PRINCIPAL, "https://agenda.example"), (error) => error.code === "EXTERNAL_URL_RISK_CONFIRMATION_REQUIRED");
  const proposalState = fixture({ urlStatus: "unknown" });
  const proposal = await proposalState.service.propose({
    action: "update_presentation_url",
    meeting_number: 108,
    expected_revision: 12,
    assignment_id: "item:ttm",
    member_id: "alice",
    external_presentation_url: "https://example.com/slides",
  }, PRINCIPAL);
  assert.equal(proposal.warnings[0].code, "EXTERNAL_URL_UNKNOWN");
  const privateState = fixture({ urlStatus: "private" });
  await assert.rejects(() => privateState.service.bookRole({
    meeting_number: 108,
    expected_revision: 12,
    assignment_id: "item:speaker",
    member_id: "bob",
    idempotency_key: "private-url-key",
    external_presentation_url: "https://docs.qq.com/doc/private",
  }, PRINCIPAL, "https://agenda.example"), (error) => error.code === "INVALID_EXTERNAL_PRESENTATION_URL");
});

test("signed Booking proposals reject tampering and expiry", () => {
  const proposal = createBookingProposal({ principalId: "officer" }, NOW);
  assert.equal(verifyBookingProposal(proposal, NOW + 1).principalId, "officer");
  assert.throws(() => verifyBookingProposal(`${proposal}x`, NOW + 1), /invalid/i);
  assert.throws(() => verifyBookingProposal(proposal, NOW + 5 * 60 * 1000), /expired/i);
});


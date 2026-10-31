import assert from "node:assert/strict";
import test from "node:test";

import { groupMeetingAssignments, groupMemberOptions, guestDisplayNameLooksStandard, matchesMemberSearch, memberSpeechDefaults } from "../book-helpers.js";
import {
  applyBookingAssignment,
  bookingAssignments,
  canManageBookingAssignment,
  canManagePresentationUrl,
  canonicalBookingRole,
  goalProgress,
  guestNameWarnings,
  inspectGuestDirectory,
  isBookingMeetingEditable,
  isGuestMember,
  nextPathwayDefaults,
  normalizeGuestDisplayName,
  parseSpeechDetails,
  partitionBookingMeetings,
  reservationsForMember,
} from "../server/booking-repository.js";
import { roleCatalogFromRecords } from "../server/roles-repository.js";

const CATALOG = roleCatalogFromRecords([
  "Prepared Speaker",
  "Individual Evaluator",
  "TME",
  "TTM",
  "Timer",
  "Photographer",
  "Meeting Manager",
  "Guest Talk Host",
].map((role_name, index) => ({
  record_id: role_name,
  fields: {
    role_name,
    aliases: role_name === "TME" ? "Toastmaster" : role_name === "Guest Talk Host" ? "Guest Introduction Host" : "",
    booking_public: true,
    guest_booking_public: role_name !== "Prepared Speaker",
    active: true,
    sort_order: index,
  },
})).concat(["President", "Sharing Speaker", "SAA", "Sharing Master", "IT Support", "Ballot Counter"].map((role_name) => ({
  record_id: role_name,
  fields: { role_name, booking_public: false, active: true },
}))));

test("member search supports ordered fuzzy initials and missing characters", () => {
  assert.equal(matchesMemberSearch("Alex Chen, PM1", "alx"), true);
  assert.equal(matchesMemberSearch("Alex Chen, PM1", "ac"), true);
  assert.equal(matchesMemberSearch("Amy, PM3@AF TMC", "pm3 af"), true);
  assert.equal(matchesMemberSearch("Amy, PM3@AF TMC", "af amy"), true);
  assert.equal(matchesMemberSearch("Amy, PM3@AF TMC", "Ami"), false);
  assert.equal(matchesMemberSearch("Alex Chen, PM1", "zx"), false);
});

test("Agenda member options group active members and guests", () => {
  const grouped = groupMemberOptions([
    { id: "guest", displayName: "Amy, Guest", memberType: "guest_placeholder", active: true },
    { id: "inactive", displayName: "Former Member", memberType: "member", active: false },
    { id: "member", displayName: "Amy, PM3@AF TMC", memberType: "member", active: true },
  ], "amy");
  assert.deepEqual(grouped.members.map(({ id }) => id), ["member"]);
  assert.deepEqual(grouped.guests.map(({ id }) => id), ["guest"]);
});

test("Guest display-name guidance accepts both documented formats", () => {
  assert.equal(guestDisplayNameLooksStandard("Amy, Guest"), true);
  assert.equal(guestDisplayNameLooksStandard("Amy, PM3@AF TMC"), true);
  assert.equal(guestDisplayNameLooksStandard("Amy"), false);
});

test("Book Guest names normalize the three accepted formats and reject other input", () => {
  assert.equal(normalizeGuestDisplayName(" Amy Chen , guest "), "Amy Chen, Guest");
  assert.equal(normalizeGuestDisplayName("Amy Chen, PM3@AF TMC"), "Amy Chen, PM3@AF TMC");
  assert.equal(normalizeGuestDisplayName("李雷, @上海西区"), "李雷, @上海西区");
  for (const value of ["Amy Chen", "Amy Chen, PM3", "Amy Chen, @", "Amy Chen, PM3@AF@TMC", "x".repeat(81)]) {
    assert.throws(() => normalizeGuestDisplayName(value), { code: "INVALID_GUEST_NAME" });
  }
});

test("Book Guest inspection merges warnings and protects directory identities", () => {
  const directory = [
    { id: "member", displayName: "Alex Chen, PM1@Demo TMC", memberType: "member", active: true },
    { id: "guest", displayName: "Amy Chen, Guest", memberType: "guest_placeholder", active: true },
    { id: "guest-club", displayName: "Amy Chen, PM3@AF TMC", memberType: "guest_placeholder", active: true },
    { id: "inactive", displayName: "Old Guest, Guest", memberType: "guest_placeholder", active: false },
  ];
  const exact = inspectGuestDirectory(" amy chen , guest ", directory);
  assert.equal(exact.exactGuest.id, "guest");
  assert.deepEqual(exact.candidates.map(({ id }) => id), ["guest-club"]);
  assert.deepEqual(guestNameWarnings("Amy, @AF TMC"), [
    "请确认这是嘉宾的完整姓名",
    "请确认该嘉宾目前没有组织角色头衔",
  ]);
  assert.deepEqual(guestNameWarnings("李雷, @上海西区"), [
    "请确认这是嘉宾的完整姓名",
    "嘉宾来自中文演讲俱乐部吗？否则建议使用英文",
    "请确认该嘉宾目前没有组织角色头衔",
  ]);
  assert.throws(() => inspectGuestDirectory("Alex Chen, PM1@Demo TMC", directory), { code: "GUEST_NAME_IS_MEMBER" });
  assert.throws(() => inspectGuestDirectory("Old Guest, Guest", directory), { code: "GUEST_INACTIVE" });
  assert.equal(isGuestMember(directory[1]), true);
  assert.equal(isGuestMember(directory[0]), false);
});

test("any Book member can manage Guest assignments but not another member assignment", () => {
  const actor = { id: "actor", displayName: "Actor", memberType: "member", active: true };
  const owner = { id: "owner", displayName: "Owner", memberType: "member", active: true };
  const guest = { id: "guest", displayName: "Amy, Guest", memberType: "guest_placeholder", active: true };
  const directory = [actor, owner, guest];
  assert.equal(canManageBookingAssignment({ memberId: guest.id, memberName: guest.displayName }, actor, directory), true);
  assert.equal(canManageBookingAssignment({ memberId: owner.id, memberName: owner.displayName }, actor, directory), false);
  assert.equal(canManageBookingAssignment({ memberId: actor.id, memberName: actor.displayName }, actor, directory), true);
});

test("member Pathways defaults target the next unfinished level", () => {
  assert.deepEqual(nextPathwayDefaults(true, "MS5/EH2"), [{ code: "EH", level: "3" }]);
  assert.deepEqual(nextPathwayDefaults(true, "PM2/EH2"), [{ code: "PM", level: "3" }, { code: "EH", level: "3" }]);
  assert.deepEqual(nextPathwayDefaults(true, "DTM/PM4"), [{ code: "PM", level: "5" }]);
  assert.deepEqual(nextPathwayDefaults(true, "PM5"), []);
  assert.deepEqual(nextPathwayDefaults(false, "PM2"), []);
});

test("Book uses a member next-level default only when speech details are empty", () => {
  const catalog = {
    paths: ["Engaging Humor", "Presentation Mastery"],
    projects: [
      { level: "3", requiredPaths: ["Engaging Humor"], electivePaths: [] },
      { level: "3", requiredPaths: ["Presentation Mastery"], electivePaths: [] },
    ],
  };
  const member = { pathwayDefaults: [{ code: "EH", level: "3" }] };
  assert.deepEqual(memberSpeechDefaults({}, member, catalog), {
    pathwaysMode: "pathways",
    pathwaysPath: "Engaging Humor",
    pathwaysLevel: "3",
  });
  const existing = { pathwaysMode: "custom", speechObjective: "Existing objective" };
  assert.equal(memberSpeechDefaults(existing, member, catalog), existing);
  const titled = { session: "A Better Question" };
  assert.equal(memberSpeechDefaults(titled, member, catalog), titled);
});

test("meeting roles follow catalog groups and pair speakers with evaluators", () => {
  const grouped = groupMeetingAssignments([
    { id: "evaluator-2", role: "Individual Evaluator", speechPairId: "speech-2" },
    { id: "tme", role: "TME" },
    { id: "speaker-1", role: "Prepared Speaker", speechPairId: "speech-1" },
    { id: "evaluator-1", role: "Individual Evaluator", speechPairId: "speech-1" },
    { id: "speaker-2", role: "Prepared Speaker", speechPairId: "speech-2" },
    { id: "photographer", role: "Photographer" },
  ], [
    { name: "Prepared Speaker", group: "演讲与个评", sortOrder: 10 },
    { name: "Individual Evaluator", group: "演讲与个评", sortOrder: 20 },
    { name: "TME", group: "主持相关", sortOrder: 30 },
    { name: "Photographer", group: "会议支持", sortOrder: 100 },
  ]);
  assert.deepEqual(grouped.map(({ label }) => label), ["演讲与个评", "主持相关", "会议支持"]);
  assert.deepEqual(grouped[0].assignments.map(({ id }) => id), ["speaker-1", "evaluator-1", "speaker-2", "evaluator-2"]);
});

function meeting({ id, date, status = "draft", memberId = "", member = "", role = "Timer" }) {
  return {
    id,
    meetingNumber: Number(id.replace(/\D/g, "")) || 1,
    date,
    status,
    photographerMemberId: "",
    photographer: "",
    meetingManagerMemberId: "",
    meetingManager: "",
    blocks: [{
      id: `${id}-block`,
      type: "opening",
      items: [{
        id: `${id}-item`,
        kind: "role",
        role,
        memberId,
        member,
        status: member ? "confirmed" : "vacant",
      }],
    }],
  };
}

test("booking assignments collapse linked functional rows and expose meeting roles", () => {
  const input = meeting({ id: "meeting-1", date: "2026-07-24" });
  input.blocks.push({
    id: "closing",
    type: "closing",
    items: [{
      id: "timer-report",
      kind: "role",
      role: "Timer",
      roleAssignmentId: "functional-timer",
      memberId: "member-1",
      member: "Alex CHEN, TM",
      status: "confirmed",
    }],
  });
  input.blocks[0].items[0].roleAssignmentId = "functional-timer";
  const assignments = bookingAssignments(input, CATALOG);
  const timer = assignments.find((assignment) => assignment.role === "Timer");
  assert.deepEqual(timer.itemIds.sort(), ["meeting-1-item", "timer-report"]);
  assert.equal(timer.memberId, "member-1");
  assert.ok(assignments.some((assignment) => assignment.id === "meeting:photographer"));
  assert.ok(assignments.some((assignment) => assignment.id === "meeting:manager"));
});

test("off-agenda Timer is bookable once while Ballot Counter stays internal", () => {
  const input = meeting({ id: "meeting-114", date: "2026-11-10", role: "President" });
  input.offAgendaRoles = [
    { role: "Timer", memberId: "", member: "", signupOpen: true },
    { role: "Ballot Counter", memberId: "", member: "", signupOpen: false },
  ];
  const assignments = bookingAssignments(input, CATALOG);
  assert.equal(assignments.filter(({ role }) => role === "Timer").length, 1);
  assert.equal(assignments.some(({ role }) => role === "Ballot Counter"), false);
  const timer = assignments.find(({ role }) => role === "Timer");
  applyBookingAssignment(input, timer, { id: "member-1", displayName: "Amy" });
  assert.equal(input.offAgendaRoles[0].memberId, "member-1");
  assert.equal(input.offAgendaRoles[0].member, "Amy");
  assert.equal(input.blocks[0].items[0].role, "President");
});

test("President stays internal to Agenda", () => {
  const input = meeting({ id: "meeting-2", date: "2026-07-24", role: "President" });
  assert.equal(bookingAssignments(input, CATALOG).some((assignment) => assignment.role === "President"), false);
});

test("Sharing Speaker stays internal to Agenda", () => {
  const input = meeting({ id: "meeting-3", date: "2026-07-24", role: "Sharing Speaker" });
  assert.equal(bookingAssignments(input, CATALOG).some((assignment) => assignment.role === "Sharing Speaker"), false);
});

test("Sharing Master is available for the meeting summary without becoming bookable", () => {
  const input = meeting({ id: "meeting-108", date: "2026-09-08", role: "Sharing Master", member: "Blake" });
  assert.equal(bookingAssignments(input, CATALOG).some((assignment) => assignment.role === "Sharing Master"), false);
  assert.deepEqual(bookingAssignments(input, CATALOG, { includeSharingMaster: true }).find((assignment) => assignment.role === "Sharing Master"), {
    id: "item:meeting-108-item",
    role: "Sharing Master",
    session: "",
    memberId: "",
    memberName: "Blake",
    status: "confirmed",
    itemIds: ["meeting-108-item"],
    linkedSpeechId: "",
    speechPairId: "",
    speakerName: "",
    speechDetails: null,
    externalPresentationUrl: "",
  });
});

test("goal roles and meeting roles share one public enum", () => {
  for (const role of ["SAA", "Sharing Master", "IT Support", "Ballot Counter"]) {
    assert.equal(CATALOG.isPublic(role), false);
  }
  for (const role of ["Timer", "Guest Talk Host", "SAA", "Sharing Master", "IT Support", "Ballot Counter", "President"]) {
    const assignments = bookingAssignments(meeting({ id: `meeting-${role}`, date: "2026-07-24", role }), CATALOG);
    assert.equal(assignments.some((assignment) => assignment.role === role), CATALOG.isPublic(role));
  }
});

test("Guest booking visibility is a narrower RoleCatalog permission", () => {
  assert.equal(CATALOG.isPublic("Prepared Speaker"), true);
  assert.equal(CATALOG.isGuestPublic("Prepared Speaker"), false);
  assert.equal(CATALOG.isGuestPublic("Timer"), true);
  assert.equal(CATALOG.isGuestPublic("President"), false);
});

test("prepared speeches and numbered roles normalize to target roles", () => {
  assert.equal(canonicalBookingRole({ kind: "speech", role: "Prepared Speaker 2" }, CATALOG), "Prepared Speaker");
  assert.equal(canonicalBookingRole({ kind: "role", role: "Individual Evaluator 2" }, CATALOG), "Individual Evaluator");
  assert.equal(canonicalBookingRole({ kind: "role", role: "Toastmaster" }, CATALOG), "TME");
  assert.equal(canonicalBookingRole({ kind: "role", role: "Guest Introduction Host" }, CATALOG), "Guest Talk Host");
});

test("only prepared speakers and TTM can maintain presentation links", () => {
  assert.equal(canManagePresentationUrl("Prepared Speaker"), true);
  assert.equal(canManagePresentationUrl("TTM"), true);
  assert.equal(canManagePresentationUrl("Timer"), false);
});

test("booking a grouped role updates every Agenda row", () => {
  const input = meeting({ id: "meeting-7", date: "2026-07-24" });
  input.blocks[0].items[0].roleAssignmentId = "functional-timer";
  input.blocks.push({ id: "closing", type: "closing", items: [{ ...input.blocks[0].items[0], id: "timer-report" }] });
  const assignment = bookingAssignments(input, CATALOG).find((candidate) => candidate.role === "Timer");
  applyBookingAssignment(input, assignment, { id: "member-1", displayName: "Alex Chen, PM1" });
  for (const item of input.blocks.flatMap((block) => block.items)) {
    assert.equal(item.memberId, "member-1");
    assert.equal(item.member, "Alex Chen, PM1");
    assert.equal(item.status, "confirmed");
  }
});

test("booking an evaluator keeps the linked speech in sync", () => {
  const input = meeting({ id: "meeting-8", date: "2026-07-24", role: "Individual Evaluator" });
  input.blocks[0].items[0].linkedSpeechId = "speech-1";
  input.blocks.push({ id: "prepared", type: "prepared_speeches", items: [{ id: "speech-1", kind: "speech", role: "Prepared Speaker 1", member: "Elaine", status: "confirmed", evaluator: "", evaluatorId: "", evaluatorStatus: "vacant" }] });
  const assignment = bookingAssignments(input, CATALOG).find((candidate) => candidate.role === "Individual Evaluator");
  const speaker = bookingAssignments(input, CATALOG).find((candidate) => candidate.role === "Prepared Speaker");
  assert.equal(assignment.speechPairId, speaker.speechPairId);
  applyBookingAssignment(input, assignment, { id: "member-2", displayName: "Casey Kim, PM5" });
  const speech = input.blocks[1].items[0];
  assert.equal(speech.evaluatorId, "member-2");
  assert.equal(speech.evaluator, "Casey Kim, PM5");
  assert.equal(speech.evaluatorStatus, "confirmed");
});

test("goal progress derives completed and booked counts from Agenda", () => {
  const member = { id: "member-1", displayName: "Alex CHEN, TM" };
  const meetings = [
    meeting({ id: "meeting-1", date: "2026-07-10", status: "archived", memberId: member.id, member: member.displayName }),
    meeting({ id: "meeting-2", date: "2026-07-24", status: "draft", memberId: member.id, member: member.displayName }),
    meeting({ id: "meeting-3", date: "2026-10-02", status: "draft", memberId: member.id, member: member.displayName }),
  ];
  const goal = { role: "Timer", targetCount: 3, dueDate: "2026-09-30", createdAt: "2026-07-01T00:00:00.000Z" };
  assert.deepEqual(goalProgress(goal, member, meetings, "2026-07-17", CATALOG), {
    completed: 1,
    booked: 1,
    targetCount: 3,
    status: "active",
  });
});

test("today's draft meeting stays editable while final and past meetings stay locked", () => {
  assert.equal(isBookingMeetingEditable({ status: "draft", date: "2026-07-24" }, "2026-07-24"), true);
  assert.equal(isBookingMeetingEditable({ status: "final", date: "2026-07-24" }, "2026-07-24"), false);
  assert.equal(isBookingMeetingEditable({ status: "draft", date: "2026-07-23" }, "2026-07-24"), false);
  assert.equal(isBookingMeetingEditable({ status: "draft", date: "2026-07-25" }, "2026-07-24"), true);
});

test("booking meetings include today and separate earlier meetings newest first", () => {
  const meetings = [
    meeting({ id: "meeting-4", date: "2026-07-25", status: "draft" }),
    meeting({ id: "meeting-2", date: "2026-07-23", status: "final" }),
    meeting({ id: "meeting-3", date: "2026-07-24", status: "final" }),
    meeting({ id: "meeting-1", date: "2026-07-10", status: "archived" }),
  ];

  const partitions = partitionBookingMeetings(meetings, "2026-07-24");
  assert.deepEqual(partitions.upcoming.map(({ id }) => id), ["meeting-3", "meeting-4"]);
  assert.deepEqual(partitions.history.map(({ id }) => id), ["meeting-2", "meeting-1"]);
});

test("goal progress counts a same-day draft reservation as booked", () => {
  const member = { id: "member-1", displayName: "Alex CHEN, TM" };
  const meetings = [meeting({ id: "meeting-1", date: "2026-07-24", status: "draft", memberId: member.id, member: member.displayName })];
  const goal = { role: "Timer", targetCount: 2, dueDate: "2026-09-30", createdAt: "2026-07-01T00:00:00.000Z" };
  assert.equal(goalProgress(goal, member, meetings, "2026-07-24", CATALOG).booked, 1);
});

test("member reservations keep today upcoming and move only earlier dates into history", () => {
  const member = { id: "member-1", displayName: "Alex CHEN, TM" };
  const meetings = [
    meeting({ id: "meeting-4", date: "2026-07-25", status: "draft", memberId: member.id, member: member.displayName }),
    meeting({ id: "meeting-3", date: "2026-07-24", status: "final", memberId: member.id, member: member.displayName }),
    meeting({ id: "meeting-2", date: "2026-07-23", status: "archived", memberId: member.id, member: member.displayName }),
    meeting({ id: "meeting-1", date: "2026-07-10", status: "archived", memberId: member.id, member: member.displayName }),
    meeting({ id: "meeting-5", date: "2026-07-26", status: "draft", memberId: "member-2", member: "Someone Else" }),
  ];

  assert.deepEqual(
    reservationsForMember(meetings, member, "2026-07-24", CATALOG),
    [
      { meetingId: "meeting-3", meetingNumber: 3, date: "2026-07-24", theme: undefined, role: "Timer", assignmentId: "item:meeting-3-item", speechDetails: null, externalPresentationUrl: "" },
      { meetingId: "meeting-4", meetingNumber: 4, date: "2026-07-25", theme: undefined, role: "Timer", assignmentId: "item:meeting-4-item", speechDetails: null, externalPresentationUrl: "" },
    ],
  );
  assert.deepEqual(
    reservationsForMember(meetings, member, "2026-07-24", CATALOG, { history: true }),
    [
      { meetingId: "meeting-2", meetingNumber: 2, date: "2026-07-23", theme: undefined, role: "Timer", assignmentId: "item:meeting-2-item", speechDetails: null, externalPresentationUrl: "" },
      { meetingId: "meeting-1", meetingNumber: 1, date: "2026-07-10", theme: undefined, role: "Timer", assignmentId: "item:meeting-1-item", speechDetails: null, externalPresentationUrl: "" },
    ],
  );
});

test("historical prepared speeches retain Pathways details", () => {
  const member = { id: "member-1", displayName: "Alex CHEN, TM" };
  const input = meeting({ id: "meeting-8", date: "2026-07-20", status: "archived", memberId: member.id, member: member.displayName, role: "Prepared Speaker" });
  Object.assign(input.blocks[0].items[0], {
    session: "A Better Question",
    pathwaysMode: "pathways",
    pathwaysPath: "Presentation Mastery",
    pathwaysLevel: "2",
    pathwaysProjectId: "active-listening",
    pathwaysFormId: "active-listening-standard",
    speechObjective: "Listen for meaning before responding.",
    externalPresentationUrl: "https://docs.qq.com/slide/history",
  });

  const history = reservationsForMember([input], member, "2026-07-24", CATALOG, { history: true });
  assert.deepEqual(history[0].speechDetails, {
    session: "A Better Question",
    pathwaysMode: "pathways",
    pathwaysPath: "Presentation Mastery",
    pathwaysLevel: "2",
    pathwaysProjectId: "active-listening",
    pathwaysFormId: "active-listening-standard",
    speechObjective: "Listen for meaning before responding.",
  });
  assert.equal(history[0].externalPresentationUrl, "https://docs.qq.com/slide/history");
});

test("new speech details use structured Agenda fields while legacy tags stay readable", () => {
  const input = meeting({ id: "meeting-9", date: "2026-07-24", role: "Prepared Speaker" });
  const assignment = bookingAssignments(input, CATALOG).find((candidate) => candidate.role === "Prepared Speaker");
  const details = {
    session: "A Better Question",
    pathwaysMode: "pathways",
    pathwaysPath: "Presentation Mastery",
    pathwaysLevel: "2",
    pathwaysProjectId: "project-understanding-your-communication-style-l2",
    pathwaysFormId: "form-understanding-your-communication-style-l2",
    speechObjective: "Understand communication styles.",
  };
  applyBookingAssignment(input, assignment, { id: "member-1", displayName: "Alex Chen, PM1" }, details);
  assert.deepEqual(bookingAssignments(input, CATALOG).find((candidate) => candidate.role === "Prepared Speaker").speechDetails, details);
  assert.doesNotMatch(input.blocks[0].items[0].speechObjective, /^\[Pathways /m);
  assert.deepEqual(parseSpeechDetails("Legacy objective"), { pathwaysProject: "", pathwaysLevel: "", speechObjective: "Legacy objective" });
});

test("transferring a prepared speech clears the previous speaker details", () => {
  const input = meeting({ id: "meeting-10", date: "2026-07-24", role: "Prepared Speaker" });
  const speech = input.blocks[0].items[0];
  Object.assign(speech, {
    session: "Old title",
    pathwaysMode: "pathways",
    pathwaysPath: "Presentation Mastery",
    pathwaysLevel: "2",
    pathwaysProjectId: "project-1",
    pathwaysFormId: "form-1",
    speechObjective: "Old objective",
    externalPresentationUrl: "https://docs.qq.com/slide/old",
  });
  const assignment = bookingAssignments(input, CATALOG).find((candidate) => candidate.role === "Prepared Speaker");
  applyBookingAssignment(input, assignment, { id: "member-2", displayName: "New Speaker" }, undefined, "transfer");
  assert.equal(speech.memberId, "member-2");
  for (const key of ["session", "pathwaysMode", "pathwaysPath", "pathwaysLevel", "pathwaysProjectId", "pathwaysFormId", "speechObjective"]) {
    assert.equal(speech[key], "");
  }
  assert.equal(speech.externalPresentationUrl, "");
});

test("booking and maintaining TTM updates one Agenda presentation link and transfer clears it", () => {
  const input = meeting({ id: "meeting-11", date: "2026-07-24", role: "TTM" });
  const assignment = bookingAssignments(input, CATALOG).find((candidate) => candidate.role === "TTM");
  applyBookingAssignment(input, assignment, { id: "member-1", displayName: "Host A" }, undefined, "book", "https://docs.qq.com/slide/example");
  assert.equal(bookingAssignments(input, CATALOG).find((candidate) => candidate.role === "TTM").externalPresentationUrl, "https://docs.qq.com/slide/example");
  applyBookingAssignment(input, assignment, { id: "member-2", displayName: "Host B" }, undefined, "transfer");
  assert.equal(input.blocks[0].items[0].externalPresentationUrl, "");
});

import assert from "node:assert/strict";
import test from "node:test";

import { groupMeetingAssignments, groupMemberOptions, guestDisplayNameLooksStandard, matchesMemberSearch, memberSpeechDefaults } from "../book-helpers.js";
import {
  applyBookingAssignment,
  bookingAssignments,
  canonicalBookingRole,
  goalProgress,
  nextPathwayDefaults,
  parseSpeechDetails,
} from "../server/booking-repository.js";
import { roleCatalogFromRecords } from "../server/roles-repository.js";

const CATALOG = roleCatalogFromRecords([
  "Prepared Speaker",
  "Individual Evaluator",
  "TME",
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

test("President stays internal to Agenda", () => {
  const input = meeting({ id: "meeting-2", date: "2026-07-24", role: "President" });
  assert.equal(bookingAssignments(input, CATALOG).some((assignment) => assignment.role === "President"), false);
});

test("Sharing Speaker stays internal to Agenda", () => {
  const input = meeting({ id: "meeting-3", date: "2026-07-24", role: "Sharing Speaker" });
  assert.equal(bookingAssignments(input, CATALOG).some((assignment) => assignment.role === "Sharing Speaker"), false);
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

test("prepared speeches and numbered roles normalize to target roles", () => {
  assert.equal(canonicalBookingRole({ kind: "speech", role: "Prepared Speaker 2" }, CATALOG), "Prepared Speaker");
  assert.equal(canonicalBookingRole({ kind: "role", role: "Individual Evaluator 2" }, CATALOG), "Individual Evaluator");
  assert.equal(canonicalBookingRole({ kind: "role", role: "Toastmaster" }, CATALOG), "TME");
  assert.equal(canonicalBookingRole({ kind: "role", role: "Guest Introduction Host" }, CATALOG), "Guest Talk Host");
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
  });
  const assignment = bookingAssignments(input, CATALOG).find((candidate) => candidate.role === "Prepared Speaker");
  applyBookingAssignment(input, assignment, { id: "member-2", displayName: "New Speaker" }, undefined, "transfer");
  assert.equal(speech.memberId, "member-2");
  for (const key of ["session", "pathwaysMode", "pathwaysPath", "pathwaysLevel", "pathwaysProjectId", "pathwaysFormId", "speechObjective"]) {
    assert.equal(speech[key], "");
  }
});

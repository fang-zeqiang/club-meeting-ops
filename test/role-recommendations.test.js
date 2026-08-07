import assert from "node:assert/strict";
import test from "node:test";

import { buildRoleRecommendations, canTransitionOutreach, hasOtherMeetingOutreach, invitationDraft, normalizeRecommendationRecords, recommendationAdvisorTask } from "../role-recommendations.js";
import { polishOutreachDraft } from "../server/role-recommendations-repository.js";

const catalog = {
  recommendationRoles: [
    { name: "Timer", sortOrder: 10, growthSkills: ["时间管理"], recommendedAfterRoles: [], firstTimeSupport: ["提前说明流程"] },
    { name: "Grammarian", sortOrder: 20, growthSkills: ["语言觉察"], recommendedAfterRoles: ["Ah-Counter"], firstTimeSupport: [] },
    { name: "Ah-Counter", sortOrder: 30, growthSkills: ["倾听观察"], recommendedAfterRoles: [], firstTimeSupport: [] },
    { name: "Photographer", sortOrder: 40, growthSkills: ["活动记录"], recommendedAfterRoles: [], firstTimeSupport: [] },
    { name: "Prepared Speaker", sortOrder: 50, growthSkills: ["公开表达"], recommendedAfterRoles: [], firstTimeSupport: [] },
    { name: "Individual Evaluator", sortOrder: 60, growthSkills: ["反馈"], recommendedAfterRoles: [], firstTimeSupport: [] },
  ],
};

const target = {
  id: "meeting-108",
  meetingNumber: 108,
  date: "2026-08-22",
  startTime: "18:40",
  meetingType: "regular_meeting",
  status: "draft",
  blocks: [],
};

const members = [
  { id: "a", displayName: "Alice", active: true, memberType: "member" },
  { id: "b", displayName: "Bob", active: true, memberType: "member" },
  { id: "c", displayName: "Carol", active: true, memberType: "member" },
  { id: "guest", displayName: "Guest, Guest", active: true, memberType: "guest_placeholder" },
];

function build(assignments, overrides = {}) {
  return buildRoleRecommendations({
    meeting: target,
    meetings: [target],
    members,
    catalog,
    profiles: [],
    exclusions: [],
    outreach: [],
    now: new Date("2026-08-06T00:00:00+08:00"),
    assignmentsForMeeting: () => assignments,
    ...overrides,
  });
}

test("outreach state machine prevents skipping the copy and acceptance gates", () => {
  assert.equal(canTransitionOutreach("suggested", "copied"), true);
  assert.equal(canTransitionOutreach("suggested", "contacted"), false);
  assert.equal(canTransitionOutreach("accepted", "booked"), true);
  assert.equal(canTransitionOutreach("declined", "booked"), false);
});

test("a candidate cannot start a second outreach in the same meeting", () => {
  const outreach = [{ meetingId: target.id, assignmentId: "role:timer", memberId: "a", status: "cancelled" }];
  assert.equal(hasOtherMeetingOutreach(outreach, { meetingId: target.id, assignmentId: "role:grammarian", memberId: "a" }), true);
  assert.equal(hasOtherMeetingOutreach(outreach, { meetingId: target.id, assignmentId: "role:timer", memberId: "a" }), false);
});

test("Advisor keeps the recommendation entry visible while loading and activates it when ready", () => {
  const loading = recommendationAdvisorTask();
  assert.equal(loading.action.disabled, true);
  assert.equal(loading.action.loading, true);
  assert.match(loading.reason, /few seconds/);

  const ready = recommendationAdvisorTask({ data: { available: true, summary: { vacancies: 2, suggestedContacts: 3 } } });
  assert.equal(ready.action.disabled, undefined);
  assert.equal(ready.action.task, "role-recommendations");
});

test("recommendation records normalize Feishu filtered rich-text cells", () => {
  const normalized = normalizeRecommendationRecords({ outreach: [{
    outreach_key: [{ type: "text", text: "meeting:role:member" }],
    meeting_id: [{ type: "text", text: "meeting" }],
    assignment_id: [{ type: "text", text: "role" }],
    member_id: [{ type: "text", text: "member" }],
    status: "dismissed",
  }] });
  assert.deepEqual(normalized.outreach[0], {
    key: "meeting:role:member",
    meetingId: "meeting",
    assignmentId: "role",
    memberId: "member",
    status: "dismissed",
    updatedAt: "",
    copiedAt: "",
    contactedAt: "",
    repliedAt: "",
    bookedAt: "",
  });
});

test("recommendations apply hard filters, then reuse a candidate when another role still needs a top result", () => {
  const result = build([
    { id: "role:timer", role: "Timer", status: "vacant", memberId: "", memberName: "" },
    { id: "role:grammarian", role: "Grammarian", status: "vacant", memberId: "", memberName: "" },
    { id: "role:tme", role: "TME", status: "confirmed", memberId: "", memberName: "Bob" },
  ], {
    exclusions: [{ id: "exclude-c", memberId: "c", scope: "meeting", meetingIds: [target.id], reason: "暂不邀约", active: true }],
  });
  const top = result.roles.flatMap((role) => role.topCandidates.map((candidate) => candidate.memberId));
  assert.deepEqual(top, ["a", "a"]);
  assert.equal(result.roles.every((role) => role.candidates.every((candidate) => !["b", "c", "guest"].includes(candidate.memberId))), true);
  assert.equal(result.currentAssignments[0].displayName, "Bob");
  assert.equal(result.summary.suggestedContacts, 1);
  assert.ok(result.roles.some((role) => role.topCandidates[0].preferredAssignmentId !== role.assignmentId));
});

test("recent Guests from the last two completed meetings lead fixed-role recommendations", () => {
  const lulu = { id: "guest-lulu", displayName: "Lulu", active: true, memberType: "guest_placeholder" };
  const generic = { id: "guest-generic", displayName: "Guest, Guest", active: true, memberType: "guest_placeholder" };
  const workshop = { id: "meeting-107", meetingNumber: 107, date: "2026-08-15", meetingType: "workshop", status: "final", blocks: [] };
  const archived = { id: "meeting-106", meetingNumber: 106, date: "2026-08-08", meetingType: "regular_meeting", status: "archived", blocks: [] };
  const older = { id: "meeting-105", meetingNumber: 105, date: "2026-08-01", meetingType: "regular_meeting", status: "archived", blocks: [] };
  const assignments = new Map([
    [target.id, [{ id: "role:timer", role: "Timer", status: "vacant", memberId: "", memberName: "" }]],
    [workshop.id, [{ id: "role:ah", role: "Ah-Counter", status: "confirmed", memberId: lulu.id, memberName: lulu.displayName }]],
    [archived.id, [{ id: "role:grammarian", role: "Grammarian", status: "confirmed", memberId: generic.id, memberName: generic.displayName }]],
    [older.id, [{ id: "role:timer-old", role: "Timer", status: "confirmed", memberId: "guest-old", memberName: "Old Guest" }]],
  ]);
  const result = build([], {
    meetings: [target, workshop, archived, older],
    members: [members[0], lulu, generic, { id: "guest-old", displayName: "Old Guest", active: true, memberType: "guest_placeholder" }],
    assignmentsForMeeting: (meeting) => assignments.get(meeting.id) || [],
  });
  const role = result.roles[0];
  assert.deepEqual(role.candidates.map((candidate) => candidate.memberId), [lulu.id, "a"]);
  assert.equal(role.topCandidates[0].isGuest, true);
  assert.equal(role.topCandidates[0].guestRecentMeetingNumber, 107);
  assert.deepEqual(role.topCandidates[0].details.sources, []);
});

test("eligible Guests stay ahead of formal members in every fixed-role top three", () => {
  const lulu = { id: "guest-lulu", displayName: "Lulu", active: true, memberType: "guest_placeholder" };
  const source = { id: "meeting-107", meetingNumber: 107, date: "2026-08-01", meetingType: "special_event", status: "final", blocks: [] };
  const assignments = new Map([
    [target.id, [
      { id: "role:timer", role: "Timer", status: "vacant", memberId: "", memberName: "" },
      { id: "role:grammarian", role: "Grammarian", status: "vacant", memberId: "", memberName: "" },
    ]],
    [source.id, [{ id: "role:timer-source", role: "Timer", status: "confirmed", memberId: lulu.id, memberName: lulu.displayName }]],
  ]);
  const result = build([], {
    meetings: [target, source],
    members: [members[0], members[1], members[2], lulu],
    assignmentsForMeeting: (meeting) => assignments.get(meeting.id) || [],
  });
  assert.equal(result.roles.every((role) => role.topCandidates[0].memberId === lulu.id), true);
  assert.equal(result.summary.waiting, result.summary.suggestedContacts);
});

test("Guest cooldown crosses the four Guest roles but keeps the candidate in the full list", () => {
  const lulu = { id: "guest-lulu", displayName: "Lulu", active: true, memberType: "guest_placeholder" };
  const source = { id: "meeting-107", meetingNumber: 107, date: "2026-08-01", meetingType: "special_event", status: "final", blocks: [] };
  const assignments = new Map([
    [target.id, [{ id: "role:grammarian", role: "Grammarian", status: "vacant", memberId: "", memberName: "" }]],
    [source.id, [{ id: "role:timer", role: "Timer", status: "confirmed", memberId: lulu.id, memberName: lulu.displayName }]],
  ]);
  const result = build([], {
    meetings: [target, source],
    members: [members[0], lulu],
    outreach: [{ meetingId: source.id, assignmentId: "role:timer", memberId: lulu.id, status: "declined", repliedAt: "2026-08-05 12:00:00" }],
    assignmentsForMeeting: (meeting) => assignments.get(meeting.id) || [],
  });
  const role = result.roles[0];
  assert.deepEqual(role.topCandidates.map((candidate) => candidate.memberId), ["a"]);
  assert.deepEqual(role.candidates.map((candidate) => candidate.memberId), ["a", lulu.id]);
  assert.match(role.candidates[1].risk, /30 天/);
});

test("Prepared Speaker needs explicit readiness and evaluator waits for a speaker", () => {
  const result = build([
    { id: "item:speech", role: "Prepared Speaker", status: "vacant", memberId: "", memberName: "" },
    { id: "item:evaluator", role: "Individual Evaluator", status: "vacant", memberId: "", memberName: "", speakerName: "" },
  ], {
    profiles: [{ memberId: "a", roleInterests: [], growthRoute: "", nextAction: "", readyToContact: true, nextSpeechPlan: "Ice Breaker", validUntil: "2026-12-31" }],
  });
  assert.deepEqual(result.roles.find((role) => role.role === "Prepared Speaker").candidates.map((candidate) => candidate.memberId), ["a"]);
  assert.equal(result.roles.find((role) => role.role === "Individual Evaluator").blockedReason, "先确认 Speaker");
});

test("standard English invitation contains no Chinese ranking text", () => {
  const draft = invitationDraft({
    language: "en",
    meeting: target,
    role: "Timer",
    candidate: { displayName: "Alice", reasons: ["曾明确表达想尝试这个角色", "目标会期前后 30 天没有其他确认任务"] },
    growthSkills: ["时间管理"],
  });
  assert.equal(/\p{Script=Han}/u.test(draft), false);
  assert.match(draft, /previously expressed interest/);
});

test("Guest invitations ask for another role experience without exposing member-development reasons", () => {
  const candidate = { displayName: "Lulu", isGuest: true, reasons: ["适合借角色体验继续邀请"] };
  const chinese = invitationDraft({ meeting: target, role: "Timer", candidate });
  const english = invitationDraft({ language: "en", meeting: target, role: "Timer", candidate });
  assert.match(chinese, /再来体验一下/);
  assert.doesNotMatch(chinese, /成长路线|Pathways/);
  assert.match(english, /experience it/);
  assert.doesNotMatch(english, /Pathways|development direction/);
});

test("DeepSeek polish receives a placeholder and must preserve it", async () => {
  let sentBody;
  const result = await polishOutreachDraft({ draft: "Hi {{NAME}}, would you take Timer?", tone: "更简短" }, {
    apiKey: "test-key",
    fetchImpl: async (_url, options) => {
      sentBody = JSON.parse(options.body);
      return { ok: true, json: async () => ({ choices: [{ message: { content: "Hi {{NAME}}, could you take Timer?" } }] }) };
    },
  });
  assert.equal(JSON.stringify(sentBody).includes("Alice"), false);
  assert.equal(result.draft.includes("{{NAME}}"), true);

  await assert.rejects(() => polishOutreachDraft({ draft: "Hi {{NAME}}", tone: "自然" }, {
    apiKey: "test-key",
    fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: "Hi friend" } }] }) }),
  }), { code: "DEEPSEEK_INVALID_RESPONSE" });
});

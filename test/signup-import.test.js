import assert from "node:assert/strict";
import test from "node:test";

import { applySignupChanges } from "../signup-import-apply.js";
import {
  SIGNUP_IMPORT_MODEL,
  analyzeSignup,
  buildSignupReview,
  buildValidatedSignupMeeting,
  normalizeSignupPersonName,
  requestDeepSeekSignupParse,
} from "../server/signup-import.js";

const members = [
  { id: "member_taylor", displayName: "Taylor LEE, TM" },
  { id: "member_riley", displayName: "Riley DAVIS" },
  { id: "member_morgan", displayName: "Morgan PARK, PM" },
  { id: "member_casey", displayName: "Casey KIM, PM5" },
  { id: "member_alex", displayName: "Alex CHEN, PM1" },
];

function meeting() {
  return {
    id: "meeting_102",
    meetingNumber: 102,
    revision: 18,
    date: "2026-07-14",
    startTime: "18:40",
    theme: "Travel",
    status: "draft",
    meetingManagerMemberId: "",
    meetingManager: "",
    photographerMemberId: "",
    photographer: "",
    blocks: [
      { id: "opening", items: [
        { id: "timer-intro", kind: "role", role: "Timer", session: "Timer Intro", memberId: "member_riley", member: "Riley DAVIS", status: "confirmed", roleAssignmentId: "functional-timer" },
      ] },
      { id: "prepared", items: [
        { id: "speech-1", kind: "speech", role: "Prepared Speaker 1", session: "", memberId: "", member: "", status: "vacant", evaluatorId: "", evaluator: "", evaluatorStatus: "vacant" },
      ] },
      { id: "closing", items: [
        { id: "timer-report", kind: "role", role: "Timer", session: "Timer Report", memberId: "member_riley", member: "Riley DAVIS", status: "confirmed", roleAssignmentId: "functional-timer" },
        { id: "evaluation-1", kind: "role", role: "Individual Evaluator", session: "Speech Evaluation 1", memberId: "", member: "", status: "vacant", linkedSpeechId: "speech-1" },
      ] },
    ],
  };
}

test("signup names ignore case, Pathways suffixes, and Guest markers", () => {
  assert.equal(normalizeSignupPersonName("  Morgan PARK，PM5 "), "morgan park");
  assert.equal(normalizeSignupPersonName("Riley Davis(Guest )"), "riley davis");
  assert.equal(normalizeSignupPersonName("Angelica@Guest"), "angelica");
});

test("signup review only proposes validated current-meeting changes", () => {
  const review = buildSignupReview({
    meeting: meeting(),
    members,
    modelOutput: {
      meeting: {
        meetingNumber: 102,
        theme: "What I saw in Silicon Valley",
        endTime: "20:40",
        meetingManager: { name: "Alex CHEN, PM1" },
      },
      changes: [
        { itemId: "timer-intro", field: "member", value: "Taylor LEE, TM" },
        { itemId: "timer-report", field: "member", value: "Taylor LEE, TM" },
        { itemId: "speech-1", field: "member", value: "morgan XIONG,PM" },
        { itemId: "speech-1", field: "evaluator", value: "Casey", suggestedMemberIds: ["member_casey", "invented"] },
        { itemId: "speech-1", field: "session", value: "A better question" },
        { itemId: "missing", field: "member", value: "Nobody" },
      ],
      ignored: [{ label: "Next Speech Speaker", value: "Taylor", reason: "Future meeting" }],
    },
  });

  assert.equal(review.model, SIGNUP_IMPORT_MODEL);
  assert.equal(review.meetingMismatch, false);
  assert.equal(review.changes.filter((change) => change.field === "member" && change.label.startsWith("Timer")).length, 1);
  const timer = review.changes.find((change) => change.label.startsWith("Timer"));
  assert.deepEqual(timer.targetIds, ["timer-intro", "timer-report"]);
  assert.equal(timer.newMemberId, "member_taylor");
  assert.equal(timer.overwrite, true);
  assert.equal(timer.selected, false);
  const evaluator = review.changes.find((change) => change.field === "evaluator");
  assert.deepEqual(evaluator.options.map((option) => option.id), ["member_casey"]);
  assert.equal(evaluator.requiresConfirmation, true);
  assert.equal(review.unapplied.length, 1);
  assert.match(review.notes[0], /end time 20:40/);
  assert.equal(review.ignored.length, 1);
});

test("conflicting names stay unselected and meeting mismatch blocks apply", () => {
  const review = buildSignupReview({
    meeting: meeting(),
    members,
    modelOutput: {
      meeting: { meetingNumber: 101 },
      changes: [
        { itemId: "timer-intro", field: "member", value: "Taylor LEE" },
        { itemId: "timer-report", field: "member", value: "Riley Davis" },
      ],
    },
  });
  assert.equal(review.canApply, false);
  assert.equal(review.meetingMismatch, true);
  assert.equal(review.changes.length, 2);
  assert.ok(review.changes.every((change) => change.conflictGroup && !change.selected));
});

test("meeting date mismatch blocks apply and invalid calendar dates are ignored", () => {
  const review = buildSignupReview({
    meeting: meeting(),
    members,
    modelOutput: { meeting: { meetingNumber: 102, date: "2026-07-15" }, changes: [] },
  });
  assert.equal(review.meetingDateMismatch, true);
  assert.equal(review.canApply, false);

  const invalid = buildSignupReview({
    meeting: meeting(),
    members,
    modelOutput: { meeting: { meetingNumber: 102, date: "2026-02-31" }, changes: [] },
  });
  assert.equal(invalid.meetingDateMismatch, false);
  assert.equal(invalid.changes.some((change) => change.field === "date"), false);
});

test("applying reviewed changes preserves Agenda structure and confirms assignments", () => {
  const source = meeting();
  const beforeIds = source.blocks.flatMap((block) => block.items.map((item) => item.id));
  const next = applySignupChanges(source, [
    { selected: true, scope: "meeting", field: "theme", newValue: "Imported theme" },
    { selected: true, scope: "meeting", field: "meetingManager", newValue: "Alex CHEN, PM1", newMemberId: "member_alex" },
    { selected: true, scope: "agenda", field: "member", targetIds: ["timer-intro", "timer-report"], newValue: "Taylor LEE, TM", newMemberId: "member_taylor" },
    { selected: true, scope: "agenda", field: "evaluator", targetIds: ["speech-1"], newValue: "Casey KIM, PM5", newMemberId: "member_casey" },
    { selected: true, scope: "agenda", field: "session", targetIds: ["speech-1"], newValue: "A better question" },
  ]);
  assert.equal(source.theme, "Travel");
  assert.equal(next.theme, "Imported theme");
  assert.equal(next.meetingManagerMemberId, "member_alex");
  assert.deepEqual(next.blocks.flatMap((block) => block.items.map((item) => item.id)), beforeIds);
  assert.equal(next.blocks[0].items[0].status, "confirmed");
  assert.equal(next.blocks[2].items[0].memberId, "member_taylor");
  assert.equal(next.blocks[1].items[0].evaluatorStatus, "confirmed");
  assert.equal(next.blocks[2].items[1].memberId, "member_casey");
  assert.equal(next.blocks[2].items[1].status, "confirmed");
  assert.equal(next.blocks[1].items[0].session, "A better question");
});

test("analysis rejects unsafe input before calling DeepSeek", async () => {
  const source = meeting();
  const neverFetch = () => assert.fail("DeepSeek should not be called");
  await assert.rejects(
    analyzeSignup({ signupText: "too short", meeting: source, members, expectedRevision: source.revision, fetchImpl: neverFetch }),
    (error) => error.code === "INVALID_SIGNUP_TEXT",
  );
  await assert.rejects(
    analyzeSignup({ signupText: "Meeting signup text that is long enough", meeting: { ...source, status: "final" }, members, expectedRevision: source.revision, fetchImpl: neverFetch }),
    (error) => error.code === "MEETING_NOT_DRAFT",
  );
  await assert.rejects(
    analyzeSignup({ signupText: "Meeting signup text that is long enough", meeting: source, members, expectedRevision: source.revision - 1, fetchImpl: neverFetch }),
    (error) => error.code === "REVISION_CONFLICT",
  );
});

test("server rebuilds signup apply from allowed current items and members", () => {
  const source = meeting();
  const next = buildValidatedSignupMeeting({
    meeting: source,
    members,
    expectedRevision: source.revision,
    changes: [
      { scope: "meeting", field: "theme", targetIds: [source.id], newValue: "Validated theme" },
      { scope: "agenda", field: "member", targetIds: ["timer-intro", "timer-report"], newValue: "Forged name", newMemberId: "member_taylor" },
    ],
  });
  assert.equal(next.theme, "Validated theme");
  assert.equal(next.blocks[0].items[0].member, "Taylor LEE, TM");
  assert.throws(
    () => buildValidatedSignupMeeting({ meeting: source, members, expectedRevision: source.revision, changes: [{ scope: "agenda", field: "duration", targetIds: ["timer-intro"], newValue: "99" }] }),
    (error) => error.code === "INVALID_SIGNUP_APPLY",
  );
  assert.throws(
    () => buildValidatedSignupMeeting({ meeting: source, members, expectedRevision: source.revision, changes: [{ scope: "agenda", field: "member", targetIds: ["missing"], newMemberId: "member_taylor" }] }),
    (error) => error.code === "INVALID_SIGNUP_APPLY",
  );
  assert.throws(
    () => buildValidatedSignupMeeting({ meeting: source, members, expectedRevision: source.revision, changes: [{ scope: "agenda", field: "member", targetIds: ["timer-intro"], newMemberId: "invented" }] }),
    (error) => error.code === "INVALID_SIGNUP_APPLY",
  );
});

test("DeepSeek request uses JSON mode, disables thinking, and retries invalid content once", async () => {
  const calls = [];
  const fetchImpl = async (_url, options) => {
    calls.push(JSON.parse(options.body));
    const content = calls.length === 1 ? "not json" : JSON.stringify({ meeting: { meetingNumber: 102 }, changes: [], ignored: [], unapplied: [] });
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const parsed = await requestDeepSeekSignupParse({ signupText: "Meeting #102 signup text long enough", meeting: meeting(), members, apiKey: "test-key", fetchImpl, timeoutMs: 1000 });
  assert.equal(parsed.meeting.meetingNumber, 102);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].model, SIGNUP_IMPORT_MODEL);
  assert.deepEqual(calls[0].response_format, { type: "json_object" });
  assert.deepEqual(calls[0].thinking, { type: "disabled" });
  const context = JSON.parse(calls[0].messages[1].content);
  assert.deepEqual(context.members[0], { id: "member_taylor", displayName: "Taylor LEE, TM" });
  assert.equal("email" in context.members[0], false);
});

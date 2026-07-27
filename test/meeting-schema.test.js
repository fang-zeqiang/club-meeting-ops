import assert from "node:assert/strict";
import test from "node:test";
import {
  asText,
  linkedIds,
  normalizeBlockType,
  normalizeItemKind,
  normalizeItemStatus,
  normalizeMeeting,
  splitStartsAt,
  startsAtTimestamp,
} from "../server/meeting-schema.js";

test("normalizes Feishu single-select arrays to canonical block and item types", () => {
  assert.equal(normalizeBlockType(["prepared_speeches"]), "prepared_speeches");
  assert.equal(normalizeItemKind(["speech"]), "speech");
  assert.equal(normalizeItemKind(["break"]), "break");
});

test("normalizes Feishu text arrays to item statuses", () => {
  assert.equal(normalizeItemStatus([{ text: "confirmed", type: "text" }]), "confirmed");
});

const meeting = {
  id: "meeting_test",
  meetingNumber: 101,
  date: "2026-06-27",
  startTime: "18:40",
  theme: "A useful theme",
  meetingType: "regular_meeting",
  status: "draft",
  venue: "Shanghai",
  votingCode: "CODE-101",
  wordOfDay: { word: "Momentum", pronunciation: "", example: "Keep moving." },
  blocks: [
    {
      id: "block_opening",
      type: "opening",
      title: "Opening",
      items: [
        {
          id: "item_host",
          kind: "role",
          session: "Welcome",
          role: "Host",
          duration: 3,
          member: "Guest / TBD",
          status: "pending",
        },
      ],
    },
  ],
};

test("normalizes a canonical meeting and derives order indexes", () => {
  const result = normalizeMeeting(meeting);
  assert.equal(result.blocks[0].orderIndex, 0);
  assert.equal(result.blocks[0].items[0].orderIndex, 0);
  assert.equal(result.blocks[0].items[0].duration, 3);
  assert.equal(result.blocks[0].items[0].speechObjective, "");
  assert.equal(result.blocks[0].items[0].externalPresentationUrl, "");
  assert.equal(result.enableTransitionTime, false);
  assert.equal(result.photographerMemberId, "");
  assert.equal(result.meetingManagerMemberId, "");
  assert.equal(result.qrSource, "system");
  assert.deepEqual(result.tableTopicsSpeakers, []);
  assert.equal(result.reviewStatus, "pending");
  assert.equal(result.qualityScore, null);
  assert.equal(result.reviewCompletedAt, "");
});

test("draft meetings can persist before date and theme are filled", () => {
  const draft = structuredClone(meeting);
  draft.date = "";
  draft.theme = "";
  draft.blocks[0].items[0].kind = "speech";
  draft.blocks[0].items[0].session = "";
  assert.equal(normalizeMeeting(draft).date, "");
  assert.equal(normalizeMeeting(draft).blocks[0].items[0].session, "");
  assert.equal(startsAtTimestamp("", "18:40"), "");
  assert.deepEqual(splitStartsAt(""), { date: "", startTime: "18:40" });
  draft.status = "final";
  assert.throws(() => normalizeMeeting(draft), /Meeting date is required/);
});

test("accepts HTTPS external presentation URLs and rejects unsafe schemes", () => {
  const withExternal = structuredClone(meeting);
  withExternal.blocks[0].items[0].externalPresentationUrl = "https://example.com/slides/demo";
  assert.equal(normalizeMeeting(withExternal).blocks[0].items[0].externalPresentationUrl, "https://example.com/slides/demo");

  withExternal.blocks[0].items[0].externalPresentationUrl = "javascript:alert(1)";
  assert.throws(() => normalizeMeeting(withExternal), /valid HTTPS URL/);
});

test("preserves a prepared speech objective", () => {
  const withObjective = structuredClone(meeting);
  withObjective.blocks[0].type = "prepared_speeches";
  withObjective.blocks[0].items[0].kind = "speech";
  withObjective.blocks[0].items[0].speechObjective = "Use vocal variety to strengthen the story.";
  assert.equal(normalizeMeeting(withObjective).blocks[0].items[0].speechObjective, withObjective.blocks[0].items[0].speechObjective);
});

test("normalizes structured Pathways speech details", () => {
  const input = structuredClone(meeting);
  Object.assign(input.blocks[0].items[0], {
    kind: "speech",
    pathwaysMode: "pathways",
    pathwaysPath: "Presentation Mastery",
    pathwaysLevel: "2",
    pathwaysProjectId: "project-understanding-your-communication-style-l2",
    pathwaysFormId: "form-understanding-your-communication-style-l2",
  });
  const item = normalizeMeeting(input).blocks[0].items[0];
  assert.equal(item.pathwaysMode, "pathways");
  assert.equal(item.pathwaysProjectId, "project-understanding-your-communication-style-l2");
  assert.equal(item.pathwaysFormId, "form-understanding-your-communication-style-l2");
});

test("normalizes dirty status values and meeting-level support roles", () => {
  const dirty = structuredClone(meeting);
  dirty.enableTransitionTime = 1;
  dirty.photographerMemberId = "member_photo";
  dirty.photographer = "Photographer Guest";
  dirty.meetingManagerMemberId = "member_manager";
  dirty.meetingManager = "Manager Guest";
  dirty.blocks[0].items[0].status = " Confirmed ";
  const result = normalizeMeeting(dirty);
  assert.equal(result.enableTransitionTime, true);
  assert.equal(result.photographerMemberId, "member_photo");
  assert.equal(result.photographer, "Photographer Guest");
  assert.equal(result.meetingManagerMemberId, "member_manager");
  assert.equal(result.meetingManager, "Manager Guest");
  assert.equal(result.blocks[0].items[0].status, "confirmed");
});

test("rejects invalid durations", () => {
  const invalid = structuredClone(meeting);
  invalid.blocks[0].items[0].duration = 0;
  assert.throws(() => normalizeMeeting(invalid), /duration/i);
});

test("accepts break items without role, member, or status", () => {
  const withBreak = structuredClone(meeting);
  withBreak.blocks[0].items[0] = {
    id: "item_break",
    kind: "break",
    session: "Break",
    duration: 5,
  };
  const item = normalizeMeeting(withBreak).blocks[0].items[0];
  assert.equal(item.kind, "break");
  assert.equal(item.role, "");
  assert.equal(item.member, "");
  assert.equal(item.externalPresentationUrl, "");
  assert.equal(item.status, "");
});

test("break items still require a session and positive duration", () => {
  const invalid = structuredClone(meeting);
  invalid.blocks[0].items[0] = { id: "item_break", kind: "break", session: "", duration: 5 };
  assert.throws(() => normalizeMeeting(invalid), /Session title/);
  invalid.blocks[0].items[0].session = "Break";
  invalid.blocks[0].items[0].duration = 0;
  assert.throws(() => normalizeMeeting(invalid), /duration/i);
});

test("round trips Shanghai meeting timestamps", () => {
  const timestamp = startsAtTimestamp("2026-06-27", "18:40");
  assert.deepEqual(splitStartsAt(timestamp), { date: "2026-06-27", startTime: "18:40" });
  assert.deepEqual(splitStartsAt("2026-06-27 18:40:00"), { date: "2026-06-27", startTime: "18:40" });
});

test("normalizes Feishu text and link response shapes", () => {
  assert.equal(asText([{ type: "text", text: "Agenda" }, { type: "text", text: " Maker" }]), "Agenda Maker");
  assert.equal(asText({ type: "url", text: "https://example.com/slides", link: "https://example.com/slides" }), "https://example.com/slides");
  assert.deepEqual(linkedIds([{ record_id: "rec_a" }, { id: "rec_b" }]), ["rec_a", "rec_b"]);
  assert.deepEqual(linkedIds({ link_record_ids: ["rec_c"] }), ["rec_c"]);
});

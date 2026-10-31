import assert from "node:assert/strict";
import test from "node:test";
import { agendaPrintRecommendation, groupMeetingsForSwitchboard, isShanghaiMeetingToday, selectCurrentMeeting, sortMeetingsForPicker } from "../workflow-helpers.js";

test("agenda print quantity uses unique role takers plus the meeting 102 attendance ratio", () => {
  const result = agendaPrintRecommendation({
    meetingManagerMemberId: "member-a",
    photographerMemberId: "member-c",
    blocks: [{ items: [
      { kind: "role", memberId: "member-a", member: "A" },
      { kind: "speech", memberId: "member-b", member: "B", evaluatorId: "member-c", evaluator: "C" },
      { kind: "break" },
    ] }],
  });
  assert.deepEqual(result, { roleTakers: 3, copies: 4, upliftPercent: 12 });
});

test("keeps today's Shanghai meeting current after its start time", () => {
  const meetings = [
    { id: "later", meetingNumber: 105, date: "2026-07-29", startTime: "18:00", status: "draft" },
    { id: "today", meetingNumber: 104, date: "2026-07-28", startTime: "18:40", status: "draft" },
  ];
  assert.equal(selectCurrentMeeting(meetings, new Date("2026-07-28T12:00:00Z"))?.id, "today");
});

test("selects final meetings and excludes archived meetings", () => {
  const now = new Date("2026-07-28T12:00:00Z");
  assert.equal(selectCurrentMeeting([
    { id: "archived", date: "2026-07-28", status: "archived" },
    { id: "final", date: "2026-07-28", status: "final" },
  ], now)?.id, "final");
  assert.equal(selectCurrentMeeting([
    { id: "archived", date: "2026-07-28", status: "archived" },
    { id: "future-final", date: "2026-07-29", status: "final" },
  ], now)?.id, "future-final");
});

test("uses the Shanghai calendar date regardless of device timezone", () => {
  const meeting = { id: "today", date: "2026-07-29", status: "draft" };
  const now = new Date("2026-07-28T16:30:00-07:00");
  assert.equal(isShanghaiMeetingToday(meeting, now), true);
  assert.equal(selectCurrentMeeting([meeting], now), meeting);
});

test("puts the nearest upcoming meeting first in the picker", () => {
  const meetings = [
    { id: "later", meetingNumber: 104, date: "2026-08-01", startTime: "18:00", status: "draft" },
    { id: "nearest", meetingNumber: 103, date: "2026-07-18", startTime: "18:00", status: "draft" },
    { id: "final", meetingNumber: 102, date: "2026-07-01", startTime: "18:00", status: "final" },
  ];
  assert.deepEqual(sortMeetingsForPicker(meetings, new Date("2026-07-17T04:00:00Z")).map(({ id }) => id), ["nearest", "later", "final"]);
});

test("keeps one next meeting, four nearby meetings, and hides the rest", () => {
  const meetings = [
    ...Array.from({ length: 9 }, (_, index) => {
      const meetingNumber = 112 - index;
      return {
        id: `future-${meetingNumber}`,
        meetingNumber,
        date: `2026-08-${String(meetingNumber - 103).padStart(2, "0")}`,
        startTime: "18:00",
        status: "draft",
      };
    }),
    { id: "next", meetingNumber: 103, date: "2026-07-18", startTime: "18:00", status: "draft" },
    { id: "recent", meetingNumber: 102, date: "2026-07-04", startTime: "18:00", status: "final" },
  ];
  const groups = groupMeetingsForSwitchboard(meetings, new Date("2026-07-17T04:00:00Z"));
  assert.equal(groups.next.id, "next");
  assert.deepEqual(groups.nearby.map(({ meetingNumber }) => meetingNumber), [104, 105, 106, 107]);
  assert.equal(groups.more.length, 6);
});

test("keeps every non-leading meeting in nearby or more", () => {
  const meetings = [
    { id: "today", date: "2026-07-28", status: "final" },
    { id: "future", date: "2026-07-29", status: "final" },
    { id: "past", date: "2026-07-27", status: "draft" },
    { id: "archived", date: "2026-07-26", status: "archived" },
  ];
  const groups = groupMeetingsForSwitchboard(meetings, new Date("2026-07-28T12:00:00Z"));
  assert.equal(groups.next.id, "today");
  assert.deepEqual(new Set([...groups.nearby, ...groups.more].map(({ id }) => id)), new Set(["future", "past", "archived"]));
});

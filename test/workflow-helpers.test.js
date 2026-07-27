import assert from "node:assert/strict";
import test from "node:test";
import { agendaPrintRecommendation, groupMeetingsForSwitchboard, selectCurrentMeeting, sortMeetingsForPicker } from "../workflow-helpers.js";

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

test("selects the nearest upcoming draft instead of the largest meeting number", () => {
  const meetings = [
    { id: "final", meetingNumber: 105, date: "2026-07-03", startTime: "18:00", status: "final" },
    { id: "later", meetingNumber: 104, date: "2026-08-01", startTime: "18:00", status: "draft" },
    { id: "nearest", meetingNumber: 100, date: "2026-07-03", startTime: "18:00", status: "draft" },
    { id: "past", meetingNumber: 99, date: "2026-07-01", startTime: "18:00", status: "draft" },
  ];
  assert.equal(selectCurrentMeeting(meetings, new Date(2026, 6, 2, 12, 0))?.id, "nearest");
});

test("returns no current meeting when every draft has started", () => {
  const meetings = [{ id: "past", date: "2026-07-02", startTime: "11:59", status: "draft" }];
  assert.equal(selectCurrentMeeting(meetings, new Date(2026, 6, 2, 12, 0)), null);
});

test("puts the nearest upcoming meeting first in the picker", () => {
  const meetings = [
    { id: "later", meetingNumber: 104, date: "2026-08-01", startTime: "18:00", status: "draft" },
    { id: "nearest", meetingNumber: 103, date: "2026-07-18", startTime: "18:00", status: "draft" },
    { id: "final", meetingNumber: 102, date: "2026-07-01", startTime: "18:00", status: "final" },
  ];
  assert.deepEqual(sortMeetingsForPicker(meetings, new Date(2026, 6, 17, 12, 0)).map(({ id }) => id), ["nearest", "later", "final"]);
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
  const groups = groupMeetingsForSwitchboard(meetings, new Date(2026, 6, 17, 12, 0));
  assert.equal(groups.next.id, "next");
  assert.deepEqual(groups.nearby.map(({ meetingNumber }) => meetingNumber), [104, 105, 106, 107]);
  assert.equal(groups.more.length, 6);
});

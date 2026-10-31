import assert from "node:assert/strict";
import test from "node:test";
import { getPreparedSpeeches, getSpeechObjectiveDensityClass, syncLinkedAgendaItems } from "../meeting-helpers.js";

test("returns speech items from prepared-speech blocks in agenda order", () => {
  const first = { id: "first", kind: "speech" };
  const second = { id: "second", kind: "speech" };
  const meeting = {
    blocks: [
      { type: "prepared_speeches", items: [first, { id: "chair", kind: "role" }] },
      { type: "custom", items: [{ id: "custom-speech", kind: "speech" }] },
      { type: "prepared_speeches", items: [second] },
    ],
  };

  assert.deepEqual(getPreparedSpeeches(meeting), [first, second]);
});

test("returns an empty list when no prepared speeches are scheduled", () => {
  assert.deepEqual(getPreparedSpeeches({ blocks: [{ type: "opening", items: [] }] }), []);
});

test("speech objective density class tracks PS count (107 期马拉松场景为 5+)", () => {
  assert.equal(getSpeechObjectiveDensityClass(0), "");
  assert.equal(getSpeechObjectiveDensityClass(2), "");
  assert.equal(getSpeechObjectiveDensityClass(3), "speech-objective-density-compact");
  assert.equal(getSpeechObjectiveDensityClass(4), "speech-objective-density-tight");
  assert.equal(getSpeechObjectiveDensityClass(5), "speech-objective-density-overflow objectives-overflow-risk");
  assert.equal(getSpeechObjectiveDensityClass(8), "speech-objective-density-overflow objectives-overflow-risk");
});

test("functional Intro and Report assignments sync both ways with legacy role ids", () => {
  const intro = { id: "intro", role: "Timer", roleId: "timer", member: "A", memberId: "a", status: "confirmed" };
  const report = { id: "report", role: "Timer", roleId: "timer", member: "", memberId: "", status: "vacant" };
  const unrelated = { id: "other", role: "Timer", roleId: "custom:timer", member: "B", status: "confirmed" };
  const items = [intro, report, unrelated];

  report.member = "C";
  report.memberId = "c";
  syncLinkedAgendaItems(items, report, "member");
  assert.equal(intro.member, "C");
  assert.equal(intro.memberId, "c");
  assert.equal(unrelated.member, "B");

  const previousRoleId = report.roleId;
  report.role = "Timekeeper";
  report.roleId = "custom:timekeeper";
  syncLinkedAgendaItems(items, report, "role", previousRoleId);
  assert.equal(intro.role, "Timekeeper");
  assert.equal(intro.roleId, "custom:timekeeper");
});

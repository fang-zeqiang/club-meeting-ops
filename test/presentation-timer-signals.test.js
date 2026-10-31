import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_TIMER_STYLE, normalizeTimerStyle, timerSignalsForItem, timerSignalState } from "../presentation-timer-signals.js";
import { derivePresentationSlides } from "../meeting-presentation-model.js";

test("three timer styles use card as the safe default", () => {
  assert.equal(DEFAULT_TIMER_STYLE, "card");
  assert.equal(normalizeTimerStyle("stack"), "stack");
  assert.equal(normalizeTimerStyle("inset"), "inset");
  assert.equal(normalizeTimerStyle("unknown"), "card");
});

test("speech signals advance at exact nodes and the bell leaves red active", () => {
  const rule = timerSignalsForItem({ kind: "speech", duration: 7 });
  assert.deepEqual(rule, { green: 300, yellow: 360, red: 420, bell: 450 });
  assert.deepEqual([299, 300, 359, 360, 420, 449, 450, 600].map((sec) => timerSignalState(sec, rule)),
    ["waiting", "green", "green", "yellow", "red", "red", "bell", "bell"]);
});

test("every timed agenda item derives signals from its duration", () => {
  const nodes = (duration, extra = {}) => timerSignalsForItem({ kind: "role", duration, ...extra });
  assert.deepEqual(nodes(1), { green: 30, yellow: 45, red: 60, bell: 90 });
  assert.deepEqual(nodes(2), { green: 60, yellow: 90, red: 120, bell: 150 });
  assert.deepEqual(nodes(3), { green: 120, yellow: 150, red: 180, bell: 210 });
  assert.deepEqual(nodes(6), { green: 240, yellow: 300, red: 360, bell: 390 });
  assert.deepEqual(nodes(15), { green: 780, yellow: 840, red: 900, bell: 930 });
  assert.deepEqual(nodes(30), { green: 1680, yellow: 1740, red: 1800, bell: 1830 });
  assert.equal(timerSignalsForItem({ kind: "speech", duration: 7, pathwaysProjectId: "special-project" }).red, 420);
  assert.equal(timerSignalsForItem({ kind: "speech", duration: 12 }).green, 600);
});

test("explicit item nodes override the duration rule", () => {
  assert.deepEqual(timerSignalsForItem({ kind: "speech", duration: 7, timerGreenSec: 240, timerYellowSec: 300, timerRedSec: 360, timerBellSec: 390 }),
    { green: 240, yellow: 300, red: 360, bell: 390 });
});

test("breaks, votes and untimed items keep the plain countdown", () => {
  assert.equal(timerSignalsForItem({ kind: "break", session: "Tea Break", duration: 10 }), null);
  assert.equal(timerSignalsForItem({ kind: "role", role: "Host", duration: 0 }), null);
  const meeting = { blocks: [{ title: "Prepared Speech", items: [{ kind: "speech", session: "Talk", duration: 7 }, { kind: "role", session: "TTM", role: "TTM", duration: 15 }, { kind: "role", session: "Vote & Announcement", role: "Voting Host", duration: 3 }] }] };
  const slides = derivePresentationSlides(meeting, { tableTopicsTotal: 3 });
  assert.equal(slides.find((slide) => slide.type === "speech").timerSignals.red, 420);
  assert.equal(slides.find((slide) => slide.type === "tabletopics-draw").timerSignals, undefined);
  assert.equal(slides.find((slide) => slide.type === "vote").timerSignals, undefined);
});

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { awardCeremonySlides, createAwardPoller, replaceAwardCeremonySlides } from "../presentation-awards.js";

const styles = await readFile(new URL("../presentation-awards.css", import.meta.url), "utf8");
const presentationStyles = await readFile(new URL("../meeting-presentation.css", import.meta.url), "utf8");

test("ceremony turns every available award into a fixed-order certificate and finish slide", () => {
  const slides = awardCeremonySlides({ awards: [
    { type: "best_facilitator", title: "Best Facilitator", winners: [{ name: "Bob" }] },
    { type: "best_role_taker", title: "Best Role Taker", winners: [{ name: "Alice" }] },
  ] });
  assert.deepEqual(slides.map((slide) => slide.type), ["award-certificate", "award-certificate", "award-finish"]);
  assert.deepEqual(slides.map((slide) => slide.award?.type), ["best_role_taker", "best_facilitator", undefined]);
  assert.deepEqual(slides.slice(0, 2).map((slide) => slide.awardSlot), ["best_role_taker:1", "best_facilitator:1"]);
});

test("empty ceremony stays empty so Presentation can show its waiting state", () => {
  assert.deepEqual(awardCeremonySlides({ awards: [] }), []);
});

test("replacing ceremony keeps Awards and Thanks boundaries", () => {
  const base = [{ type: "vote" }, { type: "awards" }, { type: "thanks" }];
  const replacement = [{ type: "award-certificate" }, { type: "award-finish" }];
  assert.deepEqual(replaceAwardCeremonySlides(base, replacement).map((slide) => slide.type), ["vote", "awards", "award-certificate", "award-finish", "thanks"]);
});

test("poller starts immediately, never overlaps, and manual refresh stays manual", async () => {
  const scheduled = [];
  let resolveLoad;
  let calls = 0;
  const poller = createAwardPoller({
    load: () => { calls += 1; return new Promise((resolve) => { resolveLoad = resolve; }); },
    onData: () => {}, onError: () => {}, intervalMs: 5000,
    schedule: (fn, ms) => { scheduled.push({ fn, ms }); return scheduled.length; }, cancel: () => {},
  });
  const first = poller.start();
  assert.equal(poller.start(), first);
  assert.equal(calls, 1);
  resolveLoad({ ready: false });
  await first;
  assert.equal(scheduled[0].ms, 5000);
  poller.stop();
  const manual = poller.refreshOnce();
  resolveLoad({ ready: true });
  await manual;
  assert.equal(poller.isRunning(), false);
  assert.equal(scheduled.length, 1);
});

test("certificate styling is fixed, theme-independent, and has a quiet refresh overlay", () => {
  assert.match(styles, /\.award-certificate-slide/);
  assert.match(styles, /\.award-live-refresh/);
  assert.doesNotMatch(styles, /var\(--pres-/);
  assert.doesNotMatch(styles, /\.stage-decor/);
});

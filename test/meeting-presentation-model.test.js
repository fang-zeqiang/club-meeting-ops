import test from "node:test";
import assert from "node:assert/strict";
import { derivePresentationSlides, findSlideJumpIndex, isWordReminderVisible, supportsWordReminder, tableTopicsDrawPool, topicTokens } from "../meeting-presentation-model.js";

test("findSlideJumpIndex locates the tabletopics draw slide", () => {
  const slides = [{ type: "cover" }, { type: "tabletopics" }, { type: "tabletopics-draw" }, { type: "thanks" }];
  assert.equal(findSlideJumpIndex(slides, "tabletopics"), 2);
});

test("findSlideJumpIndex locates the nth prepared speech slide", () => {
  const slides = [{ type: "cover" }, { type: "speech" }, { type: "item" }, { type: "speech" }, { type: "thanks" }];
  assert.equal(findSlideJumpIndex(slides, "ps", 2), 3);
});

test("findSlideJumpIndex returns -1 when the requested slide does not exist", () => {
  const slides = [{ type: "cover" }, { type: "thanks" }];
  assert.equal(findSlideJumpIndex(slides, "ps", 1), -1);
});

test("findSlideJumpIndex returns null when no jump was requested", () => {
  assert.equal(findSlideJumpIndex([{ type: "cover" }], "", 0), null);
});

test("Word reminder appears only on eligible system slides", () => {
  assert.equal(supportsWordReminder({ type: "speech" }), true);
  assert.equal(supportsWordReminder({ type: "tabletopics-draw" }), true);
  assert.equal(supportsWordReminder({ type: "grammarian-report" }), true);
  assert.equal(supportsWordReminder({ type: "cover" }), false);
  assert.equal(supportsWordReminder({ type: "grammarian-intro" }), false);
  assert.equal(supportsWordReminder({ type: "external-content" }), false);
  assert.equal(supportsWordReminder({ type: "sharing-master-award" }), false);
  assert.equal(supportsWordReminder({ type: "vote" }), true);
  assert.equal(supportsWordReminder({ type: "awards" }), false);
  assert.equal(supportsWordReminder({ type: "thanks" }), true);
  assert.equal(supportsWordReminder({ type: "future-posters" }), false);
});

test("Word reminder stays visible from Grammarian Intro to the last slide regardless of navigation direction", () => {
  const slides = ["cover", "grammarian-intro", "speech", "grammarian-report", "external-content", "vote", "future-posters", "awards", "thanks"].map((type) => ({ type }));
  assert.deepEqual(slides.map((_, index) => isWordReminderVisible(slides, index)), [false, false, true, true, true, true, true, true, true]);
  assert.equal(isWordReminderVisible([{ type: "speech" }, { type: "vote" }], 1), false);
});

test("Grammarian slides use explicit presentation phases instead of item order", () => {
  const slides = derivePresentationSlides({
    meetingNumber: 101,
    theme: "Share",
    date: "2026-10-15",
    wordOfDay: { word: "Momentum", definition: "持续推进", usage: "用于描述稳步进展" },
    blocks: [{ title: "Opening", items: [
      { key: "later", kind: "role", session: "Grammarian Report", role: "Grammarian", duration: 3, presentationPhase: "grammarian_report" },
      { key: "first", kind: "role", session: "Grammarian Intro", role: "Grammarian", member: "Ada", duration: 2, presentationPhase: "grammarian_intro" },
    ] }],
  });

  const intro = slides.find((slide) => slide.key === "item:first");
  const report = slides.find((slide) => slide.key === "item:later");
  assert.equal(intro.type, "grammarian-intro");
  assert.deepEqual(intro.wordOfDay, { word: "Momentum", pronunciation: "", partOfSpeech: "", definition: "持续推进", usage: "用于描述稳步进展", example: "" });
  assert.equal(report.type, "grammarian-report");
});

test("Timer Report uses an explicit presentation phase", () => {
  const slides = derivePresentationSlides({
    meetingNumber: 101, theme: "Share", date: "2026-10-15", blocks: [{ title: "Evaluation", items: [
      { key: "timer-report", kind: "role", session: "Timer Report", role: "Timer", member: "Grace", duration: 3, presentationPhase: "timer_report" },
    ] }],
  });
  assert.equal(slides.find((slide) => slide.key === "item:timer-report").type, "timer-report");
});

test("Table Topics draw pool serves fresh topics first", () => {
  assert.deepEqual(tableTopicsDrawPool({ total: 4, drawnKeys: ["a", "b"], heldKeys: ["b"], ownKey: "b" }), { excludeKeys: ["a", "b"], available: 2, tier: "fresh" });
});

test("Table Topics draw pool recycles swapped-away topics once fresh ones run out", () => {
  // a 被 Speaker 换掉，b、c 仍在 Speaker 手上：只有 a 回到题库
  assert.deepEqual(tableTopicsDrawPool({ total: 3, drawnKeys: ["a", "b", "c"], heldKeys: ["b", "c"], ownKey: "c" }), { excludeKeys: ["b", "c"], available: 1, tier: "recycled" });
});

test("Table Topics draw pool shares topics when speakers outnumber them but never repeats your own", () => {
  assert.deepEqual(tableTopicsDrawPool({ total: 2, drawnKeys: ["a", "b"], heldKeys: ["a", "b"], ownKey: "b" }), { excludeKeys: ["b"], available: 1, tier: "shared" });
  assert.deepEqual(tableTopicsDrawPool({ total: 2, drawnKeys: ["a", "b"], heldKeys: ["a", "b"] }), { excludeKeys: [], available: 2, tier: "shared" });
  assert.equal(tableTopicsDrawPool({ total: 1, drawnKeys: ["a"], heldKeys: ["a"], ownKey: "a" }).available, 0);
});

test("topic tokens keep punctuation with the word or character it belongs to", () => {
  assert.deepEqual(topicTokens("【Tough News】 high. How?"), ["【Tough", " ", "News】", " ", "high.", " ", "How?"]);
  assert.deepEqual(topicTokens("don't stop"), ["don't", " ", "stop"]);
  assert.deepEqual(topicTokens("你好，世界。"), ["你", "好，", "世", "界。"]);
  assert.equal(topicTokens("a b c").join(""), "a b c");
});

test("Contest decks label the cover, skip public voting, and hide evaluator lines", () => {
  const meeting = {
    meetingNumber: 114,
    blocks: [{ title: "Prepared Speeches", type: "prepared_speeches", items: [
      { key: "s1", kind: "speech", session: "Prepared Speech 1", member: "Ada", duration: 8 },
      { key: "awards", kind: "role", session: "Awards & Closing", role: "President", duration: 4 },
    ] }],
  };
  const contest = derivePresentationSlides({ ...meeting, meetingType: "contest" });
  assert.equal(contest[0].subtitle, "No.114 Mock Speech Contest");
  assert.equal(contest.some((slide) => slide.type === "vote"), false);
  assert.equal(contest.some((slide) => slide.type === "awards"), true);
  assert.equal(contest.find((slide) => slide.type === "speech").hideEvaluator, true);

  const regular = derivePresentationSlides(meeting);
  assert.equal(regular[0].subtitle, "No.114 Regular Meeting");
  assert.equal(regular.some((slide) => slide.type === "vote"), true);
  assert.equal(regular.find((slide) => slide.type === "speech").hideEvaluator, false);
});

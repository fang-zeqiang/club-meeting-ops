import test from "node:test";
import assert from "node:assert/strict";
import { toPresentationMeeting } from "../server/presentation-repository.js";
import { derivePresentationSlides } from "../meeting-presentation-model.js";

const wordOfDay = { word: "Momentum", pronunciation: "/məˈmentəm/", partOfSpeech: "noun", definition: "持续推进的力量", usage: "build momentum", example: "Small wins build momentum." };
const makeMeeting = () => ({ meetingNumber: 101, wordOfDay, blocks: [
  { type: "opening", title: "自定义开场标题", items: [{ id: "intro", kind: "role", role: "Grammarian", session: "自定义介绍标题", member: "Ada" }] },
  { type: "closing", title: "结束", items: [{ id: "report", kind: "role", roleId: "grammarian", role: "语法官", session: "总结" }] },
] });

test("existing meetings show the complete training card through the public projection without a new phase field", () => {
  const slides = derivePresentationSlides(toPresentationMeeting(makeMeeting()));
  const intro = slides.find((slide) => slide.title === "自定义介绍标题");
  assert.equal(intro.type, "grammarian-intro");
  assert.deepEqual(intro.wordOfDay, wordOfDay);
  const report = slides.find((slide) => slide.title === "总结");
  assert.equal(report.type, "grammarian-report");
  assert.equal(report.wordOfDay.word, "Momentum");
});

test("explicit phases override block placement and ordinary custom sessions are not guessed by title", () => {
  const meeting = makeMeeting();
  meeting.blocks[0].items[0].presentationPhase = "grammarian_report";
  meeting.blocks.push({ type: "custom", items: [{ kind: "role", role: "Grammarian", session: "Grammarian Intro" }] });
  const slides = derivePresentationSlides(toPresentationMeeting(meeting));
  assert.equal(slides.find((slide) => slide.title === "自定义介绍标题").type, "grammarian-report");
  assert.equal(slides.find((slide) => slide.title === "Grammarian Intro").type, "item");
});

test("missing Word falls back to a normal session and never creates an empty training card", () => {
  const meeting = makeMeeting();
  meeting.wordOfDay = {};
  const intro = derivePresentationSlides(toPresentationMeeting(meeting)).find((slide) => slide.title === "自定义介绍标题");
  assert.equal(intro.type, "grammarian-intro");
  assert.equal(intro.wordOfDay, null);
});

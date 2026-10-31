import test from "node:test";
import assert from "node:assert/strict";
import { renderWordTrainingCard, wordTrainingTooLong } from "../presentation-word-card.js";

test("training card renders all six fields safely and cannot be temporarily edited", () => {
  const html = renderWordTrainingCard({ word: "<Momentum>", pronunciation: "/məˈmentəm/", partOfSpeech: "noun", definition: "持续推进", usage: "build momentum", example: "Small wins build momentum." });
  for (const value of ["&lt;Momentum&gt;", "/məˈmentəm/", "noun", "持续推进", "build momentum", "Small wins build momentum."]) assert.ok(html.includes(value));
  assert.doesNotMatch(html, /data-editable-text|<Momentum>/);
});

test("missing fields do not leave empty labels and missing Word produces no card", () => {
  const html = renderWordTrainingCard({ word: "Momentum" });
  assert.doesNotMatch(html, /Meaning|Usage|Example|word-phonetics|undefined|null/);
  assert.equal(renderWordTrainingCard({ definition: "Only meaning" }), "");
});

test("overlong training text is bounded and flagged for Agenda preparation", () => {
  const word = { word: "Momentum", definition: "长".repeat(600), usage: "u".repeat(600), example: "e".repeat(600) };
  assert.equal(wordTrainingTooLong(word), true);
  const html = renderWordTrainingCard(word);
  assert.ok(html.includes("…"));
  assert.ok(html.length < 1800);
  assert.equal(wordTrainingTooLong({ word: "Momentum", definition: "向前的力量" }), false);
});

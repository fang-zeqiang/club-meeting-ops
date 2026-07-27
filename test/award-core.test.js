import assert from "node:assert/strict";
import test from "node:test";
import { aggregateAwardResults, AWARD_TYPES, createConfirmedSnapshot, englishList, recognitionAwardResults } from "../server/award-core.js";

test("englishList formats joint winners", () => {
  assert.equal(englishList(["A", "B"]), "A and B");
  assert.equal(englishList(["A", "B", "C"]), "A, B and C");
});

test("aggregateAwardResults ignores blanks and keeps every tied leader", () => {
  const results = aggregateAwardResults([
    { "Best Individual Evaluator": [{ text: "Alice" }], "Best Prepared Speaker": "Carol" },
    { "Best Individual Evaluator": "Bob", "Best Prepared Speaker": "" },
  ]);
  assert.deepEqual(results.find((award) => award.type === "best_individual_evaluator").winners.map(({ name }) => name), ["Alice", "Bob"]);
  assert.deepEqual(results.find((award) => award.type === "best_prepared_speaker").winners.map(({ name }) => name), ["Carol"]);
});

test("award order follows the ceremony flow", () => {
  assert.deepEqual(AWARD_TYPES.map(({ field }) => field), [
    "Best Role Taker",
    "Best Functional Role",
    "Best Table Topics Speaker",
    "Best Prepared Speaker",
    "Best Individual Evaluator",
    "Best Facilitator",
  ]);
});

test("recognition awards prepend sharing master and speech completion", () => {
  const results = recognitionAwardResults({
    votingForm: { recognitionAwardConfig: { sharingMasterRoleIds: ["ttm"], sharingMasterNames: ["Override A", "Override B"] } },
    blocks: [
      { type: "table_topics", items: [{ kind: "role", role: "TTM", member: "Role A", status: "confirmed" }] },
      { type: "prepared_speeches", items: [
        { kind: "speech", session: "Speech A", member: "Speaker A", status: "confirmed" },
        { kind: "speech", session: "Speech B", member: "", status: "vacant" },
      ] },
    ],
  });
  assert.deepEqual(results.map(({ type }) => type), ["sharing_master", "speech_completion"]);
  assert.equal(results[0].winners[0].name, "Override A & Override B");
  assert.equal(results[1].winners[0].context, "Speech A");
});

test("snapshot freezes meeting date and president", () => {
  const results = aggregateAwardResults([{ "Best Individual Evaluator": "Alice" }]);
  const snapshot = createConfirmedSnapshot({
    meeting: { date: "2026-07-02", meetingNumber: 100 }, results,
    president: { memberId: "m1", name: "Jordan" }, operator: { name: "Alex" },
    responseCount: 7, resultsVersion: "version-7",
    now: new Date("2026-07-02T10:00:00Z"),
  });
  assert.equal(snapshot.meetingDate, "2026-07-02");
  assert.equal(snapshot.signatory.name, "Jordan");
  assert.equal(snapshot.confirmedBy.name, "Alex");
  assert.equal(snapshot.responseCount, 7);
  assert.equal(snapshot.resultsVersion, "version-7");
});

test("snapshot deduplicates a winner while retaining every winning context", () => {
  const snapshot = createConfirmedSnapshot({
    meeting: { date: "2026-07-02", meetingNumber: 100 },
    results: [{ type: "best_prepared_speaker", title: "Best Prepared Speaker", winners: [
      { name: "Alice", context: "Speech A" }, { name: "Alice", context: "Speech B" },
    ] }],
    president: { name: "Jordan" }, operator: { name: "Alex" },
  });
  assert.deepEqual(snapshot.awards[0].winners, [{ memberId: "", name: "Alice", context: "Speech A / Speech B" }]);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  formatTableTopicsDuration,
  isTableTopicsWritableToday,
  normalizeTableTopicsEntries,
  tableTopicsNameKey,
  validateTableTopicsEntries,
} from "../table-topics-entries.js";

test("legacy speaker names become stable ordered entries", () => {
  assert.deepEqual(normalizeTableTopicsEntries([], ["Ada Lovelace", "Grace Hopper"]), [
    { id: "legacy-1-ada-lovelace", name: "Ada Lovelace", order: 1, durationSeconds: null, placeholder: false, aliases: ["Ada Lovelace"] },
    { id: "legacy-2-grace-hopper", name: "Grace Hopper", order: 2, durationSeconds: null, placeholder: false, aliases: ["Grace Hopper"] },
  ]);
});

test("normalizes a speaker name for duplicate detection", () => {
  assert.equal(tableTopicsNameKey("  ADA　 Lovelace  "), "ada lovelace");
});

test("normalizes and formats Table Topics durations", () => {
  const entries = normalizeTableTopicsEntries([
    { id: "entry-1", name: "Ada Lovelace", order: 4, durationSeconds: "83", aliases: [] },
    { id: "entry-2", name: "Grace Hopper", order: 2, durationSeconds: "1:42", aliases: ["Grace Hopper"] },
  ]);
  assert.deepEqual(entries.map(({ id, name, order, durationSeconds, placeholder, aliases }) => ({ id, name, order, durationSeconds, placeholder, aliases })), [
    { id: "entry-2", name: "Grace Hopper", order: 1, durationSeconds: 102, placeholder: false, aliases: ["Grace Hopper"] },
    { id: "entry-1", name: "Ada Lovelace", order: 2, durationSeconds: 83, placeholder: false, aliases: ["Ada Lovelace"] },
  ]);
  assert.equal(formatTableTopicsDuration(83), "1:23");
  assert.equal(formatTableTopicsDuration(null), "—");
});

test("Table Topics writing is gated by the Hong Kong calendar date", () => {
  const now = new Date("2026-10-15T23:30:00+08:00");
  assert.equal(isTableTopicsWritableToday("2026-10-14", now), false);
  assert.equal(isTableTopicsWritableToday("2026-10-15", now), true);
  assert.equal(isTableTopicsWritableToday("2026-10-16", now), true);
});

test("structured Table Topics entries reject duplicate visible names and invalid current entry", () => {
  assert.throws(() => validateTableTopicsEntries([
    { id: "one", name: "Ada", order: 1 }, { id: "two", name: " ADA ", order: 2 },
  ], "one"), { code: "DUPLICATE_TABLE_TOPICS_SPEAKER" });
  assert.throws(() => validateTableTopicsEntries([{ id: "one", name: "Ada", order: 1 }], "missing"), { code: "INVALID_CURRENT_TABLE_TOPICS_ENTRY" });
});

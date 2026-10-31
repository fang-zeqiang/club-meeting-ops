import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildLiveAwardCeremony } from "../server/award-core.js";

const meeting = { meetingNumber: 114, date: "2026-10-28" };

test("one available result is enough for a live ceremony", () => {
  const result = buildLiveAwardCeremony({
    meeting, president: null, responseCount: 1, resultsVersion: "v1", clubName: "DEMO SPEAKING CLUB",
    results: [
      { type: "best_role_taker", title: "Best Role Taker", winners: [{ name: "Alice" }] },
      { type: "best_facilitator", title: "Best Facilitator", winners: [] },
    ],
  });
  assert.equal(result.ready, true);
  assert.equal(result.availableAwardCount, 1);
  assert.deepEqual(result.awards.map(({ type }) => type), ["best_role_taker"]);
  assert.deepEqual(result.signatory, { memberId: "", name: "" });
  assert.deepEqual(result.warnings, ["President 未配置 · 奖状签名将留空"]);
});

test("ties remain one award with every top winner", () => {
  const result = buildLiveAwardCeremony({
    meeting, president: { memberId: "p1", name: "Pat" }, responseCount: 1, resultsVersion: "v2",
    results: [{ type: "best_prepared_speaker", title: "Best Prepared Speaker", winners: [{ name: "Alice" }, { name: "Bob" }] }],
  });
  assert.deepEqual(result.awards[0].winners.map(({ name }) => name), ["Alice", "Bob"]);
});

test("recognition awards can open the ceremony without ballots", () => {
  const result = buildLiveAwardCeremony({
    meeting, president: null, responseCount: 0, resultsVersion: "v0",
    results: [{ type: "speech_completion", title: "Speech Completion", winners: [{ name: "Alice" }] }],
  });
  assert.equal(result.ready, true);
});

test("no available result returns a non-blocking waiting contract", () => {
  const result = buildLiveAwardCeremony({ meeting, president: null, responseCount: 0, resultsVersion: "v0", results: [] });
  assert.equal(result.ready, false);
  assert.deepEqual(result.awards, []);
});

test("Awards API is live-read-only", async () => {
  const apiSource = await readFile(new URL("../api/meetings/[id]/awards.js", import.meta.url), "utf8");
  const repositorySource = await readFile(new URL("../server/award-repository.js", import.meta.url), "utf8");
  assert.match(apiSource, /request\.query\.view === "ceremony"/);
  assert.match(apiSource, /request\.query\.view === "live"/);
  assert.match(apiSource, /requireSession/);
  assert.doesNotMatch(apiSource, /confirmAwards/);
  assert.doesNotMatch(apiSource, /request\.method === "POST"/);
  assert.doesNotMatch(repositorySource, /confirmed_awards_json/);
  assert.doesNotMatch(repositorySource, /award_audit_json/);
});

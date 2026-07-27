import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  AWARDS, candidateChangePlan, candidateChangeSummary, candidatesFromMeeting, FEEDBACK_FIELDS,
  feedbackFromRecords, tableTopicsFormFieldInput, tallyVotingResults,
} from "../server/voting-repository.js";
import { roleAwardIssues } from "../role-awards.js";

const source = await readFile(new URL("../server/voting-repository.js", import.meta.url), "utf8");

test("derives ordered unique voting candidates", () => {
  const meeting = {
    tableTopicsSpeakers: [" Alice ", "Bob", "Alice", ""],
    blocks: [{ type: "opening", items: [
      { id: "tme", kind: "role", role: "TME", member: "Chair A", status: "confirmed" },
      { id: "ttm", kind: "role", role: "TTM", member: "Facilitator A", status: "confirmed" },
      { id: "ah-intro", kind: "role", role: "Ah-counter", member: "Ah A", status: "confirmed" },
      { id: "ah-report", kind: "role", role: "Ah Counter", member: "Ah A", status: "confirmed" },
      { id: "timer-intro", roleAssignmentId: "timer", kind: "role", role: "Timer", member: "Timer A", status: "confirmed" },
    ] }, { type: "closing", items: [
      { id: "timer-report", roleAssignmentId: "timer", kind: "role", role: "Timer", member: "Timer A", status: "confirmed" },
    ] }, { type: "prepared_speeches", items: [
      { id: "speech-a", kind: "speech", session: "Speech A", member: "Speaker A", status: "confirmed", evaluator: "Evaluator A", evaluatorStatus: "confirmed" },
      { id: "speech-b", kind: "speech", session: "Speech B", member: "Speaker B", status: "confirmed", evaluator: "Evaluator A", evaluatorStatus: "confirmed" },
      { kind: "role", member: "Not a candidate", evaluator: "" },
    ] }],
  };
  const candidates = candidatesFromMeeting(meeting);
  assert.deepEqual(candidates.roleTaker.map(({ label }) => label), ["Toastmaster of the Evening — Chair A"]);
  assert.deepEqual(candidates.facilitator.map(({ label }) => label), ["Table Topics Master — Facilitator A"]);
  assert.deepEqual(candidates.functionalRole.map(({ label }) => label), ["Ah-Counter — Ah A", "Timer — Timer A"]);
  assert.deepEqual(candidates.preparedSpeaker.map(({ label }) => label), ["Speaker A — Speech A", "Speaker B — Speech B"]);
  assert.deepEqual(candidates.evaluator.map(({ label }) => label), ["Evaluator A — Evaluated: Speaker A / Speaker B"]);
  assert.deepEqual(candidates.tableTopicsSpeaker.map(({ label }) => label), ["Alice", "Bob"]);
});

test("role taker extension rejects roles already owned by another award pool", () => {
  const issues = roleAwardIssues({
    votingForm: { roleAwardConfig: { roleTakerRoleIds: ["ttm"] } },
    blocks: [{ items: [{ kind: "role", role: "TTM" }] }],
  });
  assert.match(issues.blockers.join(" "), /Best Facilitator/);
});

test("candidate snapshots remain stable and ordered", () => {
  const candidates = candidatesFromMeeting({
    tableTopicsSpeakers: ["Topic A"],
    blocks: [{ type: "prepared_speeches", items: [{ id: "a", kind: "speech", session: "A", status: "confirmed", member: "Speaker A", evaluatorStatus: "confirmed", evaluator: "Evaluator A" }] }],
  });
  assert.deepEqual(structuredClone(candidates), candidates);
});

test("voting form awards follow the ceremony order", () => {
  assert.deepEqual(Object.values(AWARDS), [
    "Best Role Taker",
    "Best Functional Role",
    "Best Table Topics Speaker",
    "Best Prepared Speaker",
    "Best Individual Evaluator",
    "Best Facilitator",
  ]);
});

test("candidate change summary covers additions, removals and renames", () => {
  const previous = {
    roleTaker: [{ id: "tme", label: "TME — Alice" }],
    tableTopicsSpeaker: [{ id: "table-topics:bob", label: "Bob" }],
  };
  const next = {
    roleTaker: [{ id: "tme", label: "TME — Carol" }],
    tableTopicsSpeaker: [
      { id: "table-topics:bob", label: "Bob" },
      { id: "table-topics:dora", label: "Dora" },
    ],
  };
  assert.deepEqual(candidateChangeSummary(next, previous), {
    addedCount: 2,
    removedCount: 1,
    added: [
      { award: "Best Role Taker", label: "TME — Carol" },
      { award: "Best Table Topics Speaker", label: "Dora" },
    ],
    removed: [{ award: "Best Role Taker", label: "TME — Alice" }],
  });
});

test("any candidate change requires response reset only when responses exist", () => {
  const previous = { tableTopicsSpeaker: [{ id: "table-topics:bob", label: "Bob" }] };
  const added = { tableTopicsSpeaker: [...previous.tableTopicsSpeaker, { id: "table-topics:dora", label: "Dora" }] };
  assert.equal(candidateChangePlan(added, previous, 0).responseResetRequired, false);
  assert.equal(candidateChangePlan(added, previous, 3).responseResetRequired, true);
  assert.equal(candidateChangePlan(previous, previous, 3).responseResetRequired, false);
});

test("table topics fast sync always reconciles form visibility and order", () => {
  assert.deepEqual(tableTopicsFormFieldInput({ tableTopicsSpeaker: [] }), { visible: false });
  const candidates = {
    roleTaker: [{ id: "tme" }],
    functionalRole: [],
    tableTopicsSpeaker: [{ id: "table-topics:alice" }],
  };
  assert.deepEqual(tableTopicsFormFieldInput(candidates), {
    title: "Best Table Topics Speaker", required: true, visible: true, index: 1,
  });
  candidates.functionalRole.push({ id: "timer" });
  candidates.tableTopicsSpeaker.push({ id: "table-topics:bob" });
  assert.deepEqual(tableTopicsFormFieldInput(candidates), {
    title: "Best Table Topics Speaker", required: true, visible: true, index: 2,
  });
});

test("meeting feedback reports average, distribution and bounded comments", () => {
  const feedback = feedbackFromRecords([
    { fields: { [FEEDBACK_FIELDS.rating]: "🌟🌟🌟🌟🌟", [FEEDBACK_FIELDS.comments]: " Great meeting " } },
    { fields: { [FEEDBACK_FIELDS.rating]: "🌟🌟🌟", [FEEDBACK_FIELDS.comments]: "x".repeat(1200) } },
  ]);
  assert.equal(feedback.averageRating, 4);
  assert.equal(feedback.distribution[5], 1);
  assert.equal(feedback.distribution[3], 1);
  assert.equal(feedback.comments[1].length, 1000);
});

test("live tally keeps zero-vote candidates, historical votes, ties and a stable version", () => {
  const current = { tableTopicsSpeaker: [
    { id: "alice", name: "Alice", label: "Alice" },
    { id: "bob", name: "Bob", label: "Bob" },
  ] };
  const synced = { tableTopicsSpeaker: [...current.tableTopicsSpeaker, { id: "old", name: "Old", label: "Old" }] };
  const records = [{ fields: { "Best Table Topics Speaker": "Alice" } }, { fields: { "Best Table Topics Speaker": "Old" } }];
  const first = tallyVotingResults(current, synced, records);
  const candidates = Object.fromEntries(first.awards.tableTopicsSpeaker.candidates.map((candidate) => [candidate.name, candidate]));
  assert.equal(candidates.Bob.votes, 0);
  assert.equal(candidates.Old.historical, true);
  assert.deepEqual(first.awards.tableTopicsSpeaker.winners.map(({ name }) => name), ["Alice", "Old"]);
  assert.equal(first.resultsVersion, tallyVotingResults(current, synced, records).resultsVersion);
  assert.notEqual(first.resultsVersion, tallyVotingResults(current, synced, [...records, records[0]]).resultsVersion);
});

test("table creation batches fields while same-table repairs stay serialized", () => {
  assert.match(source, /table\.field_id_list\?\.length === inputs\.length/);
  assert.match(source, /VOTING_POOL_DESCRIPTION = "agenda-voting-pool:v1"/);
  assert.match(source, /usedVotingTableIds/);
  assert.match(source, /poolOptimized = poolBaseline \|\| metadata\.poolSchemaVersion === 1/);
  assert.match(source, /fieldsReady \|\| changes\.addedCount \|\| changes\.removedCount/);
  assert.match(source, /runTasks\(fieldSpecs\.map/);
  assert.match(source, /runTasks\(\[\.\.\.hiddenFields, \.\.\.awardUpdates/);
  assert.match(source, /QRCode\.toBuffer[\s\S]*ensureResourceEditors/);
  assert.match(source, /const hintedRecordsPromise = tableIdHint \? votingRecords/);
  assert.match(source, /updateBitableField[\s\S]*tableTopicsFormFieldInput\(candidates\)[\s\S]*table_topics_speakers_json/);
  assert.match(source, /table_topics_speakers_json: JSON\.stringify\(next\)[\s\S]*voting_form_json: JSON\.stringify\(updated\)/);
});

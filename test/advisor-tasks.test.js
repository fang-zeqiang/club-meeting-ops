import assert from "node:assert/strict";
import test from "node:test";
import { buildAdvisorTasks } from "../advisor-tasks.js";

const meeting = (patch = {}) => ({
  status: "draft",
  reviewStatus: "pending",
  votingForm: null,
  ...patch,
});

test("advisor prioritizes agenda blockers", () => {
  const tasks = buildAdvisorTasks({
    meeting: meeting(),
    issues: [{ severity: "blocker", text: "Theme is missing.", stage: "preparation", task: "meeting-details", focusKey: "meta:theme" }],
  });
  assert.equal(tasks.now.title, "Fix agenda blocker");
  assert.equal(tasks.now.action.task, "meeting-details");
  assert.equal(tasks.risks.length, 1);
  assert.equal(tasks.next[0].title, "Update future meeting posters");
  assert.equal(tasks.next[0].action.task, "future-posters");
  assert.equal(tasks.next[0].action.focusKey, "future-poster-1");
});

test("advisor moves finalized meetings through voting and awards", () => {
  const tasks = buildAdvisorTasks({ meeting: meeting({ status: "final", votingForm: { formId: "form_1" } }) });
  assert.equal(tasks.now.title, "Start voting");

  const results = buildAdvisorTasks({
    meeting: meeting({ status: "final", votingForm: { formId: "form_1" } }),
    votingResults: { responseCount: 3 },
  });
  assert.equal(results.now.title, "Confirm results");
  assert.equal(results.now.action.task, "voting-console");
});

test("advisor does not duplicate a missing future poster blocker", () => {
  const tasks = buildAdvisorTasks({
    meeting: meeting(),
    issues: [{ severity: "blocker", text: "Future meeting poster 1 is required.", stage: "preparation", task: "future-posters", focusKey: "future-poster-1" }],
  });
  assert.equal(tasks.now.action.task, "future-posters");
  assert.equal(tasks.next.some((task) => task.title === "Update future meeting posters"), false);
});

test("advisor stops after review completion", () => {
  const tasks = buildAdvisorTasks({ meeting: meeting({ reviewStatus: "completed" }) });
  assert.equal(tasks.now, null);
  assert.equal(tasks.empty.title, "Meeting loop complete");
  assert.deepEqual(tasks.next, []);
});

test("advisor keeps overflow tasks for the UI More control", () => {
  const issues = Array.from({ length: 5 }, (_, index) => ({
    severity: "blocker",
    text: `Blocker ${index + 1}`,
    stage: "preparation",
    task: "build-agenda",
    focusKey: `item:${index}`,
  }));
  assert.equal(buildAdvisorTasks({ meeting: meeting(), issues }).risks.length, 5);
});

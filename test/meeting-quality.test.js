import assert from "node:assert/strict";
import test from "node:test";
import { buildQualityMetrics, qualityConfidence, qualityScore } from "../meeting-quality.js";

const meeting = {
  theme: "Quality loop",
  qrSource: "system",
  votingForm: { formId: "form_1" },
  wordOfDay: { word: "Momentum" },
  tableTopicsSpeakers: ["A", "B"],
  blocks: [
    {
      items: [
        { kind: "role", session: "TME", duration: 3, member: "A", status: "confirmed" },
        { kind: "speech", session: "Speech", duration: 7, member: "B", status: "confirmed" },
        { kind: "role", session: "Timer", duration: 2, member: "", status: "vacant" },
      ],
    },
  ],
};

test("builds stable meeting quality metrics", () => {
  const metrics = buildQualityMetrics(meeting, {
    responseCount: 5,
    awardsConfirmed: true,
    feedback: { averageRating: 4.5, comments: ["Great"] },
  });
  assert.deepEqual(Object.keys(metrics), ["readiness", "roleCoverage", "speakerSupply", "runCompletion", "audienceFeedback"]);
  assert.equal(metrics.readiness.status, "good");
  assert.equal(metrics.runCompletion.score, 20);
  assert.equal(qualityScore(metrics), Object.values(metrics).reduce((sum, item) => sum + item.score, 0));
  assert.equal(qualityConfidence(metrics), 1);
});

test("marks missing audience feedback as unknown without guessing", () => {
  const metrics = buildQualityMetrics(meeting);
  assert.equal(metrics.audienceFeedback.status, "unknown");
  assert.equal(metrics.audienceFeedback.confidence, 0);
  assert.ok(qualityConfidence(metrics) < 1);
});

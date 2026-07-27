import assert from "node:assert/strict";
import test from "node:test";
import { templateFromMeeting } from "../server/templates-repository.js";

const sourceMeeting = {
  id: "meeting_101",
  meetingNumber: 101,
  date: "2026-06-27",
  startTime: "18:40",
  theme: "Useful Theme",
  meetingType: "regular_meeting",
  status: "draft",
  venue: "Shanghai",
  votingCode: "CODE-101",
  votingQr: { present: true, name: "vote.png" },
  wordOfDay: { word: "Momentum", pronunciation: "/m/", example: "Keep going." },
  revision: 4,
  blocks: [
    {
      id: "block_1",
      type: "prepared_speeches",
      title: "Prepared Speech Session",
      notes: "Keep time tightly.",
      items: [
        {
          id: "item_1",
          kind: "speech",
          session: "A Better Question",
          role: "Prepared Speaker 1",
          duration: 7,
          member: "Alex",
          evaluator: "Casey",
          pathwaysMode: "pathways",
          pathwaysPath: "Presentation Mastery",
          pathwaysLevel: "3",
          pathwaysProjectId: "project-active-listening-l3",
          pathwaysFormId: "form-active-listening-l3",
          speechObjective: "Use cleaner transitions.",
          externalPresentationUrl: "https://example.com/slides/demo",
          status: "confirmed",
        },
      ],
    },
  ],
};

test("templateFromMeeting keeps reusable agenda structure only", () => {
  const template = templateFromMeeting(sourceMeeting, "Regular Meeting Template");
  assert.equal(template.name, "Regular Meeting Template");
  assert.equal(template.meetingType, "regular_meeting");
  assert.equal(template.sourceMeetingId, "meeting_101");
  assert.equal(template.blocks.length, 1);
  assert.deepEqual(template.blocks[0], {
    type: "prepared_speeches",
    title: "Prepared Speech Session",
    notes: "Keep time tightly.",
    items: [
      {
        templateItemId: "item_1",
        kind: "speech",
        session: "A Better Question",
        role: "Prepared Speaker 1",
        duration: 7,
        evaluatorStatus: "vacant",
        pathwaysMode: "pathways",
        pathwaysPath: "Presentation Mastery",
        pathwaysLevel: "3",
        pathwaysProjectId: "project-active-listening-l3",
        pathwaysFormId: "form-active-listening-l3",
        speechObjective: "Use cleaner transitions.",
        status: "confirmed",
      },
    ],
  });
  assert.ok(template.id.startsWith("template_"));
  assert.ok(template.createdAt);
  assert.equal("externalPresentationUrl" in template.blocks[0].items[0], false);
});

test("templateFromMeeting rejects invalid template payloads", () => {
  const invalidMeeting = structuredClone(sourceMeeting);
  invalidMeeting.blocks[0].items[0].duration = 0;
  assert.throws(() => templateFromMeeting(invalidMeeting, "Broken template"), /duration/i);
  assert.throws(() => templateFromMeeting(sourceMeeting, "x".repeat(121)), /120 characters/i);
});

test("templateFromMeeting preserves break items with empty assignment fields", () => {
  const withBreak = structuredClone(sourceMeeting);
  withBreak.blocks[0].items = [{ kind: "break", session: "Break", role: "", duration: 5, status: "" }];
  assert.deepEqual(templateFromMeeting(withBreak, "Break Template").blocks[0].items[0], {
    kind: "break",
    session: "Break",
    role: "",
    duration: 5,
    speechObjective: "",
    status: "",
  });
});

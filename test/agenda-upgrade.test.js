import assert from "node:assert/strict";
import test from "node:test";
import { upgradeAgenda } from "../agenda-upgrade.js";

test("draft agenda migrates roles and installs linked functional sessions", () => {
  const meeting = upgradeAgenda({
    id: "m1", status: "draft", blocks: [
      { type: "opening", items: [{ id: "tme", kind: "role", session: "Program", role: "Toastmaster", duration: 3, member: "A", status: "confirmed" }] },
      { type: "prepared_speeches", items: [{ id: "speech", kind: "speech", session: "Speech", role: "Speaker", duration: 7, member: "B", status: "confirmed", evaluator: "C" }] },
      { type: "evaluation", items: [{ id: "eval", kind: "role", session: "Speech Evaluation 1", role: "Individual Evaluator", duration: 3, member: "C", status: "confirmed" }, { id: "ge", kind: "role", session: "General Evaluator Report", role: "General Evaluator", duration: 5, member: "D", status: "confirmed" }] },
      { type: "closing", items: [{ id: "vote", kind: "role", session: "Voting & Announcement", role: "Voting Host", duration: 4, member: "A", status: "confirmed" }] },
    ],
  });
  assert.equal(meeting.blocks[0].items[0].role, "TME");
  assert.deepEqual(meeting.blocks[0].items.slice(-3).map(({ session, duration }) => [session, duration]), [["Timer Intro", 2], ["Grammarian Intro", 2], ["Ah-Counter Intro", 1]]);
  assert.deepEqual(meeting.blocks[3].items.slice(0, 5).map(({ role, duration }) => [role, duration]), [["Ah-Counter", 2], ["Grammarian", 3], ["Timer", 3], ["GE", 5], ["Voting Host", 4]]);
  assert.equal(meeting.blocks[1].items[0].evaluatorStatus, "confirmed");
  assert.equal(meeting.blocks[2].items[0].linkedSpeechId, "speech");
});

test("final agenda remains untouched", () => {
  const meeting = { id: "old", status: "final", blocks: [{ type: "opening", items: [{ role: "Toastmaster" }] }] };
  assert.deepEqual(upgradeAgenda(meeting), meeting);
});

test("draft agenda does not restore removed functional intros when reports remain", () => {
  const meeting = upgradeAgenda({
    id: "m2", status: "draft", blocks: [
      { type: "opening", items: [{ id: "tme", kind: "role", session: "Program", role: "TME", duration: 3, member: "A", status: "confirmed" }] },
      { type: "evaluation", items: [] },
      { type: "closing", items: [
        { id: "timer-report", kind: "role", session: "Timer Report", role: "Timer", duration: 3, member: "", status: "vacant" },
        { id: "ah-report", kind: "role", session: "Ah-Counter Report", role: "Ah-Counter", duration: 2, member: "", status: "vacant" },
      ] },
    ],
  });
  const sessions = meeting.blocks.flatMap((block) => block.items.map((item) => item.session));
  assert.equal(sessions.includes("Timer Intro"), false);
  assert.equal(sessions.includes("Ah-Counter Intro"), false);
});

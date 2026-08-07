import assert from "node:assert/strict";
import test from "node:test";

import { checkExternalPublicUrl, isPublicIp } from "../server/external-public-url.js";
import {
  agendaTimeline,
  createAgendaEditService,
  createAgendaProposal,
  verifyAgendaProposal,
} from "../server/mcp-agenda-edit.js";

const principal = { id: "token_record_1", name: "Test Officer" };

function sampleMeeting() {
  return {
    id: "meeting_105",
    meetingNumber: 105,
    date: "2026-08-11",
    startTime: "18:40",
    theme: "Momentum",
    status: "draft",
    revision: 23,
    enableTransitionTime: true,
    meetingManagerMemberId: "member_jordan",
    meetingManager: "Jordan LEE",
    photographerMemberId: "",
    photographer: "",
    review: { private: "must not leak" },
    blocks: [
      {
        id: "opening",
        type: "opening",
        title: "Opening",
        notes: "internal note",
        items: [
          {
            id: "timer-intro",
            kind: "role",
            session: "Timer Intro",
            role: "Timer",
            duration: 2,
            memberId: "member_alice",
            member: "Alice",
            evaluatorId: "",
            evaluator: "",
            evaluatorStatus: "",
            roleAssignmentId: "functional-timer",
            linkedSpeechId: "",
            externalPresentationUrl: "",
            status: "confirmed",
          },
        ],
      },
      {
        id: "closing",
        type: "closing",
        title: "Closing",
        notes: "",
        items: [
          {
            id: "timer-report",
            kind: "role",
            session: "Timer Report",
            role: "Timer",
            duration: 3,
            memberId: "member_alice",
            member: "Alice",
            evaluatorId: "",
            evaluator: "",
            evaluatorStatus: "",
            roleAssignmentId: "functional-timer",
            linkedSpeechId: "",
            externalPresentationUrl: "",
            status: "confirmed",
          },
        ],
      },
    ],
  };
}

function harness(initialMeeting = sampleMeeting(), overrides = {}) {
  let meeting = structuredClone(initialMeeting);
  const audits = new Map();
  let now = Date.parse("2026-07-28T12:00:00Z");
  const roles = [{ name: "Timer", aliases: ["Timekeeper"], sortOrder: 10 }, { name: "Grammarian", aliases: [], sortOrder: 20 }];
  const members = [
    { id: "member_alice", displayName: "Alice", active: true, email: "" },
    { id: "member_abby", displayName: "Abby", active: true, mobilePhone: "123" },
  ];
  const service = createAgendaEditService({
    listMeetings: async () => [{ id: meeting.id, meetingNumber: meeting.meetingNumber, date: meeting.date, startTime: meeting.startTime, status: meeting.status }],
    getMeeting: async () => structuredClone(meeting),
    getMembers: async () => structuredClone(members),
    getAgendaRoles: async () => structuredClone(roles),
    planAgendaRole: async (name) => ({ created: true, role: { name, aliases: [], sortOrder: 20 } }),
    createAgendaRole: async (name) => {
      const existing = roles.find((role) => role.name === name);
      if (existing) return { created: false, role: structuredClone(existing) };
      const role = { name, aliases: [], sortOrder: 20 };
      roles.push(role);
      return { created: true, role: structuredClone(role) };
    },
    checkExternalPublicUrl: async (url) => ({ url, finalUrl: url, provider: "other", status: "unknown", reason: "Verify privately.", checkedAt: new Date(now).toISOString() }),
    getGlobalAssetImage: async () => ({ image: { present: true } }),
    updateMeeting: async (_id, next, expectedRevision) => {
      assert.equal(expectedRevision, meeting.revision);
      meeting = structuredClone(next);
      meeting.revision = expectedRevision + 1;
      return structuredClone(meeting);
    },
    findAgendaAudit: async (operationId) => audits.has(operationId) ? structuredClone(audits.get(operationId)) : null,
    listAgendaAudits: async () => [...audits.values()].map((audit) => structuredClone(audit)),
    createAgendaAudit: async (entry) => {
      const audit = { ...structuredClone(entry), recordId: `audit_${audits.size + 1}`, status: "prepared", result: null };
      audits.set(audit.operationId, audit);
      return structuredClone(audit);
    },
    updateAgendaAudit: async (recordId, fields) => {
      const audit = [...audits.values()].find((candidate) => candidate.recordId === recordId);
      assert.ok(audit);
      if (fields.status) audit.status = fields.status;
      if (fields.after_revision != null) audit.afterRevision = fields.after_revision;
      if (fields.result_json) audit.result = JSON.parse(fields.result_json);
      if (fields.created_role_json) audit.createdRole = JSON.parse(fields.created_role_json);
      if (fields.recovered_at) audit.recoveredAt = fields.recovered_at;
      return { record_id: recordId, fields };
    },
    now: () => now,
    ...overrides,
  });
  return {
    service,
    getMeeting: () => meeting,
    setMeeting: (next) => { meeting = structuredClone(next); },
    getAudit: () => [...audits.values()][0] || null,
    getAudits: () => [...audits.values()],
    advance: (milliseconds) => { now += milliseconds; },
  };
}

test.beforeEach(() => {
  process.env.AGENDA_SESSION_SECRET = "agenda-edit-test-secret";
  process.env.MCP_AGENDA_WRITE_ENABLED = "true";
});

test("edit context exposes exact editable IDs and timeline without private fields", async () => {
  const { service } = harness();
  const context = await service.getContext(105);
  assert.equal(context.revision, 23);
  assert.equal(context.blocks[0].items[0].start, "18:40");
  assert.equal(context.blocks[1].items[0].start, "18:43");
  assert.equal(context.timeline.scheduledEndTime, "18:46");
  assert.match(context.blocks[0].items[0].snapshotHash, /^[A-Za-z0-9_-]+$/);
  assert.equal(JSON.stringify(context).includes("internal note"), false);
  assert.equal(JSON.stringify(context).includes("must not leak"), false);
});

test("item search returns deletion-ready matches without private fields", async () => {
  const { service } = harness();
  const result = await service.findItems(105, "Timer");
  assert.equal(result.revision, 23);
  assert.equal(result.count, 2);
  assert.deepEqual(result.matches.map(({ blockId, itemId }) => ({ blockId, itemId })), [
    { blockId: "opening", itemId: "timer-intro" },
    { blockId: "closing", itemId: "timer-report" },
  ]);
  assert.match(result.matches[0].snapshotHash, /^[A-Za-z0-9_-]+$/);
  assert.equal(JSON.stringify(result).includes("internal note"), false);
});

test("removing an item skips member and RoleCatalog reads", async () => {
  let memberReads = 0;
  let roleReads = 0;
  const { service } = harness(sampleMeeting(), {
    getMembers: async () => { memberReads += 1; return []; },
    getAgendaRoles: async () => { roleReads += 1; return []; },
  });
  const context = await service.getContext(105);
  await service.propose({
    meeting_number: 105,
    expected_revision: 23,
    operations: [{
      op: "remove_item",
      block_id: "opening",
      item_id: "timer-intro",
      expected_before: { snapshotHash: context.blocks[0].items[0].snapshotHash },
    }],
  }, principal);
  assert.equal(memberReads, 0);
  assert.equal(roleReads, 0);
});

test("member search returns only IDs and display names", async () => {
  const { service } = harness();
  assert.deepEqual(await service.searchMembers("Ab"), [{ member_id: "member_abby", display_name: "Abby" }]);
  await assert.rejects(() => service.searchMembers("A"), /2 to 80/);
});

test("proposal changes linked role rows, persists nothing, then explicit apply writes once and verifies", async () => {
  const { service, getMeeting, getAudit } = harness();
  const context = await service.getContext(105);
  const proposal = await service.propose({
    meeting_number: 105,
    expected_revision: 23,
    operations: [{
      op: "set_item_field",
      target_ids: ["timer-intro"],
      field: "member",
      expected_before: { memberId: "member_alice", snapshotHash: context.blocks[0].items[0].snapshotHash },
      value: { memberId: "member_abby" },
    }],
  }, principal);

  assert.equal(getMeeting().revision, 23);
  assert.equal(proposal.confirmationRequired, true);
  assert.equal(proposal.affectedItemCount, 2);
  assert.match(proposal.diff[0].label, /Timer Intro.*Timer Report/);

  const applied = await service.apply(proposal.proposalId, principal, "https://agenda.example");
  assert.equal(applied.verified, true);
  assert.equal(applied.afterRevision, 24);
  assert.deepEqual(getMeeting().blocks.map((block) => block.items[0].member), ["Abby", "Abby"]);
  assert.equal(getAudit().status, "succeeded");

  const replay = await service.apply(proposal.proposalId, principal, "https://agenda.example");
  assert.deepEqual(replay, applied);
  assert.equal(getMeeting().revision, 24);
});

test("fast-track change resolves a logical role assignment and writes a Draft meeting in one call", async () => {
  const { service, getMeeting } = harness();
  const result = await service.change({
    meeting_number: 105,
    changes: [{ op: "set_item_field", target: "Timer", field: "member", value: "Abby" }],
  }, principal, "https://agenda.example");

  assert.equal(result.direct, true);
  assert.equal(result.confirmationRequired, false);
  assert.equal(result.meetingLabel, "第 105 期 · 2026-08-11");
  assert.equal(result.undoAvailable, true);
  assert.deepEqual(getMeeting().blocks.map((block) => block.items[0].member), ["Abby", "Abby"]);
});

test("Final meeting change returns a compact confirmation before applying", async () => {
  const meeting = sampleMeeting();
  meeting.status = "final";
  const { service, getMeeting } = harness(meeting);
  const proposal = await service.change({
    meeting_number: 105,
    changes: [{ op: "set_item_field", target: "Timer Intro", field: "duration", value: 4 }],
  }, principal, "https://agenda.example");

  assert.equal(proposal.confirmationRequired, true);
  assert.deepEqual(proposal.confirmationReasons, ["FINAL_MEETING"]);
  assert.match(proposal.confirmation, /第 105 期 · 2026-08-11 已封版/);
  assert.equal(getMeeting().revision, 23);

  const applied = await service.change({ proposal_id: proposal.proposalId, confirmed: true }, principal, "https://agenda.example");
  assert.equal(applied.direct, false);
  assert.equal(applied.meetingStatus, "final");
  assert.equal(getMeeting().blocks[0].items[0].duration, 4);
});

test("fast-track target ambiguity returns candidates without writing", async () => {
  const { service, getMeeting } = harness();
  await assert.rejects(
    () => service.change({ meeting_number: 105, changes: [{ op: "remove_item", target: "Timer" }] }, principal, "https://agenda.example"),
    (error) => error.code === "AGENDA_TARGET_AMBIGUOUS" && error.details.candidates.length === 2,
  );
  assert.equal(getMeeting().revision, 23);
});

test("fast-track renames and reorders Sessions through one confirmed, reversible proposal", async () => {
  const { service, getMeeting } = harness();
  const proposal = await service.change({
    meeting_number: 105,
    changes: [{ op: "rename_session", target: "Closing", title: "Wrap Up" }],
  }, principal, "https://agenda.example");
  assert.equal(proposal.confirmationRequired, true);
  assert.match(proposal.confirmation, /Session Closing/);
  await service.change({ proposal_id: proposal.proposalId, confirmed: true }, principal, "https://agenda.example");
  assert.equal(getMeeting().blocks[1].title, "Wrap Up");

  const moved = await service.change({
    meeting_number: 105,
    changes: [{ op: "move_session", target: "Wrap Up" }],
  }, principal, "https://agenda.example");
  await service.change({ proposal_id: moved.proposalId, confirmed: true }, principal, "https://agenda.example");
  assert.deepEqual(getMeeting().blocks.map(({ title }) => title), ["Wrap Up", "Opening"]);
  await service.undoLast({ meeting_number: 105 }, principal, "https://agenda.example");
  assert.deepEqual(getMeeting().blocks.map(({ title }) => title), ["Opening", "Wrap Up"]);
});

test("fast-track moves an item and accepts Schema member alias", async () => {
  const { service, getMeeting } = harness();
  const moved = await service.change({
    meeting_number: 105,
    changes: [{ op: "move_item", target: "Timer Intro", parent_session: "Closing" }],
  }, principal, "https://agenda.example");
  await service.change({ proposal_id: moved.proposalId, confirmed: true }, principal, "https://agenda.example");
  assert.deepEqual(getMeeting().blocks.map((block) => block.items.map(({ id }) => id)), [[], ["timer-intro", "timer-report"]]);
  await service.undoLast({ meeting_number: 105 }, principal, "https://agenda.example");
  assert.deepEqual(getMeeting().blocks.map((block) => block.items.map(({ id }) => id)), [["timer-intro"], ["timer-report"]]);

  await service.change({
    meeting_number: 105,
    changes: [{ op: "set_item_field", target: "Timer", field: "member", member: "Abby" }],
  }, principal, "https://agenda.example");
  assert.deepEqual(getMeeting().blocks.flatMap((block) => block.items).map(({ member }) => member), ["Abby", "Abby"]);
});

test("fast-track converts Speech to Break, cascades Evaluation, and undo restores both", async () => {
  const meeting = sampleMeeting();
  meeting.blocks[0].items.push({
    id: "speech-1", kind: "speech", session: "Speech", role: "Timer", duration: 7,
    memberId: "member_alice", member: "Alice", evaluatorId: "member_abby", evaluator: "Abby", evaluatorStatus: "confirmed",
    roleAssignmentId: "", linkedSpeechId: "", externalPresentationUrl: "", status: "confirmed",
  });
  meeting.blocks[1].items.push({
    id: "evaluation-1", kind: "role", session: "Evaluation", role: "Timer", duration: 3,
    memberId: "member_abby", member: "Abby", evaluatorId: "", evaluator: "", evaluatorStatus: "",
    roleAssignmentId: "", linkedSpeechId: "speech-1", externalPresentationUrl: "", status: "confirmed",
  });
  const { service, getMeeting } = harness(meeting);
  const proposal = await service.change({
    meeting_number: 105,
    changes: [{ op: "change_item_type", target: "Speech", kind: "break" }],
  }, principal, "https://agenda.example");
  assert.equal(proposal.confirmationRequired, true);
  assert.match(proposal.confirmation, /Remove linked Evaluation/);
  await service.change({ proposal_id: proposal.proposalId, confirmed: true }, principal, "https://agenda.example");
  assert.equal(getMeeting().blocks[0].items.find(({ id }) => id === "speech-1").kind, "break");
  assert.equal(getMeeting().blocks[1].items.some(({ id }) => id === "evaluation-1"), false);
  await service.undoLast({ meeting_number: 105 }, principal, "https://agenda.example");
  assert.equal(getMeeting().blocks[0].items.find(({ id }) => id === "speech-1").kind, "speech");
  assert.equal(getMeeting().blocks[1].items.some(({ id }) => id === "evaluation-1"), true);
});

test("fast-track changes a shared functional Role only after confirmation and restores it", async () => {
  const { service, getMeeting } = harness();
  const proposal = await service.change({
    meeting_number: 105,
    changes: [{ op: "change_item_role", target: "Timer", role: "Grammarian" }],
  }, principal, "https://agenda.example");
  assert.equal(proposal.confirmationRequired, true);
  await service.change({ proposal_id: proposal.proposalId, confirmed: true }, principal, "https://agenda.example");
  assert.deepEqual(getMeeting().blocks.flatMap((block) => block.items).map(({ role }) => role), ["Grammarian", "Grammarian"]);
  await service.undoLast({ meeting_number: 105 }, principal, "https://agenda.example");
  assert.deepEqual(getMeeting().blocks.flatMap((block) => block.items).map(({ role }) => role), ["Timer", "Timer"]);
});

test("non-empty Session deletion confirms once, preserves private data, and supports operator undo", async () => {
  const { service, getMeeting } = harness();
  const proposal = await service.change({
    meeting_number: 105,
    changes: [{ op: "remove_session", target: "Opening" }],
  }, principal, "https://agenda.example");
  assert.equal(proposal.confirmationRequired, true);
  assert.ok(proposal.confirmationReasons.includes("STRUCTURAL_OR_GLOBAL_CHANGE"));
  assert.match(proposal.confirmation, /Remove Session Opening: 1 items → Removed/);

  await service.change({ proposal_id: proposal.proposalId, confirmed: true }, principal, "https://agenda.example");
  assert.deepEqual(getMeeting().blocks.map(({ title }) => title), ["Closing"]);
  const undone = await service.undoLast({ meeting_number: 105 }, principal, "https://agenda.example");
  assert.equal(undone.verified, true);
  assert.equal(getMeeting().blocks[0].notes, "internal note");
  assert.deepEqual(getMeeting().blocks.map(({ title }) => title), ["Opening", "Closing"]);
});

test("Session deletion cascades linked Evaluation in another Session and undo restores both", async () => {
  const meeting = sampleMeeting();
  meeting.blocks[0].items.push({
    id: "speech-1", kind: "speech", session: "Prepared Speech", role: "Prepared Speaker", duration: 7,
    memberId: "member_alice", member: "Alice", evaluatorId: "member_abby", evaluator: "Abby", evaluatorStatus: "confirmed",
    roleAssignmentId: "", linkedSpeechId: "", speechObjective: "Private objective", externalPresentationUrl: "", status: "confirmed",
  });
  meeting.blocks[1].items.push({
    id: "evaluation-1", kind: "role", session: "Speech Evaluation", role: "Individual Evaluator", duration: 3,
    memberId: "member_abby", member: "Abby", evaluatorId: "", evaluator: "", evaluatorStatus: "",
    roleAssignmentId: "", linkedSpeechId: "speech-1", externalPresentationUrl: "", status: "confirmed",
  });
  const { service, getMeeting } = harness(meeting);
  const proposal = await service.change({ meeting_number: 105, changes: [{ op: "remove_session", target: "Opening" }] }, principal, "https://agenda.example");
  assert.equal(proposal.affectedItemCount, 3);
  assert.match(proposal.confirmation, /2 items \+ 1 linked Evaluation/);
  assert.equal(JSON.stringify(proposal).includes("Private objective"), false);

  await service.change({ proposal_id: proposal.proposalId, confirmed: true }, principal, "https://agenda.example");
  assert.equal(getMeeting().blocks.flatMap(({ items }) => items).some(({ id }) => id === "evaluation-1"), false);
  await service.undoLast({ meeting_number: 105 }, principal, "https://agenda.example");
  const restored = getMeeting().blocks.flatMap(({ items }) => items);
  assert.equal(restored.find(({ id }) => id === "speech-1").speechObjective, "Private objective");
  assert.ok(restored.some(({ id }) => id === "evaluation-1"));
});

test("fast-track automatically retries one unrelated revision change", async () => {
  let reads = 0;
  let current;
  let replace;
  const state = harness(sampleMeeting(), {
    getMeeting: async () => {
      reads += 1;
      const meeting = structuredClone(current());
      if (reads === 2) {
        meeting.revision += 1;
        replace(meeting);
      }
      return structuredClone(meeting);
    },
  });
  current = state.getMeeting;
  replace = state.setMeeting;

  const result = await state.service.change({
    meeting_number: 105,
    changes: [{ op: "set_item_field", target: "Timer Intro", field: "duration", value: 4 }],
  }, principal, "https://agenda.example");
  assert.equal(result.retried, true);
  assert.equal(result.afterRevision, 25);
});

test("fast-track preserves an unrelated concurrent write and retries after a storage conflict", async () => {
  let writes = 0;
  let current;
  let replace;
  const state = harness(sampleMeeting(), {
    updateMeeting: async (_id, next, expectedRevision) => {
      writes += 1;
      const meeting = structuredClone(current());
      assert.equal(expectedRevision, meeting.revision);
      if (writes === 1) {
        meeting.theme = "Concurrent theme";
        meeting.revision += 1;
        replace(meeting);
        throw Object.assign(new Error("storage conflict"), { code: "REVISION_CONFLICT", statusCode: 409, details: {} });
      }
      const updated = structuredClone(next);
      updated.revision = expectedRevision + 1;
      replace(updated);
      return structuredClone(updated);
    },
  });
  current = state.getMeeting;
  replace = state.setMeeting;

  const result = await state.service.change({
    meeting_number: 105,
    changes: [{ op: "set_item_field", target: "Timer Intro", field: "duration", value: 4 }],
  }, principal, "https://agenda.example");
  assert.equal(result.retried, true);
  assert.equal(result.afterRevision, 26);
  assert.equal(state.getMeeting().theme, "Concurrent theme");
});

test("fast-track stops when adjacent Agenda structure changes during retry", async () => {
  let reads = 0;
  let current;
  let replace;
  const state = harness(sampleMeeting(), {
    getMeeting: async () => {
      reads += 1;
      const meeting = structuredClone(current());
      if (reads === 2) {
        meeting.revision += 1;
        meeting.blocks[0].items.push({
          id: "new-neighbor", kind: "break", session: "Pause", role: "", duration: 1,
          memberId: "", member: "", evaluatorId: "", evaluator: "", evaluatorStatus: "",
          roleAssignmentId: "", linkedSpeechId: "", externalPresentationUrl: "", status: "",
        });
        replace(meeting);
      }
      return structuredClone(meeting);
    },
  });
  current = state.getMeeting;
  replace = state.setMeeting;

  await assert.rejects(
    () => state.service.change({ meeting_number: 105, changes: [{ op: "set_item_field", target: "Timer Intro", field: "duration", value: 4 }] }, principal, "https://agenda.example"),
    (error) => error.code === "REVISION_CONFLICT" && /adjacent structure/.test(error.message),
  );
});

test("Draft meeting cannot be finalized while existing readiness blockers remain", async () => {
  const { service } = harness(sampleMeeting(), { getGlobalAssetImage: async () => ({ image: { present: false } }) });
  await assert.rejects(
    () => service.change({ meeting_number: 105, changes: [{ op: "set_meeting_field", field: "status", value: "final" }] }, principal, "https://agenda.example"),
    (error) => error.code === "MEETING_NOT_READY_TO_FINALIZE" && error.details.blockers.some(({ code }) => code === "missing_future_poster"),
  );
});

test("Finalization confirmation rechecks the Future Poster immediately before apply", async () => {
  let assetReads = 0;
  const { service, getMeeting } = harness(sampleMeeting(), {
    getGlobalAssetImage: async () => ({ image: { present: ++assetReads === 1 } }),
  });
  const proposal = await service.change({ meeting_number: 105, changes: [{ op: "set_meeting_field", field: "status", value: "final" }] }, principal, "https://agenda.example");
  await assert.rejects(
    () => service.change({ proposal_id: proposal.proposalId, confirmed: true }, principal, "https://agenda.example"),
    (error) => error.code === "MEETING_NOT_READY_TO_FINALIZE" && error.details.blockers.some(({ code }) => code === "missing_future_poster"),
  );
  assert.equal(getMeeting().status, "draft");
});

test("today selector returns strong meeting identity and archived selector returns Admin link", async () => {
  const meeting = sampleMeeting();
  meeting.date = "2026-07-28";
  const today = harness(meeting);
  const result = await today.service.change({
    meeting_reference: "today",
    changes: [{ op: "set_meeting_field", field: "theme", value: "Focus" }],
  }, principal, "https://agenda.example");
  assert.equal(result.meetingLabel, "第 105 期 · 2026-07-28");

  const archived = sampleMeeting();
  archived.status = "archived";
  const state = harness(archived);
  await assert.rejects(
    () => state.service.change({ meeting_number: 105, changes: [{ op: "set_meeting_field", field: "theme", value: "No" }] }, principal, "https://agenda.example"),
    (error) => error.code === "MEETING_ARCHIVED" && error.details.adminUrl === "https://agenda.example/?meeting=105&view=admin&task=mcp-changes",
  );
});

test("missing Role requires explicit creation and its confirmation discloses the undo boundary", async () => {
  const { service } = harness();
  await assert.rejects(
    () => service.change({ meeting_number: 105, changes: [{ op: "add_item", parent_session: "Opening", title: "Workshop", kind: "role", role: "Workshop Host", duration: 5 }] }, principal, "https://agenda.example"),
    (error) => error.code === "ROLE_CONFIRMATION_REQUIRED",
  );
  const proposal = await service.change({ meeting_number: 105, changes: [{ op: "add_item", parent_session: "Opening", title: "Workshop", kind: "role", role: "Workshop Host", duration: 5, create_role: true }] }, principal, "https://agenda.example");
  assert.ok(proposal.confirmationReasons.includes("STRUCTURAL_OR_GLOBAL_CHANGE"));
  assert.match(proposal.confirmation, /global RoleCatalog role remains/);
  await service.change({ proposal_id: proposal.proposalId, confirmed: true }, principal, "https://agenda.example");
  const undone = await service.undoLast({ meeting_number: 105 }, principal, "https://agenda.example");
  assert.deepEqual(undone.preservedRoles, ["Workshop Host"]);
  await assert.rejects(
    () => service.change({ meeting_number: 105, changes: [{ op: "add_item", parent_session: "Opening", title: "Timer Extra", kind: "role", role: "Timer" }] }, principal, "https://agenda.example"),
    (error) => error.code === "MISSING_DURATION",
  );
});

test("Admin recovery requires the exact after revision, restores Agenda, and creates a new audit", async () => {
  const { service, getMeeting, getAudits } = harness();
  const context = await service.getContext(105);
  const proposal = await service.propose({
    meeting_number: 105,
    expected_revision: 23,
    operations: [{
      op: "set_item_field",
      target_ids: ["timer-intro"],
      field: "duration",
      expected_before: { snapshotHash: context.blocks[0].items[0].snapshotHash },
      value: 5,
    }],
  }, principal);
  const applied = await service.apply(proposal.proposalId, principal, "https://agenda.example");
  const recovered = await service.recover(applied.operationId, "https://agenda.example");
  assert.equal(recovered.verified, true);
  assert.equal(getMeeting().revision, 25);
  assert.equal(getMeeting().blocks[0].items[0].duration, 2);
  assert.deepEqual(getAudits().map(({ status }) => status), ["recovered", "succeeded"]);
});

test("speech deletion expands linked Evaluation without exposing objective in proposal, then recovery restores both", async () => {
  const meeting = sampleMeeting();
  meeting.blocks[0].items.push({
    id: "speech-1",
    kind: "speech",
    session: "Private Speech",
    role: "Prepared Speaker",
    duration: 7,
    memberId: "member_alice",
    member: "Alice",
    evaluatorId: "member_abby",
    evaluator: "Abby",
    evaluatorStatus: "confirmed",
    roleAssignmentId: "",
    linkedSpeechId: "",
    speechObjective: "Private objective must stay server-side.",
    externalPresentationUrl: "",
    status: "confirmed",
  });
  meeting.blocks[1].items.push({
    id: "evaluation-1",
    kind: "role",
    session: "Speech Evaluation",
    role: "Individual Evaluator",
    duration: 3,
    memberId: "member_abby",
    member: "Abby",
    evaluatorId: "",
    evaluator: "",
    evaluatorStatus: "",
    roleAssignmentId: "",
    linkedSpeechId: "speech-1",
    externalPresentationUrl: "",
    status: "confirmed",
  });
  const { service, getMeeting } = harness(meeting);
  const context = await service.getContext(105);
  const speech = context.blocks[0].items.find(({ id }) => id === "speech-1");
  assert.equal("speechObjective" in speech, false);
  const proposal = await service.propose({
    meeting_number: 105,
    expected_revision: 23,
    operations: [{
      op: "remove_item",
      block_id: "opening",
      item_id: "speech-1",
      expected_before: { snapshotHash: speech.snapshotHash },
    }],
  }, principal);
  const payload = verifyAgendaProposal(proposal.proposalId, Date.parse("2026-07-28T12:00:00Z"));
  assert.equal(JSON.stringify(payload).includes("Private objective"), false);
  assert.equal(proposal.affectedItemCount, 2);

  const applied = await service.apply(proposal.proposalId, principal, "https://agenda.example");
  assert.equal(getMeeting().blocks.flatMap(({ items }) => items).some(({ id }) => id === "speech-1"), false);
  await service.recover(applied.operationId, "https://agenda.example");
  const restored = getMeeting().blocks.flatMap(({ items }) => items);
  assert.equal(restored.find(({ id }) => id === "speech-1").speechObjective, "Private objective must stay server-side.");
  assert.ok(restored.some(({ id }) => id === "evaluation-1"));
});

test("new Session, global role, and item keep stable signed IDs through apply", async () => {
  const { service, getMeeting } = harness();
  const proposal = await service.propose({
    meeting_number: 105,
    expected_revision: 23,
    operations: [
      {
        op: "add_block",
        client_ref: "election",
        insert_after_block_id: "opening",
        value: { type: "custom", title: "Officer Election" },
      },
      { op: "create_role", value: { name: "Election Chair" } },
      {
        op: "add_item",
        block_ref: "new:election",
        insert_after_item_id: null,
        value: {
          kind: "role",
          session: "Election Process",
          role: "Election Chair",
          duration: 5,
          externalPresentationUrl: "https://example.com/public",
        },
      },
    ],
  }, principal);
  assert.equal(proposal.warnings[0].code, "EXTERNAL_URL_UNKNOWN");
  const payload = verifyAgendaProposal(proposal.proposalId, Date.parse("2026-07-28T12:00:00Z"));
  const signedBlockId = payload.operations.find(({ op }) => op === "add_block").block.id;
  const signedItemId = payload.operations.find(({ op }) => op === "add_item").item.id;

  await service.apply(proposal.proposalId, principal, "https://agenda.example");
  const block = getMeeting().blocks.find(({ id }) => id === signedBlockId);
  assert.equal(block.title, "Officer Election");
  assert.equal(block.items[0].id, signedItemId);
  assert.equal(block.items[0].role, "Election Chair");
});

test("apply fails closed while global Agenda writes are disabled", async () => {
  const { service } = harness();
  const context = await service.getContext(105);
  const proposal = await service.propose({
    meeting_number: 105,
    expected_revision: 23,
    operations: [{
      op: "set_item_field",
      target_ids: ["timer-intro"],
      field: "duration",
      expected_before: { snapshotHash: context.blocks[0].items[0].snapshotHash },
      value: 4,
    }],
  }, principal);
  process.env.MCP_AGENDA_WRITE_ENABLED = "false";
  await assert.rejects(() => service.apply(proposal.proposalId, principal, "https://agenda.example"), (error) => error.code === "MCP_AGENDA_WRITE_DISABLED");
});

test("external URL set and clear use shared validation and public checks", async () => {
  const checks = [];
  const { service, getMeeting } = harness(sampleMeeting(), {
    checkExternalPublicUrl: async (url) => {
      checks.push(url);
      return { url, finalUrl: url, provider: "other", status: "unknown", reason: "Verify privately.", checkedAt: "2026-07-28T12:00:00.000Z" };
    },
  });
  let context = await service.getContext(105);
  let proposal = await service.propose({
    meeting_number: 105,
    expected_revision: 23,
    operations: [{
      op: "set_item_field",
      target_ids: ["timer-intro"],
      field: "externalPresentationUrl",
      expected_before: { snapshotHash: context.blocks[0].items[0].snapshotHash },
      value: "https://example.com",
    }],
  }, principal);
  await service.apply(proposal.proposalId, principal, "https://agenda.example");
  assert.equal(getMeeting().blocks[0].items[0].externalPresentationUrl, "https://example.com/");
  assert.deepEqual(checks, ["https://example.com/", "https://example.com/"]);

  context = await service.getContext(105);
  proposal = await service.propose({
    meeting_number: 105,
    expected_revision: 24,
    operations: [{
      op: "set_item_field",
      target_ids: ["timer-intro"],
      field: "externalPresentationUrl",
      expected_before: { snapshotHash: context.blocks[0].items[0].snapshotHash },
      value: "",
    }],
  }, principal);
  await service.apply(proposal.proposalId, principal, "https://agenda.example");
  assert.equal(getMeeting().blocks[0].items[0].externalPresentationUrl, "");
});

test("audit creation failure prevents Agenda writes", async () => {
  let writes = 0;
  const meeting = sampleMeeting();
  const { service } = harness(meeting, {
    createAgendaAudit: async () => {
      throw new Error("audit unavailable");
    },
    updateMeeting: async () => {
      writes += 1;
      return meeting;
    },
  });
  const context = await service.getContext(105);
  const proposal = await service.propose({
    meeting_number: 105,
    expected_revision: 23,
    operations: [{
      op: "set_item_field",
      target_ids: ["timer-intro"],
      field: "duration",
      expected_before: { snapshotHash: context.blocks[0].items[0].snapshotHash },
      value: 4,
    }],
  }, principal);
  await assert.rejects(
    () => service.apply(proposal.proposalId, principal, "https://agenda.example"),
    (error) => /audit unavailable/.test(error.message) && error.details.adminUrl === "https://agenda.example/?meeting=105&view=admin&task=mcp-changes",
  );
  assert.equal(writes, 0);
});

test("apply rejects a proposal owned by another principal", async () => {
  const { service } = harness();
  const context = await service.getContext(105);
  const proposal = await service.propose({
    meeting_number: 105,
    expected_revision: 23,
    operations: [{
      op: "set_item_field",
      target_ids: ["timer-intro"],
      field: "duration",
      expected_before: { snapshotHash: context.blocks[0].items[0].snapshotHash },
      value: 4,
    }],
  }, principal);
  await assert.rejects(
    () => service.apply(proposal.proposalId, { id: "other", name: "Other" }, "https://agenda.example"),
    (error) => error.code === "PROPOSAL_PRINCIPAL_MISMATCH",
  );
});

test("proposal allows confirmation-bound Session cascade deletion but rejects stale snapshots", async () => {
  const { service } = harness();
  const context = await service.getContext(105);
  const proposal = await service.propose({
    meeting_number: 105,
    expected_revision: 23,
    operations: [{
      op: "remove_block",
      block_id: "opening",
      expected_before: { snapshotHash: context.blocks[0].snapshotHash },
    }],
  }, principal);
  assert.equal(proposal.affectedItemCount, 1);
  await assert.rejects(
    () => service.propose({
      meeting_number: 105,
      expected_revision: 23,
      operations: [{
        op: "set_item_field",
        target_ids: ["timer-intro"],
        field: "duration",
        expected_before: { snapshotHash: "stale" },
        value: 5,
      }],
    }, principal),
    (error) => error.code === "PROPOSAL_STALE",
  );
});

test("proposal signatures reject tampering and expiry", () => {
  const now = Date.now();
  const proposal = createAgendaProposal({ principalId: "p", repeated: "proposal payload ".repeat(100) }, now);
  assert.ok(proposal.length < Buffer.byteLength(JSON.stringify({ repeated: "proposal payload ".repeat(100) }), "utf8"));
  assert.equal(verifyAgendaProposal(proposal, now + 1).principalId, "p");
  assert.throws(() => verifyAgendaProposal(`${proposal}x`, now + 1), (error) => error.code === "PROPOSAL_SIGNATURE_INVALID");
  assert.throws(() => verifyAgendaProposal(proposal, now + 5 * 60 * 1000), /expired/i);
});

test("five-block proposal expires in five minutes and applies immediately", async () => {
  const { service, getMeeting } = harness();
  const proposal = await service.propose({
    meeting_number: 105,
    expected_revision: 23,
    operations: [
      { op: "add_block", client_ref: "copy-opening", value: { type: "opening", title: "Opening copy" } },
      { op: "add_block", client_ref: "copy-workshop", value: { type: "custom", title: "Workshop" } },
      { op: "add_block", client_ref: "copy-speeches", value: { type: "prepared_speeches", title: "Prepared Speech Session" } },
      { op: "add_block", client_ref: "copy-evaluation", value: { type: "evaluation", title: "Evaluation Session" } },
      { op: "add_block", client_ref: "copy-closing", value: { type: "closing", title: "Closing copy" } },
    ],
  }, principal);

  assert.equal(Date.parse(proposal.expiresAt), Date.parse("2026-07-28T12:05:00Z"));
  const applied = await service.apply(proposal.proposalId, principal, "https://agenda.example");
  assert.equal(applied.verified, true);
  assert.equal(getMeeting().blocks.length, 7);
});

test("timeline uses start time, duration, and one-minute transitions", () => {
  const timeline = agendaTimeline(sampleMeeting());
  assert.deepEqual(timeline.items.map(({ start, end }) => [start, end]), [["18:40", "18:42"], ["18:43", "18:46"]]);
  assert.equal(timeline.totalDurationMinutes, 6);
});

test("external URL checks block private destinations and classify bounded provider responses", async () => {
  assert.equal(isPublicIp("127.0.0.1"), false);
  assert.equal(isPublicIp("fec0::1"), false);
  assert.equal(isPublicIp("8.8.8.8"), true);
  await assert.rejects(() => checkExternalPublicUrl("https://127.0.0.1/private"), (error) => error.code === "EXTERNAL_URL_SSRF_BLOCKED");
  await assert.rejects(() => checkExternalPublicUrl(""), (error) => error.code === "INVALID_EXTERNAL_URL");
  await assert.rejects(() => checkExternalPublicUrl("https://example.com/中文"), (error) => error.code === "INVALID_EXTERNAL_URL");

  const result = await checkExternalPublicUrl("https://docs.qq.com/slide/public", {
    lookup: async () => [{ address: "8.8.8.8", family: 4 }],
    fetchImpl: async () => new Response("<title>腾讯文档</title>", { status: 200, headers: { "Content-Type": "text/html" } }),
  });
  assert.equal(result.status, "public");

  const privateResult = await checkExternalPublicUrl("https://docs.qq.com/slide/private", {
    lookup: async () => [{ address: "8.8.8.8", family: 4 }],
    fetchImpl: async () => new Response("请登录后申请权限", { status: 200 }),
  });
  assert.equal(privateResult.status, "private");
});

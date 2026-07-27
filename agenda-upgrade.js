const ROLE_NAMES = Object.freeze({
  Toastmaster: "TME",
  "Table Topic Master": "TTM",
  "Table Topic Evaluator": "TTE",
  "General Evaluator": "GE",
});

const FUNCTIONAL = Object.freeze([
  { role: "Timer", key: "functional-timer", intro: 2, report: 3 },
  { role: "Grammarian", key: "functional-grammarian", intro: 2, report: 3 },
  { role: "Ah-Counter", key: "functional-ah-counter", intro: 1, report: 2 },
]);

function generatedId(meeting, suffix) {
  return `${meeting.id || "template"}-${suffix}`;
}

export function upgradeAgenda(meeting) {
  if (!meeting || meeting.status === "final" || meeting.status === "archived") return meeting;
  const upgraded = structuredClone(meeting);
  const opening = upgraded.blocks.find((block) => block.type === "opening");
  const evaluation = upgraded.blocks.find((block) => block.type === "evaluation");
  const closing = upgraded.blocks.find((block) => block.type === "closing");
  const prepared = upgraded.blocks.find((block) => block.type === "prepared_speeches");
  if (!opening || !closing) return upgraded;

  upgraded.blocks.flatMap((block) => block.items || []).forEach((item) => {
    item.role = ROLE_NAMES[item.role] || item.role;
  });

  for (const definition of FUNCTIONAL) {
    const existing = upgraded.blocks.flatMap((block) => block.items || []).filter((item) => item.role === definition.role);
    const assignment = existing.find((item) => item.member) || existing[0] || {};
    existing.forEach((item) => { item.roleAssignmentId = definition.key; });
    if (!existing.length) {
      opening.items.push({ id: generatedId(upgraded, `${definition.key}-intro`), kind: "role", session: `${definition.role} Intro`, role: definition.role, duration: definition.intro, memberId: assignment.memberId || "", member: assignment.member || "", status: assignment.status || "vacant", roleAssignmentId: definition.key });
      closing.items.unshift({ id: generatedId(upgraded, `${definition.key}-report`), kind: "role", session: `${definition.role} Report`, role: definition.role, duration: definition.report, memberId: assignment.memberId || "", member: assignment.member || "", status: assignment.status || "vacant", roleAssignmentId: definition.key });
    }
  }

  const reportOrder = ["Ah-Counter", "Grammarian", "Timer"];
  const reports = closing.items.filter((item) => reportOrder.includes(item.role) && item.session.endsWith(" Report"));
  closing.items = [
    ...reportOrder.flatMap((role) => reports.filter((item) => item.role === role)),
    ...closing.items.filter((item) => !reports.includes(item)),
  ];

  const ge = upgraded.blocks.flatMap((block) => block.items || []).find((item) => item.role === "GE");
  if (ge) {
    upgraded.blocks.forEach((block) => { block.items = block.items.filter((item) => item !== ge); });
    const votingIndex = closing.items.findIndex((item) => item.session === "Voting & Announcement");
    closing.items.splice(votingIndex < 0 ? closing.items.length : votingIndex, 0, ge);
  }

  const speeches = (prepared?.items || []).filter((item) => item.kind === "speech");
  const evaluatorRows = (evaluation?.items || []).filter((item) => item.role === "Individual Evaluator");
  speeches.forEach((speech, index) => {
    speech.evaluatorStatus = speech.evaluatorStatus || evaluatorRows[index]?.status || "vacant";
    let row = evaluatorRows[index];
    if (!row && evaluation) {
      row = { id: generatedId(upgraded, `individual-evaluator-${index + 1}`), kind: "role", session: `Speech Evaluation ${index + 1}`, role: "Individual Evaluator", duration: 3, memberId: "", member: "", status: speech.evaluatorStatus, linkedSpeechId: speech.id };
      evaluation.items.push(row);
    }
    if (!row) return;
    row.linkedSpeechId = speech.id;
    row.memberId = speech.evaluatorId || row.memberId || "";
    row.member = speech.evaluator || row.member || "";
    row.status = speech.evaluatorStatus;
  });
  return upgraded;
}

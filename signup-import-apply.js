export function applySignupChanges(meeting, changes = []) {
  const next = structuredClone(meeting);
  const agendaItems = next.blocks.flatMap((block) => block.items || []);
  const items = new Map(agendaItems.map((item) => [item.id, item]));
  for (const change of changes.filter((candidate) => candidate.selected)) {
    if (change.scope === "meeting") {
      if (["meetingManager", "photographer"].includes(change.field)) {
        next[change.field] = String(change.newValue || "");
        next[`${change.field}MemberId`] = String(change.newMemberId || "");
      } else if (["date", "startTime", "theme"].includes(change.field)) {
        next[change.field] = String(change.newValue || "");
      }
      continue;
    }
    for (const itemId of change.targetIds || [change.targetId]) {
      const item = items.get(itemId);
      if (!item) continue;
      if (change.field === "member") {
        item.member = String(change.newValue || "");
        item.memberId = String(change.newMemberId || "");
        item.status = "confirmed";
        if (item.linkedSpeechId) {
          const speech = items.get(item.linkedSpeechId);
          if (speech?.kind === "speech") {
            speech.evaluator = item.member;
            speech.evaluatorId = item.memberId;
            speech.evaluatorStatus = "confirmed";
          }
        }
      } else if (change.field === "evaluator" && item.kind === "speech") {
        item.evaluator = String(change.newValue || "");
        item.evaluatorId = String(change.newMemberId || "");
        item.evaluatorStatus = "confirmed";
        agendaItems.filter((candidate) => candidate.linkedSpeechId === item.id).forEach((candidate) => {
          candidate.member = item.evaluator;
          candidate.memberId = item.evaluatorId;
          candidate.status = "confirmed";
        });
      } else if (change.field === "session" && item.kind === "speech") {
        item.session = String(change.newValue || "");
      }
    }
  }
  return next;
}

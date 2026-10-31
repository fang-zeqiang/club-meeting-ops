export function getPreparedSpeeches(meeting) {
  return meeting.blocks.flatMap((block) =>
    block.type === "prepared_speeches" ? block.items.filter((item) => item.kind === "speech") : [],
  );
}

// 背面页 SPEECH OBJECTIVE 卡片按 PS 篇数分档收紧行高/字号，避免超过 4 篇时溢出 A4。
export function getSpeechObjectiveDensityClass(objectiveCount) {
  if (objectiveCount >= 5) return "speech-objective-density-overflow objectives-overflow-risk";
  if (objectiveCount >= 4) return "speech-objective-density-tight";
  if (objectiveCount >= 3) return "speech-objective-density-compact";
  return "";
}

export function appendVersion(path, version) {
  return `${path}${path.includes("?") ? "&" : "?"}v=${encodeURIComponent(version)}`;
}

const LINKED_FUNCTIONAL_ROLE_IDS = new Set(["timer", "grammarian", "ah_counter"]);

export function syncLinkedAgendaItems(items, item, changedKey, previousRoleId = item.roleId) {
  const linkedId = item.roleAssignmentId;
  const fallbackRoleId = LINKED_FUNCTIONAL_ROLE_IDS.has(previousRoleId) ? previousRoleId : "";
  if ((linkedId || fallbackRoleId) && ["role", "member", "status"].includes(changedKey)) {
    items.filter((candidate) => candidate.id !== item.id
      && (linkedId ? candidate.roleAssignmentId === linkedId : candidate.roleId === fallbackRoleId))
      .forEach((candidate) => {
        if (changedKey === "role") {
          candidate.role = item.role;
          candidate.roleId = item.roleId;
        } else if (changedKey === "member") {
          candidate.member = item.member;
          candidate.memberId = item.memberId;
        } else candidate.status = item.status;
      });
  }

  if (item.kind === "speech" && ["evaluator", "evaluatorStatus"].includes(changedKey)) {
    items.filter((candidate) => candidate.linkedSpeechId === item.id).forEach((candidate) => {
      if (changedKey === "evaluator") {
        candidate.member = item.evaluator;
        candidate.memberId = item.evaluatorId;
      } else candidate.status = item.evaluatorStatus;
    });
  }
  if (item.linkedSpeechId && ["member", "status"].includes(changedKey)) {
    const speech = items.find((candidate) => candidate.id === item.linkedSpeechId && candidate.kind === "speech");
    if (!speech) return;
    if (changedKey === "member") {
      speech.evaluator = item.member;
      speech.evaluatorId = item.memberId;
    } else speech.evaluatorStatus = item.status;
  }
}

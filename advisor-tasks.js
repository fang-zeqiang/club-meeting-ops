const stageForTask = (task) => task.stage || "preparation";

function action(title, stage, task, focusKey = "") {
  return { title, stage, task, focusKey };
}

function card({ title, reason, source, urgency, action: primary, tone = "now" }) {
  return { title, reason, source, urgency, action: primary, tone, stage: stageForTask(primary) };
}

function agendaIssueCard(issue, count) {
  return card({
    title: count > 1 ? "Fix agenda blockers" : "Fix agenda blocker",
    reason: count > 1 ? `${issue.text} + ${count - 1} more.` : issue.text,
    source: "Agenda check",
    urgency: "Blocker",
    tone: "risk",
    action: action("Fix agenda", issue.stage, issue.task, issue.focusKey),
  });
}

function reviewDoneState(status) {
  if (!["completed", "skipped"].includes(status)) return null;
  return {
    title: "Meeting loop complete",
    reason: status === "completed" ? "Review completed" : "Review skipped",
    action: action("Open Admin", "preparation", "meeting-details"),
  };
}

export function buildAdvisorTasks({ meeting, issues = [], votingResults = null, awards = null } = {}) {
  if (!meeting) {
    return {
      now: null,
      next: [],
      risks: [],
      empty: { title: "No immediate action", reason: "Use Admin for manual edits and fallback operations.", action: action("Open Admin", "preparation", "meeting-details") },
    };
  }

  const done = reviewDoneState(meeting.reviewStatus);
  if (done) return { now: null, next: [], risks: [], empty: done };

  const blockers = issues.filter((issue) => issue.severity === "blocker");
  const risks = blockers.map((issue) => agendaIssueCard(issue, blockers.length));
  const next = [];
  let now = null;

  if (!issues.some((issue) => issue.task === "future-posters")) {
    next.push(card({
      title: "Update future meeting posters",
      reason: "Review the next two meeting posters before each meeting.",
      source: "Presentation",
      urgency: "Soon",
      action: action("Open Future posters", "preparation", "future-posters", "future-poster-1"),
    }));
  }

  if (blockers.length) {
    now = agendaIssueCard(blockers[0], blockers.length);
    next.push(card({
      title: "Prepare voting",
      reason: meeting.votingForm?.formId ? "Voting form exists; check candidates before the meeting." : "Voting form is not prepared yet.",
      source: "Voting",
      urgency: "Soon",
      action: action("Prepare voting", "preparation", "prepare-voting", "voting-prepare"),
    }));
  } else if (meeting.status !== "final") {
    now = card({
      title: "Finalize meeting",
      reason: "Agenda has no blockers. Lock preparation when ready.",
      source: "Agenda check",
      urgency: "Now",
      action: action("Finalize meeting", "preparation", "review-share", "finalize-meeting"),
    });
    if (!meeting.votingForm?.formId) next.push(card({
      title: "Prepare voting",
      reason: "Create the voting form before the meeting starts.",
      source: "Voting",
      urgency: "Soon",
      action: action("Prepare voting", "preparation", "prepare-voting", "voting-prepare"),
    }));
  } else if (!meeting.votingForm?.formId) {
    now = card({
      title: "Prepare voting",
      reason: "Meeting is final, but voting form is not prepared.",
      source: "Voting",
      urgency: "Now",
      action: action("Prepare voting", "preparation", "prepare-voting", "voting-prepare"),
    });
  } else if (!votingResults?.responseCount) {
    now = card({
      title: "Start voting",
      reason: "Voting form is ready; no responses loaded yet.",
      source: "Voting",
      urgency: "Now",
      action: action("Start voting", "live", "start-voting"),
    });
    next.push(card({
      title: "Confirm results",
      reason: "Refresh voting results after ballots come in.",
      source: "Awards",
      urgency: "Soon",
      action: action("Confirm results", "live", "voting-console"),
    }));
  } else if (!awards?.confirmedAwards) {
    now = card({
      title: "Confirm results",
      reason: `${votingResults.responseCount} voting response${votingResults.responseCount === 1 ? "" : "s"} loaded.`,
      source: "Awards",
      urgency: "Now",
      action: action("Confirm results", "live", "voting-console"),
    });
  } else {
    now = card({
      title: "Complete review",
      reason: "Awards are confirmed. Close the meeting review loop.",
      source: "Review",
      urgency: "Now",
      tone: "done",
      action: action("Complete review", "review", "meeting-review"),
    });
  }

  if (meeting.reviewStatus === "pending" && now?.action.task !== "meeting-review") {
    next.push(card({
      title: "Complete review",
      reason: "Capture highlights, issues, and improvements after the meeting.",
      source: "Review",
      urgency: "Soon",
      action: action("Complete review", "review", "meeting-review"),
    }));
  }

  return { now, next, risks, empty: null };
}

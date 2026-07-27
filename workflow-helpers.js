function localDateTime(now) {
  const date = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")].join("-");
  const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  return `${date} ${time}`;
}

const AGENDA_ATTENDANCE_RATIO = 19 / 17;

export function agendaPrintRecommendation(meeting) {
  const people = new Set();
  const add = (id, name) => {
    const key = String(id || "").trim() || String(name || "").trim().toLocaleLowerCase();
    if (key) people.add(key);
  };
  for (const item of (meeting?.blocks || []).flatMap((block) => block.items || [])) {
    if (item.kind === "break") continue;
    add(item.memberId, item.member);
    add(item.evaluatorId, item.evaluator);
  }
  add(meeting?.meetingManagerMemberId, meeting?.meetingManager);
  add(meeting?.photographerMemberId, meeting?.photographer);
  return {
    roleTakers: people.size,
    copies: Math.max(1, Math.ceil(people.size * AGENDA_ATTENDANCE_RATIO)),
    upliftPercent: Math.round((AGENDA_ATTENDANCE_RATIO - 1) * 100),
  };
}

export function selectCurrentMeeting(meetings, now = new Date()) {
  const threshold = localDateTime(now);
  return [...meetings]
    .filter((meeting) => meeting.status === "draft" && `${meeting.date || ""} ${meeting.startTime || "00:00"}` >= threshold)
    .sort((a, b) => `${a.date} ${a.startTime || "00:00"}`.localeCompare(`${b.date} ${b.startTime || "00:00"}`))[0] || null;
}

export function sortMeetingsForPicker(meetings, now = new Date()) {
  const current = selectCurrentMeeting(meetings, now);
  return [...meetings].sort((a, b) => {
    if (a === current) return -1;
    if (b === current) return 1;
    return Number(b.meetingNumber || 0) - Number(a.meetingNumber || 0)
      || `${b.date || ""} ${b.startTime || ""}`.localeCompare(`${a.date || ""} ${a.startTime || ""}`);
  });
}

export function groupMeetingsForSwitchboard(meetings, now = new Date()) {
  const threshold = localDateTime(now);
  const next = selectCurrentMeeting(meetings, now);
  const remaining = meetings.filter((meeting) => meeting !== next);
  const upcoming = remaining
    .filter((meeting) => meeting.status === "draft" && `${meeting.date || ""} ${meeting.startTime || "00:00"}` >= threshold)
    .sort((a, b) => `${a.date} ${a.startTime || "00:00"}`.localeCompare(`${b.date} ${b.startTime || "00:00"}`));
  const recent = remaining
    .filter((meeting) => !upcoming.includes(meeting))
    .sort((a, b) => `${b.date || ""} ${b.startTime || ""}`.localeCompare(`${a.date || ""} ${a.startTime || ""}`));
  const nearby = [...upcoming, ...recent].slice(0, 4);
  const visible = new Set([next, ...nearby]);
  return { next, nearby, more: meetings.filter((meeting) => !visible.has(meeting)) };
}

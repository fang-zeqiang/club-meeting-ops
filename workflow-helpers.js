export function shanghaiDate(now) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type) => parts.find((entry) => entry.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
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
  const today = shanghaiDate(now);
  const active = meetings.filter((meeting) => meeting.status !== "archived");
  return [...active]
    .filter((meeting) => meeting.date === today)
    .sort((a, b) => `${a.startTime || "00:00"}`.localeCompare(`${b.startTime || "00:00"}`))[0]
    || [...active]
    .filter((meeting) => meeting.date > today)
    .sort((a, b) => `${a.date} ${a.startTime || "00:00"}`.localeCompare(`${b.date} ${b.startTime || "00:00"}`))[0] || null;
}

export function isShanghaiMeetingToday(meeting, now = new Date()) {
  return meeting?.date === shanghaiDate(now);
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
  const today = shanghaiDate(now);
  const next = selectCurrentMeeting(meetings, now);
  const remaining = meetings.filter((meeting) => meeting !== next);
  const upcoming = remaining
    .filter((meeting) => meeting.status !== "archived" && meeting.date >= today)
    .sort((a, b) => `${a.date} ${a.startTime || "00:00"}`.localeCompare(`${b.date} ${b.startTime || "00:00"}`));
  const recent = remaining
    .filter((meeting) => !upcoming.includes(meeting))
    .sort((a, b) => `${b.date || ""} ${b.startTime || ""}`.localeCompare(`${a.date || ""} ${a.startTime || ""}`));
  const nearby = [...upcoming, ...recent].slice(0, 4);
  const visible = new Set([next, ...nearby]);
  return { next, nearby, more: meetings.filter((meeting) => !visible.has(meeting)) };
}

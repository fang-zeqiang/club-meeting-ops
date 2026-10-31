export const BOOK_DEMO_SCHEMA_VERSION = 4;
export const BOOK_DEMO_STORAGE_KEY = "club-meeting-ops.demo-role-book.v1";

const roles = [
  ["Meeting Manager", "会议主持与整体协调", "会议领导", true],
  ["TTM", "主持即兴演讲环节", "会议领导", true],
  ["Prepared Speaker", "准备并完成一场演讲", "演讲与评估", false],
  ["Individual Evaluator", "为演讲者提供具体反馈", "演讲与评估", false],
  ["General Evaluator", "观察并总结整场会议", "反馈团队", false],
  ["Timer", "记录并报告各环节用时", "反馈团队", true],
  ["Grammarian", "观察语言使用并分享亮点", "反馈团队", true],
  ["Ah-Counter", "记录填充词并给出反馈", "反馈团队", true],
  ["Photographer", "记录会议现场", "会议支持", true],
];

const roleCatalog = roles.map(([name, description, group, guestBookingPublic], index) => ({
  name,
  description,
  group,
  guestBookingPublic,
  advanced: ["Meeting Manager", "General Evaluator"].includes(name),
  sortOrder: (index + 1) * 10,
  roleUrl: "",
  sopUrl: "",
}));

export const BOOK_DEMO_PATHWAYS_CATALOG = {
  paths: ["Presentation Mastery", "Dynamic Leadership"],
  projects: [
    { projectId: "demo-ice-breaker", name: "Ice Breaker", level: "1", requiredPaths: ["Presentation Mastery", "Dynamic Leadership"], electivePaths: [] },
    { projectId: "demo-purpose", name: "Writing a Speech with Purpose", level: "1", requiredPaths: ["Presentation Mastery"], electivePaths: [] },
    { projectId: "demo-leadership", name: "Understanding Your Leadership Style", level: "2", requiredPaths: ["Dynamic Leadership"], electivePaths: [] },
  ],
  forms: [
    { formId: "demo-ice-breaker-form", projectId: "demo-ice-breaker", variant: "Standard", speechPurpose: "Introduce yourself and share a story that helps the audience understand you." },
    { formId: "demo-purpose-form", projectId: "demo-purpose", variant: "Standard", speechPurpose: "Write and deliver a speech with a clear purpose and organized message." },
    { formId: "demo-leadership-form", projectId: "demo-leadership", variant: "Standard", speechPurpose: "Share what you learned about your leadership style and its impact." },
  ],
};

const clone = (value) => structuredClone(value);
const id = (prefix) => `${prefix}-${globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)}`;

function shanghaiToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function addDays(date, days) {
  const value = new Date(`${date}T12:00:00+08:00`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function nextSaturday(offset = 0) {
  const today = shanghaiToday();
  const weekday = new Date(`${today}T12:00:00+08:00`).getUTCDay();
  const days = ((6 - weekday + 7) % 7 || 7) + offset * 7;
  return addDays(today, days);
}

function assignment(idValue, role, memberId = "", memberName = "", extra = {}) {
  return {
    id: idValue,
    role,
    memberId,
    memberName,
    status: memberId ? "confirmed" : "vacant",
    speechPairId: "",
    speakerName: "",
    speechDetails: role === "Prepared Speaker" ? {} : null,
    externalPresentationUrl: "",
    ...extra,
  };
}

export function createDemoBook() {
  const members = [
    { id: "demo-alex", displayName: "Alex LIN, DL3", pathwayDefaults: [{ code: "DL", level: "4" }], completed: { Timer: 1 }, goals: [
      { id: "goal-alex-1", role: "Timer", targetCount: 3, dueDate: addDays(shanghaiToday(), 120), createdAt: new Date().toISOString() },
      { id: "goal-alex-2", role: "Prepared Speaker", targetCount: 2, dueDate: addDays(shanghaiToday(), 180), createdAt: new Date().toISOString() },
    ] },
    { id: "demo-mina", displayName: "Mina PARK, PM4", pathwayDefaults: [{ code: "PM", level: "5" }], completed: { "General Evaluator": 1 }, goals: [
      { id: "goal-mina-1", role: "General Evaluator", targetCount: 2, dueDate: addDays(shanghaiToday(), 150), createdAt: new Date().toISOString() },
    ] },
    { id: "demo-yue", displayName: "Yue CHEN, PM1", pathwayDefaults: [{ code: "PM", level: "2" }], completed: {}, goals: [] },
    { id: "demo-jordan", displayName: "Jordan WU, PI2", pathwayDefaults: [], completed: {}, goals: [] },
  ];
  const guests = [{ id: "demo-sam", displayName: "Sam, Guest" }];
  return {
    schemaVersion: BOOK_DEMO_SCHEMA_VERSION,
    members,
    guests,
    meetings: [
      {
        id: "demo-book-129", meetingNumber: 129, date: nextSaturday(0), startTime: "19:00", theme: "Small steps, clear signals", status: "draft", revision: 1,
        assignments: [
          assignment("meeting:manager", "Meeting Manager", "demo-alex", "Alex LIN, DL3"),
          assignment("role:ttm", "TTM"),
          assignment("item:speaker-1", "Prepared Speaker", "", "", { speechPairId: "speech-1" }),
          assignment("item:evaluator-1", "Individual Evaluator", "", "", { speechPairId: "speech-1" }),
          assignment("role:timer", "Timer"),
          assignment("role:grammarian", "Grammarian", "demo-sam", "Sam, Guest"),
          assignment("role:ah-counter", "Ah-Counter"),
          assignment("item:general-evaluator", "General Evaluator", "demo-mina", "Mina PARK, PM4"),
          assignment("meeting:photographer", "Photographer"),
        ],
        tableTopics: [],
      },
      {
        id: "demo-book-130", meetingNumber: 130, date: nextSaturday(1), startTime: "19:00", theme: "Ask a better question", status: "draft", revision: 1,
        assignments: [
          assignment("meeting:manager", "Meeting Manager", "demo-jordan", "Jordan WU, PI2"),
          assignment("role:ttm", "TTM", "demo-yue", "Yue CHEN, PM1", { externalPresentationUrl: "" }),
          assignment("item:speaker-1", "Prepared Speaker", "demo-alex", "Alex LIN, DL3", { speechPairId: "speech-1", speechDetails: { session: "The First Small Step", pathwaysMode: "custom", speechObjective: "Practice a clear opening and memorable call to action." } }),
          assignment("item:evaluator-1", "Individual Evaluator", "demo-mina", "Mina PARK, PM4", { speechPairId: "speech-1", speakerName: "Alex LIN, DL3" }),
          assignment("role:timer", "Timer"),
          assignment("role:grammarian", "Grammarian"),
          assignment("role:ah-counter", "Ah-Counter"),
          assignment("item:general-evaluator", "General Evaluator"),
          assignment("meeting:photographer", "Photographer", "demo-sam", "Sam, Guest"),
        ],
        tableTopics: [
          { key: "demo-topic-1", topicText: "What's a small step you took this week?", sortOrder: 1, createdBy: "demo-yue", createdAt: new Date().toISOString() },
          { key: "demo-topic-2", topicText: "Describe a moment you asked a better question.", sortOrder: 2, createdBy: "demo-yue", createdAt: new Date().toISOString() },
        ],
      },
      {
        id: "demo-book-131", meetingNumber: 131, date: nextSaturday(2), startTime: "19:00", theme: "Make room for the pause", status: "final", revision: 1,
        assignments: [
          assignment("meeting:manager", "Meeting Manager", "demo-mina", "Mina PARK, PM4"),
          assignment("role:ttm", "TTM", "demo-jordan", "Jordan WU, PI2"),
          assignment("item:speaker-1", "Prepared Speaker", "demo-yue", "Yue CHEN, PM1", { speechPairId: "speech-1", speechDetails: { session: "Listen Before You Answer", pathwaysMode: "pathways", pathwaysPath: "Presentation Mastery", pathwaysLevel: "1", pathwaysProjectId: "demo-ice-breaker", pathwaysFormId: "demo-ice-breaker-form", speechObjective: "" } }),
          assignment("item:evaluator-1", "Individual Evaluator", "demo-alex", "Alex LIN, DL3", { speechPairId: "speech-1", speakerName: "Yue CHEN, PM1" }),
          assignment("role:timer", "Timer", "demo-sam", "Sam, Guest"),
        ],
        tableTopics: [],
      },
      {
        id: "demo-book-128", meetingNumber: 128, date: addDays(shanghaiToday(), -14), startTime: "19:00", theme: "Lead with purpose", status: "archived", revision: 1,
        assignments: [
          assignment("item:speaker-1", "Prepared Speaker", "demo-alex", "Alex LIN, DL3", {
            speechPairId: "speech-1",
            externalPresentationUrl: "https://example.com/demo-slides",
            speechDetails: {
              session: "The Choice Behind the Goal",
              pathwaysMode: "pathways",
              pathwaysPath: "Presentation Mastery",
              pathwaysLevel: "1",
              pathwaysProjectId: "demo-purpose",
              pathwaysFormId: "demo-purpose-form",
              speechObjective: "Write and deliver a speech with a clear purpose and organized message.",
            },
          }),
          assignment("item:evaluator-1", "Individual Evaluator", "demo-mina", "Mina PARK, PM4", { speechPairId: "speech-1", speakerName: "Alex LIN, DL3" }),
          assignment("role:timer", "Timer", "demo-yue", "Yue CHEN, PM1"),
        ],
        tableTopics: [],
      },
    ],
  };
}

export function loadDemoBook(storage = localStorage) {
  try {
    const saved = JSON.parse(storage.getItem(BOOK_DEMO_STORAGE_KEY));
    return saved?.schemaVersion === BOOK_DEMO_SCHEMA_VERSION && saved.members?.length && saved.meetings?.some((meeting) => meeting.date > shanghaiToday()) ? saved : createDemoBook();
  } catch {
    return createDemoBook();
  }
}

function saveDemoBook(value, storage = localStorage) {
  storage.setItem(BOOK_DEMO_STORAGE_KEY, JSON.stringify(value));
}

export function resetDemoBook(storage = localStorage) {
  storage.removeItem(BOOK_DEMO_STORAGE_KEY);
  return createDemoBook();
}

function publicGoal(goal, member, data) {
  const completed = Number(member.completed?.[goal.role] || 0);
  const booked = data.meetings.filter((meeting) => ["draft", "final"].includes(meeting.status) && meeting.date > shanghaiToday())
    .flatMap((meeting) => meeting.assignments).filter((candidate) => candidate.role === goal.role && candidate.memberId === member.id).length;
  return { ...goal, completed, booked, status: completed >= goal.targetCount ? "completed" : goal.dueDate < shanghaiToday() ? "missed" : "active" };
}

export function demoBookDashboard(data, memberId) {
  const member = data.members.find((candidate) => candidate.id === memberId);
  if (!member) throw demoError("MEMBER_NOT_FOUND", "请选择有效会员。", 404);
  const goals = member.goals.map((goal) => publicGoal(goal, member, data));
  const goalRoles = new Set(goals.filter((goal) => goal.status === "active").map((goal) => goal.role));
  const guestIds = new Set(data.guests.map((guest) => guest.id));
  const today = shanghaiToday();
  const meetings = data.meetings.map((meeting) => ({
    ...clone(meeting),
    assignments: meeting.assignments.map((candidate) => {
      const role = roleCatalog.find((entry) => entry.name === candidate.role);
      const guest = guestIds.has(candidate.memberId);
      const editable = meeting.status === "draft" && meeting.date >= today;
      return {
        ...clone(candidate),
        mine: candidate.memberId === member.id,
        bookable: editable && candidate.status === "vacant",
        guestBookable: editable && candidate.status === "vacant" && role?.guestBookingPublic === true,
        guest,
        manageable: editable && (candidate.memberId === member.id || guest),
        matchesGoal: goalRoles.has(candidate.role),
      };
    }),
  }));
  const reservation = (meeting, candidate) => ({
    meetingId: meeting.id,
    meetingNumber: meeting.meetingNumber,
    date: meeting.date,
    theme: meeting.theme,
    role: candidate.role,
    assignmentId: candidate.id,
    speechDetails: clone(candidate.speechDetails),
  });
  const reservations = meetings
    .filter((meeting) => meeting.date >= today && ["draft", "final"].includes(meeting.status))
    .sort((a, b) => a.date.localeCompare(b.date) || a.meetingNumber - b.meetingNumber)
    .flatMap((meeting) => meeting.assignments.filter((candidate) => candidate.mine).map((candidate) => reservation(meeting, candidate)));
  const historyReservations = meetings
    .filter((meeting) => meeting.date < today)
    .sort((a, b) => b.date.localeCompare(a.date) || b.meetingNumber - a.meetingNumber)
    .flatMap((meeting) => meeting.assignments.filter((candidate) => candidate.mine).map((candidate) => reservation(meeting, candidate)));
  return {
    currentMember: { id: member.id, displayName: member.displayName, pathwayDefaults: member.pathwayDefaults },
    members: data.members.map(({ id: memberValue, displayName }) => ({ id: memberValue, displayName })),
    guests: clone(data.guests),
    goalRoles: roleCatalog.map((role) => role.name),
    roleCatalog: clone(roleCatalog),
    goals,
    reservations,
    historyReservations,
    everyoneGoals: data.members.map((candidate) => ({ id: candidate.id, displayName: candidate.displayName, goals: candidate.goals.map((goal) => publicGoal(goal, candidate, data)) })).filter((candidate) => candidate.goals.length),
    meetings: meetings.filter((meeting) => meeting.date >= today && ["draft", "final"].includes(meeting.status)),
    historyMeetings: meetings.filter((meeting) => meeting.date < today).sort((a, b) => b.date.localeCompare(a.date) || b.meetingNumber - a.meetingNumber),
  };
}

function demoError(code, message, status = 400, details) {
  const error = new Error(message);
  Object.assign(error, { code, status, details });
  return error;
}

function normalizeGuestName(value) {
  const raw = String(value || "").trim();
  if (/^[^,\n]+,\s*Guest$/i.test(raw) || /^[^,\n]+,\s*[^,@\n]*@[^@\n]+$/.test(raw)) return raw;
  throw demoError("INVALID_GUEST_NAME", "请使用“姓名, Guest”或“姓名, 头衔@俱乐部缩写”格式。");
}

function inspectGuest(data, displayName) {
  const normalized = normalizeGuestName(displayName);
  const name = normalized.split(",")[0].trim().toLocaleLowerCase();
  const exactGuest = data.guests.find((guest) => guest.displayName.toLocaleLowerCase() === normalized.toLocaleLowerCase()) || null;
  const candidates = [...data.members, ...data.guests].filter((candidate) => candidate !== exactGuest && candidate.displayName.split(",")[0].trim().toLocaleLowerCase() === name)
    .map((candidate) => ({ id: candidate.id, displayName: candidate.displayName, guest: data.guests.some((guest) => guest.id === candidate.id) }));
  return { displayName: normalized, warnings: [], exactGuest: exactGuest && clone(exactGuest), candidates };
}

function requireDemoTtm(data, meetingId, memberId) {
  const meeting = data.meetings.find((candidate) => candidate.id === meetingId);
  if (!meeting) throw demoError("MEETING_NOT_FOUND", "会议不存在。", 404);
  if (meeting.status !== "draft" || meeting.date < shanghaiToday()) {
    throw demoError("MEETING_LOCKED", "该会议已锁定，不能调整角色。", 409);
  }
  const ttm = meeting.assignments.find((candidate) => candidate.role === "TTM");
  if (!ttm || ttm.memberId !== memberId) throw demoError("NOT_TTM", "只有本场 Table Topics Master 可以管理话题。", 403);
  return meeting;
}

function demoTableTopics(data, meetingId, memberId) {
  return clone(requireDemoTtm(data, meetingId, memberId).tableTopics || []);
}

function targetAssignment(data, body) {
  const meeting = data.meetings.find((candidate) => candidate.id === body.meetingId);
  const assignmentValue = meeting?.assignments.find((candidate) => candidate.id === body.assignmentId);
  if (!meeting || !assignmentValue) throw demoError("ASSIGNMENT_NOT_FOUND", "角色不存在。", 404);
  if (meeting.status !== "draft" || meeting.date < shanghaiToday()) throw demoError("MEETING_LOCKED", "该会议已锁定，不能调整角色。", 409);
  return { meeting, assignment: assignmentValue };
}

function assignTo(assignmentValue, target, { clearSpeech = false, speechDetails, externalPresentationUrl } = {}) {
  assignmentValue.memberId = target?.id || "";
  assignmentValue.memberName = target?.displayName || "";
  assignmentValue.status = target ? "confirmed" : "vacant";
  if (assignmentValue.role === "Prepared Speaker" && (speechDetails || clearSpeech)) assignmentValue.speechDetails = clearSpeech ? {} : clone(speechDetails);
  if (["Prepared Speaker", "TTM"].includes(assignmentValue.role) && externalPresentationUrl !== undefined) assignmentValue.externalPresentationUrl = clearSpeech ? "" : externalPresentationUrl;
}

function syncSpeechPair(meeting, assignmentValue) {
  if (!assignmentValue.speechPairId || assignmentValue.role !== "Prepared Speaker") return;
  meeting.assignments.filter((candidate) => candidate.role === "Individual Evaluator" && candidate.speechPairId === assignmentValue.speechPairId)
    .forEach((candidate) => { candidate.speakerName = assignmentValue.memberName; });
}

function mutateDemoBook(data, action, body) {
  const actor = data.members.find((member) => member.id === body.memberId);
  if (!actor) throw demoError("MEMBER_NOT_FOUND", "请选择有效会员。", 404);
  if (action === "save-goal") {
    const goal = body.goal || {};
    const existing = actor.goals.find((candidate) => candidate.id === goal.id);
    const next = { id: existing?.id || id("goal"), role: goal.role, targetCount: Number(goal.targetCount), dueDate: goal.dueDate, createdAt: existing?.createdAt || new Date().toISOString() };
    if (existing) Object.assign(existing, next); else actor.goals.push(next);
    return {};
  }
  if (action === "delete-goal") {
    const index = actor.goals.findIndex((goal) => goal.id === body.goalId);
    const [deleted] = index < 0 ? [] : actor.goals.splice(index, 1);
    return { deleted };
  }
  if (action === "restore-goal") {
    if (body.goal && !actor.goals.some((goal) => goal.id === body.goal.id)) actor.goals.push(body.goal);
    return {};
  }
  if (action === "table-topic-add") {
    const meeting = requireDemoTtm(data, body.meetingId, body.memberId);
    const texts = (Array.isArray(body.topicTexts) ? body.topicTexts : [body.topicText]).map((value) => String(value || "").trim()).filter(Boolean);
    if (!texts.length) throw demoError("INVALID_TOPIC_TEXT", "话题内容不能为空。");
    if (texts.length > 50) throw demoError("TOO_MANY_TOPICS", "一次最多录入 50 条话题。");
    if (texts.some((text) => text.length > 500)) throw demoError("INVALID_TOPIC_TEXT", "话题内容不能超过 500 个字符。");
    meeting.tableTopics ||= [];
    const topics = texts.map((text, index) => ({
      key: id("topic"),
      topicText: text,
      sortOrder: (meeting.tableTopics.length ? Math.max(...meeting.tableTopics.map((topic) => topic.sortOrder)) : 0) + index + 1,
      createdBy: body.memberId,
      createdAt: new Date().toISOString(),
    }));
    meeting.tableTopics.push(...topics);
    return { topics };
  }
  if (action === "table-topic-delete") {
    const meeting = requireDemoTtm(data, body.meetingId, body.memberId);
    const index = (meeting.tableTopics || []).findIndex((topic) => topic.key === body.key);
    if (index < 0) throw demoError("TOPIC_NOT_FOUND", "话题不存在或已被删除。", 404);
    meeting.tableTopics.splice(index, 1);
    return { deleted: true };
  }
  const { meeting, assignment: assignmentValue } = targetAssignment(data, body);
  if (["book", "book-guest"].includes(action) && assignmentValue.status !== "vacant") throw demoError("ROLE_TAKEN", "角色刚刚被预约。", 409);
  if (!["book", "book-guest"].includes(action) && assignmentValue.memberId !== actor.id && !data.guests.some((guest) => guest.id === assignmentValue.memberId)) throw demoError("NOT_ROLE_OWNER", "只能调整自己的预约。", 403);
  if (action === "book") assignTo(assignmentValue, actor, { speechDetails: body.speechDetails, externalPresentationUrl: body.externalPresentationUrl });
  if (action === "book-guest") {
    let guest = data.guests.find((candidate) => candidate.id === body.targetGuestId);
    if (!guest) {
      const inspection = inspectGuest(data, body.newGuestName);
      guest = inspection.exactGuest;
      if (!guest) {
        guest = { id: id("guest"), displayName: inspection.displayName };
        data.guests.push(guest);
      }
    }
    assignTo(assignmentValue, guest, { externalPresentationUrl: body.externalPresentationUrl });
  }
  if (action === "cancel") assignTo(assignmentValue, null, { clearSpeech: true });
  if (action === "transfer") {
    let target = data.members.find((candidate) => candidate.id === body.targetMemberId) || data.guests.find((candidate) => candidate.id === body.targetGuestId);
    if (!target && body.newGuestName) {
      const inspection = inspectGuest(data, body.newGuestName);
      target = inspection.exactGuest || { id: id("guest"), displayName: inspection.displayName };
      if (!data.guests.some((guest) => guest.id === target.id)) data.guests.push(target);
    }
    if (!target) throw demoError("INVALID_TRANSFER_MEMBER", "请选择其他会员。");
    assignTo(assignmentValue, target, { clearSpeech: true });
  }
  if (action === "update-speech") assignmentValue.speechDetails = clone(body.speechDetails || {});
  if (action === "update-presentation-url") assignmentValue.externalPresentationUrl = body.externalPresentationUrl || "";
  syncSpeechPair(meeting, assignmentValue);
  meeting.revision += 1;
  return {};
}

export async function demoBookApiJson(url, options = {}, storage = localStorage) {
  const request = new URL(url, "https://demo.invalid");
  const body = options.body ? JSON.parse(options.body) : {};
  const data = loadDemoBook(storage);
  if (request.pathname === "/api/session") return { authenticated: true };
  if (request.pathname === "/api/members") return { members: data.members.map(({ id: memberId, displayName }) => ({ id: memberId, displayName })) };
  if (request.pathname === "/api/pathways-catalog") return { catalog: clone(BOOK_DEMO_PATHWAYS_CATALOG) };
  if (request.pathname !== "/api/meetings") throw demoError("DEMO_NETWORK_BLOCKED", "Demo 中不提供此操作。未发送任何网络请求。", 403);
  const action = request.searchParams.get("action");
  if (!action) return { dashboard: demoBookDashboard(data, request.searchParams.get("memberId")) };
  if (action === "table-topics") return { topics: demoTableTopics(data, request.searchParams.get("meetingId"), request.searchParams.get("memberId")) };
  if (action === "inspect-guest") return { inspection: inspectGuest(data, body.displayName) };
  const result = mutateDemoBook(data, action, body);
  saveDemoBook(data, storage);
  return result;
}

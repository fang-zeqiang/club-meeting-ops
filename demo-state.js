export const DEMO_SCHEMA_VERSION = 2;
export const DEMO_STORAGE_KEY = "agenda-maker.demo-workspace.v2";

const members = [
  { id: "demo-alex", displayName: "Alex LIN, DL3", memberType: "member", active: true },
  { id: "demo-mina", displayName: "Mina PARK, PM4", memberType: "member", active: true },
  { id: "demo-yue", displayName: "悦 YUE, PM1", memberType: "member", active: true },
  { id: "demo-jordan", displayName: "Jordan WU, PI2", memberType: "member", active: true },
  { id: "demo-sam", displayName: "Sam, Guest", memberType: "guest_placeholder", active: true },
];

const memberId = (name) => members.find((member) => member.displayName === name)?.id || "";
const item = (id, role, member = "", duration = 3, extra = {}) => ({
  id,
  kind: extra.kind || "role",
  session: extra.session || role,
  role,
  member,
  memberId: memberId(member),
  duration,
  status: member ? "confirmed" : "vacant",
  ...extra,
});

function blocks(prefix, complete = false) {
  const speaker = complete ? "悦 YUE, PM1" : "";
  const evaluator = complete ? "Mina PARK, PM4" : "";
  return [
    {
      id: `${prefix}-opening`,
      type: "opening",
      title: "Opening",
      items: [
        item(`${prefix}-saa`, "Sergeant at Arms", "Jordan WU, PI2", 3, { session: "Call to order" }),
        item(`${prefix}-tme`, "Meeting Manager", "Alex LIN, DL3", 5, { session: "Meeting opening" }),
        item(`${prefix}-timer`, "Timer", "", 2, { session: "Timing briefing", roleAssignmentId: "functional-timer" }),
      ],
    },
    {
      id: `${prefix}-topics`,
      type: "table_topics",
      title: "Table Topics Session",
      items: [item(`${prefix}-ttm`, "Table Topics Master", "Jordan WU, PI2", 20, { session: "A better question" })],
    },
    {
      id: `${prefix}-prepared`,
      type: "prepared_speeches",
      title: "Prepared Speech Session",
      items: [
        item(`${prefix}-speech`, "Prepared Speaker 1", speaker, 7, {
          kind: "speech",
          session: complete ? "The First Small Step" : "",
          evaluator,
          evaluatorId: memberId(evaluator),
          evaluatorStatus: evaluator ? "confirmed" : "vacant",
          speechObjective: "Practice a clear opening and memorable call to action.",
        }),
      ],
    },
    {
      id: `${prefix}-evaluation`,
      type: "evaluation",
      title: "Evaluation Session",
      items: [
        item(`${prefix}-evaluator`, "Individual Evaluator", evaluator, 3, {
          session: "Speech Evaluation 1",
          linkedSpeechId: `${prefix}-speech`,
        }),
      ],
    },
    {
      id: `${prefix}-closing`,
      type: "closing",
      title: "Closing",
      items: [
        item(`${prefix}-ge`, "General Evaluator", "Mina PARK, PM4", 8),
        item(`${prefix}-awards`, "Voting Host", "Jordan WU, PI2", 5, { session: "Voting & awards" }),
      ],
    },
  ];
}

function meeting({ id, number, date, theme, status = "draft", complete = false }) {
  return {
    id,
    meetingNumber: number,
    revision: 0,
    date,
    startTime: "19:00",
    theme,
    meetingType: "regular_meeting",
    presentationTheme: "sky",
    status,
    venue: "Riverside Community Room",
    votingCode: `DEMO-${number}`,
    enableTransitionTime: false,
    photographerMemberId: "demo-sam",
    photographer: "Sam, Guest",
    meetingManagerMemberId: "demo-alex",
    meetingManager: "Alex LIN, DL3",
    offAgendaRoles: [],
    votingQr: { present: false, name: "", type: "", size: 0, version: "" },
    systemVotingQr: { present: false, name: "", type: "", size: 0, version: "" },
    qrSource: "system",
    tableTopicsSpeakers: [],
    votingForm: null,
    review: { highlights: [], issues: [], improvements: [], skippedReason: "", updatedAt: "" },
    reviewStatus: "pending",
    qualityScore: null,
    qualityMetrics: null,
    reviewCompletedAt: "",
    wordOfDay: {
      word: "Momentum",
      pronunciation: "/məˈmentəm/",
      partOfSpeech: "",
      definition: "",
      example: "Small wins create momentum.",
    },
    blocks: blocks(id, complete),
  };
}

export function createDemoWorkspace() {
  return {
    schemaVersion: DEMO_SCHEMA_VERSION,
    activeMeetingId: "demo-128",
    members: structuredClone(members),
    meetings: [
      meeting({ id: "demo-128", number: 128, date: "2026-08-08", theme: "Small steps, clear signals" }),
      meeting({ id: "demo-127", number: 127, date: "2026-08-01", theme: "Ask a better question", complete: true }),
      meeting({ id: "demo-126", number: 126, date: "2026-07-25", theme: "Make room for the pause", status: "final", complete: true }),
    ],
  };
}

export function loadDemoWorkspace(storage = localStorage) {
  try {
    const saved = JSON.parse(storage.getItem(DEMO_STORAGE_KEY));
    return saved?.schemaVersion === DEMO_SCHEMA_VERSION && Array.isArray(saved.meetings) && saved.meetings.length
      ? saved
      : createDemoWorkspace();
  } catch {
    return createDemoWorkspace();
  }
}

export function saveDemoWorkspace(workspace, storage = localStorage) {
  try {
    storage.setItem(DEMO_STORAGE_KEY, JSON.stringify({ ...workspace, schemaVersion: DEMO_SCHEMA_VERSION }));
    return true;
  } catch {
    return false;
  }
}

export function resetDemoWorkspace(storage = localStorage) {
  storage.removeItem(DEMO_STORAGE_KEY);
  return createDemoWorkspace();
}

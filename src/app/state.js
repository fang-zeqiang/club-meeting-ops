import { DEFAULT_PRESENTATION_THEME } from "../../presentation-themes.js";
import { randomId } from "../../random-id.js";
import { SIGNUP_DEFAULT_VACANCY_MARKER } from "../../vacancy-emoji.js";
import { EMPTY_IMAGE, FUTURE_POSTER_KINDS } from "./contract.js";

export function emptySignupImport() {
  return { open: false, step: "paste", text: "", busy: "", error: "", analysis: null, appliedCount: 0 };
}

export function emptySignupGeneration() {
  return { open: false, language: "bilingual", vacancyEmoji: SIGNUP_DEFAULT_VACANCY_MARKER, includeSpeechDetails: false, text: "", busy: false, error: "", requestId: 0, replaceEmojiOnNextPick: false };
}

export function emptyRoleRecommendations() {
  return { data: null, loading: false, error: "", selectedAssignmentId: "", showAll: false, currentMembersOpen: false, drawer: null, exclusion: null };
}

export const uid = (prefix) => `${prefix}_${randomId()}`;

export const defaultMeeting = {
  id: "meeting_98",
  meetingNumber: 98,
  date: "2026-06-20",
  startTime: "18:40",
  theme: "Small Steps, Remarkable Journeys",
  meetingType: "regular_meeting",
  presentationTheme: DEFAULT_PRESENTATION_THEME,
  status: "draft",
  venue: "Community Room B",
  votingCode: "DEMO-98",
  enableTransitionTime: false,
  photographerMemberId: "",
  photographer: "",
  meetingManagerMemberId: "",
  meetingManager: "",
  offAgendaRoles: [],
  votingQr: { ...EMPTY_IMAGE },
  systemVotingQr: { ...EMPTY_IMAGE },
  qrSource: "system",
  tableTopicsSpeakers: [],
  votingForm: null,
  review: null,
  reviewStatus: "pending",
  qualityScore: null,
  qualityMetrics: null,
  reviewCompletedAt: "",
  wordOfDay: {
    word: "Momentum",
    pronunciation: "/məˈmentəm/",
    partOfSpeech: "noun",
    definition: "The force that keeps something moving or developing",
    usage: "Build momentum by celebrating small wins",
    example: "Small wins create momentum for remarkable journeys.",
  },
  blocks: [
    {
      id: "opening",
      type: "opening",
      title: "Opening",
      items: [
        { id: uid("item"), kind: "role", duration: 4, session: "Warm-up", role: "Warm-up Host", member: "Guest / TBD", status: "pending" },
        { id: uid("item"), kind: "role", duration: 2, session: "Presidential Opening", role: "President", member: "Jamie SONG, PM2", status: "confirmed" },
        { id: uid("item"), kind: "role", duration: 3, session: "Today's Program", role: "TME", member: "Drew PAN, PM1", status: "confirmed" },
        { id: uid("item"), kind: "role", duration: 2, session: "Timer Intro", role: "Timer", member: "", status: "vacant", roleAssignmentId: "functional-timer" },
        { id: uid("item"), kind: "role", duration: 2, session: "Grammarian Intro", role: "Grammarian", member: "", status: "vacant", roleAssignmentId: "functional-grammarian", presentationPhase: "grammarian_intro" },
        { id: uid("item"), kind: "role", duration: 1, session: "Ah-Counter Intro", role: "Ah-Counter", member: "", status: "vacant", roleAssignmentId: "functional-ah-counter" },
      ],
    },
    {
      id: "table_topics",
      type: "table_topics",
      title: "Table Topics Session",
      items: [
        { id: uid("item"), kind: "role", duration: 18, session: "Table Topics Session", role: "TTM", member: "Robin ZHAO, EH1", status: "confirmed" },
      ],
    },
    {
      id: "prepared",
      type: "prepared_speeches",
      title: "Prepared Speech Session",
      items: [
        { id: "prepared-speech-1", kind: "speech", duration: 7, session: "The Courage to Begin", role: "Prepared Speaker 1", member: "Alex CHEN, TM", evaluator: "Casey KIM, PM5", evaluatorStatus: "confirmed", speechObjective: "Practice a clear opening, purposeful transitions, and a memorable call to action.", status: "confirmed" },
        { id: "prepared-speech-2", kind: "speech", duration: 7, session: "A Better Question", role: "Prepared Speaker 2", member: "", evaluator: "", evaluatorStatus: "vacant", speechObjective: "", status: "vacant" },
      ],
    },
    {
      id: "evaluation",
      type: "evaluation",
      title: "Evaluation Session",
      items: [
        { id: uid("item"), kind: "role", duration: 4, session: "Table Topics Evaluation", role: "TTE", member: "Parker ZHENG, PM3", status: "confirmed" },
        { id: uid("item"), kind: "role", duration: 3, session: "Speech Evaluation 1", role: "Individual Evaluator", member: "Casey KIM, PM5", status: "confirmed", linkedSpeechId: "prepared-speech-1" },
      ],
    },
    {
      id: "closing",
      type: "closing",
      title: "Closing",
      items: [
        { id: uid("item"), kind: "role", duration: 2, session: "Ah-Counter Report", role: "Ah-Counter", member: "", status: "vacant", roleAssignmentId: "functional-ah-counter" },
        { id: uid("item"), kind: "role", duration: 3, session: "Grammarian Report", role: "Grammarian", member: "", status: "vacant", roleAssignmentId: "functional-grammarian", presentationPhase: "grammarian_report" },
        { id: uid("item"), kind: "role", duration: 3, session: "Timer Report", role: "Timer", member: "", status: "vacant", roleAssignmentId: "functional-timer" },
        { id: uid("item"), kind: "role", duration: 5, session: "General Evaluator Report", role: "GE", member: "Taylor LEE, PM3", status: "confirmed" },
        { id: uid("item"), kind: "role", duration: 4, session: "Voting & Announcement", role: "Voting Host", member: "Drew PAN, PM1", status: "confirmed" },
        { id: uid("item"), kind: "role", duration: 3, session: "Meeting Awards & Adjourn", role: "President", member: "Jamie SONG, PM2", status: "confirmed" },
      ],
    },
  ],
};

export const state = {
  authenticated: false,
  guestMode: false,
  guestMeetings: [],
  previewMode: false,
  loading: true,
  meeting: null,
  meetings: [],
  templates: [],
  members: [],
  pathwaysCatalog: null,
  pathwaysDrafts: {},
  roles: [],
  rolesLoading: false,
  rolesError: "",
  rolePrompt: null,
  membersLoading: false,
  templatesLoading: false,
  persisted: false,
  dirty: false,
  saveStatus: "idle",
  saveError: "",
  mutationVersion: 0,
  migrationPrompt: false,
  guestPrompt: null,
  memberPicker: null,
  templatePrompt: false,
  renameTemplatePrompt: null,
  saveTemplatePrompt: false,
  printPrompt: null,
  agendaImagePrompt: null,
  conflict: null,
  selectedBlockId: "opening",
  savedAt: null,
  toast: "",
  groupQr: { ...EMPTY_IMAGE },
  paymentQr: { ...EMPTY_IMAGE },
  officerTeamPhoto: { ...EMPTY_IMAGE },
  futurePosters: FUTURE_POSTER_KINDS.map(() => ({ ...EMPTY_IMAGE })),
  clubIntroPhoto: { ...EMPTY_IMAGE },
  imageBusy: "",
  officerBusy: false,
  templateBusy: false,
  agendaPdfBusy: false,
  agendaPdfError: "",
  newMeetingCreating: false,
  votingBusy: "",
  votingProgress: "",
  votingResults: null,
  tableTopicsDraft: "",
  tableTopicsDraftDirty: false,
  tableTopicsDraftMeetingId: "",
  awards: null,
  awardsBusy: false,
  awardsTip: false,
  awardsError: "",
  votingConsole: { open: false, phase: "live", busy: false, error: "", loadedAt: "", operator: "" },
  reviewBusy: "",
  activeView: "advisor",
  activeStage: "preparation",
  activeTask: "meeting-details",
  advisorOriginLabel: "",
  highlightReviewItems: false,
  mobileView: "edit",
  clubSettingsOpen: false,
  aboutProductOpen: false,
  moreMenuOpen: false,
  signupImport: emptySignupImport(),
  signupGeneration: emptySignupGeneration(),
  mcpChanges: { items: [], busy: false, error: "" },
  tableTopics: { items: [], busy: false, error: "", addBusy: false, addError: "" },
  advisorExpanded: { risk: false },
  roleRecommendations: emptyRoleRecommendations(),
  showLoadingTip: false,
};

// 跨模块共享的可变运行时变量,统一挂到 runtime 上避免模块级 let 无法跨文件写入
export const runtime = {
  saveTimer: null,
  savePromise: null,
  overlayReturnFocusKey: "",
  agendaPreviewResizeObserver: null,
  votingConsoleTimer: null,
  signupGenerationTimer: null,
  demoMeetings: new Map(),
};

let dirtyHandler = () => {};

// markDirty 的真实实现是 lifecycle-sync.js 的 applyDirty(依赖 save/render),这里只做注册与转发
export function setDirtyHandler(fn) {
  dirtyHandler = fn;
}

export function markDirty() {
  dirtyHandler();
}

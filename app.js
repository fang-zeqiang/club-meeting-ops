import "./styles.css";
import "./speaking-tip-card.css";
import { groupMemberOptions, guestDisplayNameLooksStandard, matchesMemberSearch } from "./book-helpers.js";
import { appendVersion, getPreparedSpeeches, syncLinkedAgendaItems } from "./meeting-helpers.js";
import { assignMeetingPresident, OFFICER_ROLES, normalizeOfficerAssignments } from "./officer-roles.js";
import { bindEditorEvents } from "./editor-events.js";
import { upgradeAgenda } from "./agenda-upgrade.js";
import { randomId } from "./random-id.js";
import { ROLE_AWARD_POOLS, ROLE_DEFINITIONS, recognitionAwardConfig, roleAwardConfig, roleAwardIssues, roleEntries, roleIdentity } from "./role-awards.js";
import { buildQualityMetrics, qualityConfidence, qualityScore } from "./meeting-quality.js";
import { buildAdvisorTasks } from "./advisor-tasks.js";
import { applySignupChanges } from "./signup-import-apply.js";
import { agendaPrintRecommendation, groupMeetingsForSwitchboard, sortMeetingsForPicker } from "./workflow-helpers.js";
import { createSpeakingTipCarousel } from "./speaking-tips.js";
import { AWARD_DEFINITIONS } from "./award-order.js";
import { isAwardsItem } from "./meeting-presentation-model.js";
import { CLUB_PROFILE } from "./club-profile.js";
import productUpdatesMarkdown from "./docs/CHANGELOG.md?raw";

const STORAGE_KEY = "vpe-agenda-maker-v1";
const DRAFTS_KEY = "vpe-agenda-maker-drafts-v1";
const MIGRATION_KEY = "vpe-agenda-maker-bitable-migration-v1";
const PREVIEW_PANE_WIDTH_KEY = "vpe-agenda-preview-pane-width-v1";
const MAX_QR_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_OFFICER_IMAGE_BYTES = 5 * 1024 * 1024;
const FUTURE_POSTER_KINDS = Object.freeze(["future-poster-1", "future-poster-2"]);
const OFFICER_IMAGE_RATIO = 16 / 9;
const TRANSITION_MINUTES = 1;
const SIGNUP_TEXT_MIN = 20;
const SIGNUP_TEXT_MAX = 10_000;
const SIGNUP_IMPORT_MODEL = "deepseek-v4-flash";
const EMPTY_IMAGE = Object.freeze({ present: false, name: "", type: "", size: 0, version: "" });
const CLUB_LOGO_URL = CLUB_PROFILE.logo;
const WORKFLOW = Object.freeze({
  preparation: [
    { id: "meeting-details", label: "Meeting details" },
    { id: "build-agenda", label: "Build agenda" },
    { id: "prepare-voting", label: "Prepare voting" },
    { id: "future-posters", label: "Future posters" },
    { id: "review-share", label: "Review & share" },
  ],
  live: [
    { id: "start-voting", label: "Start voting" },
    { id: "awards", label: "Awards" },
  ],
  review: [
    { id: "meeting-review", label: "Meeting review" },
  ],
});
const STAGE_LABELS = Object.freeze({ preparation: "Preparation", live: "Live Execution", review: "Review" });

function emptySignupImport() {
  return { open: false, step: "paste", text: "", busy: "", error: "", analysis: null, appliedCount: 0 };
}

function emptySignupGeneration() {
  return { open: false, language: "bilingual", vacancyEmoji: "🈳", includeSpeechDetails: false, text: "", busy: false, error: "", requestId: 0 };
}

const uid = (prefix) => `${prefix}_${randomId()}`;

const defaultMeeting = {
  id: "meeting_98",
  meetingNumber: 98,
  date: "2026-06-20",
  startTime: "18:40",
  theme: "Small Steps, Remarkable Journeys",
  meetingType: "regular_meeting",
  status: "draft",
  venue: "Community Room B",
  votingCode: "DEMO-98",
  enableTransitionTime: false,
  photographerMemberId: "",
  photographer: "",
  meetingManagerMemberId: "",
  meetingManager: "",
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
    example: "Small wins create momentum for remarkable journeys.",
  },
  blocks: [
    {
      id: "opening",
      type: "opening",
      title: "Opening",
      items: [
        { id: uid("item"), kind: "role", duration: 4, session: "Warm-up", role: "Warm-up Host", member: "Guest / TBD", status: "pending" },
        { id: uid("item"), kind: "role", duration: 2, session: "Presidential Opening", role: "President", member: "Alex CHEN, PM2", status: "confirmed" },
        { id: uid("item"), kind: "role", duration: 3, session: "Today's Program", role: "TME", member: "Taylor LEE, PM1", status: "confirmed" },
        { id: uid("item"), kind: "role", duration: 2, session: "Timer Intro", role: "Timer", member: "", status: "vacant", roleAssignmentId: "functional-timer" },
        { id: uid("item"), kind: "role", duration: 2, session: "Grammarian Intro", role: "Grammarian", member: "", status: "vacant", roleAssignmentId: "functional-grammarian" },
        { id: uid("item"), kind: "role", duration: 1, session: "Ah-Counter Intro", role: "Ah-Counter", member: "", status: "vacant", roleAssignmentId: "functional-ah-counter" },
      ],
    },
    {
      id: "table_topics",
      type: "table_topics",
      title: "Table Topics Session",
      items: [
        { id: uid("item"), kind: "role", duration: 18, session: "Table Topics Session", role: "TTM", member: "Morgan PARK, EH1", status: "confirmed" },
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
        { id: uid("item"), kind: "role", duration: 4, session: "Table Topics Evaluation", role: "TTE", member: "Casey KIM, PM3", status: "confirmed" },
        { id: uid("item"), kind: "role", duration: 3, session: "Speech Evaluation 1", role: "Individual Evaluator", member: "Casey KIM, PM5", status: "confirmed", linkedSpeechId: "prepared-speech-1" },
      ],
    },
    {
      id: "closing",
      type: "closing",
      title: "Closing",
      items: [
        { id: uid("item"), kind: "role", duration: 2, session: "Ah-Counter Report", role: "Ah-Counter", member: "", status: "vacant", roleAssignmentId: "functional-ah-counter" },
        { id: uid("item"), kind: "role", duration: 3, session: "Grammarian Report", role: "Grammarian", member: "", status: "vacant", roleAssignmentId: "functional-grammarian" },
        { id: uid("item"), kind: "role", duration: 3, session: "Timer Report", role: "Timer", member: "", status: "vacant", roleAssignmentId: "functional-timer" },
        { id: uid("item"), kind: "role", duration: 5, session: "General Evaluator Report", role: "GE", member: "Riley DAVIS, PM3", status: "confirmed" },
        { id: uid("item"), kind: "role", duration: 4, session: "Voting & Announcement", role: "Voting Host", member: "Taylor LEE, PM1", status: "confirmed" },
        { id: uid("item"), kind: "role", duration: 3, session: "Meeting Awards & Adjourn", role: "President", member: "Alex CHEN, PM2", status: "confirmed" },
      ],
    },
  ],
};

let state = {
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
  advisorExpanded: { next: false, risk: false },
  showLoadingTip: false,
};

let saveTimer = null;
let savePromise = null;
let overlayReturnFocusKey = "";
let agendaPreviewResizeObserver = null;
let votingConsoleTimer = null;
let signupGenerationTimer = null;
const speakingTips = createSpeakingTipCarousel(document);

function loadLocalMeeting() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

function localDrafts() {
  try {
    const value = JSON.parse(localStorage.getItem(DRAFTS_KEY) || "{}");
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

function localDraft(meetingId) {
  return localDrafts()[meetingId]?.meeting || null;
}

function saveLocalDraft() {
  if (state.previewMode || !state.meeting?.id) return;
  const drafts = localDrafts();
  drafts[state.meeting.id] = { meeting: structuredClone(state.meeting), savedAt: new Date().toISOString() };
  localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
}

function clearLocalDraft(meetingId = state.meeting?.id) {
  if (!meetingId) return;
  const drafts = localDrafts();
  delete drafts[meetingId];
  localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
}

function cloneMeetingStructure(source = defaultMeeting) {
  const meeting = structuredClone(source);
  const itemIds = new Map(meeting.blocks.flatMap((block) => block.items).filter((item) => item.id).map((item) => [item.id, uid("item")]));
  meeting.id = uid("meeting");
  meeting.revision = 0;
  meeting.votingQr = { ...EMPTY_IMAGE };
  meeting.review = { highlights: [], issues: [], improvements: [], skippedReason: "", updatedAt: "" };
  meeting.reviewStatus = "pending";
  meeting.qualityScore = null;
  meeting.qualityMetrics = null;
  meeting.reviewCompletedAt = "";
  meeting.blocks.forEach((block) => {
    block.id = uid("block");
    block.items.forEach((item) => {
      item.id = itemIds.get(item.id) || uid("item");
      if (item.linkedSpeechId) item.linkedSpeechId = itemIds.get(item.linkedSpeechId) || "";
      item.speechObjective = String(item.speechObjective || "");
      item.externalPresentationUrl = "";
      const member = memberForName(item.member);
      const evaluator = memberForName(item.evaluator);
      item.memberId = member?.id || "";
      item.member = member?.displayName || item.member;
      item.evaluatorId = evaluator?.id || "";
      item.evaluator = evaluator?.displayName || item.evaluator;
    });
  });
  return meeting;
}

function freshMeeting(source = defaultMeeting, meetingNumber) {
  const meeting = cloneMeetingStructure(source);
  if (meetingNumber) meeting.meetingNumber = meetingNumber;
  return meeting;
}

function nextMeetingNumber() {
  return Math.max(0, ...state.meetings.map((meeting) => meeting.meetingNumber)) + 1;
}

function templateFromMeeting(meeting, name) {
  return {
    name,
    meeting: {
      id: meeting.id,
      meetingType: meeting.meetingType,
      blocks: meeting.blocks.map((block) => ({
        id: block.id,
        type: block.type,
        title: block.title,
        notes: block.notes || "",
        items: block.items.map((item) => ({
          id: item.id,
          kind: item.kind,
          session: item.session,
          role: item.role,
          duration: item.duration,
          evaluatorStatus: item.evaluatorStatus || "",
          roleAssignmentId: item.roleAssignmentId || "",
          linkedSpeechId: item.linkedSpeechId || "",
          pathwaysMode: item.pathwaysMode || "",
          pathwaysPath: item.pathwaysPath || "",
          pathwaysLevel: item.pathwaysLevel || "",
          pathwaysProjectId: item.pathwaysProjectId || "",
          pathwaysFormId: item.pathwaysFormId || "",
          speechObjective: item.speechObjective || "",
          status: item.status,
        })),
      })),
    },
  };
}

function meetingFromTemplate(template, meetingNumber) {
  const meeting = cloneMeetingStructure({
    ...defaultMeeting,
    meetingType: template.meetingType || defaultMeeting.meetingType,
    blocks: template.blocks.map((block) => ({
      type: block.type,
      title: block.title,
      notes: block.notes || "",
      items: block.items.map((item) => ({
        id: item.templateItemId || "",
        kind: item.kind,
        session: item.session,
        role: item.role,
        duration: item.duration,
        member: "",
        evaluator: "",
        evaluatorStatus: item.evaluatorStatus || "vacant",
        roleAssignmentId: item.roleAssignmentId || "",
        linkedSpeechId: item.linkedSpeechId || "",
        pathwaysMode: item.pathwaysMode || "",
        pathwaysPath: item.pathwaysPath || "",
        pathwaysLevel: item.pathwaysLevel || "",
        pathwaysProjectId: item.pathwaysProjectId || "",
        pathwaysFormId: item.pathwaysFormId || "",
        speechObjective: item.speechObjective || "",
        status: item.status || "vacant",
      })),
    })),
  });
  meeting.meetingNumber = meetingNumber;
  meeting.date = "";
  meeting.theme = "";
  meeting.wordOfDay = { word: "", pronunciation: "", example: "" };
  meeting.votingCode = `DEMO-${meetingNumber}`;
  return meeting;
}

function latestFinalizedMeetingSummary() {
  return [...state.meetings]
    .filter((meeting) => meeting.status === "final")
    .sort((a, b) => `${b.date} ${b.startTime || ""}`.localeCompare(`${a.date} ${a.startTime || ""}`))[0] || null;
}

function meetingFromFinalized(source, meetingNumber) {
  const meeting = cloneMeetingStructure(source);
  meeting.meetingNumber = meetingNumber;
  meeting.status = "draft";
  meeting.date = "";
  meeting.theme = "";
  meeting.votingCode = `DEMO-${meetingNumber}`;
  meeting.wordOfDay = { word: "", pronunciation: "", example: "" };
  meeting.photographerMemberId = "";
  meeting.photographer = "";
  meeting.meetingManagerMemberId = "";
  meeting.meetingManager = "";
  meeting.votingQr = { ...EMPTY_IMAGE };
  meeting.systemVotingQr = { ...EMPTY_IMAGE };
  meeting.qrSource = "system";
  meeting.tableTopicsSpeakers = [];
  meeting.votingForm = null;
  meeting.review = { highlights: [], issues: [], improvements: [], skippedReason: "", updatedAt: "" };
  meeting.reviewStatus = "pending";
  meeting.qualityScore = null;
  meeting.qualityMetrics = null;
  meeting.reviewCompletedAt = "";
  delete meeting.confirmedAwards;
  delete meeting.awardPresentation;
  delete meeting.awardAudit;
  meeting.blocks.forEach((block) => block.items.forEach((item) => {
    item.memberId = "";
    item.member = "";
    item.evaluatorId = "";
    item.evaluator = "";
    item.status = "vacant";
    if (item.kind === "speech") {
      item.session = "";
      item.speechObjective = "";
      item.evaluatorStatus = "vacant";
    }
  }));
  return meeting;
}

function markDirty() {
  state.dirty = true;
  state.mutationVersion += 1;
  saveLocalDraft();
  if (state.previewMode) {
    state.saveStatus = "saved";
    return;
  }
  state.saveStatus = "saving";
  state.saveError = "";
  renderStatusRegion();
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(flushSave, 800);
}

function esc(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function toMinutes(time) {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

function fromMinutes(value) {
  const wrapped = ((value % 1440) + 1440) % 1440;
  return `${String(Math.floor(wrapped / 60)).padStart(2, "0")}:${String(wrapped % 60).padStart(2, "0")}`;
}

function normalizeAgendaStatus(value) {
  const normalized = String(value || "").trim().toLocaleLowerCase();
  if (normalized === "pending") return "pending";
  if (normalized === "confirmed" || normalized.startsWith("confirm")) return "confirmed";
  return "vacant";
}

function memberDisplayNameById(memberId, fallback = "") {
  return state.members.find((member) => member.id === memberId)?.displayName || fallback;
}

function normalizeMeetingState(meeting) {
  const normalized = upgradeAgenda(meeting);
  normalized.enableTransitionTime = Boolean(normalized.enableTransitionTime);
  normalized.photographerMemberId = String(normalized.photographerMemberId || "");
  normalized.photographer = memberDisplayNameById(normalized.photographerMemberId, normalized.photographer || "");
  normalized.meetingManagerMemberId = String(normalized.meetingManagerMemberId || "");
  normalized.meetingManager = memberDisplayNameById(normalized.meetingManagerMemberId, normalized.meetingManager || "");
  normalized.qrSource = normalized.qrSource === "manual" ? "manual" : "system";
  normalized.tableTopicsSpeakers = Array.isArray(normalized.tableTopicsSpeakers) ? normalized.tableTopicsSpeakers : [];
  normalized.review = normalized.review && typeof normalized.review === "object" ? {
    highlights: Array.isArray(normalized.review.highlights) ? normalized.review.highlights : [],
    issues: Array.isArray(normalized.review.issues) ? normalized.review.issues : [],
    improvements: Array.isArray(normalized.review.improvements) ? normalized.review.improvements : [],
    skippedReason: String(normalized.review.skippedReason || ""),
    updatedAt: String(normalized.review.updatedAt || ""),
  } : { highlights: [], issues: [], improvements: [], skippedReason: "", updatedAt: "" };
  normalized.reviewStatus = ["completed", "skipped"].includes(normalized.reviewStatus) ? normalized.reviewStatus : "pending";
  normalized.qualityScore = normalized.qualityScore == null || normalized.qualityScore === "" || !Number.isFinite(Number(normalized.qualityScore)) ? null : Number(normalized.qualityScore);
  normalized.qualityMetrics = normalized.qualityMetrics && typeof normalized.qualityMetrics === "object" ? normalized.qualityMetrics : null;
  normalized.reviewCompletedAt = String(normalized.reviewCompletedAt || "");
  normalized.votingForm = normalized.votingForm && typeof normalized.votingForm === "object" ? {
    ...normalized.votingForm,
    roleAwardConfig: roleAwardConfig(normalized.votingForm),
    recognitionAwardConfig: recognitionAwardConfig(normalized.votingForm),
  } : null;
  normalized.votingQr = normalized.votingQr || { ...EMPTY_IMAGE };
  normalized.systemVotingQr = normalized.systemVotingQr || { ...EMPTY_IMAGE };
  normalized.blocks = (normalized.blocks || []).map((block) => ({
    ...block,
    items: (block.items || []).map((item) => ({
      ...item,
      status: normalizeAgendaStatus(item.status),
      evaluatorStatus: item.kind === "speech" ? normalizeAgendaStatus(item.evaluatorStatus) : "",
      roleId: roleIdentity(item.role, item.roleId).id,
      roleAssignmentId: String(item.roleAssignmentId || ""),
      linkedSpeechId: String(item.linkedSpeechId || ""),
      pathwaysMode: ["pathways", "custom"].includes(item.pathwaysMode) ? item.pathwaysMode : "",
      pathwaysPath: String(item.pathwaysPath || ""),
      pathwaysLevel: String(item.pathwaysLevel || ""),
      pathwaysProjectId: String(item.pathwaysProjectId || ""),
      pathwaysFormId: String(item.pathwaysFormId || ""),
      externalPresentationUrl: item.kind === "break" ? "" : String(item.externalPresentationUrl || ""),
    })),
  }));
  return normalized;
}

function officerAssignmentsFromMembers() {
  const assignments = Object.fromEntries(OFFICER_ROLES.map((role) => [role, ""]));
  state.members.forEach((member) => {
    (Array.isArray(member.officerRoles) ? member.officerRoles : []).forEach((role) => {
      if (role in assignments && !assignments[role]) assignments[role] = member.id;
    });
  });
  return assignments;
}

function autofillAgendaOfficer(item, role) {
  if (!OFFICER_ROLES.includes(role)) return;
  const memberId = officerAssignmentsFromMembers()[role];
  if (!memberId) return;
  const member = state.members.find((candidate) => candidate.id === memberId);
  if (!member) return;
  item.memberId = member.id;
  item.member = member.displayName;
}

function applyOfficerAssignments(assignments) {
  const normalized = normalizeOfficerAssignments(assignments);
  const assignedRolesByMemberId = new Map();
  Object.entries(normalized).forEach(([role, memberId]) => {
    if (!memberId) return;
    const roles = assignedRolesByMemberId.get(memberId) || [];
    roles.push(role);
    assignedRolesByMemberId.set(memberId, roles);
  });
  state.members = state.members.map((member) => {
    const preserved = (Array.isArray(member.officerRoles) ? member.officerRoles : []).filter((role) => !OFFICER_ROLES.includes(role));
    return { ...member, officerRoles: [...preserved, ...(assignedRolesByMemberId.get(member.id) || [])] };
  });
}

function supportRoleEntries() {
  return [
    { label: "Photographer", memberId: state.meeting.photographerMemberId, name: state.meeting.photographer },
    { label: "Meeting Manager", memberId: state.meeting.meetingManagerMemberId, name: state.meeting.meetingManager },
  ];
}

function getTimeline() {
  let cursor = toMinutes(state.meeting.startTime);
  const allItems = state.meeting.blocks.flatMap((block) => block.items.map((item) => ({ block, item })));
  const rows = allItems.map(({ block, item }, index) => {
      const duration = Number(item.duration) || 0;
      const row = { ...item, duration, status: item.kind === "break" ? "" : normalizeAgendaStatus(item.status), blockId: block.id, blockTitle: block.title, start: fromMinutes(cursor) };
      cursor += duration;
      if (state.meeting.enableTransitionTime && index < allItems.length - 1) cursor += TRANSITION_MINUTES;
      return row;
    });
  return rows;
}

function getValidation() {
  const issues = [];
  const add = (severity, text, stage, task, focusKey = "") => issues.push({ type: severity === "blocker" ? "error" : "warning", severity, text, stage, task, focusKey });
  if (!state.meeting.date.trim()) add("blocker", "Meeting date is required.", "preparation", "meeting-details", "meta:date");
  if (!state.meeting.theme.trim()) add("blocker", "Meeting theme is required.", "preparation", "meeting-details", "meta:theme");
  if (!state.meeting.wordOfDay.word.trim()) add("recommendation", "Word of the Day is missing.", "preparation", "meeting-details", "meta:wordOfDay.word");
  if (!state.meeting.blocks.length) add("blocker", "Agenda needs at least one block.", "preparation", "build-agenda", "add-block");
  if (!activeVotingImage()?.present) add("recommendation", "Voting QR code has not been prepared.", "preparation", "prepare-voting", "voting-prepare");
  if (!state.futurePosters[0]?.present) add("blocker", "Future meeting poster 1 is required.", "preparation", "future-posters", "future-poster-1");
  if (!state.groupQr?.present) add("recommendation", "Club guest group QR code has not been configured.", "preparation", "review-share", "club-settings");

  state.meeting.blocks.forEach((block) => {
    if (!block.items.length) add("recommendation", `${block.title} has no items.`, "preparation", "build-agenda", `block-select:${block.id}`);
    block.items.forEach((item) => {
      if (!item.session.trim()) add("blocker", "Agenda item title is required.", "preparation", "build-agenda", `item:${item.id}:session`);
      if (item.kind !== "break" && !item.member.trim()) add("recommendation", `${item.role || item.session} has no member assigned.`, "preparation", "build-agenda", `item:${item.id}:member`);
      if (item.kind === "speech" && !item.evaluator.trim()) add("recommendation", `${item.session} has no evaluator.`, "preparation", "build-agenda", `item:${item.id}:evaluator`);
      if (block.type === "prepared_speeches" && item.kind === "speech") {
        const pathwaysComplete = item.pathwaysMode === "pathways" && item.pathwaysPath && item.pathwaysLevel && item.pathwaysProjectId && item.pathwaysFormId;
        const customComplete = item.pathwaysMode === "custom" && item.speechObjective.trim();
        if (!pathwaysComplete && !customComplete) add("blocker", `${item.session} needs complete learning-path details or a custom speech objective.`, "preparation", "build-agenda", `item:${item.id}:speech-type`);
      }
      if (Number(item.duration) <= 0) add("blocker", `${item.session} needs a valid duration.`, "preparation", "build-agenda", `item:${item.id}:duration`);
    });
  });

  const total = totalMinutes();
  if (total > 120) add("recommendation", `Total duration is ${total} minutes, exceeding the 120-minute target.`, "preparation", "build-agenda", "block-list");
  return issues;
}

function validationCounts() {
  const issues = getValidation();
  return {
    issues,
    blockers: issues.filter((issue) => issue.severity === "blocker").length,
    recommendations: issues.filter((issue) => issue.severity === "recommendation").length,
  };
}

function isFinalized() {
  return state.meeting?.status === "final";
}

function selectedBlock() {
  return state.meeting.blocks.find((block) => block.id === state.selectedBlockId) || state.meeting.blocks[0];
}

function notify(message) {
  state.toast = message;
  if (!renderToastRegion()) render();
  window.setTimeout(() => {
    state.toast = "";
    renderToastRegion();
  }, 2200);
}

async function waitForPrintLayout() {
  await Promise.race([
    Promise.all([
      document.fonts?.ready,
      ...[...document.querySelectorAll(".agenda-page img")].filter((image) => !image.complete).map((image) => new Promise((resolve) => {
        image.addEventListener("load", resolve, { once: true });
        image.addEventListener("error", resolve, { once: true });
      })),
    ]),
    new Promise((resolve) => setTimeout(resolve, 2000)),
  ]);
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

function printLayoutWarnings() {
  // ponytail: mobile screen media differs from print; add a print-media probe if mobile preflight becomes necessary.
  if (window.matchMedia("(max-width: 680px)").matches) return [];
  const pages = [...document.querySelectorAll(".agenda-page")];
  const zooms = pages.map((page) => page.style.zoom);
  pages.forEach((page) => { page.style.zoom = "1"; });
  const warnings = pages
    .filter((page) => page.scrollHeight > page.clientHeight + 1)
    .map((page) => `${page.classList.contains("front-page") ? "Front" : "Back"} page exceeds A4 and may be clipped or split.`);
  pages.forEach((page, index) => { page.style.zoom = zooms[index]; });
  return warnings;
}

function restorePrintView(prompt) {
  state.activeView = prompt.previousView;
  state.mobileView = prompt.previousMobileView;
  state.activeStage = prompt.previousStage;
  state.activeTask = prompt.previousTask;
  state.printPrompt = null;
  render();
}

async function openPrintPrompt() {
  const prompt = {
    ...agendaPrintRecommendation(state.meeting),
    blockers: getValidation().filter((issue) => issue.severity === "blocker").map((issue) => issue.text),
    layoutWarnings: [],
    checking: true,
    previousView: state.activeView,
    previousMobileView: state.mobileView,
    previousStage: state.activeStage,
    previousTask: state.activeTask,
  };
  state.printPrompt = prompt;
  state.activeView = "admin";
  state.mobileView = "preview";
  state.activeStage = "preparation";
  state.activeTask = "review-share";
  render();
  await waitForPrintLayout();
  if (state.printPrompt !== prompt) return;
  prompt.layoutWarnings = printLayoutWarnings();
  prompt.checking = false;
  renderOverlayRegion();
}

async function printAgenda(copies = 1, prompt = state.printPrompt) {
  if (!prompt) return;
  const restore = () => restorePrintView(prompt);
  try {
    const preview = document.querySelector(".preview-scroll");
    const pages = [...(preview?.querySelectorAll(":scope > .agenda-page") || [])];
    if (pages.length !== 2) {
      restore();
      notify("Agenda preview is not ready. Please try again.");
      return;
    }
    const copyCount = Math.min(50, Math.max(1, Math.round(Number(copies) || 1)));
    for (let copy = 1; copy < copyCount; copy += 1) pages.forEach((page) => preview.append(page.cloneNode(true)));
    window.addEventListener("afterprint", restore, { once: true });
    window.print();
  } catch (error) {
    window.removeEventListener("afterprint", restore);
    restore();
    throw error;
  }
}

function updateField(path, value) {
  const parts = path.split(".");
  let target = state.meeting;
  parts.slice(0, -1).forEach((key) => (target = target[key]));
  target[parts.at(-1)] = value;
  markDirty();
  refreshDerivedRegions();
}

function renderField(label, path, value, options = {}) {
  const span = options.span ? " span-2" : "";
  const type = options.type || "text";
  const focusKey = `meta:${path}`;
  if (options.checkbox) {
    return `<div class="field checkbox-field${span}"><label><input data-path="${path}" data-focus-key="${focusKey}" type="checkbox" ${value ? "checked" : ""} /><span>${label}</span></label></div>`;
  }
  if (options.select) {
    return `<div class="field${span}"><label>${label}</label><select data-path="${path}" data-focus-key="${focusKey}">${options.select
      .map((option) => `<option value="${esc(option.value)}" ${option.value === value ? "selected" : ""}>${esc(option.label)}</option>`)
      .join("")}</select></div>`;
  }
  if (options.textarea) {
    return `<div class="field${span}"><label>${label}</label><textarea data-path="${path}" data-focus-key="${focusKey}">${esc(value)}</textarea></div>`;
  }
  return `<div class="field${span}"><label>${label}</label><input data-path="${path}" data-focus-key="${focusKey}" type="${type}" value="${esc(value)}" /></div>`;
}

function renderMemberSelect(label, selectedId, attributes, { span = false, allowGuest = false, allowEmpty = true, disabled = false, selectedLabel = "", className = "" } = {}) {
  const selectedName = state.members.find((member) => member.id === selectedId)?.displayName || selectedLabel;
  return `<div class="field${span ? " span-2" : ""}${className ? ` ${esc(className)}` : ""}"><label>${label}</label><button class="member-picker-trigger" type="button" data-open-member-picker data-picker-label="${esc(label)}" data-selected-id="${esc(selectedId)}" data-selected-label="${esc(selectedName)}" data-allow-empty="${allowEmpty}" data-allow-guest="${allowGuest}" ${attributes} ${disabled ? "disabled" : ""} aria-haspopup="dialog"><span>${esc(selectedName || "None / Unassigned")}</span><i aria-hidden="true">⌄</i></button>${state.membersLoading ? '<small class="member-picker-status">Syncing members…</small>' : ""}</div>`;
}

function renderSupportRolesEditor() {
  return `<div class="subsection">
    <div class="subsection-heading">
      <h3>Support roles</h3>
      <p>Meeting-level roles shown in the first-page sidebar.</p>
    </div>
    <div class="form-grid">
      ${renderMemberSelect("Photographer", state.meeting.photographerMemberId, 'data-meeting-member-key="photographer" data-focus-key="meeting-role:photographer"', { allowGuest: true, selectedLabel: state.meeting.photographer })}
      ${renderMemberSelect("Meeting Manager", state.meeting.meetingManagerMemberId, 'data-meeting-member-key="meetingManager" data-focus-key="meeting-role:meetingManager"', { allowGuest: true, selectedLabel: state.meeting.meetingManager })}
    </div>
  </div>`;
}

function renderMetaEditor() {
  const m = state.meeting;
  return `
    <section class="section-card" data-region="meta" data-scroll-anchor="meta">
      <div class="section-heading"><div><span class="eyebrow">Meeting setup</span><h2>Meeting details</h2></div></div>
      <div class="section-content form-grid">
        ${renderField("Meeting no.", "meetingNumber", m.meetingNumber, { type: "number" })}
        ${renderField("Date", "date", m.date, { type: "date" })}
        ${renderField("Start time", "startTime", m.startTime, { type: "time" })}
        ${renderField("Theme", "theme", m.theme, { span: true })}
        ${renderField("Venue", "venue", m.venue, { span: true })}
        ${renderField("Enable transition time", "enableTransitionTime", m.enableTransitionTime, { checkbox: true, span: true })}
        ${renderField("Word of the day", "wordOfDay.word", m.wordOfDay.word)}
        ${renderField("Pronunciation", "wordOfDay.pronunciation", m.wordOfDay.pronunciation)}
        ${renderField("Example sentence", "wordOfDay.example", m.wordOfDay.example, { span: true, textarea: true })}
        ${renderField("Voting code", "votingCode", m.votingCode, { span: true })}
      </div>
      <div class="section-content section-content-divider">
        ${renderSupportRolesEditor()}
      </div>
    </section>`;
}

function imageUrl(kind, image) {
  if (!image?.present) return "";
  if (image.url) return image.url;
  const path = kind === "voting-system"
    ? `/api/meetings/${encodeURIComponent(state.meeting.id)}/voting?action=system-image`
    : kind === "voting"
    ? `/api/meetings/${encodeURIComponent(state.meeting.id)}/images/voting`
    : kind === "group"
      ? "/api/assets/group-qr"
      : kind === "officer-team"
        ? "/api/assets/officer-team-photo"
        : `/api/assets/${encodeURIComponent(kind)}`;
  return appendVersion(path, image.version);
}

function renderQrFrame(kind, image, className = "") {
  return `<div class="qr-frame ${className} ${image?.present ? "has-image" : "is-empty"}">
    ${image?.present
      ? `<img src="${esc(imageUrl(kind, image))}" alt="${kind.startsWith("voting") ? "Voting QR code" : kind === "wechat-payment-qr" ? "WeChat payment QR code" : "Guest group QR code"}" />`
      : `<span>QR code<br />not uploaded</span>`}
  </div>`;
}

function activeVotingImage() {
  return state.meeting.qrSource === "manual" ? state.meeting.votingQr : state.meeting.systemVotingQr;
}

function renderVotingResults() {
  if (!state.votingResults) return "";
  const feedback = state.votingResults.feedback || { averageRating: null, distribution: {}, comments: [] };
  return `<div class="voting-results"><strong>${state.votingResults.responseCount} responses</strong>${Object.values(state.votingResults.awards).map((award) => `<div><b>${esc(award.title)}</b>: ${award.winners.length ? award.winners.map((item) => esc(item.name)).join(", ") : "No result"}<br>${award.candidates.map((item) => `${esc(item.label || item.name)} ${item.votes}${item.historical ? " (historical)" : ""}`).join(" · ")}</div>`).join("")}<div><b>Meeting rating</b>: ${feedback.averageRating == null ? "No ratings" : `${feedback.averageRating} / 5`}<br>${[1, 2, 3, 4, 5].map((rating) => `${rating}★ ${feedback.distribution?.[rating] || 0}`).join(" · ")}</div>${feedback.comments?.length ? `<div><b>Comments</b>${feedback.comments.map((comment) => `<p>${esc(comment)}</p>`).join("")}</div>` : ""}</div>`;
}

function votingCandidates() {
  const items = state.meeting.blocks.flatMap((block) => block.items || []);
  const speeches = state.meeting.blocks.flatMap((block) => block.type === "prepared_speeches" ? block.items.filter((item) => item.kind === "speech") : []);
  const unique = (values) => [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
  const configuredRoleTaker = roleAwardConfig(state.meeting.votingForm).roleTakerRoleIds;
  const roles = (allowed, key) => {
    const seen = new Set();
    return items.map((item) => ({ item, identity: roleIdentity(item.role, item.roleId) }))
    .filter(({ item, identity }) => item.kind === "role" && allowed.has(identity.id) && item.status === "confirmed" && item.member)
    .filter(({ item, identity }) => {
      const id = item.roleAssignmentId || (key === "functionalRole" ? `${identity.id}:${item.member.trim().toLocaleLowerCase()}` : item.id);
      if (seen.has(id)) return false;
      seen.add(id); return true;
    }).map(({ item, identity }) => ({
      id: item.roleAssignmentId || (key === "functionalRole" ? `${identity.id}:${item.member.trim().toLocaleLowerCase()}` : item.id),
      label: `${identity.label} — ${item.member}`,
    }));
  };
  const evaluatorMap = new Map();
  speeches.filter((item) => item.evaluatorStatus === "confirmed" && item.evaluator).forEach((item) => {
    const id = item.evaluatorId || item.evaluator.toLocaleLowerCase();
    const value = evaluatorMap.get(id) || { id: `evaluator:${id}`, name: item.evaluator, speakers: [] };
    value.speakers.push(item.member || item.session); evaluatorMap.set(id, value);
  });
  return {
    roleTaker: roles(new Set([...ROLE_AWARD_POOLS.roleTaker, ...configuredRoleTaker]), "roleTaker"),
    facilitator: roles(new Set(ROLE_AWARD_POOLS.facilitator), "facilitator"),
    functionalRole: roles(new Set(ROLE_AWARD_POOLS.functionalRole), "functionalRole"),
    tableTopicsSpeaker: unique(state.meeting.tableTopicsSpeakers || []).map((name) => ({ id: `table-topics:${name.toLocaleLowerCase()}`, label: name })),
    preparedSpeaker: speeches.filter((item) => item.status === "confirmed" && item.member).map((item) => ({ id: item.id, label: `${item.member} — ${item.session}` })),
    evaluator: [...evaluatorMap.values()].map((item) => ({ id: item.id, label: `${item.name} — Evaluated: ${item.speakers.join(" / ")}` })),
  };
}

function preparedSpeechCompletions() {
  return state.meeting.blocks
    .flatMap((block) => block.type === "prepared_speeches" ? block.items.filter((item) => item.kind === "speech") : [])
    .filter((item) => item.status === "confirmed" && item.member);
}

function sharingMasterAutoNames() {
  const config = recognitionAwardConfig(state.meeting.votingForm);
  return [...new Set(state.meeting.blocks
    .flatMap((block) => block.items || [])
    .filter((item) => item.kind === "role" && item.status === "confirmed" && item.member)
    .filter((item) => config.sharingMasterRoleIds.includes(roleIdentity(item.role, item.roleId).id))
    .map((item) => item.member.trim())
    .filter(Boolean))];
}

function votingCandidateDiff() {
  const current = votingCandidates();
  const synced = state.meeting.votingForm?.syncedCandidates || {};
  let added = 0;
  let removed = 0;
  Object.keys(current).forEach((key) => {
    added += current[key].filter((item) => !(synced[key] || []).some((stored) => stored.id === item.id && stored.label === item.label)).length;
    removed += (synced[key] || []).filter((item) => !current[key].some((candidate) => candidate.id === item.id && candidate.label === item.label)).length;
  });
  return { added, removed, needsUpdate: Boolean(added || removed) };
}

function renderVotingSource() {
  return `<fieldset class="voting-source" ${state.votingBusy ? "disabled" : ""}><legend>Voting source</legend>
    <label class="${state.meeting.qrSource === "system" ? "active" : ""}"><input type="radio" name="voting-source" data-voting-source value="system" ${state.meeting.qrSource === "system" ? "checked" : ""}>System form</label>
    <label class="${state.meeting.qrSource === "manual" ? "active" : ""}"><input type="radio" name="voting-source" data-voting-source value="manual" ${state.meeting.qrSource === "manual" ? "checked" : ""}>Manual QR</label>
  </fieldset>`;
}

function renderAgendaSyncTip(label) {
  return `<div class="agenda-sync-tip" role="status"><div class="sync-progress"><span aria-hidden="true"></span>${esc(label)}</div>${speakingTips.markup({ delayed: true })}</div>`;
}

function renderCandidateSummary() {
  const candidates = votingCandidates();
  const issues = roleAwardIssues(state.meeting);
  const list = (values, empty) => values.length ? values.map((item) => `<span>${esc(item.label)}</span>`).join("") : `<em>${empty}</em>`;
  return `<div class="candidate-summary">
    ${issues.blockers.length || issues.warnings.length ? `<div class="role-award-issues">${issues.blockers.map((item) => `<strong>${esc(item)}</strong>`).join("")}${issues.warnings.map((item) => `<span>${esc(item)}</span>`).join("")}</div>` : ""}
    <div><strong>Role takers <b>${candidates.roleTaker.length}</b></strong>${list(candidates.roleTaker, "Confirm TME, TTE and GE")}</div>
    <div><strong>Facilitators <b>${candidates.facilitator.length}</b></strong>${list(candidates.facilitator, "Confirm Warm-up Host, TTM, Guest Talk Host and Voting Host")}</div>
    <div><strong>Functional roles <b>${candidates.functionalRole.length}</b></strong>${list(candidates.functionalRole, "Confirm Timer, Grammarian and Ah-Counter")}</div>
    <div><strong>Prepared speakers <b>${candidates.preparedSpeaker.length}</b></strong>${list(candidates.preparedSpeaker, "Complete assignments in Build agenda")}</div>
    <div><strong>Evaluators <b>${candidates.evaluator.length}</b></strong>${list(candidates.evaluator, "Complete assignments in Build agenda")}</div>
    <div><strong>Table Topics</strong><em>Added during Live Voting</em></div>
  </div>${renderRoleTakerConfig()}${renderRecognitionConfig()}<button class="text-button" data-task="build-agenda" data-stage-target="preparation">Edit agenda →</button>`;
}

function renderRoleTakerConfig() {
  const config = roleAwardConfig(state.meeting.votingForm);
  const fixed = new Map([
    ...ROLE_AWARD_POOLS.roleTaker.map((id) => [id, "Best Role Taker default"]),
    ...ROLE_AWARD_POOLS.facilitator.map((id) => [id, "Best Facilitator"]),
    ...ROLE_AWARD_POOLS.functionalRole.map((id) => [id, "Best Functional Role"]),
  ]);
  const rows = roleEntries(state.meeting).map((role) => {
    const disabled = fixed.has(role.id);
    const checked = config.roleTakerRoleIds.includes(role.id);
    const note = disabled ? fixed.get(role.id) : role.standard ? "Can add to Best Role Taker" : "Custom role";
    return `<label class="${disabled ? "disabled" : ""}"><input type="checkbox" data-role-taker-role="${esc(role.id)}" ${checked ? "checked" : ""} ${disabled ? "disabled" : ""}>${esc(role.label)}<span>${esc(note)}</span></label>`;
  }).join("") || "<em>No agenda roles yet.</em>";
  return `<details class="role-award-config"><summary>Extend Best Role Taker</summary><div>${rows}</div></details>`;
}

function renderRecognitionConfig() {
  const config = recognitionAwardConfig(state.meeting.votingForm);
  const speeches = preparedSpeechCompletions();
  const roles = roleEntries(state.meeting).map((role) => {
    const checked = config.sharingMasterRoleIds.includes(role.id);
    return `<label><input type="checkbox" data-sharing-master-role="${esc(role.id)}" ${checked ? "checked" : ""}>${esc(role.label)}</label>`;
  }).join("") || "<em>No agenda roles yet.</em>";
  return `<details class="role-award-config"><summary>Recognition awards</summary><div>
    <span>Speech Completion · ${speeches.length ? speeches.map((item) => esc(item.member)).join(" · ") : "No confirmed prepared speaker"}</span>
    <strong>Sharing Master roles</strong>
    ${roles}
  </div></details>`;
}

function renderVotingPreparation() {
  const m = state.meeting;
  const prepared = Boolean(m.votingForm?.formId);
  const busy = Boolean(state.votingBusy);
  const authorization = m.votingForm?.authorization;
  const authorizationReady = authorization?.status === "ready";
  const diff = votingCandidateDiff();
  if (m.qrSource === "manual") return `${renderVotingSource()}${renderImageEditor("voting", "Manual voting QR code", "Used on both Agenda pages.", m.votingQr)}`;
  const stateLabel = !prepared ? "Not prepared" : diff.needsUpdate ? `Needs update · ${diff.added} added · ${diff.removed} removed` : `Ready · synced ${esc(m.votingForm.lastSyncedAt || "unknown")}`;
  return `${renderVotingSource()}<article class="voting-readiness">
    ${renderQrFrame("voting-system", activeVotingImage(), "editor-qr")}
    <div class="voting-config"><div class="voting-state ${prepared && !diff.needsUpdate ? "ready" : ""}"><span></span><strong>${stateLabel}</strong></div>
      ${renderCandidateSummary()}
      <div class="voting-primary-actions">
        ${!prepared ? `<button class="button primary" data-voting-prepare ${busy ? "disabled" : ""}>${state.votingBusy === "prewarm" ? "Preparing ahead…" : state.votingBusy === "prepare" ? "Preparing…" : "Prepare voting form"}</button>` : diff.needsUpdate ? `<button class="button primary" data-voting-sync ${busy ? "disabled" : ""}>${state.votingBusy === "prewarm" ? "Syncing ahead…" : state.votingBusy === "sync" ? "Updating…" : "Update voting form"}</button>` : ""}
        ${prepared && m.votingForm?.shareUrl ? `<a class="button" href="${esc(m.votingForm.shareUrl)}" target="_blank" rel="noopener">Preview form ↗</a>` : ""}
        ${prepared ? `<details class="voting-more"><summary>More</summary><div>${m.votingForm?.editUrl ? `<a href="${esc(m.votingForm.editUrl)}" target="_blank" rel="noopener">Edit voting table ↗</a>` : ""}<button data-voting-prepare>Repair voting form</button></div></details>` : ""}
      </div>
      ${state.votingProgress ? `<p class="voting-progress" role="status">${esc(state.votingProgress)}</p>` : ""}
      ${busy && state.votingBusy !== "prewarm" ? renderAgendaSyncTip(state.votingProgress || "Syncing voting data…") : ""}
      ${prepared && !authorizationReady ? `<div class="voting-alert"><span>${esc(authorization?.message || "Editor authorization is pending.")}</span><button class="text-button" data-voting-authorize>${state.votingBusy === "authorize" ? "Retrying…" : "Retry authorization"}</button></div>` : ""}
    </div></article>`;
}

function ensureTableTopicsDraft() {
  if (state.tableTopicsDraftMeetingId === state.meeting.id) return;
  state.tableTopicsDraftMeetingId = state.meeting.id;
  state.tableTopicsDraft = state.meeting.tableTopicsSpeakers.join("\n");
  state.tableTopicsDraftDirty = false;
}

function renderLiveVoting() {
  const m = state.meeting;
  ensureTableTopicsDraft();
  if (m.qrSource === "manual") return `<article class="voting-readiness">${renderQrFrame("voting", activeVotingImage(), "editor-qr")}<div class="voting-config"><div class="voting-state ready"><span></span><strong>Manual QR selected</strong></div><p>Voting entry is ready on the Agenda.</p></div></article>`;
  const prepared = Boolean(m.votingForm?.formId);
  const recognition = recognitionAwardConfig(m.votingForm);
  const autoSharingNames = sharingMasterAutoNames();
  return `<article class="voting-live">
    <div class="voting-live-head"><div><span class="eyebrow">Live candidates</span><h3>Table Topics speakers</h3></div><span class="draft-state ${state.tableTopicsDraftDirty ? "dirty" : ""}">${state.tableTopicsDraftDirty ? "Unsaved" : "Saved"}</span></div>
    <label>One full name per line<textarea data-table-topics-speakers placeholder="Add speakers as they take the stage" ${!prepared ? "disabled" : ""}>${esc(state.tableTopicsDraft)}</textarea></label>
    <label>Sharing Master names<textarea data-sharing-master-names placeholder="${esc(autoSharingNames.length ? autoSharingNames.join(" / ") : "Leave blank to use selected role assignments")}">${esc(recognition.sharingMasterNames.join("\n"))}</textarea></label>
    ${!prepared ? '<div class="voting-alert">Prepare system form before meeting starts.</div>' : ""}
    ${m.votingForm?.awardsNeedReconfirmation ? '<div class="voting-alert"><strong>⚠ Reconfirm awards</strong><span>Candidates changed after awards were confirmed. The previous snapshot is stale and presentation is disabled.</span></div>' : ""}
    <div class="voting-live-footer">
      <div class="voting-primary-actions"><button class="button primary" data-save-table-topics ${!prepared || !state.tableTopicsDraftDirty || state.votingBusy ? "disabled" : ""}>${state.votingBusy === "speakers" ? "Saving…" : "Save speakers & update form"}</button><span>⌘S / Ctrl+S</span></div>
      <div class="live-voting-tools"><button class="button" data-task="${isFinalized() ? "review-share" : "build-agenda"}" data-stage-target="preparation">Adjust agenda roles</button>${prepared && m.votingForm?.shareUrl ? `<a class="button" href="${esc(m.votingForm.shareUrl)}" target="_blank" rel="noopener">Open voting form ↗</a>` : ""}<button class="button" data-voting-results>Refresh results</button><details class="voting-more"><summary>Danger zone</summary><div><button class="danger-link" data-voting-clear>Clear responses</button></div></details></div>
    </div>
    ${state.votingBusy ? renderAgendaSyncTip(state.votingBusy === "speakers" ? "Syncing speakers and voting form…" : "Syncing voting data…") : ""}
    ${renderVotingResults()}
  </article>`;
}

function renderImageEditor(kind, title, description, image) {
  const busy = state.imageBusy === kind;
  const emptyHint = kind === "wechat-payment-qr" ? "JPEG or PNG · original ratio · max 5 MB" : "JPEG or PNG · square · max 2 MB";
  return `<article class="image-upload-card asset-upload-card">
    ${renderQrFrame(kind, image, "editor-qr asset-preview")}
    <div class="image-upload-copy">
      <strong>${title}</strong>
      <p>${description}</p>
      <span title="${image?.present ? esc(image.name) : ""}">${image?.present ? `${esc(image.name)} · ${Math.max(1, Math.round(image.size / 1024))} KB` : emptyHint}</span>
    </div>
    <div class="image-upload-actions">
      <label class="button ${busy ? "disabled" : ""}">
        <input type="file" accept="image/jpeg,image/png" data-upload-image="${kind}" ${busy ? "disabled" : ""} />
        ${busy ? "Uploading…" : image?.present ? "Replace" : "Upload"}
      </label>
      ${image?.present ? `<button class="button danger" data-remove-image="${kind}" ${busy ? "disabled" : ""}>Remove</button>` : ""}
    </div>
    ${busy ? renderAgendaSyncTip("Uploading image…") : ""}
  </article>`;
}

function renderOfficerImageEditor(image) {
  const busy = state.imageBusy === "officer-team";
  return `<article class="image-upload-card asset-upload-card">
    <div class="photo-frame editor-photo asset-preview ${image?.present ? "has-image" : "is-empty"}">
      ${image?.present ? `<img src="${esc(imageUrl("officer-team", image))}" alt="Officer team" />` : "<span>Officer team photo<br />not uploaded</span>"}
    </div>
    <div class="image-upload-copy">
      <strong>Officer team image</strong>
      <p>Global across all meetings. Back page shows full image without stretching.</p>
      <span title="${image?.present ? esc(image.name) : ""}">${image?.present ? `${esc(image.name)} · ${Math.max(1, Math.round(image.size / 1024))} KB` : "JPEG or PNG · 16:9 recommended · max 5 MB"}</span>
    </div>
    <div class="image-upload-actions">
      <label class="button ${busy ? "disabled" : ""}">
        <input type="file" accept="image/jpeg,image/png" data-upload-image="officer-team" ${busy ? "disabled" : ""} />
        ${busy ? "Uploading…" : image?.present ? "Replace" : "Upload"}
      </label>
      ${image?.present ? `<button class="button danger" data-remove-image="officer-team" ${busy ? "disabled" : ""}>Remove</button>` : ""}
    </div>
    ${busy ? renderAgendaSyncTip("Uploading officer image…") : ""}
  </article>`;
}

function renderFuturePosterEditor(kind, image, index) {
  const busy = state.imageBusy === kind;
  const required = index === 1;
  return `<article class="image-upload-card asset-upload-card">
    <div class="photo-frame future-poster-preview asset-preview ${image?.present ? "has-image" : "is-empty"}">
      ${image?.present ? `<img src="${esc(imageUrl(kind, image))}" alt="Future meeting poster ${index}" />` : `<span>Future poster ${index}<br />not uploaded</span>`}
    </div>
    <div class="image-upload-copy">
      <div class="asset-title-row"><strong>Future meeting poster ${index}</strong><span class="asset-requirement ${required ? "required" : "optional"}">${required ? "Required" : "Optional"}</span></div>
      <p>${required ? "Creates the poster slide after Voting & Announcement." : "Appears beside Poster 1 when uploaded."} Shared across meetings.</p>
      <span title="${image?.present ? esc(image.name) : ""}">${image?.present ? `${esc(image.name)} · ${Math.max(1, Math.round(image.size / 1024))} KB` : "JPEG or PNG · max 5 MB"}</span>
    </div>
    <div class="image-upload-actions">
      <label class="button ${busy ? "disabled" : ""}">
        <input type="file" accept="image/jpeg,image/png" data-upload-image="${kind}" data-focus-key="${kind}" ${busy ? "disabled" : ""} />
        ${busy ? "Uploading…" : image?.present ? "Replace" : "Upload"}
      </label>
      ${image?.present ? `<button class="button danger" data-remove-image="${kind}" ${busy ? "disabled" : ""}>Remove</button>` : ""}
    </div>
    ${busy ? renderAgendaSyncTip("Uploading future poster…") : ""}
  </article>`;
}

function renderFuturePostersTask() {
  const ready = Boolean(state.futurePosters[0]?.present);
  return `<section class="section-card future-posters-task" data-region="media">
    <div class="section-heading future-posters-heading">
      <div><span class="eyebrow">Presentation asset</span><h2>Future meeting posters</h2><p>Keep upcoming meeting promotion current without tying it to one meeting.</p></div>
      <span class="poster-readiness ${ready ? "ready" : "missing"}">${ready ? "Required poster ready" : "Required poster missing"}</span>
    </div>
    <div class="section-content image-upload-list">
      ${FUTURE_POSTER_KINDS.map((kind, index) => renderFuturePosterEditor(kind, state.futurePosters[index], index + 1)).join("")}
    </div>
  </section>`;
}

function renderClubIntroPhotoEditor(image) {
  const kind = "club-intro-photo";
  const busy = state.imageBusy === kind;
  return `<article class="image-upload-card asset-upload-card">
    <div class="photo-frame club-intro-preview asset-preview ${image?.present ? "has-image" : "is-empty"}">
      ${image?.present ? `<img src="${esc(imageUrl(kind, image))}" alt="Club introduction" />` : "<span>Club introduction photo<br />not uploaded</span>"}
    </div>
    <div class="image-upload-copy">
      <strong>Club introduction photo</strong>
      <p>Shown in the Club Intro slide. Large JPEG files are compressed before upload.</p>
      <span title="${image?.present ? esc(image.name) : ""}">${image?.present ? `${esc(image.name)} · ${Math.max(1, Math.round(image.size / 1024))} KB` : "JPEG or PNG · max 5 MB"}</span>
    </div>
    <div class="image-upload-actions">
      <label class="button ${busy ? "disabled" : ""}">
        <input type="file" accept="image/jpeg,image/png" data-upload-image="${kind}" ${busy ? "disabled" : ""} />
        ${busy ? "Compressing…" : image?.present ? "Replace" : "Upload"}
      </label>
      ${image?.present ? `<button class="button danger" data-remove-image="${kind}" ${busy ? "disabled" : ""}>Remove</button>` : ""}
    </div>
    ${busy ? renderAgendaSyncTip("Preparing club photo…") : ""}
  </article>`;
}

function renderMediaEditor() {
  const mediaContext = state.previewMode ? "Local preview media" : "Feishu Base media";
  const votingDescription = state.previewMode
    ? "Used on both agenda pages for this local preview."
    : "Saved with this meeting and used on both agenda pages.";
  const groupDescription = state.previewMode
    ? "Used on the back page for this local preview."
    : "Shared globally across every meeting.";
  return `<section class="section-card" data-region="media" data-scroll-anchor="media">
    <div class="section-heading"><div><span class="eyebrow">${mediaContext}</span><h2>QR code images</h2></div></div>
    <div class="section-content image-upload-list">
      ${renderVotingPreparation()}
      ${renderImageEditor("wechat-payment-qr", "WeChat payment QR code", state.previewMode ? "Used on the Agenda front page for this local preview." : "Shared globally on every Agenda front page.", state.paymentQr)}
      ${renderImageEditor("group", "Guest group QR code", groupDescription, state.groupQr)}
    </div>
  </section>`;
}

function renderOfficerEditor() {
  const assignments = officerAssignmentsFromMembers();
  return `<section class="section-card" data-region="officers" data-scroll-anchor="officers">
    <div class="section-heading"><div><span class="eyebrow">Global roster</span><h2>Club officers</h2></div></div>
    <div class="section-content">
      <div class="form-grid">
        ${OFFICER_ROLES.map((role) => renderMemberSelect(role, assignments[role], `data-officer-role="${esc(role)}" data-focus-key="officer:${esc(role)}"`, { allowEmpty: true, disabled: state.officerBusy })).join("")}
      </div>
    </div>
    <div class="section-content section-content-divider">
      ${renderOfficerImageEditor(state.officerTeamPhoto)}
    </div>
  </section>`;
}

function renderAwardsEditor() {
  const data = state.awards;
  const confirmed = data?.confirmedAwards;
  const stale = Boolean(data?.awardsStale);
  const disabled = state.previewMode || state.awardsBusy || !state.persisted || state.dirty || state.saveStatus !== "saved" || !data?.ready;
  const resultMarkup = data?.results?.map((result) => {
    const winnerNames = result.winners.map((winner) => winner.name).join(", ");
    const meta = result.totalVotes ? `${result.totalVotes} valid vote${result.totalVotes === 1 ? "" : "s"}` : result.winners.length ? "recognition" : "no votes";
    return `<div class="award-result"><div><strong>${esc(result.title)}</strong><span>${meta}</span></div><b>${esc(winnerNames || "No result — no certificate")}</b></div>`;
  }).join("") || '<p class="award-help">Load live voting results before confirming awards.</p>';
  return `<section class="section-card" data-region="awards">
    <div class="section-heading"><div><span class="eyebrow">Live ceremony</span><h2>Meeting awards</h2></div></div>
    <div class="section-content award-panel">
      ${resultMarkup}
      ${data?.blockers?.length ? `<div class="award-blockers">${data.blockers.map((blocker) => `<span>${esc(blocker)}</span>`).join("")}</div>` : ""}
      ${confirmed ? `<p class="award-help">Last confirmed by ${esc(confirmed.confirmedBy.name)} · ${esc(new Date(confirmed.confirmedAt).toLocaleString())}. ${stale ? "This snapshot is stale because candidates changed." : "New votes do not alter this snapshot."}</p>` : ""}
      ${stale ? '<div class="voting-alert"><strong>⚠ Reconfirm awards</strong><span>Reconfirm awards to enable presentation.</span></div>' : ""}
      <div class="add-row">
        <button class="button" data-refresh-awards data-focus-key="awards-refresh" ${state.awardsBusy ? "disabled" : ""}>${state.awardsBusy ? "Loading…" : "Refresh results"}</button>
        <button class="button primary" data-confirm-awards data-focus-key="awards-confirm" ${disabled ? "disabled" : ""}>${confirmed ? "Reconfirm results" : "Confirm results"}</button>
      </div>
      ${state.awardsBusy && state.awardsTip ? renderAgendaSyncTip("Syncing award results…") : ""}
      ${confirmed ? `${stale ? '<button class="button award-open" disabled>Open award presentation ↗</button>' : `<a class="button award-open" href="${esc(data.awardPage?.url || `/m/${encodeURIComponent(state.meeting.meetingNumber)}/awards`)}" target="_blank" rel="noopener">Open award presentation ↗</a>`}${stale ? "" : '<p class="award-help">Open before the ceremony. Use ← / → or Space to reveal each award.</p>'}` : ""}
    </div>
  </section>`;
}

function renderBlockList() {
  return `
    <section class="section-card" data-region="block-list" data-scroll-anchor="block-list">
      <div class="section-heading"><div><span class="eyebrow">Agenda structure</span><h2>Blocks</h2></div></div>
      <div class="section-content">
        <div class="block-list">
          ${state.meeting.blocks
            .map(
              (block, index) => `
                <div class="block-row ${block.id === state.selectedBlockId ? "active" : ""}">
                  <span class="block-index">${index + 1}</span>
                  <button class="block-copy" data-select-block="${block.id}" data-focus-key="block-select:${block.id}" type="button">
                    <strong>${esc(block.title)}</strong>
                    <span>${block.items.length} items · ${block.items.reduce((sum, item) => sum + Number(item.duration || 0), 0)} min</span>
                  </button>
                  <div class="block-actions">
                    <button class="icon-button" data-move-block="${block.id}" data-direction="-1" data-focus-key="block-move:${block.id}:-1" title="Move up">↑</button>
                    <button class="icon-button" data-move-block="${block.id}" data-direction="1" data-focus-key="block-move:${block.id}:1" title="Move down">↓</button>
                  </div>
                </div>`,
            )
            .join("")}
        </div>
        <div class="add-row">
          <button class="button" data-add-block data-focus-key="add-block">+ Add block</button>
          <button class="button" data-duplicate-block data-focus-key="duplicate-block">Duplicate</button>
        </div>
      </div>
    </section>`;
}

function renderItemEditor(item, index) {
  const showsSpeechObjective = selectedBlock()?.type === "prepared_speeches" && item.kind === "speech";
  const isBreak = item.kind === "break";
  const awards = isAwardsItem(item);
  const role = roleIdentity(item.role, item.roleId);
  return `
    <article class="item-card ${isBreak ? "item-break" : "has-assignment"}">
      <div class="item-card-head">
        <span class="item-kind ${isBreak ? "break" : ""}">${isBreak ? '<span class="break-mark">Ⅱ</span>' : `<span class="status-dot ${item.status}"></span>`}${esc(item.kind)} ${index + 1}</span>
        <div class="item-actions">
          <button class="icon-button" data-move-item="${item.id}" data-direction="-1" data-focus-key="item-move:${item.id}:-1">↑</button>
          <button class="icon-button" data-move-item="${item.id}" data-direction="1" data-focus-key="item-move:${item.id}:1">↓</button>
          <button class="icon-button" data-delete-item="${item.id}" data-focus-key="item-delete:${item.id}" title="Delete">×</button>
        </div>
      </div>
      <div class="form-grid">
        ${renderItemField(item, isBreak ? "Session" : "Session / speech title", "session", { span: true })}
        ${isBreak ? "" : renderRoleField(item, role)}
        ${renderItemField(item, "Duration (min)", "duration", { type: "number" })}
        ${isBreak ? "" : renderMemberField(item, "Member", "member", false, awards)}
        ${isBreak ? "" : renderItemField(item, "Status", "status", { select: ["confirmed", "pending", "vacant"] })}
        ${item.kind === "speech" ? renderMemberField(item, "Evaluator", "evaluator") : ""}
        ${item.kind === "speech" ? renderItemField(item, "Evaluator status", "evaluatorStatus", { select: ["confirmed", "pending", "vacant"] }) : ""}
        ${showsSpeechObjective ? renderSpeechDetailsEditor(item) : ""}
        ${isBreak ? "" : renderItemField(item, "External presentation URL (public)", "externalPresentationUrl", { span: true, type: "url", placeholder: "https://…", info: "Paste a public Tencent Docs presentation link. Other links must allow iframe embedding. It appears as an embedded slide after this agenda item." })}
      </div>
    </article>`;
}

function renderSpeechDetailsEditor(item) {
  const catalog = state.pathwaysCatalog;
  const draftKey = `${state.meeting.id}:${item.id}`;
  const details = state.pathwaysDrafts[draftKey] || item;
  const mode = details.pathwaysMode || "";
  const option = (value, label, selected) => `<option value="${esc(value)}" ${value === selected ? "selected" : ""}>${esc(label)}</option>`;
  const activeOrSelected = (entry, id, key) => entry.active || entry[key] === id;
  const pathProjects = catalog && details.pathwaysPath
    ? catalog.projects.filter((project) => activeOrSelected(project, details.pathwaysProjectId, "projectId") && [...project.requiredPaths, ...project.electivePaths].includes(details.pathwaysPath))
    : [];
  const levels = [...new Set(pathProjects.map((project) => project.level))].sort();
  const projects = pathProjects.filter((project) => project.level === details.pathwaysLevel);
  const project = projects.find((candidate) => candidate.projectId === details.pathwaysProjectId);
  const forms = catalog && project ? catalog.forms.filter((form) => activeOrSelected(form, details.pathwaysFormId, "formId") && form.projectId === project.projectId) : [];
  const form = forms.find((candidate) => candidate.formId === details.pathwaysFormId) || (forms.length === 1 ? forms[0] : null);
  const select = (label, key, values, selected, disabled = false) => `<label class="field"><span>${esc(label)}</span><select data-speech-item="${esc(item.id)}" data-speech-key="${esc(key)}" ${disabled ? "disabled" : ""}><option value="">Select…</option>${values.map((entry) => option(entry.value, entry.label, selected)).join("")}</select></label>`;
  const legacy = !mode && details.speechObjective ? `<p class="agenda-speech-warning">Legacy objective: ${esc(details.speechObjective)}. Choose Learning path or Custom to update it.</p>` : "";
  const required = !mode ? '<p class="agenda-speech-warning required">Choose Learning path or Custom before finalizing this Agenda.</p>' : "";
  const fields = mode === "pathways"
    ? catalog
      ? `<div class="agenda-path-level">${select("Path", "pathwaysPath", catalog.paths.map((value) => ({ value, label: value })), details.pathwaysPath)}
        ${select("Level", "pathwaysLevel", levels.map((value) => ({ value, label: `Level ${value}` })), details.pathwaysLevel, !details.pathwaysPath)}</div>
        ${select("Project", "pathwaysProjectId", projects.map((value) => ({ value: value.projectId, label: value.name })), details.pathwaysProjectId, !details.pathwaysLevel)}
        ${forms.length === 1 ? "" : select("Speech variant", "pathwaysFormId", forms.map((value) => ({ value: value.formId, label: value.variant })), details.pathwaysFormId, !project)}
        <label class="field"><span>Official speech purpose</span><textarea rows="4" readonly>${esc(form?.speechPurpose || (forms.length > 1 ? "Select a speech variant." : "Select a project."))}</textarea></label>`
      : '<p class="agenda-speech-warning">Learning catalog unavailable. Choose Custom.</p>'
    : mode === "custom"
      ? `<label class="field"><span>Custom speech objective</span><textarea rows="4" data-item="${esc(item.id)}" data-item-key="speechObjective" maxlength="1000">${esc(details.speechObjective)}</textarea></label>`
      : "";
  const modeChoice = (value, label) => `<label><input type="radio" name="speech-mode-${esc(item.id)}" value="${esc(value)}" data-speech-item="${esc(item.id)}" data-speech-key="pathwaysMode" ${value === mode ? "checked" : ""}><span>${esc(label)}</span></label>`;
  return `<section class="agenda-speech-card span-2">
    <header><div><span class="eyebrow">Prepared speech</span><h4>Speech details</h4></div><small>Same information used in Role Book</small></header>
    <div class="agenda-speech-fields">${legacy}${required}<div class="agenda-speech-type"><span>Speech type</span><div class="agenda-speech-modes mode-${mode || "required"}" role="radiogroup" aria-label="Speech type" tabindex="-1" data-focus-key="item:${esc(item.id)}:speech-type">
      ${modeChoice("pathways", "Learning path")}${modeChoice("custom", "Custom")}
    </div></div>${fields}</div>
  </section>`;
}

function normalizedPersonName(name) {
  return String(name || "").split(",")[0].trim().toLocaleLowerCase();
}

function memberForName(name) {
  const normalized = normalizedPersonName(name);
  return state.members.find((member) => normalizedPersonName(member.displayName) === normalized);
}

function memberIdForName(name) {
  return memberForName(name)?.id || "";
}

function renderMemberField(item, label, key, span = false, disabled = false) {
  const idKey = `${key}Id`;
  const selectedId = item[idKey] || memberIdForName(item[key]);
  return renderMemberSelect(
    label,
    selectedId,
    `data-member-item="${item.id}" data-member-key="${key}" data-focus-key="item:${item.id}:${key}"`,
    { span, allowGuest: true, selectedLabel: item[key], className: `item-field-${key}`, disabled },
  );
}

function roleCatalogMatch(value) {
  const normalized = String(value || "").trim().toLocaleLowerCase();
  return state.roles.find((role) => [role.name, ...(role.aliases || [])].some((name) => String(name).trim().toLocaleLowerCase() === normalized));
}

function renderRoleField(item, identity) {
  if (isAwardsItem(item)) {
    return `<div class="field item-field-role"><div class="field-label"><label>Role title</label></div>
      <input value="President" readonly aria-readonly="true"><small>Fixed for Awards · follows Club settings</small></div>`;
  }
  const current = String(item.role || "");
  const match = roleCatalogMatch(current);
  const exact = match?.name === current;
  const currentOption = current && !exact
    ? `<option value="${esc(current)}" selected>Current · ${esc(current)}${match ? ` → ${esc(match.name)}` : " · Legacy"}</option>`
    : "";
  const options = state.roles.map((role) => `<option value="${esc(role.name)}" ${role.name === current ? "selected" : ""}>${esc(role.name)}</option>`).join("");
  const status = state.rolesLoading
    ? "<small>Loading role catalog…</small>"
    : state.rolesError
      ? `<small class="role-catalog-error" title="${esc(state.rolesError)}">Role catalog unavailable · <button type="button" data-retry-roles>Retry</button></small>`
      : `<small>${identity.standard ? `Recognized as ${esc(identity.label)}` : match ? `Matches ${esc(match.name)}` : current ? "Legacy role" : "Choose an active RoleCatalog role"}</small>`;
  return `<div class="field item-field-role"><div class="field-label"><label for="item-${esc(item.id)}-role">Role title</label></div>
    <select id="item-${esc(item.id)}-role" data-role-item="${esc(item.id)}" data-focus-key="item:${esc(item.id)}:role" ${state.rolesLoading || state.rolesError ? "disabled" : ""}>
      ${current ? "" : '<option value="" selected>Select role…</option>'}${currentOption}${options}${state.rolesLoading || state.rolesError ? "" : '<option value="__add_role__">＋ Add new role…</option>'}
    </select>${status}</div>`;
}

function renderItemField(item, label, key, options = {}) {
  const span = options.span ? " span-2" : "";
  const fieldClass = `field${span} item-field-${key}`;
  const inputId = `item-${item.id}-${key}`;
  const fieldLabel = `<div class="field-label"><label for="${esc(inputId)}">${esc(label)}</label>${options.info ? `<button class="field-info" type="button" aria-label="${esc(options.info)}" data-tooltip="${esc(options.info)}">i</button>` : ""}</div>`;
  if (options.select) {
    return `<div class="${fieldClass}">${fieldLabel}<select id="${esc(inputId)}" data-item="${item.id}" data-item-key="${key}" data-focus-key="item:${item.id}:${key}">${options.select
      .map((option) => `<option value="${esc(option)}" ${option === item[key] ? "selected" : ""}>${esc(option || "Select member")}</option>`)
      .join("")}</select></div>`;
  }
  if (options.textarea) {
    return `<div class="${fieldClass}">${fieldLabel}<textarea id="${esc(inputId)}" data-item="${item.id}" data-item-key="${key}" data-focus-key="item:${item.id}:${key}" placeholder="Describe what the speaker wants to practice or achieve…">${esc(item[key])}</textarea></div>`;
  }
  return `<div class="${fieldClass}">${fieldLabel}<input id="${esc(inputId)}" data-item="${item.id}" data-item-key="${key}" data-focus-key="item:${item.id}:${key}" type="${options.type || "text"}" ${options.list ? `list="${esc(options.list)}"` : ""} ${options.placeholder ? `placeholder="${esc(options.placeholder)}"` : ""} value="${esc(item[key])}" />${options.help ? `<small>${esc(options.help)}</small>` : ""}</div>`;
}

function allAgendaItems() {
  return state.meeting.blocks.flatMap((block) => block.items);
}

function syncLinkedAgendaItem(item, changedKey, previousRoleId) {
  syncLinkedAgendaItems(allAgendaItems(), item, changedKey, previousRoleId);
}

function renderBlockEditor() {
  const block = selectedBlock();
  if (!block) return "";
  return `
    <section class="section-card" data-region="block-editor" data-scroll-anchor="block-editor">
      <div class="section-heading">
        <div><span class="eyebrow">${esc(block.type)}</span><h2>Edit selected block</h2></div>
        <button class="button danger" data-delete-block data-focus-key="delete-block">Delete block</button>
      </div>
      <div class="section-content">
        <div class="form-grid">
          <div class="field span-2"><label>Block title</label><input data-block-key="title" data-focus-key="block:${block.id}:title" value="${esc(block.title)}" /></div>
          <div class="field span-2"><label>Block type</label><select data-block-key="type" data-focus-key="block:${block.id}:type">
            ${["opening", "table_topics", "prepared_speeches", "evaluation", "break", "closing", "custom"].map((type) => `<option ${block.type === type ? "selected" : ""}>${type}</option>`).join("")}
          </select></div>
        </div>
        <div style="margin-top:12px">
          ${block.items.map(renderItemEditor).join("")}
        </div>
        <div class="add-row">
          <button class="button" data-add-item="role" data-focus-key="add-item:role">+ Role item</button>
          <button class="button" data-add-item="speech" data-focus-key="add-item:speech">+ Speech item</button>
          <button class="button" data-add-item="break" data-focus-key="add-item:break">+ Break</button>
        </div>
      </div>
    </section>`;
}

function renderValidation() {
  const issues = getValidation();
  return `
    <section class="section-card validation-card ${state.highlightReviewItems ? "is-highlighted" : ""}" data-region="validation" data-scroll-anchor="validation">
      <div class="section-heading validation-head">
        <div><span class="eyebrow">Readiness check</span><h2>Validation</h2></div>
        <strong>${issues.length}</strong>
      </div>
      <div class="section-content validation-list">
        ${
          issues.length
            ? issues.map((issue, index) => `<button class="validation-item ${issue.type}" data-issue-index="${index}"><strong>${issue.type === "error" ? "!" : "•"}</strong><span>${esc(issue.text)}</span></button>`).join("")
            : '<div class="validation-item ok"><strong>✓</strong><span>Agenda is ready to publish.</span></div>'
        }
      </div>
    </section>`;
}

function renderAgendaRows() {
  const timeline = getTimeline();
  return state.meeting.blocks
    .map((block) => {
      const rows = timeline
        .filter((row) => row.blockId === block.id)
        .map(
          (item) => item.kind === "break" ? `
          <tr class="break-row" data-preview-block="${esc(block.id)}" data-preview-item="${esc(item.id)}" tabindex="0" title="Edit ${esc(item.session)}">
            <td><strong>${item.start}</strong></td>
            <td>0:${String(item.duration).padStart(2, "0")}</td>
            <td colspan="3">${esc(item.session)}</td>
          </tr>` : `
          <tr class="${item.status}" data-preview-block="${esc(block.id)}" data-preview-item="${esc(item.id)}" tabindex="0" title="Edit ${esc(item.session)}">
            <td><strong>${item.start}</strong></td>
            <td>0:${String(item.duration).padStart(2, "0")}</td>
            <td>${esc(item.session)}</td>
            <td>${esc(item.role)}</td>
            <td>${esc(item.member || "Vacant")}</td>
          </tr>`,
        )
        .join("");
      return `<tr class="section-row ${block.id === state.selectedBlockId ? "selected" : ""}" data-preview-block="${esc(block.id)}" tabindex="0" title="Edit ${esc(block.title)}"><td colspan="5">${esc(block.title)}</td></tr>${rows}`;
    })
    .join("");
}

function renderFrontPage() {
  const m = state.meeting;
  const officerAssignments = officerAssignmentsFromMembers();
  const officerLines = OFFICER_ROLES.map((role) => ({ role, name: memberDisplayNameById(officerAssignments[role], "Unassigned") }));
  const supportLines = supportRoleEntries();
  return `
    <section class="agenda-page front-page" aria-label="Agenda print preview front page">
      <header class="agenda-header">
        <h1>${esc(CLUB_PROFILE.clubName)} · Meeting ${esc(m.meetingNumber)}</h1>
        <p>${esc(CLUB_PROFILE.tagline)} · CLUB ${esc(CLUB_PROFILE.clubNumber)} · ${esc(CLUB_PROFILE.district)}</p>
      </header>
      <div class="agenda-meta-line">${esc(m.startTime)}, ${esc(m.date)} · Meeting Theme: ${esc(m.theme)}</div>
      <div class="agenda-layout">
        <aside class="agenda-sidebar">
          <h3>WORD OF THE DAY</h3>
          <p><strong>${esc(m.wordOfDay.word)}</strong> ${esc(m.wordOfDay.pronunciation)}<br />${esc(m.wordOfDay.example)}</p>
          <h3>MEETING VENUE</h3>
          <p>${esc(m.venue)}</p>
          <h3>OFFICER TEAM</h3>
          ${officerLines.map((entry) => `<div class="officer-line"><b>${esc(entry.role)}</b> ${esc(entry.name)}</div>`).join("")}
          <h3>SUPPORT ROLES</h3>
          ${supportLines.map((entry) => `<div class="officer-line"><b>${esc(entry.label)}</b> ${esc(entry.name || "Unassigned")}</div>`).join("")}
          <h3>4 TABOOS</h3>
          <p class="taboos-copy">Politics · Religion<br />Sex · Low Taste</p>
          <img class="club-logo" src="${CLUB_LOGO_URL}" alt="${esc(CLUB_PROFILE.clubName)} logo" />
        </aside>
        <table class="agenda-table">
          <thead><tr><th>From</th><th>Duration</th><th>Session</th><th>Role Title</th><th>Role Name</th></tr></thead>
          <tbody>${renderAgendaRows()}</tbody>
        </table>
      </div>
      <div class="print-note">
        <div class="front-qr-row">
          <div class="front-qr-item">${renderQrFrame(m.qrSource === "system" ? "voting-system" : "voting", activeVotingImage(), "print-qr")}</div>
          <div class="front-qr-item">${renderQrFrame("wechat-payment-qr", state.paymentQr, "print-qr payment-qr")}<small>Member ¥20 | Guest ¥30</small></div>
        </div>
        <strong>Voting Code: ${esc(m.votingCode)}</strong>
        <span>Scan or enter the code after the meeting to vote.</span>
      </div>
    </section>`;
}

function renderPathwaysOverview() {
  const pathways = state.pathwaysCatalog?.paths || [];
  if (!pathways.length) return "";
  return `<article class="back-card pathways-overview"><h2>LEARNING PATHS</h2><div class="pathways-grid">${pathways.map(
    (name) => `<div class="pathway-item"><strong>${esc(name)}</strong></div>`,
  ).join("")}</div></article>`;
}

function renderBackPage() {
  const preparedSpeeches = getPreparedSpeeches(state.meeting);
  const objectiveCount = preparedSpeeches.length;
  const objectiveDensity = objectiveCount >= 5
    ? " speech-objective-density-overflow objectives-overflow-risk"
    : objectiveCount >= 4
      ? " speech-objective-density-tight"
      : objectiveCount >= 3
        ? " speech-objective-density-compact"
        : "";
  return `
    <section class="agenda-page back-page${objectiveDensity}" aria-label="Agenda print preview back page">
      <header class="agenda-header">
        <h1>${esc(CLUB_PROFILE.clubName)}</h1>
        <p>${esc(CLUB_PROFILE.tagline)}</p>
      </header>
      <div class="back-page-grid">
        <div class="back-page-column">
          <article class="back-card">
            <h2>HOW TO JOIN US</h2>
            <div class="back-card-content">
              <strong>Take a meeting role or attend Table Topics.</strong><br />
              Meet our officers, choose a learning path, and join a supportive practice community.
              ${renderQrFrame("group", state.groupQr, "back-qr")}
            </div>
          </article>
          <article class="back-card">
            <h2>VOTING CODE</h2>
            <div class="back-card-content">
              ${renderQrFrame(state.meeting.qrSource === "system" ? "voting-system" : "voting", activeVotingImage(), "back-qr")}
              <p class="voting-code-fallback"><strong>${esc(state.meeting.votingCode)}</strong></p>
              <p style="text-align:center">Vote for the best speaker, evaluator and Table Topics speaker.</p>
            </div>
          </article>
        </div>
        <div class="back-page-column back-page-column-main">
          <article class="back-card">
            <h2>SPEECH OBJECTIVE</h2>
            <div class="back-card-content speech-objectives">
              ${
                preparedSpeeches.length
                  ? preparedSpeeches
                      .map(
                        (speech, index) => `<section class="speech-objective-item">
                          <div class="speech-objective-heading">
                            <span>Speech ${index + 1}</span>
                            <strong>${esc(speech.session || `Prepared Speech ${index + 1}`)}</strong>
                          </div>
                          <p class="speech-objective-speaker">${esc(speech.member || "Speaker to be confirmed")}</p>
                          <p class="speech-objective-copy ${speech.speechObjective?.trim() ? "" : "is-empty"}">${esc(speech.speechObjective?.trim() || "Objective to be confirmed")}</p>
                        </section>`,
                      )
                      .join("")
                  : '<p class="speech-objectives-empty">No prepared speeches scheduled.</p>'
              }
            </div>
          </article>
          ${renderPathwaysOverview()}
          <article class="back-card">
            <h2>OFFICER TEAM</h2>
            <div class="back-card-content">
              ${state.officerTeamPhoto.present
                ? `<div class="photo-frame officer-team-photo"><img src="${esc(imageUrl("officer-team", state.officerTeamPhoto))}" alt="Officer team photo" /></div>`
                : '<p class="speech-objectives-empty">Officer team photo not uploaded.</p>'}
              <p>Our officers are here to help you choose a role, prepare a speech, and make your next small step.</p>
            </div>
          </article>
        </div>
      </div>
      <article class="back-card" style="margin-top:18px">
        <h2>ABOUT THIS CLUB</h2>
        <div class="back-card-content">
          ${esc(CLUB_PROFILE.agendaFooter)}
        </div>
      </article>
    </section>`;
}

function totalMinutes() {
  if (!state.meeting) return 0;
  const itemCount = state.meeting.blocks.reduce((sum, block) => sum + block.items.length, 0);
  const durations = state.meeting.blocks.reduce((sum, block) => sum + block.items.reduce((blockSum, item) => blockSum + (Number(item.duration) || 0), 0), 0);
  return durations + (state.meeting.enableTransitionTime ? Math.max(0, itemCount - 1) * TRANSITION_MINUTES : 0);
}

function renderLogin() {
  return `<main class="auth-shell">
    <nav class="public-links" aria-label="Related tools">
      <a class="division-template-link" href="/mcp">Agenda MCP <span aria-hidden="true">↗</span></a>
    </nav>
    <section class="auth-card">
      <span class="eyebrow">Agenda Maker · Secure workspace</span>
      <h1>Open the meeting desk</h1>
      <p>Enter the shared editing passcode to load meetings from Feishu Base.</p>
      <form data-login-form>
        <label class="field"><span>Edit passcode</span><input name="passcode" type="password" autocomplete="current-password" required autofocus /></label>
        <button class="button primary" type="submit">Sign in</button>
        <p class="form-error" data-login-error></p>
      </form>
      <button class="public-browse-button" type="button" data-browse-meetings>Browse as guest</button>
    </section>
  </main>`;
}

function guestTimeline(meeting) {
  let cursor = toMinutes(meeting.startTime);
  const items = meeting.blocks.flatMap((block) => block.items.map((item) => ({ block, item })));
  return items.map(({ block, item }, index) => {
    const row = { ...item, blockTitle: block.title, start: fromMinutes(cursor) };
    cursor += Number(item.duration) || 0;
    if (meeting.enableTransitionTime && index < items.length - 1) cursor += TRANSITION_MINUTES;
    return row;
  });
}

function renderGuestWorkspace() {
  const meeting = state.meeting;
  const rows = meeting ? guestTimeline(meeting) : [];
  return `<main class="guest-shell">
    <header class="guest-topbar"><a href="/" data-leave-guest>Agenda Maker</a><span>Public read-only view</span><a href="/">Editor sign in</a></header>
    <section class="guest-intro">
      <div><span class="eyebrow">Meeting operations</span><h1>Agenda, presentation, voting, review.</h1><p>Browse finalized meeting run sheets. Editing, uploads, resource links, and live controls stay private.</p></div>
      <label><span>Final meeting</span><select data-guest-meeting>${state.guestMeetings.map((item) => `<option value="${esc(item.meetingNumber)}" ${item.meetingNumber === meeting?.meetingNumber ? "selected" : ""}>#${esc(item.meetingNumber)} · ${esc(item.date)} · ${esc(item.theme)}</option>`).join("")}</select></label>
    </section>
    ${meeting ? `<section class="guest-agenda">
      <header><span>#${esc(meeting.meetingNumber)} · ${esc(meeting.date)} · ${esc(meeting.startTime)}</span><h2>${esc(meeting.theme)}</h2><p>${esc(meeting.venue)}</p></header>
      <div class="guest-facts"><span><b>Word of the day</b>${esc(meeting.wordOfDay?.word || "Not set")}</span><span><b>Meeting Manager</b>${esc(meeting.meetingManager || "Unassigned")}</span><span><b>Photographer</b>${esc(meeting.photographer || "Unassigned")}</span></div>
      <div class="guest-table-wrap"><table class="guest-agenda-table"><thead><tr><th>From</th><th>Min</th><th>Session</th><th>Role</th><th>Name</th></tr></thead><tbody>${rows.map((row) => `<tr class="${row.kind === "break" ? "break" : ""}"><td>${esc(row.start)}</td><td>${esc(row.duration)}</td><td>${esc(row.session)}</td><td>${esc(row.role)}</td><td>${esc(row.member || (row.kind === "break" ? "" : "Vacant"))}</td></tr>`).join("")}</tbody></table></div>
    </section>` : '<section class="guest-empty"><h2>No finalized meetings yet.</h2><p>Only final meetings appear in this public view.</p></section>'}
  </main>`;
}

function renderMeetingNavigator() {
  return `<label class="topbar-meeting-select" data-region="navigator"><span class="eyebrow">Current meeting</span><select data-meeting-select>${state.meetings.map((meeting) => `<option value="${esc(meeting.id)}" ${meeting.id === state.meeting.id ? "selected" : ""}>${esc(meetingOptionLabel(meeting))}</option>`).join("")}</select></label>`;
}

function meetingOptionLabel(meeting) {
  return `#${meeting.meetingNumber} · ${meeting.date || "Date not set"}`;
}

function saveStatusText() {
  if (state.previewMode) return "Local preview · changes are not saved";
  if (state.saveStatus === "saving") return "Auto-saving to Feishu";
  if (state.saveStatus === "error") return `Save failed · ${state.saveError}`;
  if (state.saveStatus === "conflict") return "Save paused · newer remote version";
  if (state.savedAt) return `Auto-saved to Feishu · ${state.savedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  return "Connected to Feishu Base";
}

function renderSaveStatus() {
  const icon = state.saveStatus === "saving" ? "↻" : state.saveStatus === "error" || state.saveStatus === "conflict" ? "!" : "✓";
  const tag = state.saveStatus === "error" ? "button" : "span";
  const action = state.saveStatus === "error" ? ' type="button" data-retry-save aria-label="Save failed, retry"' : "";
  return `<${tag} class="topbar-save save-${esc(state.saveStatus)}"${action}><span aria-hidden="true">${icon}</span>${esc(saveStatusText())}</${tag}>`;
}

function renderMigrationPrompt() {
  if (!state.migrationPrompt) return "";
  const local = loadLocalMeeting();
  return `<div class="modal-backdrop"><section class="modal-card">
    <span class="eyebrow">One-time migration</span>
    <h2>Import your local agenda?</h2>
    <p>A browser draft for meeting #${esc(local?.meetingNumber || "—")} was found. Importing creates a new cloud meeting and keeps the local copy intact.</p>
    <div class="modal-actions">
      <button class="button" data-skip-migration>Ignore local draft</button>
      <button class="button primary" data-import-local>Import to Feishu</button>
    </div>
  </section></div>`;
}

function renderConflictPrompt() {
  if (!state.conflict) return "";
  return `<div class="modal-backdrop"><section class="modal-card">
    <span class="eyebrow">Edit conflict</span>
    <h2>A newer version exists</h2>
    <p>This meeting changed in another browser. Reload the remote version or preserve your edits as a new meeting.</p>
    <div class="modal-actions">
      <button class="button" data-reload-remote>Load remote version</button>
      <button class="button primary" data-save-copy>Save edits as copy</button>
    </div>
  </section></div>`;
}

function renderGuestPrompt() {
  if (!state.guestPrompt) return "";
  if (state.guestPrompt.busy) return `<div class="modal-backdrop"><section class="modal-card sync-modal" role="dialog" aria-modal="true" aria-labelledby="guest-sync-title" aria-busy="true">
    <span class="eyebrow">Guest directory</span><h2 id="guest-sync-title">Creating guest…</h2><p>Please wait while Agenda syncs the latest members from Feishu.</p><div class="sync-progress"><span aria-hidden="true"></span>Syncing members</div>${speakingTips.markup({ delayed: true })}
  </section></div>`;
  const signupGuest = state.guestPrompt.kind === "signup";
  return `<div class="modal-backdrop"><section class="modal-card">
    <span class="eyebrow">Guest placeholder</span>
    <h2>Add a guest</h2>
    <p>${signupGuest ? "Create this guest, then return to the import review." : "Create a guest option for this agenda assignment."}</p>
    <form data-guest-form>
      <label class="field"><span>Guest name</span><input name="displayName" autocomplete="off" minlength="2" maxlength="80" required autofocus value="${esc(state.guestPrompt.defaultName || "")}" /></label>
      <div class="guest-name-guide"><strong>Use a clear directory format</strong><span>Regular guest: <code>Amy, Guest</code></span><span>Club member: <code>Amy, PM3@AF TMC</code></span></div>
      ${state.guestPrompt.formatWarning ? '<p class="form-warning" role="alert">Name format looks unusual. Edit it or choose Add anyway.</p>' : ""}
      ${state.guestPrompt.error ? `<p class="form-error" role="alert">${esc(state.guestPrompt.error)}</p>` : ""}
      <div class="modal-actions">
        <button class="button" type="button" data-cancel-guest>Cancel</button>
        <button class="button primary" type="submit">${state.guestPrompt.formatWarning ? "Add anyway" : state.guestPrompt.error ? "Retry" : "Add guest"}</button>
      </div>
    </form>
  </section></div>`;
}

function renderRolePrompt() {
  if (!state.rolePrompt) return "";
  if (state.rolePrompt.busy) return `<div class="modal-backdrop"><section class="modal-card sync-modal" role="dialog" aria-modal="true" aria-labelledby="role-sync-title" aria-busy="true">
    <span class="eyebrow">RoleCatalog</span><h2 id="role-sync-title">Syncing role…</h2><p>Adding ${esc(state.rolePrompt.name)} to the shared role catalog.</p><div class="sync-progress"><span aria-hidden="true"></span>Syncing with Base</div>${speakingTips.markup({ delayed: true })}
  </section></div>`;
  return `<div class="modal-backdrop"><section class="modal-card" role="dialog" aria-modal="true" aria-labelledby="role-create-title">
    <span class="eyebrow">RoleCatalog</span><h2 id="role-create-title">Add a shared role</h2><p>This role becomes available in every Agenda. Book visibility stays off.</p>
    <form data-role-form><label class="field"><span>Role name</span><input name="name" autocomplete="off" maxlength="80" required autofocus value="${esc(state.rolePrompt.name)}"></label>
      ${state.rolePrompt.error ? `<p class="form-error" role="alert">${esc(state.rolePrompt.error)}</p>` : ""}
      <div class="modal-actions"><button class="button" type="button" data-cancel-role>Cancel</button><button class="button primary" type="submit">Add role</button></div>
    </form>
  </section></div>`;
}

function renderTemplatePrompt() {
  if (!state.templatePrompt || state.renameTemplatePrompt) return "";
  const latestFinalized = latestFinalizedMeetingSummary();
  return `<div class="modal-backdrop"><section class="modal-card">
    <span class="eyebrow">New meeting</span>
    <h2>Choose a starting point</h2>
    <p>Reuse a proven agenda structure, choose a shared template, or start blank.</p>
    <div class="template-option-list">
      <button class="template-option" data-template-choice="reuse" ${latestFinalized && !state.newMeetingCreating ? "" : "disabled"}>
        <strong>Reuse latest finalized meeting</strong>
        <span>${latestFinalized ? `#${latestFinalized.meetingNumber} · ${esc(latestFinalized.date)} · ${esc(latestFinalized.theme)}` : "No finalized meeting is available yet."}</span>
      </button>
      ${state.templates.map((template) => `<div class="template-option-row"><button class="template-option" data-template-choice="template:${esc(template.id)}" ${state.newMeetingCreating ? "disabled" : ""}>
        <strong>${esc(template.name)}</strong>
        <span>Shared template · ${template.blocks.length} block${template.blocks.length === 1 ? "" : "s"}</span>
      </button><button class="template-rename" data-rename-template="${esc(template.id)}" aria-label="Rename ${esc(template.name)}" ${state.newMeetingCreating ? "disabled" : ""}>Rename</button></div>`).join("")}
      ${state.templatesLoading ? '<button class="template-option" disabled><strong>Loading templates…</strong><span>Shared templates will appear here.</span></button>' : ""}
      <button class="template-option" data-template-choice="blank" ${state.newMeetingCreating ? "disabled" : ""}>
        <strong>Start blank</strong>
        <span>Use the built-in starter agenda.</span>
      </button>
    </div>
    ${state.newMeetingCreating ? '<p class="voting-progress" role="status">Creating meeting…</p>' : ""}
    <div class="modal-actions">
      <button class="button" data-cancel-template-choice ${state.newMeetingCreating ? "disabled" : ""}>Cancel</button>
    </div>
  </section></div>`;
}

function renderRenameTemplatePrompt() {
  if (!state.renameTemplatePrompt) return "";
  return `<div class="modal-backdrop"><section class="modal-card"><span class="eyebrow">Shared template</span><h2>Rename template</h2>
    <form data-rename-template-form><label class="field"><span>Template name</span><input name="name" maxlength="120" required autofocus value="${esc(state.renameTemplatePrompt.name)}"></label>
      <div class="modal-actions"><button class="button" type="button" data-cancel-rename-template>Cancel</button><button class="button primary" ${state.templateBusy ? "disabled" : ""}>${state.templateBusy ? "Renaming…" : "Rename"}</button></div>
    </form></section></div>`;
}

function meetingStatusLabel(status) {
  return status === "final" ? "Final" : status === "archived" ? "Archived" : "Draft";
}

function renderMeetingSwitchboardRow(meeting, isNext = false) {
  return `<button class="switchboard-row${isNext ? " is-next" : ""}" data-open-meeting="${esc(meeting.id)}">
    <span class="switchboard-number">#${esc(meeting.meetingNumber)}</span>
    <span class="switchboard-copy">${isNext ? '<span class="switchboard-next-label">Next meeting</span>' : ""}<strong>${esc(meeting.theme || "Untitled meeting")}</strong><small>${esc(meeting.date || "Date not set")} · ${esc(meeting.startTime || "Time not set")}</small></span>
    <span class="switchboard-status status-${esc(meeting.status || "draft")}">${meetingStatusLabel(meeting.status)}</span>
  </button>`;
}

function renderMeetingSwitchboard() {
  const { next, nearby, more } = groupMeetingsForSwitchboard(state.meetings);
  const meetingRows = [
    next ? renderMeetingSwitchboardRow(next, true) : "",
    next && nearby.length ? '<div class="switchboard-divider" role="separator"><span>Nearby meetings</span></div>' : "",
    ...nearby.map((meeting) => renderMeetingSwitchboardRow(meeting)),
    more.length ? `<details class="switchboard-more"><summary><span><strong>More meetings</strong><small>${more.length} hidden · expand full list</small></span><i aria-hidden="true">⌄</i></summary><div class="switchboard-more-list">${more.map((meeting) => renderMeetingSwitchboardRow(meeting)).join("")}</div></details>` : "",
  ].join("");
  return `<main class="switchboard-shell">
    <header class="topbar switchboard-topbar">
      <div class="brand">
        <span class="brand-mark">A</span>
        <div class="brand-copy"><strong>Agenda Maker</strong><span>Meeting Ops</span></div>
      </div>
      <details class="more-menu"><summary class="icon-button" aria-label="More actions">•••</summary><div class="more-menu-popover"><button data-new-meeting>New meeting</button><button data-about-product>About Product</button><button data-sign-out>Sign out</button></div></details>
    </header>
    <section class="switchboard-panel">
      <div class="switchboard-main">
        <div class="switchboard-head">
          <div>
            <span class="eyebrow">Choose meeting</span>
            <h1>Pick the run sheet to open.</h1>
          </div>
          <button class="button primary" data-new-meeting data-focus-key="new-meeting">New meeting</button>
        </div>
        ${state.meetings.length ? `<div class="switchboard-list">${meetingRows}</div>` : `<div class="switchboard-empty"><h2>No meetings yet</h2><p>Create meeting #${esc(defaultMeeting.meetingNumber)} from a template or blank agenda.</p><button class="button primary" data-new-meeting data-focus-key="new-meeting">New meeting</button></div>`}
      </div>
    </section>
    ${renderToastRegionMarkup()}
    ${renderOverlayRegionMarkup()}
  </main>`;
}

function renderSaveTemplatePrompt() {
  if (!state.saveTemplatePrompt) return "";
  return `<div class="modal-backdrop"><section class="modal-card">
    <span class="eyebrow">Shared template</span>
    <h2>Save this agenda as template</h2>
    <p>We will keep the agenda structure and reusable copy, but reset meeting-specific assignments when it is used next time.</p>
    <form data-template-form>
      <label class="field"><span>Template name</span><input name="name" autocomplete="off" maxlength="120" required autofocus value="${esc(state.saveTemplatePrompt.defaultName)}" /></label>
      <div class="modal-actions">
        <button class="button" type="button" data-cancel-save-template>Cancel</button>
        <button class="button primary" type="submit" ${state.templateBusy ? "disabled" : ""}>${state.templateBusy ? "Saving…" : "Save template"}</button>
      </div>
    </form>
  </section></div>`;
}

function renderPrintPrompt() {
  if (!state.printPrompt) return "";
  const { copies, roleTakers, upliftPercent, blockers, layoutWarnings, checking } = state.printPrompt;
  const hasWarnings = blockers.length || layoutWarnings.length;
  return `<div class="modal-backdrop"><section class="modal-card print-setup-modal" role="dialog" aria-modal="true" aria-labelledby="print-setup-title">
    <header><span class="eyebrow">Print setup</span><h2 id="print-setup-title">Print Agenda</h2></header>
    <form data-print-form><div class="print-setup-scroll">
      ${blockers.length ? `<section class="print-warning"><h3>Agenda blockers · ${blockers.length}</h3><ul>${blockers.map((blocker) => `<li>${esc(blocker)}</li>`).join("")}</ul></section>` : ""}
      ${checking ? `<section class="print-checking" role="status"><div class="sync-progress"><span aria-hidden="true"></span>Checking print layout…</div>${speakingTips.markup({ delayed: true })}</section>` : layoutWarnings.length ? `<section class="print-warning layout"><h3>Print layout warning</h3><ul>${layoutWarnings.map((warning) => `<li>${esc(warning)}</li>`).join("")}</ul></section>` : ""}
      <div class="field"><div class="field-label"><label for="agenda-sets">Agenda sets</label><button class="field-info" type="button" aria-label="Recommended: ${esc(copies)} sets for ${esc(roleTakers)} scheduled role taker${roleTakers === 1 ? "" : "s"}, including a ${esc(upliftPercent)}% attendance buffer." data-tooltip="Recommended: ${esc(copies)} sets for ${esc(roleTakers)} scheduled role taker${roleTakers === 1 ? "" : "s"}, including a ${esc(upliftPercent)}% attendance buffer.">i</button></div><input id="agenda-sets" name="copies" type="number" min="1" max="50" value="${esc(copies)}" required autofocus></div>
      <div class="system-print-note"><strong>In the print dialog</strong><span>Select a color printer, then Color + Double-sided. Keep Copies at 1.</span></div>
    </div>
      <div class="modal-actions"><button class="button" type="button" data-cancel-print>Cancel</button><button class="button primary" type="submit" ${checking ? "disabled" : ""}>${hasWarnings ? "Print anyway" : "Continue to print"}</button></div>
    </form>
  </section></div>`;
}

function renderMemberPickerPrompt() {
  const picker = state.memberPicker;
  if (!picker) return "";
  const groups = groupMemberOptions(state.members);
  const selectedMember = state.members.find((member) => member.id === picker.selectedId);
  const currentIsHistorical = picker.target.kind !== "signup" && picker.selectedLabel && !selectedMember;
  const signupChange = picker.target.kind === "signup" ? signupChangeById(picker.target.changeId) : null;
  const suggestions = new Map((signupChange?.options || []).map((option) => [option.id, option.source]));
  const row = (member, group) => {
    const suggestion = suggestions.get(member.id);
    const note = suggestion === "ai_suggestion" ? "AI suggestion" : suggestion === "ambiguous" ? "Same name" : "";
    const hidden = !matchesMemberSearch(member.displayName, picker.query);
    return `<button class="member-picker-option" type="button" data-pick-member="${esc(member.id)}" data-member-name="${esc(member.displayName)}" data-member-group="${group}" ${hidden ? "hidden" : ""}><span><strong>${esc(member.displayName)}</strong>${group === "guests" ? '<small class="member-picker-guest-tag">Guest</small>' : note ? `<small>${esc(note)}</small>` : ""}</span>${member.id === picker.selectedId ? '<i aria-label="Selected">✓</i>' : ""}</button>`;
  };
  const group = (key, label, members) => {
    const count = members.filter((member) => matchesMemberSearch(member.displayName, picker.query)).length;
    return `<section class="member-picker-group" data-member-picker-group="${key}" ${count ? "" : "hidden"}><h3>${label} · <span data-member-group-count="${key}">${count}</span></h3><div>${members.map((member) => row(member, key)).join("")}</div></section>`;
  };
  const query = picker.query.trim();
  const matchCount = [...groups.members, ...groups.guests].filter((member) => matchesMemberSearch(member.displayName, picker.query)).length;
  return `<div class="modal-backdrop member-picker-backdrop"><section class="member-picker-modal" role="dialog" aria-modal="true" aria-labelledby="member-picker-title">
    <header><div><span class="eyebrow">Member directory</span><h2 id="member-picker-title">${esc(picker.label)}</h2></div><button class="icon-button" type="button" data-close-member-picker aria-label="Close member picker">×</button></header>
    <label class="member-picker-search"><span class="sr-only">Search members and guests</span><input type="search" data-member-picker-search autocomplete="off" placeholder="Search name, level, or club" value="${esc(picker.query)}" autofocus></label>
    ${picker.refreshing ? '<p class="member-picker-refresh" role="status">Syncing latest members…</p>' : picker.error ? `<p class="member-picker-refresh is-error" role="status">${esc(picker.error)}</p>` : ""}
    <div class="member-picker-results">
      ${currentIsHistorical ? `<section class="member-picker-current"><h3>Current assignment</h3><button type="button" data-keep-current-member><span><strong>${esc(picker.selectedLabel)}</strong><small>Inactive · historical</small></span><i aria-label="Selected">✓</i></button></section>` : ""}
      ${group("members", "Members", groups.members)}
      ${group("guests", "Guests", groups.guests)}
      <p class="member-picker-empty" data-member-picker-empty ${matchCount ? "hidden" : ""}>No matching member or guest.</p>
    </div>
    <footer>
      ${picker.allowEmpty ? '<button type="button" data-clear-member>None / Unassigned</button>' : ""}
      ${picker.allowGuest ? `<button class="member-picker-add" type="button" data-add-picker-guest>＋ <span>${query ? `Add “${esc(query)}” as guest` : "Add guest…"}</span></button>` : ""}
    </footer>
  </section></div>`;
}

function renderClubSettingsPrompt() {
  if (!state.clubSettingsOpen) return "";
  return `<div class="modal-backdrop"><section class="modal-card club-settings-modal">
    <div class="modal-title-row"><div><span class="eyebrow">Shared across meetings</span><h2>Club settings</h2></div><button class="icon-button" data-close-club-settings aria-label="Close club settings">×</button></div>
    <p>Manage the club profile used by every agenda.</p>
    <div class="club-settings-scroll">
      ${renderOfficerEditor()}
      <section class="section-card"><div class="section-heading"><div><span class="eyebrow">Shared asset</span><h2>WeChat payment QR code</h2></div></div><div class="section-content image-upload-list">${renderImageEditor("wechat-payment-qr", "WeChat payment QR code", "Shared globally on every Agenda front page.", state.paymentQr)}</div></section>
      <section class="section-card"><div class="section-heading"><div><span class="eyebrow">Shared asset</span><h2>Guest group QR code</h2></div></div><div class="section-content image-upload-list">${renderImageEditor("group", "Guest group QR code", "Shared globally across every meeting.", state.groupQr)}</div></section>
      <section class="section-card"><div class="section-heading"><div><span class="eyebrow">Presentation</span><h2>Club introduction</h2></div></div><div class="section-content image-upload-list">${renderClubIntroPhotoEditor(state.clubIntroPhoto)}</div></section>
    </div>
  </section></div>`;
}

function signupChangeIsPerson(change) {
  return ["member", "evaluator", "meetingManager", "photographer"].includes(change.field);
}

function signupSelectedCount() {
  return state.signupImport.analysis?.changes.filter((change) => change.selected).length || 0;
}

function signupNeedsReviewCount() {
  return state.signupImport.analysis?.changes.filter((change) => !change.selected && (change.requiresConfirmation || change.overwrite || change.conflictGroup)).length || 0;
}

function renderSignupMemberSelect(change) {
  const selected = state.members.find((member) => member.id === change.newMemberId)?.displayName || change.newValue;
  return `<button class="member-picker-trigger signup-member-trigger" type="button" data-open-member-picker data-signup-change-member="${esc(change.id)}" data-focus-key="signup-member:${esc(change.id)}" data-picker-label="Choose ${esc(change.label)}" data-selected-id="${esc(change.newMemberId)}" data-selected-label="${esc(selected)}" data-allow-empty="true" data-allow-guest="true" aria-haspopup="dialog"><span>${esc(selected || "Choose member…")}</span><i aria-hidden="true">⌄</i></button>`;
}

function signupChangeTag(change) {
  if (change.conflictGroup) return '<span class="signup-change-tag review">Conflict</span>';
  if (change.overwrite) return '<span class="signup-change-tag overwrite">Overwrite</span>';
  if (change.match === "exact") return '<span class="signup-change-tag exact">Exact match</span>';
  if (change.match === "ai_suggestion") return '<span class="signup-change-tag review">AI suggestion</span>';
  if (change.requiresConfirmation) return '<span class="signup-change-tag review">Review</span>';
  return '<span class="signup-change-tag exact">Fill</span>';
}

function renderSignupChange(change) {
  const person = signupChangeIsPerson(change);
  const disabled = person && !change.newMemberId;
  const inputType = change.field === "date" ? "date" : change.field === "startTime" ? "time" : "text";
  return `<article class="signup-change-row ${change.warning ? "has-warning" : ""}" data-signup-change-row="${esc(change.id)}">
    <input class="signup-change-check" type="checkbox" data-signup-change-check="${esc(change.id)}" ${change.selected ? "checked" : ""} ${disabled ? "disabled" : ""} aria-label="Apply ${esc(change.label)}">
    <div class="signup-change-label"><strong>${esc(change.label)}</strong><span>${esc(String(change.kind || "change").replaceAll("_", " "))}</span></div>
    <div class="signup-change-value">
      <div class="signup-diff"><del>${esc(change.oldValue || "Vacant")}</del><b aria-hidden="true">→</b>${person ? `<span class="signup-new-value">${esc(change.newValue || "Choose member")}</span>` : `<input type="${inputType}" value="${esc(change.newValue)}" data-signup-change-value="${esc(change.id)}" aria-label="New ${esc(change.label)}">`}</div>
      ${person ? renderSignupMemberSelect(change) : ""}
      ${change.warning ? `<small>${esc(change.warning)}</small>` : ""}
    </div>
    ${signupChangeTag(change)}
  </article>`;
}

function renderSignupChangeSection(title, changes) {
  if (!changes.length) return "";
  return `<section class="signup-review-section"><header><h3>${esc(title)}</h3><span>${changes.filter((change) => change.selected).length} selected</span></header>${changes.map(renderSignupChange).join("")}</section>`;
}

function signupProgressClass(step) {
  const order = { paste: 1, review: 2, success: 3 };
  const current = order[state.signupImport.step] || 1;
  return order[step] < current ? "complete" : order[step] === current ? "active" : "";
}

function renderSignupPasteScreen() {
  const text = state.signupImport.text;
  return `<section class="signup-import-screen signup-paste-screen">
    <div class="signup-paste-main">
      <div class="signup-paste-title"><h3>Paste signup message</h3><span data-signup-count>${text.length.toLocaleString()} / ${SIGNUP_TEXT_MAX.toLocaleString()}</span></div>
      <div class="signup-paste-box"><textarea data-signup-text minlength="${SIGNUP_TEXT_MIN}" maxlength="${SIGNUP_TEXT_MAX}" autofocus aria-label="WeChat signup text" placeholder="Paste the latest WeChat signup here…">${esc(text)}</textarea></div>
      <p class="signup-privacy-note"><strong>Before you analyze</strong><span>Beta feature. Signup text and member names are sent to DeepSeek. Review all changes before applying.</span></p>
    </div>
    <aside class="signup-side-panel">
      <section class="signup-target-card"><span class="eyebrow">Importing into</span><h3>Meeting #${esc(state.meeting.meetingNumber)}</h3><p>${esc(state.meeting.theme || "Untitled meeting")}</p><div><span>Draft</span><span>Revision ${esc(state.meeting.revision)}</span></div></section>
      <section><h3>Can update</h3><ul><li><b>1</b>Date, time, theme, Meeting Manager</li><li><b>2</b>Existing role assignments</li><li><b>3</b>Speakers, evaluators, speech titles</li></ul></section>
      <section><h3>Stays safe</h3><ul class="safe"><li><b>✓</b>No new Agenda items</li><li><b>✓</b>No reorder or duration changes</li><li><b>✓</b>No changes before Apply</li></ul></section>
    </aside>
  </section>`;
}

function renderSignupReviewScreen() {
  const analysis = state.signupImport.analysis;
  const meetingChanges = analysis.changes.filter((change) => change.scope === "meeting");
  const agendaChanges = analysis.changes.filter((change) => change.scope === "agenda");
  const selected = signupSelectedCount();
  const needsReview = signupNeedsReviewCount();
  const ignored = analysis.ignored || [];
  const unapplied = analysis.unapplied || [];
  return `<section class="signup-import-screen signup-review-screen">
    <div class="signup-change-ledger">
      <div class="signup-summary-strip"><div><strong>${analysis.changes.length}</strong><span>Found</span></div><div class="selected"><strong data-signup-selected-count>${selected}</strong><span>Selected</span></div><div class="attention"><strong data-signup-review-count>${needsReview}</strong><span>Need review</span></div><div><strong>${ignored.length}</strong><span>Ignored</span></div></div>
      ${renderSignupChangeSection("Meeting details", meetingChanges)}
      ${renderSignupChangeSection("Agenda assignments", agendaChanges)}
      ${analysis.changes.length ? "" : '<div class="signup-empty-review"><h3>No applicable changes found</h3><p>Review ignored and unapplied items, then adjust the signup text or edit Agenda manually.</p></div>'}
    </div>
    <aside class="signup-review-side">
      ${analysis.meetingMismatch ? `<section class="signup-mismatch"><h3>Wrong meeting detected</h3><p>${analysis.meetingNumberMismatch ? `Signup says Meeting #${esc(analysis.detectedMeetingNumber)}, but you opened #${esc(analysis.meetingNumber)}.` : `Signup date ${esc(analysis.detectedMeetingDate)} does not match ${esc(state.meeting.date)}.`} Select the correct meeting and analyze again.</p></section>` : ""}
      <section class="signup-attention-box"><h3><span data-signup-review-count>${needsReview}</span> need your choice</h3><p>Resolve or skip. Other selected changes can still apply.</p>${analysis.changes.filter((change) => !change.selected && (change.requiresConfirmation || change.overwrite || change.conflictGroup)).slice(0, 8).map((change) => `<div><strong>${esc(change.label)}</strong><span>${esc(change.warning || (change.overwrite ? "Would replace an existing value." : "Choose a member or confirm this suggestion."))}</span></div>`).join("")}</section>
      ${ignored.length ? `<section class="signup-muted-box"><h3>${ignored.length} ignored</h3>${ignored.map((item) => `<p><strong>${esc(item.label)}</strong> ${esc(item.reason || item.value)}</p>`).join("")}</section>` : ""}
      ${unapplied.length ? `<section class="signup-muted-box"><h3>${unapplied.length} unapplied</h3>${unapplied.map((item) => `<p><strong>${esc(item.label)}</strong> ${esc(item.reason || item.value)}</p>`).join("")}</section>` : ""}
      ${analysis.notes?.length ? `<section class="signup-notes"><h3>Parsing notes</h3>${analysis.notes.map((note) => `<p>${esc(note)}</p>`).join("")}</section>` : ""}
    </aside>
  </section>`;
}

function renderSignupSuccessScreen() {
  return `<section class="signup-import-screen signup-success-screen"><div><span>✓</span><h3>Agenda updated</h3><p>${esc(state.signupImport.appliedCount)} reviewed changes were applied to Meeting #${esc(state.meeting.meetingNumber)}. Existing Agenda structure stayed unchanged.</p></div></section>`;
}

function renderSignupImportPrompt() {
  if (!state.signupImport.open) return "";
  const step = state.signupImport.step;
  const selected = signupSelectedCount();
  const textReady = state.signupImport.text.trim().length >= SIGNUP_TEXT_MIN && state.signupImport.text.trim().length <= SIGNUP_TEXT_MAX;
  const analysis = state.signupImport.analysis;
  const title = step === "review" ? "Review suggested changes" : step === "success" ? "Import complete" : "Turn signup text into Agenda";
  const copy = step === "review" ? "Confirm safe fills, inspect overwrites, and resolve unmatched people." : step === "success" ? `Meeting #${state.meeting.meetingNumber} now includes the changes you approved.` : "Paste the latest signup. Nothing changes until you review and apply.";
  return `<div class="modal-backdrop signup-import-backdrop"><section class="modal-card signup-import-modal" role="dialog" aria-modal="true" aria-labelledby="signup-import-title">
    <header class="signup-modal-head"><div><div class="signup-beta-lockup"><span class="eyebrow">WeChat signup</span><span>BETA</span></div><h2 id="signup-import-title">${esc(title)}</h2><p>${esc(copy)}</p></div><button class="icon-button" data-close-signup-import aria-label="Close signup import" ${state.signupImport.busy ? "disabled" : ""}>×</button></header>
    <nav class="signup-progress" aria-label="Import progress">${[["paste", "Paste signup"], ["review", "Review changes"], ["success", "Applied"]].map(([id, label], index) => `<div class="${signupProgressClass(id)}"><span>${signupProgressClass(id) === "complete" ? "✓" : index + 1}</span><strong>${label}</strong></div>`).join("")}</nav>
    ${state.signupImport.busy ? `<section class="signup-sync-screen">${renderAgendaSyncTip(state.signupImport.busy === "analyze" ? "Analyzing signup and syncing members…" : "Applying reviewed changes to Agenda…")}</section>` : step === "review" ? renderSignupReviewScreen() : step === "success" ? renderSignupSuccessScreen() : renderSignupPasteScreen()}
    ${state.signupImport.error ? `<p class="signup-import-error" role="alert">${esc(state.signupImport.error)}</p>` : ""}
    <footer class="signup-modal-footer">
      <span class="signup-footer-status"><i>✓</i>${step === "paste" ? `Meeting #${esc(state.meeting.meetingNumber)} is Draft · safe to import` : step === "review" ? "Nothing has changed yet" : "Auto-saved to Feishu"}</span>
      <div>${step === "paste" ? `<button class="button" data-close-signup-import>Cancel</button><button class="button primary" data-analyze-signup ${!textReady || state.signupImport.busy ? "disabled" : ""}>${state.signupImport.busy === "analyze" ? "Analyzing…" : "Analyze signup →"}</button>` : step === "review" ? `<button class="button" data-back-signup-import ${state.signupImport.busy ? "disabled" : ""}>Back</button><button class="button primary" data-apply-signup ${!analysis?.canApply || !selected || state.signupImport.busy ? "disabled" : ""}>${state.signupImport.busy === "apply" ? "Applying…" : `Apply <span data-signup-selected-count>${selected}</span> changes`}</button>` : `<button class="button primary" data-close-signup-import>View updated Agenda</button>`}</div>
    </footer>
  </section></div>`;
}

function renderSignupGenerationPrompt() {
  const preview = state.signupGeneration;
  if (!preview.open) return "";
  return `<div class="modal-backdrop signup-import-backdrop"><section class="modal-card signup-import-modal signup-generate-modal" role="dialog" aria-modal="true" aria-labelledby="signup-generate-title">
    <header class="signup-modal-head"><div><div class="signup-beta-lockup"><span class="eyebrow">Agenda → WeChat</span></div><h2 id="signup-generate-title">Generate signup</h2><p>Copy-ready text from Meeting #${esc(state.meeting.meetingNumber)}.</p></div><button class="icon-button" data-close-signup-generation aria-label="Close signup preview">×</button></header>
    <div class="signup-generate-controls">
      <label>Language<select data-signup-generation-language>
        <option value="bilingual" ${preview.language === "bilingual" ? "selected" : ""}>中英双语</option>
        <option value="zh-CN" ${preview.language === "zh-CN" ? "selected" : ""}>中文</option>
        <option value="en" ${preview.language === "en" ? "selected" : ""}>English</option>
      </select></label>
      <label>空缺标记<input data-signup-generation-emoji value="${esc(preview.vacancyEmoji)}" aria-describedby="signup-emoji-help"></label>
      <label class="signup-generate-check"><input type="checkbox" data-signup-generation-titles ${preview.includeSpeechDetails ? "checked" : ""}><span>Include speech titles</span></label>
      <small id="signup-emoji-help">Use complete marker as entered, e.g. 🈳, 🙋🙋🙋, 🟡🟡.</small>
    </div>
    <div class="signup-generate-preview">
      ${preview.busy && !preview.text ? '<p class="member-picker-refresh" role="status">Generating from current Agenda…</p>' : ""}
      ${preview.error ? `<div class="signup-import-error" role="alert">${esc(preview.error)} <button class="button" type="button" data-retry-signup-generation>Retry</button></div>` : ""}
      <textarea readonly aria-label="Generated signup text">${esc(preview.text)}</textarea>
    </div>
    <footer class="signup-modal-footer"><span class="signup-footer-status">${preview.busy ? "Updating preview…" : "Current Agenda · no changes made"}</span><div><button class="button" type="button" data-close-signup-generation>Close</button><button class="button primary" type="button" data-copy-signup-generation ${!preview.text || preview.busy ? "disabled" : ""}>Copy signup</button></div></footer>
  </section></div>`;
}

function renderProductUpdates() {
  let html = "";
  let inList = false;
  const closeList = () => {
    if (inList) html += "</ul>";
    inList = false;
  };
  for (const line of productUpdatesMarkdown.split("\n")) {
    if (line.startsWith("# ")) continue;
    if (line.startsWith("## ")) {
      closeList();
      html += `<h3>${esc(line.slice(3))}</h3>`;
    } else if (line.startsWith("- ")) {
      if (!inList) html += "<ul>";
      inList = true;
      html += `<li>${esc(line.slice(2))}</li>`;
    } else if (line.trim()) {
      closeList();
      html += `<p>${esc(line)}</p>`;
    }
  }
  closeList();
  return html;
}

function renderAboutProductPrompt() {
  if (!state.aboutProductOpen) return "";
  return `<div class="modal-backdrop"><section class="modal-card club-settings-modal" role="dialog" aria-modal="true" aria-labelledby="about-product-title">
    <div class="modal-title-row"><div><span class="eyebrow">VPE Agenda</span><h2 id="about-product-title">About Product</h2></div><button class="icon-button" data-close-about-product aria-label="Close About Product">×</button></div>
    <div class="club-settings-scroll">${renderProductUpdates()}</div>
  </section></div>`;
}

function renderStatusCluster() {
  const { blockers, recommendations } = validationCounts();
  return `<div class="status-cluster" data-region="status">
    <span class="status-pill save-${state.saveStatus}"><span class="status-dot"></span>${esc(saveStatusText())}</span>
    <span class="status-pill">${totalMinutes()} min total</span>
    <span class="status-pill ${blockers ? "has-blockers" : "is-ready"}">${blockers ? `${blockers} blocker${blockers === 1 ? "" : "s"}` : "Ready to finalize"}</span>
    ${recommendations ? `<span class="status-pill">${recommendations} recommendation${recommendations === 1 ? "" : "s"}</span>` : ""}
  </div>`;
}

function renderStageNavigation() {
  const stages = Object.entries(STAGE_LABELS);
  const activeIndex = stages.findIndex(([id]) => id === state.activeStage);
  const { blockers, recommendations } = validationCounts();
  const reviewCount = blockers + recommendations;
  return `<nav class="stage-navigation" aria-label="Meeting lifecycle" role="tablist">
    ${stages.map(([id, label], index) => {
      const stateClass = index < activeIndex ? "is-complete" : index === activeIndex ? "is-current" : "is-future";
      return `<div class="stage-step ${stateClass}">
        <button class="stage-tab" role="tab" aria-label="${index + 1} ${esc(label)}" aria-selected="${state.activeStage === id ? "true" : "false"}" ${state.activeStage === id ? 'aria-current="step"' : ""} data-stage="${id}">
          <span class="stage-index">${index < activeIndex ? "✓" : index + 1}</span><span class="stage-label">${esc(label)}</span>
        </button>
        ${id === "review" && reviewCount ? `<button class="review-badge" data-review-badge data-task="review-share" data-stage-target="preparation" aria-label="${reviewCount} items need review, click to review"><span aria-hidden="true">!</span>${reviewCount} items need review</button>` : ""}
      </div>`;
    }).join("")}
  </nav>`;
}

function renderMobileActionDock() {
  return `<nav class="mobile-action-dock" aria-label="Mobile workspace controls">
    <div class="mobile-view-switch" aria-label="Workspace view"><button class="${state.mobileView === "edit" ? "active" : ""}" data-mobile-view="edit">Edit</button><button class="${state.mobileView === "preview" ? "active" : ""}" data-mobile-view="preview">Preview</button></div>
  </nav>`;
}

function advisorActionAttrs(item, fallback = false) {
  if (!fallback && item.action.task === "voting-console") return `data-open-voting-console data-label="${esc(item.title)}"`;
  const target = fallback ? { ...item.action, task: item.action.task === "voting-console" ? "awards" : item.action.task, focusKey: "" } : item.action;
  return `data-advisor-action data-stage-target="${esc(target.stage)}" data-task="${esc(target.task)}" data-focus-key="${esc(target.focusKey || "")}" data-label="${esc(item.title)}"`;
}

function renderAdvisorCard(item, mode = "") {
  return `<article class="advisor-task-card ${esc(item.tone || "now")} ${esc(mode)}">
    <div class="advisor-task-meta">
      <span class="advisor-source">${esc(item.source)}</span>
      <span class="advisor-urgency">${esc(item.urgency)}</span>
    </div>
    <h2>${esc(item.title)}</h2>
    <p>${esc(item.reason)}</p>
    <div class="advisor-card-actions">
      <button class="button primary" ${advisorActionAttrs(item)}>${esc(item.action.title)}</button>
      <button class="button" ${advisorActionAttrs(item, true)}>Open Admin</button>
    </div>
  </article>`;
}

function renderSignupAdvisorCard() {
  return `<article class="advisor-task-card large signup-advisor-card">
    <div class="signup-ai-tag-wrap">
      <span class="signup-ai-model-trigger"><button class="advisor-source signup-ai-tag" type="button" aria-describedby="signup-ai-model">AI <span aria-hidden="true">i</span></button><span class="signup-ai-model" id="signup-ai-model" role="tooltip">DeepSeek · ${SIGNUP_IMPORT_MODEL}</span></span>
      <span class="advisor-source signup-card-beta">BETA</span>
    </div>
    <strong class="signup-card-translation">微信接龙导入</strong>
    <h2>Import WeChat signup</h2>
    <p>Paste signup text. Review changes. Apply when ready.</p>
    <div class="advisor-card-actions"><button class="button primary" data-open-signup-import data-focus-key="signup-import">Import signup</button><button class="button" data-open-signup-generation data-focus-key="signup-generation">Generate signup</button></div>
  </article>`;
}

function advisorStageFromTasks(tasks) {
  const stage = tasks.now?.stage || tasks.next[0]?.stage || tasks.empty?.action?.stage || "preparation";
  return stage === "live" ? "run" : stage === "review" ? "review" : "plan";
}

function renderAdvisorHeader(tasks) {
  const active = advisorStageFromTasks(tasks);
  const stage = { plan: "Plan", run: "Run", review: "Review" }[active];
  return `<section class="advisor-header">
    <div>
      <span class="eyebrow">Meeting #${esc(state.meeting.meetingNumber)}</span>
      <h1>${esc(state.meeting.theme || "Untitled meeting")}</h1>
      <div class="run-sheet-meta">
        <span>${esc(formatMeetingDate(state.meeting.date))}</span>
        <span>${esc(formatMeetingTime(state.meeting.startTime))}</span>
        <span title="${esc(state.meeting.venue || "Venue not set")}">${esc(state.meeting.venue || "Venue not set")}</span>
        <span class="status-pill status-${esc(state.meeting.status || "draft")}">${esc(meetingStatusLabel(state.meeting.status))}</span>
        <span class="advisor-current-stage">Current · ${stage}</span>
      </div>
    </div>
  </section>`;
}

function renderAdvisorEmpty(empty) {
  const item = {
    title: empty.title,
    reason: empty.reason,
    source: "Advisor",
    urgency: empty.title === "Meeting loop complete" ? "Done" : "Now",
    tone: empty.title === "Meeting loop complete" ? "done" : "now",
    action: empty.action,
  };
  return `<section class="advisor-now">${renderAdvisorCard(item, "empty")}</section>`;
}

function saaAction({ id, icon, title, help, status, tone = "neutral", href = "", attrs = "" }) {
  const tag = href ? "a" : "button";
  const behavior = href ? `href="${esc(href)}" target="_blank" rel="noopener"` : `type="button" ${attrs}`;
  return `<${tag} class="saa-action" ${behavior} aria-describedby="saa-help-${id}">
    <span class="saa-action-top"><span class="saa-action-icon" aria-hidden="true">${icon}</span><span class="saa-action-status ${tone}">${esc(status)}</span></span>
    <span class="saa-action-title"><strong>${esc(title)}</strong><span class="saa-action-info" aria-hidden="true">i</span></span>
    <span class="saa-action-tooltip" id="saa-help-${id}" role="tooltip">${esc(help)}</span>
  </${tag}>`;
}

function renderSaaQuickActions() {
  const { blockers } = validationCounts();
  const checking = !state.previewMode && (state.awardsBusy || (!state.awards && !state.awardsError));
  const unavailable = Boolean(state.awardsError);
  const votingStatus = state.meeting.qrSource === "manual"
    ? ["Manual QR", "neutral"]
    : !state.meeting.votingForm?.formId
      ? ["Not prepared", "warning"]
      : unavailable
        ? ["Status unavailable", "error"]
        : checking
          ? ["Checking…", "loading"]
          : state.awards?.responseCount
            ? [`${state.awards.responseCount} responses`, "ready"]
            : votingCandidateDiff().needsUpdate
              ? ["Needs update", "warning"]
              : ["Ready", "ready"];
  const confirmStatus = unavailable
    ? ["Status unavailable", "error"]
    : checking
      ? ["Checking…", "loading"]
      : state.awards?.awardsStale
        ? ["Reconfirm", "error"]
        : state.awards?.resultsChanged
          ? [state.awards.newResponseCount ? `${state.awards.newResponseCount} new` : "Changed", "warning"]
        : state.awards?.confirmedAwards
          ? ["Confirmed", "ready"]
          : state.awards?.responseCount
            ? [`${state.awards.responseCount} responses`, "ready"]
            : ["Waiting", "warning"];
  const awardUrl = state.awards?.confirmedAwards && !state.awards?.awardsStale
    ? state.awards.awardPage?.url || `/m/${encodeURIComponent(state.meeting.meetingNumber)}/awards`
    : "";
  const evaluations = evaluationForms();
  const evaluationStatus = !evaluations.length
    ? ["No speeches", "neutral"]
    : evaluations.some((entry) => !entry.pdfUrl)
      ? [`${evaluations.filter((entry) => !entry.pdfUrl).length} missing`, "warning"]
      : [`${evaluations.length} form${evaluations.length === 1 ? "" : "s"}`, "ready"];
  const print = agendaPrintRecommendation(state.meeting);
  const pdfStatus = state.agendaPdfBusy
    ? ["Preparing…", "loading"]
    : state.agendaPdfError
      ? ["Retry", "error"]
      : ["2 pages", "ready"];
  return `<section class="saa-quick-actions" data-region="saa-quick-actions" aria-labelledby="saa-quick-actions-title">
    <div class="saa-quick-actions-head"><h2 id="saa-quick-actions-title">Meeting Support Shortcut</h2></div>
    <div class="support-shortcut-groups">
      <section class="support-shortcut-group support-shortcut-print"><div class="support-shortcut-group-head"><div><span class="eyebrow">Before meeting · MM desk</span><h3>Print pack</h3></div><div class="support-shortcut-group-stats"><small>PHYSICAL · ${print.copies} SETS</small><small>DIGITAL · 1 PDF / 2 PAGES</small></div></div><div class="print-pack-route">
        ${saaAction({ id: "print", icon: "⎙", title: "Print Agenda", help: `Suggested from ${print.roleTakers} scheduled role takers using the #102 attendance baseline.`, status: `${print.copies} cop${print.copies === 1 ? "y" : "ies"}`, tone: "ready", attrs: 'data-print data-focus-key="print-agenda"' })}
        ${saaAction({ id: "agenda-pdf", icon: "⇩", title: "Download Agenda PDF", help: state.agendaPdfError || "Download the current agenda as one share-ready, two-page A4 PDF.", status: pdfStatus[0], tone: pdfStatus[1], attrs: `data-download-agenda-pdf${state.agendaPdfBusy ? " disabled" : ""}` })}
        ${saaAction({ id: "evaluations", icon: "▤", title: "Print Evaluation Forms", help: "Print one official form per prepared speech as needed. Use color and double-sided printing.", status: evaluationStatus[0], tone: evaluationStatus[1], attrs: 'data-advisor-action data-stage-target="preparation" data-task="review-share" data-focus-key="evaluation-forms" data-label="Print Evaluation Forms"' })}
        </div></section>
      <section class="support-shortcut-group support-shortcut-live"><div class="support-shortcut-group-head"><div><span class="eyebrow">During meeting</span><h3>Run of show</h3></div><small>Useful for rehearsal</small></div><div class="saa-action-grid">
        ${saaAction({ id: "presentation", icon: "▶", title: "Open Presentation", help: "Launch the public meeting presentation in a new tab.", status: blockers ? `${blockers} blocker${blockers === 1 ? "" : "s"}` : "Ready", tone: blockers ? "warning" : "ready", href: `/m/${encodeURIComponent(state.meeting.meetingNumber)}/presentation` })}
        ${saaAction({ id: "voting", icon: "✓", title: "Manage Voting", help: "Open Admin · Live Execution · Open voting.", status: votingStatus[0], tone: votingStatus[1], attrs: 'data-advisor-action data-stage-target="live" data-task="start-voting" data-label="Manage Voting"' })}
        ${saaAction({ id: "confirm-results", icon: "◎", title: "Confirm Results", help: "Review live totals and freeze the result for the award ceremony.", status: confirmStatus[0], tone: confirmStatus[1], attrs: 'data-open-voting-console data-label="Confirm Results"' })}
        ${saaAction({ id: "awards", icon: "★", title: "Present Awards", help: awardUrl ? "Launch the confirmed award ceremony in a new tab." : "Available after results are confirmed.", status: awardUrl ? "Ready" : "Waiting", tone: awardUrl ? "ready" : "neutral", href: awardUrl, attrs: awardUrl ? "" : "disabled aria-disabled=\"true\"" })}
      </div></section>
    </div>
  </section>`;
}

function renderAdvisorHome() {
  const tasks = buildAdvisorTasks({ meeting: state.meeting, issues: getValidation(), votingResults: state.votingResults || (state.awards ? { responseCount: state.awards.responseCount } : null), awards: state.awards });
  const promotesSignup = state.meeting.status === "draft";
  const allNext = promotesSignup ? [tasks.now, ...tasks.next].filter(Boolean) : tasks.next;
  const next = state.advisorExpanded.next ? allNext : allNext.slice(0, 3);
  const risks = state.advisorExpanded.risk ? tasks.risks : tasks.risks.slice(0, 3);
  const more = (lane, items) => items.length > 3
    ? `<button class="advisor-more" type="button" data-advisor-toggle="${lane}" aria-expanded="${state.advisorExpanded[lane]}">${state.advisorExpanded[lane] ? "Show less" : `More (${items.length - 3})`}</button>`
    : "";
  return `<main class="advisor-home">
    ${renderAdvisorHeader(tasks)}
    <section class="advisor-grid">
      ${promotesSignup ? `<section class="advisor-now">${renderSignupAdvisorCard()}</section>` : tasks.empty ? renderAdvisorEmpty(tasks.empty) : `<section class="advisor-now">${renderAdvisorCard(tasks.now, "large")}</section>`}
      <section class="advisor-lane" aria-label="Next actions">
        <div class="advisor-lane-head"><span class="eyebrow">Next</span><strong>${next.length ? "Coming up" : "Clear"}</strong></div>
        ${next.length ? next.map((item) => renderAdvisorCard(item)).join("") : '<p class="advisor-lane-empty">No queued actions.</p>'}
        ${more("next", allNext)}
      </section>
      <section class="advisor-lane risk-lane" aria-label="Risks">
        <div class="advisor-lane-head"><span class="eyebrow">Risk</span><strong>${risks.length ? "Needs attention" : "No major risk"}</strong></div>
        ${risks.length ? risks.map((item) => renderAdvisorCard(item)).join("") : '<p class="advisor-lane-empty">No blockers affecting meeting flow.</p>'}
        ${more("risk", tasks.risks)}
      </section>
    </section>
    ${renderSaaQuickActions()}
  </main>`;
}

const RUN_SHEET_TAB_LABELS = {
  "meeting-details": "Overview",
  "build-agenda": "Run of show",
  "prepare-voting": "Voting",
  "future-posters": "Posters",
  "review-share": "Share",
  "start-voting": "Open voting",
  "awards": "Awards",
  "meeting-review": "Review",
};

function formatMeetingDate(date) {
  if (!date) return "Date not set";
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return new Intl.DateTimeFormat(navigator.language || undefined, { weekday: "short", month: "short", day: "numeric" }).format(parsed);
}

function formatMeetingTime(time) {
  if (!time) return "Time not set";
  const parsed = new Date(`2000-01-01T${time}`);
  if (Number.isNaN(parsed.getTime())) return time;
  return new Intl.DateTimeFormat(navigator.language || undefined, { hour: "numeric", minute: "2-digit" }).format(parsed);
}

function formatDuration(minutes) {
  const value = Math.max(0, Number(minutes) || 0);
  const hours = Math.floor(value / 60);
  const mins = value % 60;
  if (!hours) return `${mins}m`;
  return mins ? `${hours}h ${mins}m` : `${hours}h`;
}

function renderRunSheetHeader() {
  const tasks = WORKFLOW[state.activeStage];
  return `<section class="run-sheet-header">
    <div class="run-sheet-title-row">
      <div class="run-sheet-title">
        <h1>${esc(state.meeting.theme || "Untitled meeting")}</h1>
        <div class="run-sheet-meta">
          <span><b aria-hidden="true">📅</b>${esc(formatMeetingDate(state.meeting.date))}</span>
          <span><b aria-hidden="true">🕒</b>${esc(formatMeetingTime(state.meeting.startTime))}</span>
          <span><b aria-hidden="true">⏱</b>${esc(formatDuration(totalMinutes()))}</span>
          <span title="${esc(state.meeting.venue || "Venue not set")}"><b aria-hidden="true">📍</b>${esc(state.meeting.venue || "Venue not set")}</span>
        </div>
      </div>
    </div>
    <div class="run-sheet-nav-row">
      <nav class="run-view-tabs" aria-label="Meeting workspace views">
        ${tasks.map((task) => `<button class="run-view-tab ${state.activeTask === task.id ? "active" : ""}" data-task="${task.id}" title="${esc(task.label)}" role="tab" aria-selected="${state.activeTask === task.id ? "true" : "false"}" aria-label="${esc(task.label)}"><span>${esc(RUN_SHEET_TAB_LABELS[task.id] || task.label)}</span></button>`).join("")}
      </nav>
    </div>
  </section>`;
}

function renderTaskSidebar() {
  const { blockers, recommendations } = validationCounts();
  const tasks = WORKFLOW[state.activeStage];
  return `<aside class="task-sidebar" data-region="workflow-sidebar">
    <div class="current-meeting-card">
      <span class="eyebrow">Current meeting</span>
      <strong>#${esc(state.meeting.meetingNumber)} · ${esc(state.meeting.theme || "Untitled meeting")}</strong>
      <span>${esc(state.meeting.date)} · ${isFinalized() ? "Finalized" : STAGE_LABELS[state.activeStage]}</span>
    </div>
    <div class="task-list">
      ${tasks.map((task, index) => `<button class="task-link ${state.activeTask === task.id ? "active" : ""}" data-task="${task.id}"><span>${index + 1}</span><strong>${task.label}</strong></button>`).join("")}
    </div>
    <div class="readiness-summary">
      <button data-task="review-share" data-stage-target="preparation" class="readiness-line ${blockers ? "danger" : "ok"}"><strong>${blockers || "✓"}</strong><span>${blockers ? "Blockers" : "No blockers"}</span></button>
      <div class="readiness-line"><strong>${recommendations}</strong><span>Recommendations</span></div>
    </div>
  </aside>`;
}

function renderVotingTask({ includeUpload = false } = {}) {
  return `<section class="section-card" data-region="media"><div class="section-heading"><div><span class="eyebrow">Meeting voting</span><h2>${includeUpload ? "Prepare voting" : "Live voting"}</h2></div></div><div class="section-content image-upload-list">${includeUpload ? renderVotingPreparation() : renderLiveVoting()}</div></section>`;
}

function renderClubProfileSummary() {
  const assignments = officerAssignmentsFromMembers();
  const configuredOfficers = Object.values(assignments).filter(Boolean).length;
  return `<section class="section-card"><div class="section-heading"><div><span class="eyebrow">Shared profile</span><h2>Club profile</h2></div><button class="button" data-club-settings data-focus-key="club-settings">Manage club settings</button></div><div class="section-content profile-status-grid"><span><strong>${configuredOfficers}/${OFFICER_ROLES.length}</strong> officers assigned</span><span><strong>${state.groupQr.present ? "Ready" : "Missing"}</strong> guest group QR</span><span><strong>${state.officerTeamPhoto.present ? "Ready" : "Missing"}</strong> officer photo</span></div></section>`;
}

function renderFinalizeTask() {
  const { blockers, recommendations } = validationCounts();
  return `<section class="section-card finalize-card"><div class="section-heading"><div><span class="eyebrow">Agenda state</span><h2>${isFinalized() ? "Agenda finalized" : "Finalize meeting"}</h2></div></div><div class="section-content">
    <p>${isFinalized() ? "Preparation content is locked. Live Execution remains available." : blockers ? `Resolve ${blockers} blocker${blockers === 1 ? "" : "s"} before finalizing.` : recommendations ? `${recommendations} recommendation${recommendations === 1 ? "" : "s"} remain. They do not block finalization.` : "All checks passed. This meeting is ready to finalize."}</p>
    ${isFinalized() ? '<button class="button" data-reopen-meeting>Reopen for editing</button>' : `<button class="button primary" data-finalize-meeting data-focus-key="finalize-meeting" ${blockers ? "disabled" : ""}>Finalize meeting</button>`}
  </div></section>`;
}

function renderShareTask() {
  const { blockers } = validationCounts();
  const presentationUrl = `/m/${encodeURIComponent(state.meeting.meetingNumber)}/presentation`;
  return `<section class="section-card"><div class="section-heading"><div><span class="eyebrow">Distribution</span><h2>Share or print</h2></div></div><div class="section-content share-actions"><a class="button primary presentation-open" href="${esc(presentationUrl)}" target="_blank" rel="noopener">Open presentation</a><button class="button" data-summary>Copy group summary</button><button class="button" data-print>Print / PDF</button>${blockers ? `<span class="presentation-note">Agenda has blockers</span>` : ""}</div></section>`;
}

function renderReviewShareTask() {
  return `${renderEvaluationForms()}${renderClubProfileSummary()}${renderValidation()}${renderShareTask()}${renderFinalizeTask()}`;
}

function evaluationForms() {
  const catalog = state.pathwaysCatalog;
  if (!state.meeting) return [];
  const projects = new Map((catalog?.projects || []).map((project) => [project.projectId, project]));
  const forms = new Map((catalog?.forms || []).map((form) => [form.formId, form]));
  const generic = forms.get("generic-evaluation-resource");
  return state.meeting.blocks
    .flatMap((block) => block.type === "prepared_speeches" ? block.items : [])
    .filter((item) => item.kind === "speech" && item.member && item.status === "confirmed")
    .map((item) => {
      if (item.pathwaysMode === "pathways") {
        const project = projects.get(item.pathwaysProjectId);
        const form = forms.get(item.pathwaysFormId);
        return { item, project, form, pdfUrl: form && project && form.projectId === project.projectId ? form.pdfUrl : "", reason: form ? "" : "Evaluation form missing" };
      }
      if (item.pathwaysMode === "custom") return { item, project: null, form: generic, pdfUrl: generic?.pdfUrl || "", reason: generic ? "" : "Generic form missing" };
      return { item, project: null, form: null, pdfUrl: "", reason: "Speech details not selected" };
    });
}

function renderEvaluationForms() {
  const entries = evaluationForms();
  return `<section class="section-card" data-region="evaluation-forms" data-scroll-anchor="evaluation-forms" data-focus-key="evaluation-forms" tabindex="-1">
    <div class="section-heading"><div><span class="eyebrow">Review & share</span><h2>Evaluation Forms</h2></div><span>${entries.length ? `${entries.filter((entry) => entry.pdfUrl).length}/${entries.length} ready` : "No speeches"}</span></div>
    <div class="section-content evaluation-form-list">
      ${entries.length ? entries.map(({ item, project, form, pdfUrl, reason }) => `<article class="evaluation-form-row">
        <div><strong>${esc(item.member)}</strong><span>${esc(item.pathwaysMode === "custom" ? "Custom speech · Generic evaluation" : [item.pathwaysPath, item.pathwaysLevel ? `Level ${item.pathwaysLevel}` : "", project?.name, form?.variant].filter(Boolean).join(" · ") || reason)}</span></div>
        ${pdfUrl ? `<a class="button" href="${esc(pdfUrl)}" target="_blank" rel="noopener">Open PDF ↗</a>` : `<button class="button" data-task="build-agenda" data-stage-target="preparation">Fix in Build agenda</button>`}
      </article>`).join("") : '<p>No confirmed prepared speakers.</p>'}
    </div>
  </section>`;
}

const REVIEW_METRIC_LABELS = Object.freeze({
  readiness: "Readiness",
  roleCoverage: "Role coverage",
  speakerSupply: "Speaker supply",
  runCompletion: "Run completion",
  audienceFeedback: "Audience feedback",
});

function reviewContext() {
  return {
    responseCount: state.votingResults?.responseCount || 0,
    feedback: state.votingResults?.feedback || null,
    awardsConfirmed: Boolean(state.awards?.confirmedAwards),
  };
}

function currentQualityMetrics() {
  return buildQualityMetrics(state.meeting, reviewContext());
}

function linesFromReview(key) {
  return (state.meeting.review?.[key] || []).join("\n");
}

function renderQualityMetrics() {
  const metrics = state.meeting.qualityMetrics || currentQualityMetrics();
  const score = state.meeting.qualityScore ?? qualityScore(metrics);
  return `<div class="quality-board">
    <div class="quality-score"><span class="eyebrow">Meeting quality</span><strong>${score}</strong><small>${Math.round(qualityConfidence(metrics) * 100)}% confidence</small></div>
    <div class="quality-metrics">
      ${Object.entries(REVIEW_METRIC_LABELS).map(([key, label]) => {
        const item = metrics[key] || { score: 0, status: "unknown", evidence: [], confidence: 0 };
        return `<article class="quality-metric ${esc(item.status)}"><div><strong>${esc(label)}</strong><span>${esc(item.status)}</span></div><b>${esc(item.score)}</b><p>${(item.evidence || []).map(esc).join(" · ")}</p></article>`;
      }).join("")}
    </div>
  </div>`;
}

function renderMeetingReviewTask() {
  const review = state.meeting.review || {};
  const completed = state.meeting.reviewStatus === "completed";
  const skipped = state.meeting.reviewStatus === "skipped";
  return `<section class="section-card review-card" data-region="review">
    <div class="section-heading"><div><span class="eyebrow">Meeting Advisor</span><h2>Review this meeting</h2></div><span class="review-status ${esc(state.meeting.reviewStatus)}">${esc(state.meeting.reviewStatus)}</span></div>
    <div class="section-content">
      ${renderQualityMetrics()}
      <div class="review-grid">
        <label>Highlights<textarea data-review-field="highlights" placeholder="One highlight per line">${esc(linesFromReview("highlights"))}</textarea></label>
        <label>Issues<textarea data-review-field="issues" placeholder="One issue per line">${esc(linesFromReview("issues"))}</textarea></label>
        <label>Next improvements<textarea data-review-field="improvements" placeholder="Optional for v1">${esc(linesFromReview("improvements"))}</textarea></label>
        <label>Skip reason<textarea data-review-field="skippedReason" placeholder="Required only when skipping">${esc(review.skippedReason || "")}</textarea></label>
      </div>
      <div class="review-actions">
        <button class="button primary" data-complete-review ${state.reviewBusy || !state.persisted ? "disabled" : ""}>${state.reviewBusy === "complete" ? "Completing…" : completed ? "Complete again" : "Complete Review"}</button>
        <button class="button" data-skip-review ${state.reviewBusy || !state.persisted ? "disabled" : ""}>${state.reviewBusy === "skip" ? "Skipping…" : skipped ? "Update skip" : "Skip Review"}</button>
        <button class="button" data-task="meeting-details" data-stage-target="preparation">Open Admin</button>
      </div>
      ${state.reviewBusy ? renderAgendaSyncTip(state.reviewBusy === "skip" ? "Saving skipped review…" : "Syncing meeting review…") : ""}
      ${state.persisted ? "" : '<p class="review-help">Save the meeting before completing review.</p>'}
    </div>
  </section>`;
}

function renderAdvisorOriginBanner() {
  if (!state.advisorOriginLabel) return "";
  return `<div class="advisor-origin-banner">
    <span>From Advisor: ${esc(state.advisorOriginLabel)}</span>
    <button class="button" data-view="advisor">Back to Advisor</button>
  </div>`;
}

function renderActiveTask() {
  let content = "";
  switch (state.activeTask) {
    case "meeting-details": content = renderMetaEditor(); break;
    case "build-agenda": content = `${renderBlockList()}${renderBlockEditor()}`; break;
    case "prepare-voting": content = renderVotingTask({ includeUpload: true }); break;
    case "future-posters": content = renderFuturePostersTask(); break;
    case "review-share": content = renderReviewShareTask(); break;
    case "start-voting": content = renderVotingTask(); break;
    case "awards": content = renderAwardsEditor(); break;
    case "meeting-review": content = renderMeetingReviewTask(); break;
    default: content = renderMetaEditor();
  }
  const task = Object.values(WORKFLOW).flat().find((candidate) => candidate.id === state.activeTask);
  const nextAction = state.activeStage === "preparation" && state.activeTask !== "review-share" && !isFinalized()
    ? '<button class="button primary" data-continue-workflow>Continue preparation</button>'
    : state.activeStage === "preparation" && state.activeTask === "review-share" && isFinalized()
      ? '<button class="button primary" data-go-live>Go to Live Execution</button>' : "";
  const preparationLocked = isFinalized() && state.activeStage === "preparation" && !["review-share", "future-posters"].includes(state.activeTask);
  return `<div class="task-editor-head"><div><span class="eyebrow">${esc(STAGE_LABELS[state.activeStage])}</span><h1>${esc(task?.label || "Meeting workspace")}</h1></div>${nextAction}</div>${renderAdvisorOriginBanner()}<fieldset class="task-fieldset" ${preparationLocked ? "disabled" : ""}>${content}</fieldset>`;
}

function renderToastRegionMarkup() {
  return `<div data-region="toast">${state.toast ? `<div class="toast">${esc(state.toast)}</div>` : ""}</div>`;
}

const VOTING_AWARD_TYPES = new Set(AWARD_DEFINITIONS.map(({ type }) => type));

function votingHostName() {
  return state.meeting?.blocks?.flatMap((block) => block.items || []).find((item) =>
    item.kind === "role" && roleIdentity(item.role, item.roleId).id === "voting_announcement_host" && item.status === "confirmed" && item.member,
  )?.member || "";
}

function votingConsoleResults() {
  return (state.awards?.results || []).filter((result) => VOTING_AWARD_TYPES.has(result.type));
}

function votingConsoleChange(result) {
  const previous = state.awards?.confirmedAwards?.awards?.find((award) => award.type === result.type)?.winners?.map((winner) => winner.name).sort() || [];
  const current = result.winners.map((winner) => winner.name).sort();
  if (!previous.length) return "";
  if (previous.join("|") === current.join("|")) return state.awards?.resultsChanged ? "Votes changed" : "";
  if (previous.length > 1 || current.length > 1) return "Tie changed";
  return "Winner changed";
}

function renderVotingResultCard(result) {
  const total = result.totalVotes || 0;
  const change = votingConsoleChange(result);
  return `<article class="voting-console-card">
    <header><div><span>${esc(result.title)}</span><strong>${total} vote${total === 1 ? "" : "s"}</strong></div><div class="voting-console-tags">${result.winners.length > 1 ? "<b>Tie</b>" : ""}${change ? `<b class="changed">${esc(change)}</b>` : ""}</div></header>
    <div class="voting-console-candidates">${result.candidates.length ? result.candidates.map((candidate) => {
      const percent = total ? Math.round((candidate.votes / total) * 100) : 0;
      return `<div class="voting-console-candidate"><div><strong>${esc(candidate.name || candidate.label)}</strong>${candidate.context ? `<span>${esc(candidate.context)}</span>` : ""}${candidate.historical ? "<em>Historical</em>" : ""}</div><div class="voting-console-count"><b>${candidate.votes}</b><span>${percent}%</span></div><i style="--vote-width:${percent}%"></i></div>`;
    }).join("") : '<p class="voting-console-empty">No candidates · N/A</p>'}</div>
  </article>`;
}

function renderVotingConsolePrompt() {
  const consoleState = state.votingConsole;
  if (!consoleState.open) return "";
  const data = state.awards;
  const results = votingConsoleResults();
  const awardUrl = data?.awardPage?.url || `/m/${encodeURIComponent(state.meeting.meetingNumber)}/awards`;
  const confirmed = Boolean(data?.confirmedAwards && !data.awardsStale && !data.resultsChanged);
  const operator = consoleState.operator || votingHostName() || data?.confirmedAwards?.confirmedBy?.name || "";
  const loadedAt = consoleState.loadedAt ? new Date(consoleState.loadedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—";
  let footer;
  if (consoleState.phase === "confirmed") {
    footer = `<div class="voting-console-success"><div><strong>Result confirmed</strong><span>Award presentation is now available.</span></div><div><a class="button primary" href="${esc(awardUrl)}" target="_blank" rel="noopener">Open Award ↗</a><button class="button" data-copy-award-link>Copy link</button><button class="button" data-close-voting-console>Close</button></div></div>`;
  } else if (consoleState.phase === "review") {
    footer = `<div class="voting-console-review"><div><span class="eyebrow">Final check</span><strong>${results.filter((result) => result.winners.length).map((result) => `${result.title}: ${result.winners.map((winner) => winner.name).join(" & ")}`).join(" · ") || "No valid result"}</strong></div><label>Confirmed by<input data-voting-console-operator value="${esc(operator)}" placeholder="Voting Host name"></label><div><button class="button" data-back-voting-console>Back</button><button class="button primary" data-confirm-voting-console ${consoleState.busy || !operator.trim() ? "disabled" : ""}>${consoleState.busy ? "Confirming…" : "Confirm Results"}</button></div></div>`;
  } else if (confirmed) {
    footer = `<div class="voting-console-success compact"><div><strong>Confirmed</strong><span>Live monitoring continues while this console is open.</span></div><div><a class="button primary" href="${esc(awardUrl)}" target="_blank" rel="noopener">Open Award ↗</a><button class="button" data-close-voting-console>Close</button></div></div>`;
  } else {
    footer = `<div class="voting-console-footer-copy"><span>${data?.blockers?.length ? esc(data.blockers[0]) : `${data?.responseCount || 0} valid response${data?.responseCount === 1 ? "" : "s"}`}</span><button class="button primary" data-review-voting-console ${consoleState.busy || consoleState.error || !data?.ready ? "disabled" : ""}>${data?.confirmedAwards ? "Review Changes" : "Review & Confirm"}</button></div>`;
  }
  return `<div class="modal-backdrop voting-console-backdrop"><section class="voting-console-modal" role="dialog" aria-modal="true" aria-labelledby="voting-console-title">
    <aside><div><span class="voting-console-live"><i></i> Live ballot</span><h2>Voting<br>Console</h2></div><dl><div><dt>Responses</dt><dd>${data?.responseCount ?? "—"}</dd></div><div><dt>Voting Host</dt><dd>${esc(votingHostName() || "Unassigned")}</dd></div><div><dt>Updated</dt><dd>${esc(loadedAt)}</dd></div></dl><button data-close-voting-console aria-label="Close voting console">×</button></aside>
    <main><header><div><span class="eyebrow">Meeting #${esc(state.meeting.meetingNumber)}</span><h1 id="voting-console-title">Confirm voting results</h1></div><button class="button" data-refresh-voting-console ${consoleState.busy ? "disabled" : ""}>${consoleState.busy ? "Refreshing…" : "Refresh"}</button></header>
      ${consoleState.error ? `<div class="voting-console-error"><strong>Refresh failed.</strong> Showing the last loaded totals. Confirmation is paused.</div>` : '<div class="voting-console-error is-empty" aria-hidden="true"></div>'}
      <section class="voting-console-results">${results.length ? results.map(renderVotingResultCard).join("") : '<div class="voting-console-loading">Loading voting results…</div>'}</section>
      <footer>${footer}</footer>
    </main>
  </section></div>`;
}

function renderOverlayRegionMarkup() {
  return `<div data-region="overlays">
    ${renderVotingConsolePrompt()}
    ${renderMigrationPrompt()}
    ${renderConflictPrompt()}
    ${renderTemplatePrompt()}
    ${renderRenameTemplatePrompt()}
    ${renderSaveTemplatePrompt()}
    ${renderPrintPrompt()}
    ${renderClubSettingsPrompt()}
    ${renderAboutProductPrompt()}
    ${renderSignupImportPrompt()}
    ${renderSignupGenerationPrompt()}
    ${renderGuestPrompt()}
    ${renderRolePrompt()}
    ${renderMemberPickerPrompt()}
  </div>`;
}

function replaceRegion(name, markup) {
  const current = document.querySelector(`[data-region="${name}"]`);
  if (!current) return false;
  current.outerHTML = markup;
  return true;
}

function updateRegionContent(name, markup) {
  const current = document.querySelector(`[data-region="${name}"]`);
  if (!current) return false;
  current.innerHTML = markup;
  return true;
}

function captureUiContinuity() {
  const active = document.activeElement;
  const editor = document.querySelector(".editor-scroll");
  const preview = document.querySelector(".preview-scroll");
  const selection = active && ["INPUT", "TEXTAREA"].includes(active.tagName)
    ? { start: active.selectionStart, end: active.selectionEnd, direction: active.selectionDirection }
    : null;
  return {
    editorScrollTop: editor?.scrollTop || 0,
    editorScrollLeft: editor?.scrollLeft || 0,
    previewScrollTop: preview?.scrollTop || 0,
    previewScrollLeft: preview?.scrollLeft || 0,
    windowScrollX: window.scrollX,
    windowScrollY: window.scrollY,
    focusKey: active?.dataset?.focusKey || "",
    selection,
  };
}

function elementForFocusKey(focusKey) {
  if (!focusKey) return null;
  return [...document.querySelectorAll("[data-focus-key]")]
    .find((element) => element.dataset.focusKey === focusKey) || null;
}

function restoreUiContinuity(snapshot, preferredFocusKey = "") {
  const focusTarget = elementForFocusKey(preferredFocusKey || snapshot.focusKey);
  focusTarget?.focus({ preventScroll: true });
  if (focusTarget && snapshot.selection && ["INPUT", "TEXTAREA"].includes(focusTarget.tagName)) {
    const max = focusTarget.value.length;
    focusTarget.setSelectionRange(
      Math.min(snapshot.selection.start ?? max, max),
      Math.min(snapshot.selection.end ?? max, max),
      snapshot.selection.direction || "none",
    );
  }
  const editor = document.querySelector(".editor-scroll");
  const preview = document.querySelector(".preview-scroll");
  if (editor) {
    editor.scrollTop = snapshot.editorScrollTop;
    editor.scrollLeft = snapshot.editorScrollLeft;
  }
  if (preview) {
    preview.scrollTop = snapshot.previewScrollTop;
    preview.scrollLeft = snapshot.previewScrollLeft;
  }
  window.scrollTo(snapshot.windowScrollX, snapshot.windowScrollY);
}

function withUiContinuity(update, preferredFocusKey = "") {
  const snapshot = captureUiContinuity();
  update();
  restoreUiContinuity(snapshot, preferredFocusKey);
}

function renderNavigatorRegion() {
  replaceRegion("navigator", renderMeetingNavigator());
}

function renderWorkflowSidebarRegion() {
  replaceRegion("workflow-sidebar", renderTaskSidebar());
}

function renderMediaRegion() {
  const markup = state.activeTask === "prepare-voting"
    ? renderVotingTask({ includeUpload: true })
    : state.activeTask === "future-posters" ? renderFuturePostersTask()
      : state.activeTask === "start-voting" ? renderVotingTask() : renderMediaEditor();
  replaceRegion("media", markup);
  speakingTips.start();
}

function renderOfficerRegion() {
  replaceRegion("officers", renderOfficerEditor());
}

function renderAwardsRegion(preferredFocusKey = "") {
  withUiContinuity(() => replaceRegion("awards", renderAwardsEditor()), preferredFocusKey);
  speakingTips.start();
}

function renderSaaQuickActionsRegion() {
  replaceRegion("saa-quick-actions", renderSaaQuickActions());
}

function renderBlockListRegion() {
  replaceRegion("block-list", renderBlockList());
}

function renderBlockEditorRegion() {
  replaceRegion("block-editor", renderBlockEditor());
}

function renderValidationRegion() {
  replaceRegion("validation", renderValidation());
}

function renderStatusRegion() {
  replaceRegion("status", renderStatusCluster());
}

function renderPreviewRegion() {
  updateRegionContent("preview", renderPreviewOutput());
}

function isFuturePostersTask() {
  return state.activeStage === "preparation" && state.activeTask === "future-posters";
}

function renderPreviewToolbar() {
  if (!isFuturePostersTask()) return `<div><span class="eyebrow">Print proof · A4</span><strong>Live output</strong></div><span class="preview-page-count">2 pages</span>`;
  const presentationUrl = `/m/${encodeURIComponent(state.meeting.meetingNumber)}/presentation`;
  return `<div><span class="eyebrow">Presentation · 16:9</span><strong>Poster slide</strong></div><a class="preview-open-link" href="${esc(presentationUrl)}" target="_blank" rel="noopener">Open full presentation ↗</a>`;
}

function renderPreviewOutput() {
  if (!isFuturePostersTask()) return `${renderFrontPage()}${renderBackPage()}`;
  if (!state.futurePosters[0]?.present) return `<div class="poster-preview-empty"><span>Presentation · Future posters</span><strong>Poster slide not generated</strong><p>Upload required Poster 1 to preview it.</p></div>`;
  const versions = state.futurePosters.map((image) => image?.version || "missing").join("-");
  const url = `/m/${encodeURIComponent(state.meeting.meetingNumber)}/presentation?preview=future-posters&version=${encodeURIComponent(versions)}`;
  return `<div class="poster-stage-preview"><iframe src="${esc(url)}" title="Future meeting posters presentation preview" loading="eager"></iframe></div>`;
}

function updateAgendaPreviewScale(preview) {
  const styles = getComputedStyle(preview);
  const availableWidth = preview.clientWidth - Number.parseFloat(styles.paddingLeft) - Number.parseFloat(styles.paddingRight);
  const scale = Math.min(1, Math.max(0.2, availableWidth / (210 * 96 / 25.4)));
  preview.style.setProperty("--agenda-preview-scale", scale.toFixed(4));
}

function bindAgendaPreviewSizing() {
  agendaPreviewResizeObserver?.disconnect();
  const preview = document.querySelector(".preview-scroll");
  if (!preview || isFuturePostersTask()) return;
  updateAgendaPreviewScale(preview);
  agendaPreviewResizeObserver = new ResizeObserver(() => updateAgendaPreviewScale(preview));
  agendaPreviewResizeObserver.observe(preview);
}

function renderToastRegion() {
  return replaceRegion("toast", renderToastRegionMarkup());
}

function renderOverlayRegion(preferredFocusKey = "") {
  replaceRegion("overlays", renderOverlayRegionMarkup());
  document.body.classList.toggle("has-modal", Boolean(document.querySelector(".modal-backdrop")));
  speakingTips.start();
  const autofocus = document.querySelector('[data-region="overlays"] [autofocus]');
  const focusTarget = autofocus || elementForFocusKey(preferredFocusKey);
  focusTarget?.focus({ preventScroll: true });
}

function refreshDerivedRegions({ blockList = false, navigator = false } = {}) {
  if (blockList) renderBlockListRegion();
  if (navigator) renderNavigatorRegion();
  renderOfficerRegion();
  renderValidationRegion();
  renderWorkflowSidebarRegion();
  renderStatusRegion();
  renderPreviewRegion();
}

function refreshStructure(preferredFocusKey = "") {
  withUiContinuity(() => {
    renderBlockListRegion();
    renderBlockEditorRegion();
    renderValidationRegion();
    renderWorkflowSidebarRegion();
    renderStatusRegion();
    renderPreviewRegion();
  }, preferredFocusKey);
}

function finishRender() {
  document.body.classList.toggle("has-modal", Boolean(document.querySelector(".modal-backdrop")));
  speakingTips.start();
}

function render() {
  speakingTips.stop();
  if (state.loading) {
    document.querySelector("#app").innerHTML = `<main class="loading-shell"><span class="loading-mark">A</span><p>Opening workspace…</p>${state.showLoadingTip ? speakingTips.markup({ delayed: true }) : ""}</main>`;
    finishRender();
    return;
  }
  if (state.guestMode) {
    document.querySelector("#app").innerHTML = renderGuestWorkspace();
    finishRender();
    return;
  }
  if (!state.authenticated) {
    document.querySelector("#app").innerHTML = renderLogin();
    bindLogin();
    finishRender();
    return;
  }
  if (!state.meeting) {
    document.querySelector("#app").innerHTML = renderMeetingSwitchboard();
    bindEvents();
    finishRender();
    return;
  }
  const storedPreviewWidth = Number(localStorage.getItem(PREVIEW_PANE_WIDTH_KEY));
  const previewPaneWidth = Number.isFinite(storedPreviewWidth) && storedPreviewWidth > 0 ? storedPreviewWidth : 390;
  const adminMarkup = `
      ${renderStageNavigation()}
      ${renderRunSheetHeader()}
      <main class="workspace mobile-${state.mobileView}" style="--preview-pane-width:${previewPaneWidth}px">
        <section class="editor-panel"><div class="editor-scroll">${renderActiveTask()}</div></section>
        <div class="workspace-splitter" data-workspace-splitter role="separator" aria-label="Resize editor and preview" aria-orientation="vertical" aria-valuemin="340" aria-valuenow="${previewPaneWidth}" tabindex="0" title="Drag to resize · Double-click to reset"></div>
        <section class="preview-panel" aria-label="Live preview panel">
          <div class="preview-toolbar ${isFuturePostersTask() ? "is-presentation" : ""}">${renderPreviewToolbar()}</div>
          <div class="preview-scroll ${isFuturePostersTask() ? "poster-output" : ""}" data-region="preview">${renderPreviewOutput()}</div>
        </section>
      </main>
      ${renderMobileActionDock()}`;
  document.querySelector("#app").innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <div class="brand">
          <span class="brand-mark">A</span>
          <div class="brand-copy"><strong>Meeting Advisor</strong><span>Meeting Ops</span></div>
        </div>
        ${renderMeetingNavigator()}
        <div class="topbar-actions">
          ${state.activeView === "advisor"
            ? '<button class="button primary advisor-nav-action" data-view="admin">Open Admin</button>'
            : '<button class="button primary advisor-nav-action advisor-nav-back" data-view="advisor" aria-label="Back to Advisor"><span class="advisor-nav-label-full">Back to Advisor</span><span class="advisor-nav-label-short" aria-hidden="true">Advisor</span></button>'}
          ${renderSaveStatus()}
          <details class="more-menu"><summary class="icon-button" aria-label="More actions">•••</summary><div class="more-menu-popover"><button data-new-meeting>New meeting</button><button data-club-settings>Club settings</button>${state.previewMode ? "" : '<button data-save-template data-focus-key="save-template">Save as template</button>'}<button data-export-json>Export JSON</button><button data-about-product>About Product</button><button data-sign-out>Sign out</button></div></details>
        </div>
      </header>
      ${state.activeView === "advisor" ? renderAdvisorHome() : adminMarkup}
      ${renderToastRegionMarkup()}
      ${renderOverlayRegionMarkup()}
    </div>`;
  const workspace = document.querySelector(".workspace");
  const splitter = workspace?.querySelector("[data-workspace-splitter]");
  if (workspace && splitter) setWorkspacePreviewWidth(workspace, splitter, previewPaneWidth);
  if (state.activeView === "admin") bindAgendaPreviewSizing();
  bindEvents();
  finishRender();
}

let delegatedEventsBound = false;

function bindEvents() {
  if (delegatedEventsBound) return;
  delegatedEventsBound = true;
  const app = document.querySelector("#app");
  bindEditorEvents(app, {
    onEdit: handleDelegatedChange,
    onClick: handleDelegatedClick,
    onSubmit: handleDelegatedSubmit,
  });
  document.addEventListener("keydown", handleWorkspaceShortcut);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.memberPicker) closeMemberPicker();
    else if (event.key === "Escape" && state.votingConsole.open) closeVotingConsole();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopVotingConsoleRefresh();
    else if (state.votingConsole.open && state.votingConsole.phase === "live") refreshVotingConsole();
  });
  app.addEventListener("pointerdown", handleWorkspaceSplitPointerDown);
  app.addEventListener("dblclick", handleWorkspaceSplitDoubleClick);
  app.addEventListener("keydown", handleWorkspaceSplitKeydown);
  app.addEventListener("touchstart", (event) => speakingTips.handleTouchStart(event), { passive: true });
  app.addEventListener("touchend", (event) => speakingTips.handleTouchEnd(event), { passive: true });
}

function workspacePreviewBounds(workspace) {
  const width = workspace.getBoundingClientRect().width;
  return { min: 340, max: Math.max(340, width - 430) };
}

function setWorkspacePreviewWidth(workspace, splitter, value, { persist = false } = {}) {
  const { min, max } = workspacePreviewBounds(workspace);
  const width = Math.round(Math.min(max, Math.max(min, value)));
  workspace.style.setProperty("--preview-pane-width", `${width}px`);
  splitter.setAttribute("aria-valuemax", String(Math.round(max)));
  splitter.setAttribute("aria-valuenow", String(width));
  if (persist) localStorage.setItem(PREVIEW_PANE_WIDTH_KEY, String(width));
}

function handleWorkspaceSplitPointerDown(event) {
  const splitter = event.target.closest("[data-workspace-splitter]");
  if (!splitter || window.matchMedia("(max-width: 1050px)").matches) return;
  const workspace = splitter.closest(".workspace");
  splitter.setPointerCapture(event.pointerId);
  document.body.classList.add("is-resizing-workspace");
  const move = (moveEvent) => {
    const rect = workspace.getBoundingClientRect();
    setWorkspacePreviewWidth(workspace, splitter, rect.right - moveEvent.clientX);
  };
  const stop = (upEvent) => {
    splitter.releasePointerCapture(upEvent.pointerId);
    document.body.classList.remove("is-resizing-workspace");
    splitter.removeEventListener("pointermove", move);
    splitter.removeEventListener("pointerup", stop);
    splitter.removeEventListener("pointercancel", stop);
    setWorkspacePreviewWidth(workspace, splitter, Number.parseFloat(getComputedStyle(workspace).getPropertyValue("--preview-pane-width")), { persist: true });
  };
  splitter.addEventListener("pointermove", move);
  splitter.addEventListener("pointerup", stop);
  splitter.addEventListener("pointercancel", stop);
}

function handleWorkspaceSplitKeydown(event) {
  const splitter = event.target.closest("[data-workspace-splitter]");
  if (!splitter || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
  event.preventDefault();
  const workspace = splitter.closest(".workspace");
  const current = Number.parseFloat(getComputedStyle(workspace).getPropertyValue("--preview-pane-width")) || 390;
  setWorkspacePreviewWidth(workspace, splitter, current + (event.key === "ArrowLeft" ? 24 : -24), { persist: true });
}

function handleWorkspaceSplitDoubleClick(event) {
  const splitter = event.target.closest("[data-workspace-splitter]");
  if (!splitter) return;
  setWorkspacePreviewWidth(splitter.closest(".workspace"), splitter, 390, { persist: true });
}

function handleWorkspaceShortcut(event) {
  if (!(event.metaKey || event.ctrlKey) || event.key.toLocaleLowerCase() !== "s") return;
  if (state.activeTask !== "start-voting" || !state.tableTopicsDraftDirty) return;
  event.preventDefault();
  saveTableTopicsSpeakers();
}

function previewSignupAnalysis() {
  const items = allAgendaItems();
  const timerTargets = items.filter((item) => roleIdentity(item.role, item.roleId).id === "timer").map((item) => item.id);
  const speech = items.find((item) => item.kind === "speech" && !item.member) || items.find((item) => item.kind === "speech");
  const member = (name) => state.members.find((candidate) => candidate.displayName.startsWith(name));
  const taylor = member("Taylor LEE");
  const morgan = member("Morgan PARK");
  const casey = member("Casey KIM");
  const alex = member("Alex CHEN");
  const theme = state.signupImport.text.match(/^\s*Theme\s*[:：]\s*(.+)$/im)?.[1]?.trim() || "The courage to begin";
  const detectedMeetingNumber = Number(state.signupImport.text.match(/Meeting\s*#?\s*(\d+)/i)?.[1] || state.meeting.meetingNumber);
  const exactPerson = (id, scope, field, label, kind, targetIds, oldValue, targetMember) => ({
    id, scope, targetId: targetIds[0], targetIds, field, label, kind, oldValue: oldValue || "",
    newValue: targetMember.displayName, newMemberId: targetMember.id, match: "exact",
    options: [{ id: targetMember.id, displayName: targetMember.displayName, source: "exact" }],
    overwrite: Boolean(oldValue), requiresConfirmation: false, selected: !oldValue, warning: "",
  });
  const changes = [
    { id: "preview-theme", scope: "meeting", targetId: state.meeting.id, targetIds: [state.meeting.id], field: "theme", label: "Meeting theme", kind: "meeting", oldValue: state.meeting.theme, newValue: theme, newMemberId: "", match: "text", options: [], overwrite: true, requiresConfirmation: false, selected: false, warning: "" },
    exactPerson("preview-manager", "meeting", "meetingManager", "Meeting Manager", "support_role", [state.meeting.id], state.meeting.meetingManager, alex),
    exactPerson("preview-timer", "agenda", "member", "Timer · linked role", "role", timerTargets, items.find((item) => timerTargets.includes(item.id))?.member, taylor),
    exactPerson("preview-speaker", "agenda", "member", speech?.role || "Prepared Speaker", "speaker", [speech.id], speech.member, morgan),
    exactPerson("preview-evaluator", "agenda", "evaluator", `${speech?.role || "Prepared Speaker"} evaluator`, "evaluator", [speech.id], speech.evaluator, casey),
    { id: "preview-title", scope: "agenda", targetId: speech.id, targetIds: [speech.id], field: "session", label: `${speech.role} title`, kind: "speech_title", oldValue: speech.session, newValue: "A Question Worth Asking", newMemberId: "", match: "text", options: [], overwrite: Boolean(speech.session), requiresConfirmation: false, selected: !speech.session, warning: "" },
  ].filter((change) => change.targetIds.length && change.newValue);
  return {
    meetingId: state.meeting.id,
    meetingNumber: state.meeting.meetingNumber,
    revision: Number(state.meeting.revision || 0),
    model: SIGNUP_IMPORT_MODEL,
    detectedMeetingNumber,
    detectedMeetingDate: state.meeting.date,
    meetingNumberMismatch: detectedMeetingNumber !== Number(state.meeting.meetingNumber),
    meetingDateMismatch: false,
    meetingMismatch: detectedMeetingNumber !== Number(state.meeting.meetingNumber),
    canApply: detectedMeetingNumber === Number(state.meeting.meetingNumber),
    changes,
    ignored: [{ label: "Next meeting speaker", value: "Future signup", reason: "Future meeting section" }],
    unapplied: [],
    notes: ["Preview uses an in-memory mock. No network or Feishu data is touched."],
  };
}

function openSignupImport() {
  if (!state.meeting || state.meeting.status !== "draft") return notify("Reopen preparation before importing signup text.");
  overlayReturnFocusKey = "signup-import";
  state.signupImport = {
    ...emptySignupImport(),
    open: true,
    text: state.previewMode ? `Meeting #${state.meeting.meetingNumber}\nDate: ${state.meeting.date}\nTheme: The courage to begin\nMeeting Manager: Alex CHEN\nTimer: Taylor LEE\nPrepared Speaker 2: Morgan PARK\nEvaluator 2: Casey KIM\nSpeech title: A Question Worth Asking` : "",
  };
  renderOverlayRegion();
}

async function generateSignupPreview() {
  const preview = state.signupGeneration;
  if (!preview.open) return;
  const requestId = ++preview.requestId;
  preview.busy = true;
  preview.error = "";
  renderOverlayRegion();
  try {
    const body = await apiJson(`/api/meetings/${encodeURIComponent(state.meeting.id)}?action=generate-signup`, {
      method: "POST",
      body: JSON.stringify({
        language: preview.language,
        vacancyEmoji: preview.vacancyEmoji,
        includeSpeechDetails: preview.includeSpeechDetails,
      }),
    });
    if (state.signupGeneration.open && state.signupGeneration.requestId === requestId) state.signupGeneration.text = body.text;
  } catch (error) {
    if (state.signupGeneration.open && state.signupGeneration.requestId === requestId) state.signupGeneration.error = error.message;
  } finally {
    if (state.signupGeneration.open && state.signupGeneration.requestId === requestId) {
      state.signupGeneration.busy = false;
      renderOverlayRegion();
    }
  }
}

function scheduleSignupPreview(delay = 0) {
  window.clearTimeout(signupGenerationTimer);
  signupGenerationTimer = window.setTimeout(generateSignupPreview, delay);
}

function openSignupGeneration() {
  overlayReturnFocusKey = "signup-generation";
  state.signupGeneration = { ...emptySignupGeneration(), open: true };
  renderOverlayRegion();
  scheduleSignupPreview();
}

function closeSignupGeneration() {
  window.clearTimeout(signupGenerationTimer);
  state.signupGeneration = emptySignupGeneration();
  renderOverlayRegion(overlayReturnFocusKey);
  overlayReturnFocusKey = "";
}

function closeSignupImport() {
  const refresh = state.signupImport.step === "success";
  state.signupImport = emptySignupImport();
  if (refresh) render();
  else {
    renderOverlayRegion(overlayReturnFocusKey);
    overlayReturnFocusKey = "";
  }
}

function syncSignupReviewControls() {
  const selected = signupSelectedCount();
  const needsReview = signupNeedsReviewCount();
  document.querySelectorAll("[data-signup-selected-count]").forEach((node) => { node.textContent = selected; });
  document.querySelectorAll("[data-signup-review-count]").forEach((node) => { node.textContent = needsReview; });
  document.querySelectorAll(".signup-review-section").forEach((section) => {
    const count = [...section.querySelectorAll("[data-signup-change-check]")].filter((input) => input.checked).length;
    const label = section.querySelector("header > span");
    if (label) label.textContent = `${count} selected`;
  });
  const apply = document.querySelector("[data-apply-signup]");
  if (apply) apply.disabled = !state.signupImport.analysis?.canApply || !selected || Boolean(state.signupImport.busy);
}

function signupChangeById(id) {
  return state.signupImport.analysis?.changes.find((change) => change.id === id);
}

async function analyzeSignupImport() {
  const text = state.signupImport.text.trim();
  if (text.length < SIGNUP_TEXT_MIN || text.length > SIGNUP_TEXT_MAX || state.signupImport.busy) return;
  state.signupImport.busy = "analyze";
  state.signupImport.error = "";
  renderOverlayRegion();
  try {
    await flushSave();
    if (["error", "conflict"].includes(state.saveStatus)) throw new Error("Save the current meeting before analyzing signup text.");
    const analysis = state.previewMode
      ? previewSignupAnalysis()
      : (await apiJson(`/api/meetings/${encodeURIComponent(state.meeting.id)}?action=analyze-signup`, {
          method: "POST",
          body: JSON.stringify({ signupText: text, expectedRevision: state.meeting.revision }),
        })).analysis;
    state.signupImport.analysis = analysis;
    state.signupImport.step = "review";
  } catch (error) {
    state.signupImport.error = error.message;
  } finally {
    state.signupImport.busy = "";
    renderOverlayRegion();
  }
}

async function applySignupImport() {
  const analysis = state.signupImport.analysis;
  if (!analysis?.canApply || state.signupImport.busy) return;
  const selected = analysis.changes.filter((change) => change.selected);
  if (!selected.length) return;
  if (Number(state.meeting.revision || 0) !== Number(analysis.revision || 0)) {
    state.signupImport.error = "Meeting changed after analysis. Close this review and analyze the latest version again.";
    return renderOverlayRegion();
  }
  if (selected.some((change) => !String(change.newValue || "").trim() || (signupChangeIsPerson(change) && !change.newMemberId))) {
    state.signupImport.error = "Complete every selected value before applying.";
    return renderOverlayRegion();
  }
  state.signupImport.busy = "apply";
  state.signupImport.error = "";
  renderOverlayRegion();
  try {
    const next = applySignupChanges(state.meeting, analysis.changes);
    const meeting = state.previewMode
      ? { ...next, revision: Number(next.revision || 0) + 1 }
      : (await apiJson(`/api/meetings/${encodeURIComponent(state.meeting.id)}`, {
          method: "PUT",
          body: JSON.stringify({ meeting: next, expectedRevision: analysis.revision, signupImport: { changes: selected } }),
        })).meeting;
    state.meeting = normalizeMeetingState(meeting);
    state.persisted = true;
    state.dirty = false;
    state.saveStatus = "saved";
    state.saveError = "";
    state.savedAt = new Date();
    clearLocalDraft(state.meeting.id);
    updateMeetingSummary(state.meeting);
    state.signupImport.appliedCount = selected.length;
    state.signupImport.step = "success";
  } catch (error) {
    state.signupImport.error = error.status === 409
      ? "Meeting changed in another browser. Keep this review open, reload the meeting, then analyze again."
      : error.message;
  } finally {
    state.signupImport.busy = "";
    renderOverlayRegion();
  }
}

async function handleDelegatedChange(event) {
  const input = event.target;
  if (input.matches("[data-voting-console-operator]")) {
    state.votingConsole.operator = input.value;
    const confirmButton = input.closest(".voting-console-review")?.querySelector("[data-confirm-voting-console]");
    if (confirmButton) confirmButton.disabled = !input.value.trim() || state.votingConsole.busy;
    return;
  }
  if (input.matches("[data-member-picker-search]")) {
    updateMemberPickerSearch(input);
    return;
  }
  if (input.matches("[data-signup-generation-language], [data-signup-generation-emoji], [data-signup-generation-titles]")) {
    if (input.matches("[data-signup-generation-language]")) state.signupGeneration.language = input.value;
    else if (input.matches("[data-signup-generation-emoji]")) state.signupGeneration.vacancyEmoji = input.value;
    else state.signupGeneration.includeSpeechDetails = input.checked;
    scheduleSignupPreview(input.matches("[data-signup-generation-emoji]") ? 250 : 0);
    return;
  }
  if (input.matches("[data-signup-text]")) {
    state.signupImport.text = input.value;
    state.signupImport.error = "";
    const count = input.closest(".signup-import-modal")?.querySelector("[data-signup-count]");
    if (count) count.textContent = `${input.value.length.toLocaleString()} / ${SIGNUP_TEXT_MAX.toLocaleString()}`;
    const analyze = input.closest(".signup-import-modal")?.querySelector("[data-analyze-signup]");
    if (analyze) analyze.disabled = input.value.trim().length < SIGNUP_TEXT_MIN || input.value.trim().length > SIGNUP_TEXT_MAX;
    return;
  }
  if (input.matches("[data-signup-change-check]")) {
    const change = signupChangeById(input.dataset.signupChangeCheck);
    if (!change) return;
    if (input.checked && change.conflictGroup) {
      state.signupImport.analysis.changes.filter((candidate) => candidate.id !== change.id && candidate.conflictGroup === change.conflictGroup).forEach((candidate) => {
        candidate.selected = false;
        const checkbox = document.querySelector(`[data-signup-change-check="${CSS.escape(candidate.id)}"]`);
        if (checkbox) checkbox.checked = false;
      });
    }
    change.selected = input.checked;
    if (input.checked && change.newMemberId) change.requiresConfirmation = false;
    syncSignupReviewControls();
    return;
  }
  if (input.matches("[data-signup-change-member]")) {
    const change = signupChangeById(input.dataset.signupChangeMember);
    if (!change) return;
    if (input.value === "__create_guest__") {
      overlayReturnFocusKey = `signup-member:${change.id}`;
      state.guestPrompt = { kind: "signup", changeId: change.id, defaultName: change.newValue };
      renderOverlayRegion();
      return;
    }
    const member = state.members.find((candidate) => candidate.id === input.value);
    change.newMemberId = member?.id || "";
    change.newValue = member?.displayName || change.newValue;
    change.match = member ? "manual" : "unmatched";
    change.requiresConfirmation = !member || Boolean(change.conflictGroup);
    change.selected = Boolean(member) && !change.overwrite && !change.conflictGroup;
    const row = input.closest("[data-signup-change-row]");
    const value = row?.querySelector(".signup-new-value");
    const checkbox = row?.querySelector("[data-signup-change-check]");
    if (value) value.textContent = member?.displayName || "Choose member";
    if (checkbox) { checkbox.disabled = !member; checkbox.checked = change.selected; }
    syncSignupReviewControls();
    return;
  }
  if (input.matches("[data-signup-change-value]")) {
    const change = signupChangeById(input.dataset.signupChangeValue);
    if (change) change.newValue = input.value;
    return;
  }
  if (input.matches("[data-guest-meeting]")) {
    await loadGuestMeeting(input.value);
    return;
  }
  const globalPosterUpload = input.matches("[data-upload-image]") && FUTURE_POSTER_KINDS.includes(input.dataset.uploadImage);
  if (isFinalized() && state.activeStage === "preparation" && !state.clubSettingsOpen && !globalPosterUpload && !input.matches("[data-meeting-select]") && !input.closest("[data-template-form], [data-rename-template-form]")) return notify("Reopen preparation before editing.");
  if (input.matches("[data-path]")) {
    const value = input.type === "checkbox" ? input.checked : input.type === "number" ? Number(input.value) : input.value;
    updateField(input.dataset.path, value);
    return;
  }
  if (input.matches("[data-block-key]")) {
    selectedBlock()[input.dataset.blockKey] = input.value;
    markDirty();
    refreshDerivedRegions({ blockList: true });
    return;
  }
  if (input.matches("[data-speech-item]")) {
    const item = selectedBlock().items.find((candidate) => candidate.id === input.dataset.speechItem);
    const draftKey = `${state.meeting.id}:${item.id}`;
    const draft = { ...item, ...(state.pathwaysDrafts[draftKey] || {}) };
    const key = input.dataset.speechKey;
    draft[key] = input.value;
    if (key === "pathwaysMode") {
      draft.pathwaysPath = "";
      draft.pathwaysLevel = "";
      draft.pathwaysProjectId = "";
      draft.pathwaysFormId = "";
      if (input.value !== "custom") draft.speechObjective = "";
      if (input.value === "custom" && /^\[Pathways /m.test(draft.speechObjective)) {
        draft.speechObjective = draft.speechObjective.match(/^\[Speech Objective\]\s*(.*)$/m)?.[1] || "";
      }
    }
    if (key === "pathwaysPath") Object.assign(draft, { pathwaysLevel: "", pathwaysProjectId: "", pathwaysFormId: "", speechObjective: "" });
    if (key === "pathwaysLevel") Object.assign(draft, { pathwaysProjectId: "", pathwaysFormId: "", speechObjective: "" });
    if (key === "pathwaysProjectId") {
      Object.assign(draft, { pathwaysFormId: "", speechObjective: "" });
      const forms = state.pathwaysCatalog?.forms.filter((candidate) => candidate.projectId === input.value) || [];
      if (forms.length === 1) Object.assign(draft, { pathwaysFormId: forms[0].formId, speechObjective: forms[0].speechPurpose || "" });
    }
    if (key === "pathwaysFormId") {
      const form = state.pathwaysCatalog?.forms.find((candidate) => candidate.formId === input.value);
      draft.speechObjective = form?.speechPurpose || "";
    }
    const complete = draft.pathwaysMode !== "pathways" || Boolean(draft.pathwaysPath && draft.pathwaysLevel && draft.pathwaysProjectId && draft.pathwaysFormId);
    if (complete) {
      Object.assign(item, draft);
      delete state.pathwaysDrafts[draftKey];
      markDirty();
    } else state.pathwaysDrafts[draftKey] = draft;
    refreshStructure(`item:${item.id}:${key}`);
    return;
  }
  if (input.matches("[data-role-item]")) {
    const item = selectedBlock().items.find((candidate) => candidate.id === input.dataset.roleItem);
    if (input.value === "__add_role__") {
      overlayReturnFocusKey = `item:${item.id}:role`;
      state.rolePrompt = { itemId: item.id, name: "", error: "", busy: false };
      renderOverlayRegion();
      return;
    }
    const previousRoleId = item.roleId;
    item.role = input.value;
    item.roleId = roleIdentity(item.role).id;
    autofillAgendaOfficer(item, item.role);
    syncLinkedAgendaItem(item, "role", previousRoleId);
    markDirty();
    refreshDerivedRegions({ blockList: true });
    return;
  }
  if (input.matches("[data-item]")) {
    const item = selectedBlock().items.find((candidate) => candidate.id === input.dataset.item);
    const previousRoleId = item.roleId;
    item[input.dataset.itemKey] = input.type === "number" ? Number(input.value) : input.value;
    if (input.dataset.itemKey === "role") {
      item.roleId = roleIdentity(item.role).id;
      autofillAgendaOfficer(item, item.role);
    }
    syncLinkedAgendaItem(item, input.dataset.itemKey, previousRoleId);
    markDirty();
    refreshDerivedRegions({ blockList: true });
    return;
  }
  if (input.matches("[data-role-taker-role]")) {
    state.meeting.votingForm = state.meeting.votingForm && typeof state.meeting.votingForm === "object" ? state.meeting.votingForm : {};
    const config = roleAwardConfig(state.meeting.votingForm);
    const next = new Set(config.roleTakerRoleIds);
    if (input.checked) next.add(input.dataset.roleTakerRole);
    else next.delete(input.dataset.roleTakerRole);
    state.meeting.votingForm.roleAwardConfig = { roleTakerRoleIds: [...next] };
    markDirty();
    renderMediaRegion();
    return;
  }
  if (input.matches("[data-sharing-master-role]")) {
    state.meeting.votingForm = state.meeting.votingForm && typeof state.meeting.votingForm === "object" ? state.meeting.votingForm : {};
    const config = recognitionAwardConfig(state.meeting.votingForm);
    const next = new Set(config.sharingMasterRoleIds);
    if (input.checked) next.add(input.dataset.sharingMasterRole);
    else next.delete(input.dataset.sharingMasterRole);
    state.meeting.votingForm.recognitionAwardConfig = { ...config, sharingMasterRoleIds: [...next] };
    state.awards = null;
    state.awardsError = "";
    markDirty();
    renderMediaRegion();
    return;
  }
  if (input.matches("[data-member-item]")) {
    const item = selectedBlock().items.find((candidate) => candidate.id === input.dataset.memberItem);
    const key = input.dataset.memberKey;
    if (input.value === "__add_guest__") {
      await addGuestForItem(item, key);
      return;
    }
    const member = state.members.find((candidate) => candidate.id === input.value);
    item[`${key}Id`] = member?.id || "";
    item[key] = member?.displayName || "";
    syncLinkedAgendaItem(item, key);
    markDirty();
    refreshDerivedRegions();
    return;
  }
  if (input.matches("[data-meeting-member-key]")) {
    const key = input.dataset.meetingMemberKey;
    if (input.value === "__add_guest__") {
      await addGuestForMeetingRole(key);
      return;
    }
    const member = state.members.find((candidate) => candidate.id === input.value);
    state.meeting[`${key}MemberId`] = member?.id || "";
    state.meeting[key] = member?.displayName || "";
    markDirty();
    refreshDerivedRegions();
    return;
  }
  if (input.matches("[data-officer-role]")) {
    await updateOfficerRole(input.dataset.officerRole, input.value);
    return;
  }
  if (input.matches("[data-upload-image]")) {
    const [file] = input.files || [];
    if (file) await uploadQrImage(input.dataset.uploadImage, file);
    return;
  }
  if (input.matches("[data-table-topics-speakers]")) {
    state.tableTopicsDraft = input.value;
    state.tableTopicsDraftDirty = input.value !== state.meeting.tableTopicsSpeakers.join("\n");
    const panel = input.closest(".voting-live");
    const indicator = panel?.querySelector(".draft-state");
    const saveButton = panel?.querySelector("[data-save-table-topics]");
    if (indicator) { indicator.textContent = state.tableTopicsDraftDirty ? "Unsaved" : "Saved"; indicator.classList.toggle("dirty", state.tableTopicsDraftDirty); }
    if (saveButton) saveButton.disabled = !state.tableTopicsDraftDirty;
    return;
  }
  if (input.matches("[data-review-field]")) {
    const key = input.dataset.reviewField;
    state.meeting.review = state.meeting.review && typeof state.meeting.review === "object" ? state.meeting.review : {};
    state.meeting.review[key] = key === "skippedReason"
      ? input.value
      : input.value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    return;
  }
  if (input.matches("[data-sharing-master-names]")) {
    state.meeting.votingForm = state.meeting.votingForm && typeof state.meeting.votingForm === "object" ? state.meeting.votingForm : {};
    const config = recognitionAwardConfig(state.meeting.votingForm);
    state.meeting.votingForm.recognitionAwardConfig = {
      ...config,
      sharingMasterNames: [...new Set(input.value.split(/\r?\n/).map((name) => name.trim()).filter(Boolean))],
    };
    state.awards = null;
    state.awardsError = "";
    markDirty();
    return;
  }
  if (input.matches("[data-voting-source]")) {
    if (event.type === "input") return;
    await flushSave();
    const body = await apiJson(`/api/meetings/${encodeURIComponent(state.meeting.id)}/voting?action=qr-source`, { method: "PUT", body: JSON.stringify({ qrSource: input.value }) });
    state.meeting.qrSource = body.qrSource;
    renderMediaRegion(); renderPreviewRegion();
    return;
  }
  if (input.matches("[data-meeting-select]")) await loadMeetingFromCloud(input.value);
}

async function handleDelegatedClick(event) {
  if (event.target.matches(".member-picker-backdrop")) {
    closeMemberPicker();
    return;
  }
  const button = event.target.closest("button, [data-select-block], [data-preview-block]");
  if (!button) return;
  if (speakingTips.handleClick(event)) return;
  if (state.tableTopicsDraftDirty && (button.matches("[data-stage]") || button.matches("[data-task]")) && button.dataset.task !== "start-voting") {
    if (!window.confirm("Leave Live Voting without saving Table Topics speakers?")) return;
    state.tableTopicsDraft = state.meeting.tableTopicsSpeakers.join("\n");
    state.tableTopicsDraftDirty = false;
  }
  if (button.matches("[data-open-member-picker]")) {
    openMemberPicker(button);
  } else if (button.matches("[data-close-member-picker], [data-keep-current-member]")) {
    closeMemberPicker();
  } else if (button.matches("[data-pick-member]")) {
    await applyMemberPickerSelection(button.dataset.pickMember);
  } else if (button.matches("[data-clear-member]")) {
    await applyMemberPickerSelection("");
  } else if (button.matches("[data-add-picker-guest]")) {
    const picker = state.memberPicker;
    if (!picker) return;
    overlayReturnFocusKey = picker.returnFocusKey;
    state.memberPicker = null;
    state.guestPrompt = { kind: "picker", target: picker.target, defaultName: picker.query.trim(), busy: false, error: "", formatWarning: false };
    renderOverlayRegion();
  } else if (button.matches("[data-open-voting-console]")) {
    await openVotingConsole();
  } else if (button.matches("[data-close-voting-console]")) {
    closeVotingConsole();
  } else if (button.matches("[data-refresh-voting-console]")) {
    await refreshVotingConsole();
  } else if (button.matches("[data-review-voting-console]")) {
    await reviewVotingConsoleResults();
  } else if (button.matches("[data-back-voting-console]")) {
    state.votingConsole.phase = "live";
    renderOverlayRegion();
    scheduleVotingConsoleRefresh();
  } else if (button.matches("[data-confirm-voting-console]")) {
    await confirmVotingConsoleResults();
  } else if (button.matches("[data-copy-award-link]")) {
    try {
      await navigator.clipboard.writeText(new URL(state.awards?.awardPage?.url || `/m/${state.meeting.meetingNumber}/awards`, window.location.origin).href);
      notify("Award link copied.");
    } catch { notify("Could not copy the award link."); }
  } else if (button.matches("[data-open-signup-generation]")) {
    openSignupGeneration();
  } else if (button.matches("[data-close-signup-generation]")) {
    closeSignupGeneration();
  } else if (button.matches("[data-retry-signup-generation]")) {
    scheduleSignupPreview();
  } else if (button.matches("[data-copy-signup-generation]")) {
    try {
      await navigator.clipboard.writeText(state.signupGeneration.text);
      notify("Signup copied.");
    } catch {
      notify("Could not copy signup text.");
    }
  } else if (button.matches("[data-open-signup-import]")) {
    openSignupImport();
  } else if (button.matches("[data-close-signup-import]")) {
    closeSignupImport();
  } else if (button.matches("[data-analyze-signup]")) {
    await analyzeSignupImport();
  } else if (button.matches("[data-back-signup-import]")) {
    state.signupImport.step = "paste";
    state.signupImport.analysis = null;
    state.signupImport.error = "";
    renderOverlayRegion();
  } else if (button.matches("[data-apply-signup]")) {
    await applySignupImport();
  } else if (button.matches("[data-browse-meetings]")) {
    await openGuestWorkspace();
  } else if (button.matches("[data-view]")) {
    state.activeView = button.dataset.view;
    if (state.activeView === "admin") state.mobileView = "edit";
    if (state.activeView === "admin") state.advisorOriginLabel = "";
    render();
    if (state.activeView === "advisor") await loadAwards({ quiet: true });
  } else if (button.matches("[data-advisor-toggle]")) {
    const lane = button.dataset.advisorToggle;
    state.advisorExpanded[lane] = !state.advisorExpanded[lane];
    render();
  } else if (button.matches("[data-advisor-action]")) {
    await navigateFromAdvisor(button);
  } else if (button.matches("[data-stage]")) {
    state.activeStage = button.dataset.stage;
    state.activeTask = isFinalized() && state.activeStage === "preparation" ? "review-share" : WORKFLOW[state.activeStage][0].id;
    render();
  } else if (button.matches("[data-task]")) {
    state.highlightReviewItems = button.matches("[data-review-badge]");
    state.activeStage = button.dataset.stageTarget || Object.entries(WORKFLOW).find(([, tasks]) => tasks.some((task) => task.id === button.dataset.task))?.[0] || state.activeStage;
    state.activeTask = button.dataset.task;
    render();
    if (state.highlightReviewItems) document.querySelector('[data-region="validation"]')?.scrollIntoView({ block: "start" });
    if (state.activeTask === "awards") await loadAwards();
    if (state.activeTask === "prepare-voting") await prewarmVotingForm();
  } else if (button.matches("[data-mobile-view]")) {
    state.mobileView = button.dataset.mobileView;
    render();
  } else if (button.matches("[data-club-settings]")) {
    state.clubSettingsOpen = true;
    renderOverlayRegion();
  } else if (button.matches("[data-close-club-settings]")) {
    state.clubSettingsOpen = false;
    renderOverlayRegion("club-settings");
  } else if (button.matches("[data-about-product]")) {
    state.aboutProductOpen = true;
    renderOverlayRegion();
  } else if (button.matches("[data-close-about-product]")) {
    state.aboutProductOpen = false;
    renderOverlayRegion();
  } else if (button.matches("[data-retry-roles]")) {
    await loadRoles();
  } else if (button.matches("[data-cancel-role]")) {
    state.rolePrompt = null;
    renderOverlayRegion();
    renderBlockEditorRegion();
    elementForFocusKey(overlayReturnFocusKey)?.focus({ preventScroll: true });
    overlayReturnFocusKey = "";
  } else if (button.matches("[data-issue-index]")) {
    navigateToIssue(getValidation()[Number(button.dataset.issueIndex)]);
  } else if (button.matches("[data-preview-block]")) {
    navigateFromPreview(button.dataset.previewBlock, button.dataset.previewItem || "");
  } else if (button.matches("[data-continue-workflow]")) {
    const tasks = WORKFLOW.preparation;
    const index = tasks.findIndex((task) => task.id === state.activeTask);
    state.activeTask = tasks[Math.min(tasks.length - 1, index + 1)].id;
    render();
    if (state.activeTask === "prepare-voting") await prewarmVotingForm();
  } else if (button.matches("[data-go-live]")) {
    state.activeStage = "live";
    state.activeTask = "start-voting";
    render();
  } else if (button.matches("[data-retry-save]")) {
    await flushSave();
    render();
  } else if (button.matches("[data-finalize-meeting]")) {
    if (validationCounts().blockers) return notify("Resolve all blockers before finalizing.");
    state.meeting.status = "final";
    markDirty();
    render();
    await flushSave();
    if (state.saveStatus === "saved") await prewarmVotingForm();
  } else if (button.matches("[data-reopen-meeting]")) {
    state.meeting.status = "draft";
    markDirty();
    state.activeStage = "preparation";
    state.activeTask = "review-share";
    render();
  } else if (button.matches("[data-select-block]")) {
    state.selectedBlockId = button.dataset.selectBlock;
    refreshStructure(button.dataset.focusKey);
  } else if (button.matches("[data-move-block]")) {
    moveInList(state.meeting.blocks, button.dataset.moveBlock, Number(button.dataset.direction), button.dataset.focusKey);
  } else if (button.matches("[data-move-item]")) {
    moveInList(selectedBlock().items, button.dataset.moveItem, Number(button.dataset.direction), button.dataset.focusKey);
  } else if (button.matches("[data-delete-item]")) {
    deleteItem(button.dataset.deleteItem);
  } else if (button.matches("[data-remove-image]")) {
    await removeQrImage(button.dataset.removeImage);
  } else if (button.matches("[data-voting-prepare]")) {
    await runVotingAction("prepare");
  } else if (button.matches("[data-voting-sync]")) {
    await runVotingAction("sync");
  } else if (button.matches("[data-voting-results]")) {
    await runVotingAction("results");
  } else if (button.matches("[data-voting-clear]")) {
    await runVotingAction("clear");
  } else if (button.matches("[data-voting-authorize]")) {
    await runVotingAction("authorize");
  } else if (button.matches("[data-save-table-topics]")) {
    await saveTableTopicsSpeakers();
  } else if (button.matches("[data-add-block]")) {
    addBlock();
  } else if (button.matches("[data-duplicate-block]")) {
    duplicateBlock();
  } else if (button.matches("[data-delete-block]")) {
    deleteBlock();
  } else if (button.matches("[data-add-item]")) {
    addItem(button.dataset.addItem);
  } else if (button.matches("[data-new-meeting]")) {
    await createNewMeeting();
  } else if (button.matches("[data-rename-template]")) {
    if (state.newMeetingCreating) return;
    const template = state.templates.find((candidate) => candidate.id === button.dataset.renameTemplate);
    if (template) {
      state.renameTemplatePrompt = { id: template.id, name: template.name };
      renderOverlayRegion();
    }
  } else if (button.matches("[data-open-meeting]")) {
    await loadMeetingFromCloud(button.dataset.openMeeting);
  } else if (button.matches("[data-save-template]")) {
    await ensureTemplates();
    openSaveTemplatePrompt();
  } else if (button.matches("[data-download-agenda-pdf]")) {
    await downloadAgendaPdf();
  } else if (button.matches("[data-print]")) {
    overlayReturnFocusKey = button.dataset.focusKey || "";
    await openPrintPrompt();
  } else if (button.matches("[data-summary]")) {
    await exportSummary();
  } else if (button.matches("[data-refresh-awards]")) {
    await loadAwards();
  } else if (button.matches("[data-confirm-awards]")) {
    await confirmAwardResults();
  } else if (button.matches("[data-complete-review]")) {
    await saveMeetingReview("complete");
  } else if (button.matches("[data-skip-review]")) {
    await saveMeetingReview("skip");
  } else if (button.matches("[data-export-json]")) {
    exportJson();
  } else if (button.matches("[data-sign-out]")) {
    await signOut();
  } else if (button.matches("[data-cancel-guest]")) {
    state.guestPrompt = null;
    renderOverlayRegion(overlayReturnFocusKey);
    overlayReturnFocusKey = "";
  } else if (button.matches("[data-cancel-template-choice]")) {
    state.templatePrompt = false;
    renderOverlayRegion(overlayReturnFocusKey);
    overlayReturnFocusKey = "";
  } else if (button.matches("[data-template-choice]")) {
    if (state.newMeetingCreating) return;
    const choice = button.dataset.templateChoice;
    if (choice === "reuse") await startNewMeetingFromFinalized();
    else {
      const template = choice.startsWith("template:")
        ? state.templates.find((candidate) => candidate.id === choice.slice("template:".length))
        : null;
      await startNewMeetingFromSource(template);
    }
  } else if (button.matches("[data-cancel-rename-template]")) {
    state.renameTemplatePrompt = null;
    renderOverlayRegion();
  } else if (button.matches("[data-cancel-save-template]")) {
    state.saveTemplatePrompt = false;
    renderOverlayRegion(overlayReturnFocusKey);
    overlayReturnFocusKey = "";
  } else if (button.matches("[data-cancel-print]")) {
    if (state.printPrompt) restorePrintView(state.printPrompt);
    overlayReturnFocusKey = "";
  } else if (button.matches("[data-skip-migration]")) {
    localStorage.setItem(MIGRATION_KEY, "ignored");
    state.migrationPrompt = false;
    renderOverlayRegion();
  } else if (button.matches("[data-import-local]")) {
    await importLocalMeeting();
  } else if (button.matches("[data-reload-remote]")) {
    const meetingId = state.conflict.meetingId;
    state.conflict = null;
    state.saveStatus = "idle";
    await loadMeetingFromCloud(meetingId);
  } else if (button.matches("[data-save-copy]")) {
    await saveConflictCopy();
  }
}

function highlightAdvisorTarget(focusKey) {
  const focusTarget = elementForFocusKey(focusKey);
  focusTarget?.focus({ preventScroll: false });
  const target = focusTarget?.closest(".section-card, .item-card, .field, .block-row") || focusTarget || document.querySelector(".editor-scroll .section-card");
  if (!target) return;
  const scroller = target.closest(".editor-scroll");
  if (scroller) scroller.scrollTop = Math.max(0, target.offsetTop - (scroller.clientHeight - target.clientHeight) / 2);
  else target.scrollIntoView({ block: "center" });
  target.classList.add("advisor-target-highlight");
  window.setTimeout(() => target.classList.remove("advisor-target-highlight"), 1800);
}

async function navigateFromAdvisor(button) {
  state.activeView = "admin";
  state.mobileView = "edit";
  state.activeStage = button.dataset.stageTarget || "preparation";
  state.activeTask = button.dataset.task || WORKFLOW[state.activeStage]?.[0]?.id || "meeting-details";
  state.advisorOriginLabel = button.dataset.label || "";
  const focusKey = button.dataset.focusKey || "";
  if (focusKey === "club-settings") state.clubSettingsOpen = true;
  const itemId = focusKey.match(/^item:([^:]+)/)?.[1];
  if (itemId) {
    const block = state.meeting.blocks.find((candidate) => candidate.items.some((item) => item.id === itemId));
    if (block) state.selectedBlockId = block.id;
  }
  render();
  highlightAdvisorTarget(focusKey);
  if (state.activeTask === "awards") await loadAwards();
}

function memberPickerTarget(button) {
  if (button.dataset.signupChangeMember) return { kind: "signup", changeId: button.dataset.signupChangeMember };
  if (button.dataset.memberItem) return { kind: "item", itemId: button.dataset.memberItem, key: button.dataset.memberKey };
  if (button.dataset.meetingMemberKey) return { kind: "meeting", key: button.dataset.meetingMemberKey };
  if (button.dataset.officerRole) return { kind: "officer", role: button.dataset.officerRole };
  return null;
}

async function refreshMemberPickerMembers(picker) {
  if (state.previewMode) return;
  picker.refreshing = true;
  renderOverlayRegion();
  try {
    const { members } = await apiJson("/api/members");
    state.members = members;
    picker.error = "";
  } catch {
    picker.error = "Could not refresh members. Showing the cached list.";
  } finally {
    picker.refreshing = false;
    if (state.memberPicker === picker) renderOverlayRegion();
  }
}

function openMemberPicker(button) {
  const target = memberPickerTarget(button);
  if (!target) return;
  const picker = {
    target,
    label: button.dataset.pickerLabel || "Choose member",
    selectedId: button.dataset.selectedId || "",
    selectedLabel: button.dataset.selectedLabel || "",
    allowEmpty: button.dataset.allowEmpty === "true",
    allowGuest: button.dataset.allowGuest === "true",
    returnFocusKey: button.dataset.focusKey || "",
    query: "",
    refreshing: false,
    error: "",
  };
  state.memberPicker = picker;
  renderOverlayRegion();
  refreshMemberPickerMembers(picker);
}

function closeMemberPicker() {
  const focusKey = state.memberPicker?.returnFocusKey || "";
  state.memberPicker = null;
  renderOverlayRegion(focusKey);
}

function setSignupMember(change, member) {
  change.newMemberId = member?.id || "";
  change.newValue = member?.displayName || change.newValue;
  change.match = member ? "manual" : "unmatched";
  change.requiresConfirmation = !member || Boolean(change.conflictGroup);
  change.selected = Boolean(member) && !change.overwrite && !change.conflictGroup;
}

async function applyMemberToTarget(target, member, returnFocusKey = "") {
  if (target.kind === "signup") {
    const change = signupChangeById(target.changeId);
    if (change) setSignupMember(change, member);
    renderOverlayRegion(returnFocusKey);
    return;
  }
  if (target.kind === "officer") {
    renderOverlayRegion();
    await updateOfficerRole(target.role, member?.id || "");
    elementForFocusKey(returnFocusKey)?.focus({ preventScroll: true });
    return;
  }
  if (target.kind === "item") {
    const item = state.meeting.blocks.flatMap((block) => block.items).find((candidate) => candidate.id === target.itemId);
    if (!item) return renderOverlayRegion();
    item[`${target.key}Id`] = member?.id || "";
    item[target.key] = member?.displayName || "";
    syncLinkedAgendaItem(item, target.key);
    markDirty();
    refreshStructure(`item:${item.id}:${target.key}`);
  } else if (target.kind === "meeting") {
    state.meeting[`${target.key}MemberId`] = member?.id || "";
    state.meeting[target.key] = member?.displayName || "";
    markDirty();
    withUiContinuity(() => render(), returnFocusKey);
    return;
  }
  renderOverlayRegion(returnFocusKey);
}

async function applyMemberPickerSelection(memberId) {
  const picker = state.memberPicker;
  if (!picker) return;
  const member = state.members.find((candidate) => candidate.id === memberId);
  state.memberPicker = null;
  await applyMemberToTarget(picker.target, member, picker.returnFocusKey);
}

function updateMemberPickerSearch(input) {
  const picker = state.memberPicker;
  if (!picker) return;
  picker.query = input.value;
  const results = input.closest(".member-picker-modal")?.querySelector(".member-picker-results");
  if (results) results.scrollTop = 0;
  let total = 0;
  ["members", "guests"].forEach((group) => {
    const section = input.closest(".member-picker-modal")?.querySelector(`[data-member-picker-group="${group}"]`);
    const options = [...(section?.querySelectorAll("[data-member-name]") || [])];
    let count = 0;
    options.forEach((option) => {
      option.hidden = !matchesMemberSearch(option.dataset.memberName, picker.query);
      if (!option.hidden) count += 1;
    });
    if (section) section.hidden = count === 0;
    const counter = section?.querySelector(`[data-member-group-count="${group}"]`);
    if (counter) counter.textContent = count;
    total += count;
  });
  const modal = input.closest(".member-picker-modal");
  const empty = modal?.querySelector("[data-member-picker-empty]");
  if (empty) empty.hidden = total > 0;
  const add = modal?.querySelector("[data-add-picker-guest] span");
  if (add) add.textContent = picker.query.trim() ? `Add “${picker.query.trim()}” as guest` : "Add guest…";
}

function navigateToIssue(issue) {
  if (!issue) return;
  state.activeView = "admin";
  state.activeStage = issue.stage;
  state.activeTask = issue.task;
  const itemId = issue.focusKey.match(/^item:([^:]+)/)?.[1];
  if (itemId) {
    const block = state.meeting.blocks.find((candidate) => candidate.items.some((item) => item.id === itemId));
    if (block) state.selectedBlockId = block.id;
  }
  render();
  elementForFocusKey(issue.focusKey)?.focus({ preventScroll: false });
}

function navigateFromPreview(blockId, itemId = "") {
  state.activeView = "admin";
  state.selectedBlockId = blockId;
  state.activeStage = "preparation";
  state.activeTask = "build-agenda";
  render();
  elementForFocusKey(itemId ? `item:${itemId}:session` : `block:${blockId}:title`)?.focus({ preventScroll: false });
}

async function handleDelegatedSubmit(event) {
  const form = event.target;
  if (form.matches("[data-print-form]")) {
    event.preventDefault();
    const copies = Math.min(50, Math.max(1, Number(new FormData(form).get("copies")) || 1));
    await printAgenda(copies, state.printPrompt);
  } else if (form.matches("[data-rename-template-form]")) {
    event.preventDefault();
    await renameTemplate(String(new FormData(form).get("name") || ""));
  } else if (form.matches("[data-template-form]")) {
    event.preventDefault();
    const name = String(new FormData(form).get("name") || "").trim();
    if (name) await saveTemplate(name);
  } else if (form.matches("[data-guest-form]")) {
    event.preventDefault();
    const displayName = String(new FormData(form).get("displayName") || "").trim();
    if (displayName.length < 2) return;
    state.guestPrompt.defaultName = displayName;
    if (!guestDisplayNameLooksStandard(displayName) && !state.guestPrompt.formatWarning) {
      state.guestPrompt.formatWarning = true;
      renderOverlayRegion();
      return;
    }
    await createGuestForTarget(displayName);
  } else if (form.matches("[data-role-form]")) {
    event.preventDefault();
    await createRoleForTarget(String(new FormData(form).get("name") || ""));
  }
}

function agendaPdfUrl() {
  if (!state.meeting) return "";
  return state.previewMode
    ? "/api/preview-agenda.pdf"
    : `/api/meetings/${encodeURIComponent(state.meeting.id)}?action=pdf`;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Could not read file."));
    reader.readAsDataURL(file);
  });
}

async function snapshotPdfImage(kind, image) {
  if (!image?.present) return image ? { ...image } : { ...EMPTY_IMAGE };
  if (image.url) return { ...image };
  const response = await fetch(imageUrl(kind, image), { credentials: "same-origin" });
  if (!response.ok) throw new Error(`Could not load ${kind} for the PDF.`);
  const blob = await response.blob();
  return { ...image, url: await fileToDataUrl(blob) };
}

async function buildAgendaPdfSnapshot() {
  const meeting = structuredClone(state.meeting);
  meeting.votingQr = await snapshotPdfImage("voting", meeting.votingQr);
  meeting.systemVotingQr = await snapshotPdfImage("voting-system", meeting.systemVotingQr);
  return {
    meeting,
    pathwaysCatalog: structuredClone(state.pathwaysCatalog),
    groupQr: await snapshotPdfImage("group", state.groupQr),
    paymentQr: await snapshotPdfImage("wechat-payment-qr", state.paymentQr),
    officerTeamPhoto: await snapshotPdfImage("officer-team", state.officerTeamPhoto),
  };
}

async function downloadAgendaPdf() {
  const url = agendaPdfUrl();
  if (!url || state.agendaPdfBusy) return;
  state.agendaPdfBusy = true;
  state.agendaPdfError = "";
  render();
  try {
    const response = await fetch(url, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ snapshot: await buildAgendaPdfSnapshot() }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      if (state.previewMode && response.status === 404) {
        throw new Error("Direct PDF download is unavailable in frontend-only preview. Run `npm run dev` to enable the local PDF API.");
      }
      throw new Error(body.message || "Could not create agenda PDF.");
    }
    const file = await response.blob();
    downloadFile(`Agenda-${state.meeting?.meetingNumber || "preview"}.pdf`, file, "application/pdf");
    notify("Agenda PDF downloaded.");
  } catch (error) {
    state.agendaPdfError = error.message || "Could not create agenda PDF.";
    notify(state.agendaPdfError);
  } finally {
    state.agendaPdfBusy = false;
    render();
  }
}

async function browserImageDimensions(file) {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return { width: image.naturalWidth, height: image.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function validateClientImage(file, { square = false, maxBytes = MAX_QR_IMAGE_BYTES, label = "image" } = {}) {
  if (!["image/jpeg", "image/png"].includes(file.type)) throw new Error("Choose a JPEG or PNG image.");
  if (!file.size) throw new Error("Choose a non-empty image.");
  if (file.size > maxBytes) throw new Error(`${label} must be ${Math.round(maxBytes / (1024 * 1024))} MB or smaller.`);
  const { width, height } = await browserImageDimensions(file);
  if (!width || !height) throw new Error("The selected image dimensions are invalid.");
  if (square && Math.abs(width - height) / Math.max(width, height) > 0.05) {
    throw new Error(`QR code images must be square or within 5% of 1:1. This image is ${width}×${height}.`);
  }
}

function fileDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result));
    reader.addEventListener("error", () => reject(new Error("The image could not be read.")));
    reader.readAsDataURL(file);
  });
}

async function compressClubIntroPhoto(file) {
  if (file.type !== "image/jpeg") return file;
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (Math.max(image.naturalWidth, image.naturalHeight) <= 1920 && file.size <= MAX_OFFICER_IMAGE_BYTES) return file;
    const scale = Math.min(1, 1920 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(image.naturalWidth * scale);
    canvas.height = Math.round(image.naturalHeight * scale);
    canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
    if (!blob) throw new Error("The club introduction photo could not be compressed.");
    return new File([blob], file.name, { type: "image/jpeg", lastModified: file.lastModified });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function mediaConflict(error) {
  if (error.status !== 409 || error.code !== "REVISION_CONFLICT") return false;
  state.conflict = { meetingId: state.meeting.id, currentRevision: error.details?.currentRevision };
  state.saveStatus = "conflict";
  return true;
}

async function uploadQrImage(kind, sourceFile) {
  try {
    const file = kind === "club-intro-photo" ? await compressClubIntroPhoto(sourceFile) : sourceFile;
    await validateClientImage(file, kind === "officer-team" || kind === "club-intro-photo" || kind === "wechat-payment-qr" || FUTURE_POSTER_KINDS.includes(kind)
      ? { maxBytes: MAX_OFFICER_IMAGE_BYTES, label: kind === "wechat-payment-qr" ? "WeChat payment images" : kind === "club-intro-photo" ? "Club introduction photos" : FUTURE_POSTER_KINDS.includes(kind) ? "Future meeting posters" : "Officer team images" }
      : { square: true, maxBytes: MAX_QR_IMAGE_BYTES, label: "QR code images" });
    state.imageBusy = kind;
    withUiContinuity(() => {
      renderMediaRegion();
      renderOfficerRegion();
    });

    if (state.previewMode) {
      const image = {
        present: true,
        name: file.name,
        type: file.type,
        size: file.size,
        version: String(Date.now()),
        url: await fileDataUrl(file),
      };
      if (kind === "voting") state.meeting.votingQr = image;
      else if (kind === "group") state.groupQr = image;
      else if (kind === "wechat-payment-qr") state.paymentQr = image;
      else if (kind === "officer-team") state.officerTeamPhoto = image;
      else if (kind === "club-intro-photo") state.clubIntroPhoto = image;
      else state.futurePosters[FUTURE_POSTER_KINDS.indexOf(kind)] = image;
      state.toast = kind === "club-intro-photo" ? "Club introduction photo loaded for this local preview." : FUTURE_POSTER_KINDS.includes(kind) ? "Future meeting poster loaded for this local preview." : kind === "officer-team" ? "Officer team image loaded for this local preview." : kind === "wechat-payment-qr" ? "WeChat payment image loaded for this local preview." : "QR code loaded for this local preview.";
      return;
    }

    if (kind === "voting") {
      await flushSave();
      if (["error", "conflict"].includes(state.saveStatus)) return;
      const body = await apiJson(`/api/meetings/${encodeURIComponent(state.meeting.id)}/images/voting`, {
        method: "POST",
        headers: {
          "Content-Type": file.type,
          "X-File-Name": encodeURIComponent(file.name),
          "X-Expected-Revision": String(state.meeting.revision || 0),
        },
        body: file,
      });
      state.meeting.votingQr = body.image;
      state.meeting.revision = body.revision;
      updateMeetingSummary(state.meeting);
      state.toast = "Voting QR code saved to Feishu Base.";
    } else if (kind === "group") {
      const body = await apiJson("/api/assets/group-qr", {
        method: "POST",
        headers: { "Content-Type": file.type, "X-File-Name": encodeURIComponent(file.name) },
        body: file,
      });
      state.groupQr = body.image;
      state.toast = "Global guest group QR code saved to Feishu Base.";
    } else {
      const assetKind = kind === "officer-team" ? "officer-team-photo" : kind;
      const body = await apiJson(`/api/assets/${assetKind}`, {
        method: "POST",
        headers: { "Content-Type": file.type, "X-File-Name": encodeURIComponent(file.name) },
        body: file,
      });
      if (kind === "officer-team") state.officerTeamPhoto = body.image;
      else if (kind === "wechat-payment-qr") state.paymentQr = body.image;
      else if (kind === "club-intro-photo") state.clubIntroPhoto = body.image;
      else state.futurePosters[FUTURE_POSTER_KINDS.indexOf(kind)] = body.image;
      state.toast = kind === "club-intro-photo" ? "Club introduction photo saved to Feishu Base." : FUTURE_POSTER_KINDS.includes(kind) ? "Future meeting poster saved to Feishu Base." : kind === "wechat-payment-qr" ? "WeChat payment image saved to Feishu Base." : "Global officer team image saved to Feishu Base.";
    }
  } catch (error) {
    if (!mediaConflict(error)) state.toast = error.message;
  } finally {
    state.imageBusy = "";
    withUiContinuity(() => {
      renderMediaRegion();
      renderOfficerRegion();
      renderPreviewRegion();
      renderValidationRegion();
      renderStatusRegion();
      renderToastRegion();
      renderOverlayRegion();
    });
  }
}

async function removeQrImage(kind) {
  if (!window.confirm(`Remove the ${kind === "voting" ? "voting" : kind === "group" ? "guest group" : kind === "wechat-payment-qr" ? "WeChat payment" : kind === "club-intro-photo" ? "club introduction" : FUTURE_POSTER_KINDS.includes(kind) ? "future meeting poster" : "officer team"} image?`)) return;
  state.imageBusy = kind;
  withUiContinuity(() => {
    renderMediaRegion();
    renderOfficerRegion();
  });
  try {
    if (state.previewMode) {
      if (kind === "voting") state.meeting.votingQr = { ...EMPTY_IMAGE };
      else if (kind === "group") state.groupQr = { ...EMPTY_IMAGE };
      else if (kind === "wechat-payment-qr") state.paymentQr = { ...EMPTY_IMAGE };
      else if (kind === "officer-team") state.officerTeamPhoto = { ...EMPTY_IMAGE };
      else if (kind === "club-intro-photo") state.clubIntroPhoto = { ...EMPTY_IMAGE };
      else state.futurePosters[FUTURE_POSTER_KINDS.indexOf(kind)] = { ...EMPTY_IMAGE };
      state.toast = kind === "club-intro-photo" ? "Club introduction photo removed from this local preview." : FUTURE_POSTER_KINDS.includes(kind) ? "Future meeting poster removed from this local preview." : kind === "officer-team" ? "Officer team image removed from this local preview." : kind === "wechat-payment-qr" ? "WeChat payment image removed from this local preview." : "QR code removed from this local preview.";
      return;
    }

    if (kind === "voting") {
      await flushSave();
      if (["error", "conflict"].includes(state.saveStatus)) return;
      const body = await apiJson(`/api/meetings/${encodeURIComponent(state.meeting.id)}/images/voting`, {
        method: "DELETE",
        headers: { "X-Expected-Revision": String(state.meeting.revision || 0) },
      });
      state.meeting.votingQr = body.image;
      state.meeting.revision = body.revision;
      updateMeetingSummary(state.meeting);
    } else if (kind === "group") {
      const body = await apiJson("/api/assets/group-qr", { method: "DELETE" });
      state.groupQr = body.image;
    } else {
      const assetKind = kind === "officer-team" ? "officer-team-photo" : kind;
      const body = await apiJson(`/api/assets/${assetKind}`, { method: "DELETE" });
      if (kind === "officer-team") state.officerTeamPhoto = body.image;
      else if (kind === "wechat-payment-qr") state.paymentQr = body.image;
      else if (kind === "club-intro-photo") state.clubIntroPhoto = body.image;
      else state.futurePosters[FUTURE_POSTER_KINDS.indexOf(kind)] = body.image;
    }
    state.toast = kind === "club-intro-photo" ? "Club introduction photo removed." : FUTURE_POSTER_KINDS.includes(kind) ? "Future meeting poster removed." : kind === "officer-team" ? "Officer team image removed." : kind === "wechat-payment-qr" ? "WeChat payment image removed." : "QR code removed.";
  } catch (error) {
    if (!mediaConflict(error)) state.toast = error.message;
  } finally {
    state.imageBusy = "";
    withUiContinuity(() => {
      renderMediaRegion();
      renderOfficerRegion();
      renderPreviewRegion();
      renderValidationRegion();
      renderStatusRegion();
      renderToastRegion();
      renderOverlayRegion();
    });
  }
}

async function addGuestForItem(item, key) {
  overlayReturnFocusKey = `item:${item.id}:${key}`;
  state.guestPrompt = { kind: "item", itemId: item.id, key };
  renderOverlayRegion();
}

async function addGuestForMeetingRole(key) {
  overlayReturnFocusKey = `meeting-role:${key}`;
  state.guestPrompt = { kind: "meeting", key };
  renderOverlayRegion();
}

function useGuestForSignup(prompt, member) {
  const change = signupChangeById(prompt.changeId);
  if (!change) return false;
  change.newMemberId = member.id;
  change.newValue = member.displayName;
  change.match = "guest";
  change.requiresConfirmation = Boolean(change.conflictGroup);
  change.selected = !change.overwrite && !change.conflictGroup;
  change.options = [{ id: member.id, displayName: member.displayName, source: "guest" }, ...(change.options || [])];
  return true;
}

async function createGuestForTarget(displayName) {
  const prompt = state.guestPrompt;
  if (!prompt) return;
  prompt.busy = true;
  prompt.error = "";
  renderOverlayRegion();
  try {
    let createdMember;
    if (state.previewMode) {
      createdMember = {
        id: uid("guest"),
        displayName,
        englishName: displayName,
        memberType: "guest_placeholder",
        active: true,
      };
      state.members = [...state.members, createdMember].sort((a, b) => a.displayName.localeCompare(b.displayName));
    } else {
      const { member } = await apiJson("/api/members", { method: "POST", body: JSON.stringify({ displayName }) });
      const latest = await apiJson("/api/members");
      state.members = latest.members;
      createdMember = state.members.find((candidate) => candidate.id === member.id) || member;
      if (!state.members.some((candidate) => candidate.id === createdMember.id)) state.members.push(createdMember);
    }
    if (prompt.kind === "signup") {
      if (!useGuestForSignup(prompt, createdMember)) throw new Error("Signup review changed. Reopen the member picker.");
      state.guestPrompt = null;
      renderOverlayRegion(overlayReturnFocusKey);
    } else {
      const target = prompt.kind === "picker" ? prompt.target : prompt.kind === "item"
        ? { kind: "item", itemId: prompt.itemId, key: prompt.key }
        : { kind: "meeting", key: prompt.key };
      state.guestPrompt = null;
      await applyMemberToTarget(target, createdMember, overlayReturnFocusKey);
    }
    overlayReturnFocusKey = "";
  } catch (error) {
    prompt.busy = false;
    prompt.error = error.message;
    state.guestPrompt = prompt;
    renderOverlayRegion();
  }
}

async function updateOfficerRole(role, memberId) {
  const assignments = officerAssignmentsFromMembers();
  assignments[role] = memberId;
  try {
    state.officerBusy = true;
    if (state.previewMode) {
      applyOfficerAssignments(assignments);
      refreshDerivedRegions();
      return;
    }
    const body = await apiJson("/api/members", {
      method: "PUT",
      body: JSON.stringify({ officers: assignments }),
    });
    state.members = body.members;
    refreshDerivedRegions();
  } catch (error) {
    notify(error.message);
  } finally {
    state.officerBusy = false;
    renderOfficerRegion();
  }
}

function moveInList(list, id, direction, focusKey = "") {
  const index = list.findIndex((entry) => entry.id === id);
  const next = index + direction;
  if (index < 0 || next < 0 || next >= list.length) return;
  [list[index], list[next]] = [list[next], list[index]];
  markDirty();
  refreshStructure(focusKey);
}

function addBlock() {
  const block = { id: uid("block"), type: "custom", title: "New Session", items: [] };
  state.meeting.blocks.push(block);
  state.selectedBlockId = block.id;
  markDirty();
  refreshStructure(`block:${block.id}:title`);
}

function duplicateBlock() {
  const source = selectedBlock();
  if (!source) return;
  const clone = structuredClone(source);
  clone.id = uid("block");
  clone.title = `${clone.title} Copy`;
  const itemIds = new Map(clone.items.map((item) => [item.id, uid("item")]));
  clone.items.forEach((item) => {
    item.id = itemIds.get(item.id);
    if (item.linkedSpeechId) item.linkedSpeechId = itemIds.get(item.linkedSpeechId) || "";
    if (item.roleAssignmentId) item.roleAssignmentId = `${item.roleAssignmentId}-${clone.id}`;
  });
  state.meeting.blocks.splice(state.meeting.blocks.indexOf(source) + 1, 0, clone);
  state.selectedBlockId = clone.id;
  markDirty();
  refreshStructure(`block:${clone.id}:title`);
}

function deleteBlock() {
  if (state.meeting.blocks.length === 1) return notify("An agenda needs at least one block.");
  const index = state.meeting.blocks.findIndex((block) => block.id === state.selectedBlockId);
  state.meeting.blocks.splice(index, 1);
  state.selectedBlockId = state.meeting.blocks[Math.max(0, index - 1)].id;
  markDirty();
  refreshStructure(`block:${state.selectedBlockId}:title`);
}

function addItem(kind) {
  const isBreak = kind === "break";
  const item = {
    id: uid("item"),
    kind,
    duration: isBreak ? 5 : kind === "speech" ? 7 : 3,
    session: isBreak ? "Break" : kind === "speech" ? "Prepared Speech" : "New Agenda Item",
    role: isBreak ? "" : kind === "speech" ? "Prepared Speaker" : "Role",
    member: "",
    evaluator: "",
    evaluatorStatus: kind === "speech" ? "vacant" : "",
    speechObjective: "",
    externalPresentationUrl: "",
    status: isBreak ? "" : "vacant",
  };
  selectedBlock().items.push(item);
  if (kind === "speech") {
    const evaluation = state.meeting.blocks.find((block) => block.type === "evaluation");
    if (evaluation) evaluation.items.push({
      id: uid("item"), kind: "role", duration: 3,
      session: `Speech Evaluation ${state.meeting.blocks.flatMap((block) => block.items).filter((candidate) => candidate.kind === "speech").length}`,
      role: "Individual Evaluator", member: "", memberId: "", status: "vacant", linkedSpeechId: item.id,
    });
  }
  markDirty();
  refreshStructure(`item:${item.id}:session`);
}

function deleteItem(itemId) {
  const items = selectedBlock().items;
  const index = items.findIndex((item) => item.id === itemId);
  if (index < 0) return;
  const [removed] = items.splice(index, 1);
  if (removed.kind === "speech") state.meeting.blocks.forEach((block) => {
    block.items = block.items.filter((item) => item.linkedSpeechId !== removed.id);
  });
  const next = items[Math.min(index, items.length - 1)];
  markDirty();
  refreshStructure(next ? `item:${next.id}:session` : `add-item:${removed.kind}`);
}

async function createNewMeeting() {
  overlayReturnFocusKey = "new-meeting";
  state.templatePrompt = true;
  renderOverlayRegion();
  ensureTemplates();
}

async function beforeCreateMeeting() {
  if (state.newMeetingCreating) return false;
  state.newMeetingCreating = true;
  renderOverlayRegion();
  await flushSave();
  if (["error", "conflict"].includes(state.saveStatus)) {
    state.newMeetingCreating = false;
    renderOverlayRegion();
    notify("Save the current meeting before creating another.");
    return false;
  }
  return true;
}

async function startNewMeetingFromSource(template = null) {
  if (!await beforeCreateMeeting()) return;
  const meetingNumber = nextMeetingNumber();
  const meeting = normalizeMeetingState(
    template ? meetingFromTemplate(template, meetingNumber) : meetingFromFinalized(defaultMeeting, meetingNumber),
  );
  assignMeetingPresident(meeting, state.members);
  meeting.enableTransitionTime = true;
  meeting.votingCode = `DEMO-${meetingNumber}`;
  state.meeting = meeting;
  state.selectedBlockId = state.meeting.blocks[0]?.id;
  state.templatePrompt = false;
  overlayReturnFocusKey = "";
  state.persisted = false;
  state.dirty = true;
  state.saveStatus = "saving";
  state.activeView = "advisor";
  state.activeStage = "preparation";
  state.activeTask = "meeting-details";
  state.advisorOriginLabel = "";
  render();
  await flushSave();
  state.newMeetingCreating = false;
  if (state.saveStatus === "saved") { render(); notify(`Meeting #${meetingNumber} created.`); void prewarmVotingForm(); }
}

async function startNewMeetingFromFinalized() {
  if (!await beforeCreateMeeting()) return;
  const summary = latestFinalizedMeetingSummary();
  if (!summary) { state.newMeetingCreating = false; renderOverlayRegion(); return notify("No finalized meeting is available to reuse."); }
  let source = state.meeting?.id === summary.id ? state.meeting : null;
  if (!source && !state.previewMode) {
    try {
      const body = await apiJson(`/api/meetings/${encodeURIComponent(summary.id)}`);
      source = body.meeting;
    } catch (error) {
      state.newMeetingCreating = false;
      renderOverlayRegion();
      return notify(error.message);
    }
  }
  if (!source) { state.newMeetingCreating = false; renderOverlayRegion(); return notify("The finalized meeting could not be loaded."); }
  const meetingNumber = nextMeetingNumber();
  state.meeting = assignMeetingPresident(normalizeMeetingState(meetingFromFinalized(source, meetingNumber)), state.members);
  state.selectedBlockId = state.meeting.blocks[0]?.id;
  state.templatePrompt = false;
  overlayReturnFocusKey = "";
  state.persisted = false;
  state.dirty = true;
  state.saveStatus = "saving";
  state.activeView = "advisor";
  state.activeStage = "preparation";
  state.activeTask = "meeting-details";
  state.advisorOriginLabel = "";
  render();
  await flushSave();
  state.newMeetingCreating = false;
  if (state.saveStatus === "saved") { render(); notify(`Meeting #${meetingNumber} created.`); void prewarmVotingForm(); }
}

async function renameTemplate(name) {
  const prompt = state.renameTemplatePrompt;
  const normalized = name.trim();
  if (!prompt || !normalized || normalized.length > 120 || state.templateBusy) return;
  state.templateBusy = true;
  renderOverlayRegion();
  try {
    const { template } = await apiJson(`/api/templates/${encodeURIComponent(prompt.id)}`, { method: "PUT", body: JSON.stringify({ name: normalized }) });
    state.templates = state.templates.map((candidate) => candidate.id === template.id ? template : candidate);
    state.renameTemplatePrompt = null;
    notify("Template renamed.");
  } catch (error) {
    notify(error.message);
  } finally {
    state.templateBusy = false;
    renderOverlayRegion();
  }
}

function openSaveTemplatePrompt() {
  overlayReturnFocusKey = "save-template";
  state.saveTemplatePrompt = {
    defaultName: `Meeting #${state.meeting.meetingNumber} Template · ${state.meeting.theme || "Untitled Agenda"}`,
  };
  renderOverlayRegion();
}

async function saveTemplate(name) {
  if (state.previewMode) return;
  await flushSave();
  if (["error", "conflict"].includes(state.saveStatus)) return;
  state.templateBusy = true;
  renderOverlayRegion();
  try {
    const body = await apiJson("/api/templates", {
      method: "POST",
      body: JSON.stringify(templateFromMeeting(state.meeting, name)),
    });
    state.templates.unshift(body.template);
    state.saveTemplatePrompt = false;
    notify("Agenda template saved to Feishu Base.");
  } catch (error) {
    notify(error.message);
  } finally {
    state.templateBusy = false;
    renderOverlayRegion(state.saveTemplatePrompt ? "" : overlayReturnFocusKey);
    if (!state.saveTemplatePrompt) overlayReturnFocusKey = "";
  }
}

function downloadFile(name, content, type) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([content], { type }));
  link.download = name;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 0);
}

function triggerBrowserDownload(url, name = "") {
  const link = document.createElement("a");
  link.href = url;
  if (name) link.download = name;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
}

function exportJson() {
  downloadFile(`meeting-${state.meeting.meetingNumber}.json`, JSON.stringify(state.meeting, null, 2), "application/json");
  notify("Canonical meeting JSON exported.");
}

async function exportSummary() {
  const lines = [
    `Demo Speaking Club #${state.meeting.meetingNumber}`,
    `${state.meeting.date} ${state.meeting.startTime}`,
    `Theme: ${state.meeting.theme}`,
    `WOD: ${state.meeting.wordOfDay.word}`,
    "",
    ...getTimeline().map((item) => `${item.start} · ${item.session} · ${item.role}: ${item.member || "Vacant"}`),
  ];
  const summary = lines.join("\n");
  try {
    await navigator.clipboard.writeText(summary);
    notify("Group summary copied to clipboard.");
  } catch {
    downloadFile(`meeting-${state.meeting.meetingNumber}-summary.txt`, summary, "text/plain");
    notify("Group summary downloaded.");
  }
}

async function apiJson(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.message || "Request failed.");
    error.status = response.status;
    error.code = body.code;
    error.details = body.details;
    throw error;
  }
  return body;
}

function candidateResetMessage(details) {
  const changes = details?.candidateChanges || {};
  const lines = [
    ...(changes.added || []).map((item) => `+ ${item.award}: ${item.label}`),
    ...(changes.removed || []).map((item) => `− ${item.award}: ${item.label}`),
  ];
  return `Candidate changes:\n${lines.join("\n") || "Candidate list updated"}\n\nConfirming this change will permanently delete all ${details?.responseCount || 0} existing responses and update the voting form.`;
}

async function withCandidateResetConfirmation(request) {
  try {
    return await request(false);
  } catch (error) {
    if (error.code !== "VOTING_RESPONSE_RESET_REQUIRED") throw error;
    if (!window.confirm(candidateResetMessage(error.details))) return null;
    return request(true);
  }
}

async function runVotingAction(action) {
  await flushSave();
  if (["error", "conflict"].includes(state.saveStatus)) return;
  const issues = roleAwardIssues(state.meeting);
  if ((action === "prepare" || action === "sync") && issues.blockers.length) return notify(issues.blockers.join(" "));
  state.votingBusy = action;
  state.votingProgress = action === "prepare" ? "Checking existing voting resources…" : action === "sync" ? "Updating candidates…" : "";
  renderMediaRegion();
  const progressTimers = [
    window.setTimeout(() => { if (state.votingBusy === action) { state.votingProgress = "Updating Feishu form fields…"; renderMediaRegion(); } }, 3000),
    window.setTimeout(() => { if (state.votingBusy === action) { state.votingProgress = "Finishing QR code and permissions…"; renderMediaRegion(); } }, 8000),
  ];
  try {
    const base = `/api/meetings/${encodeURIComponent(state.meeting.id)}/voting`;
    if (action === "prepare") await timedVotingRequest(`${base}?action=prepare`, { method: "POST", body: "{}" });
    else if (action === "sync") {
      const result = await withCandidateResetConfirmation((confirmResponseReset) => timedVotingRequest(`${base}?action=sync`, {
        method: "POST",
        body: JSON.stringify({ confirmResponseReset }),
      }));
      if (!result) return;
      state.toast = result.clearedResponses ? `Voting form updated. ${result.clearedResponses} responses deleted.` : "Voting form updated.";
    }
    else if (action === "authorize") {
      const result = await apiJson(`${base}?action=authorize`, { method: "POST", body: "{}" });
      state.meeting.votingForm = result.votingForm;
      state.toast = result.votingForm.authorization?.status === "ready" ? "Voting table editors authorized." : result.votingForm.authorization?.message;
    }
    else if (action === "clear") {
      const status = await apiJson(`${base}?action=status`);
      if (!window.confirm(`Delete ${status.responseCount} responses? This cannot be undone.`)) return;
      const result = await apiJson(`${base}?action=responses`, { method: "DELETE" });
      state.toast = `${result.deleted} responses deleted.`;
      state.votingResults = null;
    } else state.votingResults = await apiJson(`${base}?action=results`);
    if (action === "prepare" || action === "sync") {
      const { meeting } = await apiJson(`/api/meetings/${encodeURIComponent(state.meeting.id)}`);
      state.meeting = normalizeMeetingState(meeting);
      if (action === "prepare") state.toast = "Voting form ready.";
    }
  } catch (error) { state.toast = error.message; }
  finally { progressTimers.forEach(window.clearTimeout); state.votingBusy = ""; state.votingProgress = ""; renderMediaRegion(); renderPreviewRegion(); renderToastRegion(); }
}

async function prewarmVotingForm() {
  if (state.previewMode || state.votingBusy || state.meeting.qrSource !== "system") return;
  const diff = votingCandidateDiff();
  if (state.meeting.votingForm?.formId && !diff.needsUpdate) return;
  await flushSave();
  if (["error", "conflict"].includes(state.saveStatus)) return;
  const issues = roleAwardIssues(state.meeting);
  if (issues.blockers.length) return notify(issues.blockers.join(" "));
  const meetingId = state.meeting.id;
  state.votingBusy = "prewarm";
  state.votingProgress = "Claiming a prebuilt voting form…";
  renderMediaRegion();
  const timers = [
    window.setTimeout(() => { if (state.votingBusy === "prewarm") { state.votingProgress = "Syncing current candidates…"; renderMediaRegion(); } }, 3000),
    window.setTimeout(() => { if (state.votingBusy === "prewarm") { state.votingProgress = "Finishing voting QR and access…"; renderMediaRegion(); } }, 8000),
  ];
  try {
    await apiJson(`/api/meetings/${encodeURIComponent(meetingId)}/voting?action=prepare`, { method: "POST", body: "{}" });
    const { meeting } = await apiJson(`/api/meetings/${encodeURIComponent(meetingId)}`);
    if (state.meeting.id === meetingId) {
      state.meeting.votingForm = meeting.votingForm;
      state.meeting.systemVotingQr = meeting.systemVotingQr;
      state.meeting.qrSource = meeting.qrSource;
      updateMeetingSummary(meeting);
      state.toast = "Voting form prepared ahead of time.";
    }
  } catch (error) {
    if (state.meeting.id === meetingId) state.toast = `Voting prebuild failed · ${error.message}`;
  } finally {
    timers.forEach(window.clearTimeout);
    if (state.meeting.id === meetingId) {
      state.votingBusy = "";
      state.votingProgress = "";
      renderMediaRegion(); renderPreviewRegion(); renderToastRegion();
      if (state.activeView === "advisor") await loadAwards({ quiet: true });
    }
  }
}

async function timedVotingRequest(url, options) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15000);
  try { return await apiJson(url, { ...options, signal: controller.signal }); }
  catch (error) {
    if (error.name === "AbortError") throw new Error("Voting form update exceeded 15 seconds. Retry is safe and reuses existing resources.");
    throw error;
  } finally { window.clearTimeout(timeout); }
}

async function saveTableTopicsSpeakers() {
  if (!state.tableTopicsDraftDirty || state.votingBusy) return;
  state.votingBusy = "speakers";
  renderMediaRegion();
  try {
    const speakers = [...new Set(state.tableTopicsDraft.split(/\r?\n/).map((name) => name.trim()).filter(Boolean))];
    const base = `/api/meetings/${encodeURIComponent(state.meeting.id)}/voting`;
    const result = await withCandidateResetConfirmation((confirmResponseReset) => apiJson(`${base}?action=speakers`, {
      method: "PUT",
      body: JSON.stringify({ speakers, confirmResponseReset, tableId: state.meeting.votingForm?.tableId || "" }),
    }));
    if (!result) return;
    state.meeting.tableTopicsSpeakers = result.tableTopicsSpeakers;
    state.meeting.votingForm = result.votingForm;
    state.tableTopicsDraft = result.tableTopicsSpeakers.join("\n");
    state.tableTopicsDraftDirty = false;
    state.votingResults = null;
    state.awards = null;
    state.awardsError = "";
    state.toast = result.awardsNeedReconfirmation
      ? "⚠ Speakers and voting form updated. Reconfirm awards before presenting."
      : result.clearedResponses
        ? `Speakers updated. ${result.clearedResponses} responses deleted.`
        : "Table Topics speakers saved. Voting form updated.";
  } catch (error) { state.toast = error.message; }
  finally { state.votingBusy = ""; renderMediaRegion(); renderPreviewRegion(); renderToastRegion(); }
}

async function loadAwards({ quiet = false } = {}) {
  if (state.previewMode || !state.meeting) return;
  const meetingId = state.meeting.id;
  state.awardsBusy = true;
  state.awardsTip = !quiet;
  state.awardsError = "";
  renderAwardsRegion("awards-refresh");
  renderSaaQuickActionsRegion();
  try {
    const awards = await apiJson(`/api/meetings/${encodeURIComponent(meetingId)}/awards`);
    if (state.meeting?.id === meetingId) state.awards = awards;
  } catch (error) {
    if (state.meeting?.id === meetingId) {
      state.awardsError = error.message;
      if (!quiet) state.toast = error.message;
    }
  } finally {
    if (state.meeting?.id === meetingId) {
      state.awardsBusy = false;
      state.awardsTip = false;
      renderAwardsRegion("awards-refresh");
      renderSaaQuickActionsRegion();
      renderToastRegion();
    }
  }
}

function stopVotingConsoleRefresh() {
  window.clearTimeout(votingConsoleTimer);
  votingConsoleTimer = null;
}

function scheduleVotingConsoleRefresh() {
  stopVotingConsoleRefresh();
  if (!state.votingConsole.open || state.votingConsole.phase !== "live" || document.hidden) return;
  votingConsoleTimer = window.setTimeout(() => refreshVotingConsole(), 5000);
}

async function refreshVotingConsole() {
  if (!state.votingConsole.open || !state.meeting) return;
  const meetingId = state.meeting.id;
  state.votingConsole.busy = true;
  renderOverlayRegion();
  try {
    state.awards = await apiJson(`/api/meetings/${encodeURIComponent(meetingId)}/awards`);
    state.votingConsole.error = "";
    state.votingConsole.loadedAt = new Date().toISOString();
  } catch (error) {
    state.votingConsole.error = error.message;
  } finally {
    if (state.meeting?.id === meetingId && state.votingConsole.open) {
      state.votingConsole.busy = false;
      renderOverlayRegion();
      renderSaaQuickActionsRegion();
      scheduleVotingConsoleRefresh();
    }
  }
}

async function openVotingConsole() {
  overlayReturnFocusKey = "";
  state.votingConsole = {
    open: true,
    phase: "live",
    busy: false,
    error: "",
    loadedAt: "",
    operator: votingHostName() || state.awards?.confirmedAwards?.confirmedBy?.name || "",
  };
  renderOverlayRegion();
  await refreshVotingConsole();
}

function closeVotingConsole() {
  stopVotingConsoleRefresh();
  state.votingConsole.open = false;
  renderOverlayRegion();
}

async function postAwardConfirmation(operatorName, expectedResultsVersion) {
  const result = await apiJson(`/api/meetings/${encodeURIComponent(state.meeting.id)}/awards`, {
    method: "POST",
    body: JSON.stringify({ expectedRevision: state.meeting.revision, expectedResultsVersion, operator: { name: operatorName } }),
  });
  state.awards = { ...state.awards, ...result, resultsChanged: false, newResponseCount: 0 };
  if (state.meeting.votingForm) state.meeting.votingForm.awardsNeedReconfirmation = false;
  return result;
}

async function reviewVotingConsoleResults() {
  await refreshVotingConsole();
  if (state.votingConsole.error || !state.awards?.ready) return;
  stopVotingConsoleRefresh();
  state.votingConsole.phase = "review";
  renderOverlayRegion();
}

async function confirmVotingConsoleResults() {
  const operatorName = state.votingConsole.operator.trim();
  if (!operatorName) return;
  await flushSave();
  if (state.dirty || state.saveStatus !== "saved") return notify("Save the meeting before confirming results.");
  state.votingConsole.busy = true;
  renderOverlayRegion();
  try {
    await postAwardConfirmation(operatorName, state.awards?.resultsVersion);
    stopVotingConsoleRefresh();
    state.votingConsole.phase = "confirmed";
    state.toast = "Award page is ready.";
  } catch (error) {
    state.toast = error.message;
    if (error.code === "VOTING_RESULTS_CHANGED") {
      state.votingConsole.phase = "live";
      await refreshVotingConsole();
    }
  } finally {
    state.votingConsole.busy = false;
    renderOverlayRegion();
    renderSaaQuickActionsRegion();
    renderToastRegion();
  }
}

async function confirmAwardResults() {
  await flushSave();
  if (state.dirty || state.saveStatus !== "saved") return notify("Save the meeting successfully before confirming awards.");
  const reconfirming = Boolean(state.awards?.confirmedAwards);
  const summary = state.awards.results.map((result) => `${result.title}: ${result.winners.map((winner) => winner.name).join(", ") || "no certificate"}`).join("\n");
  if (!window.confirm(`${reconfirming ? "Reconfirm" : "Confirm"} this frozen result?\n\n${summary}\n\nThe award page will use this snapshot.`)) return;
  const operatorName = window.prompt("Your name for the confirmation audit log:", state.awards?.confirmedAwards?.confirmedBy?.name || "")?.trim();
  if (!operatorName) return;
  state.awardsBusy = true;
  state.awardsTip = true;
  renderAwardsRegion("awards-confirm");
  try {
    await postAwardConfirmation(operatorName, state.awards?.resultsVersion);
    state.toast = "Award page is ready.";
  } catch (error) {
    state.toast = error.details?.recovery ? `${error.message} ${error.details.recovery}` : error.message;
  } finally {
    state.awardsBusy = false;
    state.awardsTip = false;
    renderAwardsRegion("awards-confirm");
    renderToastRegion();
  }
}

async function saveMeetingReview(action) {
  await flushSave();
  if (state.dirty || state.saveStatus === "error" || state.saveStatus === "conflict") return notify("Save the meeting successfully before completing review.");
  if (action === "skip" && !String(state.meeting.review?.skippedReason || "").trim()) return notify("Skip reason is required.");
  state.reviewBusy = action;
  replaceRegion("review", renderMeetingReviewTask());
  speakingTips.start();
  try {
    const result = await apiJson(`/api/meetings/${encodeURIComponent(state.meeting.id)}/review`, {
      method: "PUT",
      body: JSON.stringify({ action, review: state.meeting.review, context: reviewContext() }),
    });
    state.meeting.review = result.review;
    state.meeting.reviewStatus = result.reviewStatus;
    state.meeting.qualityScore = result.qualityScore;
    state.meeting.qualityMetrics = result.qualityMetrics;
    state.meeting.reviewCompletedAt = result.reviewCompletedAt;
    state.toast = action === "skip" ? "Review skipped." : "Review completed.";
  } catch (error) {
    state.toast = error.message;
  } finally {
    state.reviewBusy = "";
    replaceRegion("review", renderMeetingReviewTask());
    speakingTips.start();
    renderToastRegion();
  }
}

function updateMeetingSummary(meeting) {
  const summary = {
    id: meeting.id,
    meetingNumber: meeting.meetingNumber,
    date: meeting.date,
    startTime: meeting.startTime,
    theme: meeting.theme,
    status: meeting.status,
    revision: meeting.revision,
  };
  const index = state.meetings.findIndex((candidate) => candidate.id === meeting.id);
  if (index >= 0) state.meetings[index] = summary;
  else state.meetings.push(summary);
  state.meetings = sortMeetingsForPicker(state.meetings);
}

async function flushSave() {
  window.clearTimeout(saveTimer);
  saveTimer = null;
  if (state.previewMode) {
    state.saveStatus = "saved";
    updateMeetingSummary(state.meeting);
    renderNavigatorRegion();
    renderStatusRegion();
    return;
  }
  if (!state.authenticated || !state.meeting || state.conflict) return;
  if (state.persisted && !state.dirty) return;
  if (savePromise) {
    await savePromise;
    if (state.dirty && !state.conflict && state.saveStatus !== "error") return flushSave();
    return;
  }

  const snapshot = structuredClone(state.meeting);
  const savedMutationVersion = state.mutationVersion;
  const wasPersisted = state.persisted;
  state.saveStatus = "saving";
  renderStatusRegion();

  savePromise = (async () => {
    try {
      const body = wasPersisted
        ? await apiJson(`/api/meetings/${encodeURIComponent(snapshot.id)}`, {
            method: "PUT",
            body: JSON.stringify({ meeting: snapshot, expectedRevision: snapshot.revision || 0 }),
          })
        : await apiJson("/api/meetings", { method: "POST", body: JSON.stringify({ meeting: snapshot }) });
      state.persisted = true;
      state.dirty = state.mutationVersion > savedMutationVersion;
      state.meeting.revision = body.meeting.revision;
      state.meeting.votingQr = body.meeting.votingQr || state.meeting.votingQr || { ...EMPTY_IMAGE };
      state.savedAt = new Date();
      state.saveStatus = state.dirty ? "saving" : "saved";
      state.saveError = "";
      updateMeetingSummary({ ...body.meeting, ...state.meeting, revision: body.meeting.revision });
      if (state.dirty) saveLocalDraft();
      else clearLocalDraft(snapshot.id);
    } catch (error) {
      if (error.status === 409 && error.code === "REVISION_CONFLICT") {
        state.conflict = { meetingId: snapshot.id, currentRevision: error.details?.currentRevision };
        state.saveStatus = "conflict";
      } else {
        state.saveStatus = "error";
        state.saveError = error.message;
      }
    } finally {
      savePromise = null;
    }
  })();

  await savePromise;
  if (state.mutationVersion > savedMutationVersion && !state.conflict) {
    state.saveStatus = "saving";
    saveTimer = window.setTimeout(flushSave, 800);
  }
  renderStatusRegion();
  renderNavigatorRegion();
}

async function loadMeetingFromCloud(meetingId) {
  await flushSave();
  if (["error", "conflict"].includes(state.saveStatus)) return;
  stopVotingConsoleRefresh();
  state.votingConsole.open = false;
  state.loading = true;
  state.showLoadingTip = true;
  render();
  try {
    const { meeting } = await apiJson(`/api/meetings/${encodeURIComponent(meetingId)}`);
    const draft = localDraft(meetingId);
    const useDraft = draft && Number(draft.revision || 0) === Number(meeting.revision || 0);
    if (draft && !useDraft) clearLocalDraft(meetingId);
    state.meeting = normalizeMeetingState({ ...(useDraft ? draft : meeting), votingQr: meeting.votingQr || draft?.votingQr || { ...EMPTY_IMAGE } });
    state.selectedBlockId = state.meeting.blocks[0]?.id;
    state.persisted = true;
    state.dirty = Boolean(useDraft);
    state.saveStatus = useDraft ? "saving" : "saved";
    state.savedAt = new Date();
    state.mutationVersion = 0;
    state.awards = null;
    state.awardsError = "";
    state.activeView = "advisor";
    state.activeStage = "preparation";
    state.activeTask = state.meeting.status === "final" ? "review-share" : "meeting-details";
    state.advisorOriginLabel = "";
    state.advisorExpanded = { next: false, risk: false };
    state.signupGeneration = emptySignupGeneration();
  } catch (error) {
    state.toast = error.message;
  } finally {
    state.loading = false;
    state.showLoadingTip = false;
    render();
  }
  if (state.meeting?.id === meetingId && state.dirty) {
    saveLocalDraft();
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(flushSave, 0);
  }
  if (state.meeting?.id === meetingId) await loadAwards({ quiet: true });
}

async function loadWorkspace() {
  state.loading = true;
  state.showLoadingTip = true;
  render();
  try {
    const { meetings } = await apiJson("/api/meetings");
    state.meetings = sortMeetingsForPicker(meetings);
    loadDeferredWorkspaceData();
    const localMeeting = loadLocalMeeting();
    state.migrationPrompt = Boolean(localMeeting && !localStorage.getItem(MIGRATION_KEY));
    state.loading = false;
    state.showLoadingTip = false;
    if (state.migrationPrompt && !meetings.length) {
      render();
      return;
    }
    state.meeting = null;
    render();
  } catch (error) {
    state.loading = false;
    state.showLoadingTip = false;
    state.toast = error.message;
    render();
  }
}

async function loadGuestMeeting(meetingNumber) {
  state.loading = true;
  state.showLoadingTip = false;
  render();
  try {
    const { meeting } = await apiJson(`/api/meetings/${encodeURIComponent(meetingNumber)}?view=guest`);
    state.meeting = meeting;
  } catch (error) {
    state.toast = error.message;
  } finally {
    state.loading = false;
    render();
  }
}

async function openGuestWorkspace() {
  state.loading = true;
  state.showLoadingTip = false;
  render();
  try {
    const { meetings } = await apiJson("/api/meetings?view=guest");
    state.guestMeetings = meetings;
    state.guestMode = true;
    state.meeting = null;
    if (meetings[0]) {
      const body = await apiJson(`/api/meetings/${encodeURIComponent(meetings[0].meetingNumber)}?view=guest`);
      state.meeting = body.meeting;
    }
  } catch (error) {
    state.guestMode = false;
    state.toast = error.message;
  } finally {
    state.loading = false;
    render();
  }
}

async function loadDeferredWorkspaceData() {
  state.membersLoading = true;
  state.templatesLoading = true;
  const results = await Promise.allSettled([
    loadRoles(),
    apiJson("/api/members").then(({ members }) => { state.members = members; }),
    apiJson("/api/templates").then(({ templates }) => { state.templates = templates; }),
    apiJson("/api/pathways-catalog?includeInactive=1").then(({ catalog }) => { state.pathwaysCatalog = catalog; }),
    apiJson("/api/assets/group-qr?metadata=1").then(({ image }) => { state.groupQr = image || { ...EMPTY_IMAGE }; }),
    apiJson("/api/assets/wechat-payment-qr?metadata=1").then(({ image }) => { state.paymentQr = image || { ...EMPTY_IMAGE }; }),
    apiJson("/api/assets/officer-team-photo?metadata=1").then(({ image }) => { state.officerTeamPhoto = image || { ...EMPTY_IMAGE }; }),
    apiJson("/api/assets/club-intro-photo?metadata=1").then(({ image }) => { state.clubIntroPhoto = image || { ...EMPTY_IMAGE }; }),
    ...FUTURE_POSTER_KINDS.map((kind, index) => apiJson(`/api/assets/${kind}?metadata=1`).then(({ image }) => { state.futurePosters[index] = image || { ...EMPTY_IMAGE }; })),
  ]);
  state.membersLoading = false;
  state.templatesLoading = false;
  const failed = results.find((result) => result.status === "rejected");
  if (failed) state.toast = failed.reason?.message || "Some workspace data could not be loaded.";
  if (!state.authenticated) return;
  if (!state.meeting) {
    renderOverlayRegion();
    renderToastRegion();
    return;
  }
  renderMediaRegion();
  renderOfficerRegion();
  renderBlockEditorRegion();
  renderSaaQuickActionsRegion();
  renderPreviewRegion();
  renderOverlayRegion();
  renderToastRegion();
}

async function loadRoles() {
  state.rolesLoading = true;
  state.rolesError = "";
  if (state.meeting) renderBlockEditorRegion();
  try {
    const { roles } = await apiJson("/api/roles");
    state.roles = roles;
  } catch (error) {
    state.rolesError = error.message;
  } finally {
    state.rolesLoading = false;
    if (state.meeting) renderBlockEditorRegion();
  }
}

async function createRoleForTarget(value) {
  if (!state.rolePrompt || state.rolePrompt.busy) return;
  state.rolePrompt.name = value.trim().replace(/ {2,}/g, " ");
  state.rolePrompt.error = "";
  state.rolePrompt.busy = true;
  renderOverlayRegion();
  try {
    const result = await apiJson("/api/roles", {
      method: "POST",
      body: JSON.stringify({ name: state.rolePrompt.name }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!state.roles.some((role) => role.name === result.role.name)) state.roles.push(result.role);
    state.roles.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
    const item = allAgendaItems().find((candidate) => candidate.id === state.rolePrompt.itemId);
    if (!item) throw new Error("Agenda item is no longer available.");
    const previousRoleId = item.roleId;
    item.role = result.role.name;
    item.roleId = roleIdentity(item.role).id;
    autofillAgendaOfficer(item, item.role);
    syncLinkedAgendaItem(item, "role", previousRoleId);
    const focusKey = `item:${item.id}:role`;
    state.rolePrompt = null;
    overlayReturnFocusKey = "";
    markDirty();
    renderOverlayRegion();
    refreshStructure(focusKey);
    notify(result.created ? `${result.role.name} added to RoleCatalog.` : `Using existing role ${result.role.name}.`);
  } catch (error) {
    state.rolePrompt.busy = false;
    state.rolePrompt.error = ["AbortError", "TimeoutError"].includes(error.name) ? "Sync timed out. Retry." : error.message;
    renderOverlayRegion();
  }
}

async function ensureTemplates() {
  if (state.templates.length || state.templatesLoading || state.previewMode) return;
  state.templatesLoading = true;
  renderOverlayRegion();
  try {
    const { templates } = await apiJson("/api/templates");
    state.templates = templates;
  } catch (error) {
    notify(error.message);
  } finally {
    state.templatesLoading = false;
    renderOverlayRegion();
  }
}

function loadPreviewWorkspace(message = "") {
  state.previewMode = true;
  state.authenticated = true;
  state.loading = false;
  state.members = [
    { id: "preview-taylor", displayName: "Taylor LEE, TM", memberType: "member", active: true },
    { id: "preview-morgan", displayName: "Morgan PARK, PM", memberType: "member", active: true },
    { id: "preview-casey", displayName: "Casey KIM, PM5", memberType: "member", active: true },
    { id: "preview-alex", displayName: "Alex CHEN, TM", memberType: "member", active: true },
  ];
  state.meeting = normalizeMeetingState(freshMeeting(defaultMeeting, defaultMeeting.meetingNumber));
  state.selectedBlockId = state.meeting.blocks[0].id;
  state.meetings = [{
    id: state.meeting.id,
    meetingNumber: state.meeting.meetingNumber,
    date: state.meeting.date,
    startTime: state.meeting.startTime,
    theme: state.meeting.theme,
    status: state.meeting.status,
    revision: state.meeting.revision,
  }];
  state.templates = [];
  state.membersLoading = false;
  state.templatesLoading = false;
  state.officerTeamPhoto = { ...EMPTY_IMAGE };
  state.paymentQr = { ...EMPTY_IMAGE };
  state.futurePosters = FUTURE_POSTER_KINDS.map(() => ({ ...EMPTY_IMAGE }));
  state.clubIntroPhoto = { ...EMPTY_IMAGE };
  state.persisted = true;
  state.dirty = false;
  state.saveStatus = "saved";
  state.toast = message;
  state.activeView = "advisor";
  state.activeStage = "preparation";
  state.activeTask = "meeting-details";
  state.advisorOriginLabel = "";
  state.signupImport = emptySignupImport();
  state.signupGeneration = emptySignupGeneration();
  render();
}

function loadPdfSnapshotWorkspace(snapshot) {
  state.previewMode = true;
  state.authenticated = true;
  state.loading = false;
  state.pathwaysCatalog = snapshot.pathwaysCatalog || null;
  state.groupQr = snapshot.groupQr || { ...EMPTY_IMAGE };
  state.paymentQr = snapshot.paymentQr || { ...EMPTY_IMAGE };
  state.officerTeamPhoto = snapshot.officerTeamPhoto || { ...EMPTY_IMAGE };
  state.meeting = normalizeMeetingState(snapshot.meeting);
  state.selectedBlockId = state.meeting.blocks[0]?.id || "";
  state.persisted = true;
  state.dirty = false;
  state.saveStatus = "saved";
  state.activeView = "admin";
  state.mobileView = "preview";
  state.activeStage = "preparation";
  state.activeTask = "review-share";
  render();
}

async function openWorkspace() {
  const health = await apiJson("/api/health");
  if (health.persistence === "local-only") {
    loadPreviewWorkspace("Local preview mode: changes are not saved to Feishu.");
    return;
  }
  await loadWorkspace();
  const params = new URLSearchParams(window.location.search);
  const meetingNumber = Number(params.get("meeting"));
  if (params.get("view") !== "admin" || params.get("task") !== "future-posters" || !Number.isInteger(meetingNumber) || meetingNumber < 1) return;
  const target = state.meetings.find((meeting) => meeting.meetingNumber === meetingNumber);
  if (!target) {
    state.toast = `Meeting #${meetingNumber} was not found.`;
    render();
    return;
  }
  await loadMeetingFromCloud(target.id);
  if (state.meeting?.id !== target.id) return;
  state.activeView = "admin";
  state.activeStage = "preparation";
  state.activeTask = "future-posters";
  render();
}

function bindLogin() {
  const form = document.querySelector("[data-login-form]");
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const errorNode = form.querySelector("[data-login-error]");
    const button = form.querySelector("button");
    button.disabled = true;
    errorNode.textContent = "";
    try {
      await apiJson("/api/session", { method: "POST", body: JSON.stringify({ passcode: new FormData(form).get("passcode") }) });
      state.authenticated = true;
      await openWorkspace();
    } catch (error) {
      errorNode.textContent = error.message;
      button.disabled = false;
    }
  });
}

async function saveConflictCopy() {
  state.meeting = normalizeMeetingState(freshMeeting(state.meeting, nextMeetingNumber()));
  state.selectedBlockId = state.meeting.blocks[0].id;
  state.conflict = null;
  state.persisted = false;
  state.dirty = true;
  state.saveStatus = "saving";
  state.activeView = "advisor";
  state.activeStage = "preparation";
  state.activeTask = "meeting-details";
  state.advisorOriginLabel = "";
  render();
  await flushSave();
}

async function importLocalMeeting() {
  const source = loadLocalMeeting();
  if (!source) return;
  const existingNumbers = new Set(state.meetings.map((meeting) => meeting.meetingNumber));
  const nextNumber = existingNumbers.has(Number(source.meetingNumber))
    ? Math.max(0, ...existingNumbers) + 1
    : Number(source.meetingNumber);
  state.meeting = normalizeMeetingState(freshMeeting(source, nextNumber));
  state.selectedBlockId = state.meeting.blocks[0].id;
  state.persisted = false;
  state.dirty = true;
  state.migrationPrompt = false;
  state.saveStatus = "saving";
  state.activeView = "advisor";
  state.activeStage = "preparation";
  state.activeTask = "meeting-details";
  state.advisorOriginLabel = "";
  render();
  await flushSave();
  if (state.saveStatus === "saved") localStorage.setItem(MIGRATION_KEY, "imported");
}

async function signOut() {
  await flushSave();
  await apiJson("/api/session", { method: "DELETE" }).catch(() => {});
  state.authenticated = false;
  state.meeting = null;
  state.meetings = [];
  state.templates = [];
  state.members = [];
  state.pathwaysCatalog = null;
  state.pathwaysDrafts = {};
  state.roles = [];
  state.rolesLoading = false;
  state.rolesError = "";
  state.rolePrompt = null;
  state.guestPrompt = null;
  state.memberPicker = null;
  state.printPrompt = null;
  state.signupImport = emptySignupImport();
  state.signupGeneration = emptySignupGeneration();
  state.membersLoading = false;
  state.templatesLoading = false;
  state.awardsTip = false;
  state.showLoadingTip = false;
  state.groupQr = { ...EMPTY_IMAGE };
  state.paymentQr = { ...EMPTY_IMAGE };
  state.officerTeamPhoto = { ...EMPTY_IMAGE };
  state.futurePosters = FUTURE_POSTER_KINDS.map(() => ({ ...EMPTY_IMAGE }));
  state.clubIntroPhoto = { ...EMPTY_IMAGE };
  state.loading = false;
  render();
}

async function bootstrap() {
  const pdfSnapshot = window.__AGENDA_PDF_SNAPSHOT__;
  const previewParams = new URLSearchParams(window.location.search);
  const pdfMeetingId = previewParams.get("pdfMeeting");
  if (pdfSnapshot?.meeting) {
    loadPdfSnapshotWorkspace(pdfSnapshot);
    return;
  }
  if (import.meta.env.DEV && previewParams.has("preview")) {
    loadPreviewWorkspace();
    if (previewParams.has("pdf")) {
      state.activeView = "admin";
      state.mobileView = "preview";
      state.activeTask = "review-share";
      render();
    }
    return;
  }
  if (pdfMeetingId) {
    state.loading = true;
    render();
    try {
      const session = await apiJson("/api/session");
      state.authenticated = session.authenticated;
      if (state.authenticated) {
        await loadMeetingFromCloud(pdfMeetingId);
        if (state.meeting) {
          state.activeView = "admin";
          state.mobileView = "preview";
          state.activeStage = "preparation";
          state.activeTask = "review-share";
          render();
        }
      } else {
        state.loading = false;
        render();
      }
    } catch {
      state.loading = false;
      render();
    }
    return;
  }
  render();
  try {
    const session = await apiJson("/api/session");
    state.authenticated = session.authenticated;
    state.loading = false;
    if (state.authenticated) await openWorkspace();
    else render();
  } catch {
    state.loading = false;
    render();
  }
}

bindEvents();
bootstrap();

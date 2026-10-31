import { appendVersion, syncLinkedAgendaItems } from "../../meeting-helpers.js";
import { OFFICER_ROLES, normalizeOfficerAssignments } from "../../officer-roles.js";
import { upgradeAgenda } from "../../agenda-upgrade.js";
import { recognitionAwardConfig, roleAwardConfig, roleEntries, roleIdentity } from "../../role-awards.js";
import { esc } from "../shared/html.js";
import { DEMO_MODE, EMPTY_IMAGE, STORAGE_KEYS, TRANSITION_MINUTES } from "./contract.js";
import { speakingTips } from "./render-engine.js";
import { state } from "./state.js";
import { wordTrainingTooLong } from "../../presentation-word-card.js";

export function toMinutes(time) {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

export function fromMinutes(value) {
  const wrapped = ((value % 1440) + 1440) % 1440;
  return `${String(Math.floor(wrapped / 60)).padStart(2, "0")}:${String(wrapped % 60).padStart(2, "0")}`;
}

function normalizeAgendaStatus(value) {
  const normalized = String(value || "").trim().toLocaleLowerCase();
  if (normalized === "pending") return "pending";
  if (normalized === "confirmed" || normalized.startsWith("confirm")) return "confirmed";
  return "vacant";
}

export function memberDisplayNameById(memberId, fallback = "") {
  return state.members.find((member) => member.id === memberId)?.displayName || fallback;
}

export function normalizeMeetingState(meeting) {
  const normalized = upgradeAgenda(meeting);
  normalized.enableTransitionTime = Boolean(normalized.enableTransitionTime);
  normalized.photographerMemberId = String(normalized.photographerMemberId || "");
  normalized.photographer = memberDisplayNameById(normalized.photographerMemberId, normalized.photographer || "");
  normalized.meetingManagerMemberId = String(normalized.meetingManagerMemberId || "");
  normalized.meetingManager = memberDisplayNameById(normalized.meetingManagerMemberId, normalized.meetingManager || "");
  normalized.offAgendaRoles = (Array.isArray(normalized.offAgendaRoles) ? normalized.offAgendaRoles : []).map((entry) => ({
    role: String(entry.role || ""),
    memberId: String(entry.memberId || ""),
    member: memberDisplayNameById(entry.memberId, entry.member || ""),
    signupOpen: entry.signupOpen === true,
  }));
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
    roleAwardConfig: roleAwardConfig(normalized.votingForm, roleEntries(normalized)),
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
      externalPresentationUrl: String(item.externalPresentationUrl || ""),
    })),
  }));
  return normalized;
}

export function officerAssignmentsFromMembers() {
  const assignments = Object.fromEntries(OFFICER_ROLES.map((role) => [role, ""]));
  state.members.forEach((member) => {
    (Array.isArray(member.officerRoles) ? member.officerRoles : []).forEach((role) => {
      if (role in assignments && !assignments[role]) assignments[role] = member.id;
    });
  });
  return assignments;
}

export function autofillAgendaOfficer(item, role) {
  if (!OFFICER_ROLES.includes(role)) return;
  const memberId = officerAssignmentsFromMembers()[role];
  if (!memberId) return;
  const member = state.members.find((candidate) => candidate.id === memberId);
  if (!member) return;
  item.memberId = member.id;
  item.member = member.displayName;
}

export function applyOfficerAssignments(assignments) {
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

export function supportRoleEntries() {
  return [
    { label: "Photographer", memberId: state.meeting.photographerMemberId, name: state.meeting.photographer },
    { label: "Meeting Manager", memberId: state.meeting.meetingManagerMemberId, name: state.meeting.meetingManager },
    ...(state.meeting.offAgendaRoles || []).map((entry) => ({ label: entry.role, memberId: entry.memberId, name: entry.member })),
  ];
}

export function getTimeline() {
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

export function getValidation() {
  const issues = [];
  const contest = state.meeting.meetingType === "contest";
  const add = (severity, text, stage, task, focusKey = "") => issues.push({ type: severity === "blocker" ? "error" : "warning", severity, text, stage, task, focusKey });
  if (!state.meeting.date.trim()) add("blocker", "Meeting date is required.", "preparation", "meeting-details", "meta:date");
  if (!state.meeting.theme.trim()) add("blocker", "Meeting theme is required.", "preparation", "meeting-details", "meta:theme");
  if (!contest && !state.meeting.wordOfDay.word.trim()) add("recommendation", "Word of the Day is missing.", "preparation", "meeting-details", "meta:wordOfDay.word");
  if (!contest && state.meeting.wordOfDay.word.trim()) {
    for (const [key, label] of [["definition", "释义"], ["example", "例句"]]) {
      if (!state.meeting.wordOfDay[key]?.trim()) add("recommendation", `单词训练卡${label}待补充`, "preparation", "meeting-details", `meta:wordOfDay.${key}`);
    }
    if (wordTrainingTooLong(state.meeting.wordOfDay)) add("recommendation", "单词训练卡投屏内容过长，请精简释义、用法或例句", "preparation", "meeting-details", "meta:wordOfDay.definition");
  }
  if (!state.meeting.blocks.length) add("blocker", "Agenda needs at least one block.", "preparation", "build-agenda", "add-block");
  if (!contest && !activeVotingImage()?.present) add("recommendation", "Voting QR code has not been prepared.", "preparation", "prepare-voting", "voting-prepare");
  if (!state.futurePosters[0]?.present) add("blocker", "Future meeting poster 1 is required.", "preparation", "future-posters", "future-poster-1");
  if (!state.groupQr?.present) add("recommendation", "Club guest group QR code has not been configured.", "preparation", "review-share", "club-settings");

  state.meeting.blocks.forEach((block) => {
    if (!block.items.length) add("recommendation", `${block.title} has no items.`, "preparation", "build-agenda", `block-select:${block.id}`);
    block.items.forEach((item) => {
      if (!item.session.trim()) add("blocker", "Agenda item title is required.", "preparation", "build-agenda", `item:${item.id}:session`);
      if (item.kind !== "break" && !item.member.trim()) add("recommendation", `${item.role || item.session} has no member assigned.`, "preparation", "build-agenda", `item:${item.id}:member`);
      if (!contest && item.kind === "speech" && !item.evaluator.trim()) add("recommendation", `${item.session} has no evaluator.`, "preparation", "build-agenda", `item:${item.id}:evaluator`);
      if (!contest && block.type === "prepared_speeches" && item.kind === "speech") {
        const pathwaysComplete = item.pathwaysMode === "pathways" && item.pathwaysPath && item.pathwaysLevel && item.pathwaysProjectId && item.pathwaysFormId;
        const customComplete = item.pathwaysMode === "custom" && item.speechObjective.trim();
        if (!pathwaysComplete && !customComplete) add("blocker", `${item.session} needs complete Pathways details or a custom speech objective.`, "preparation", "build-agenda", `item:${item.id}:speech-type`);
      }
      if (Number(item.duration) <= 0) add("blocker", `${item.session} needs a valid duration.`, "preparation", "build-agenda", `item:${item.id}:duration`);
    });
  });

  const total = totalMinutes();
  if (total > 120) add("recommendation", `Total duration is ${total} minutes, exceeding the 120-minute target.`, "preparation", "build-agenda", "block-list");
  return issues;
}

export function validationCounts() {
  const issues = getValidation();
  return {
    issues,
    blockers: issues.filter((issue) => issue.severity === "blocker").length,
    recommendations: issues.filter((issue) => issue.severity === "recommendation").length,
  };
}

export function isFinalized() {
  return state.meeting?.status === "final";
}

export function selectedBlock() {
  return state.meeting.blocks.find((block) => block.id === state.selectedBlockId) || state.meeting.blocks[0];
}

export function imageUrl(kind, image) {
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

export function renderQrFrame(kind, image, className = "") {
  return `<div class="qr-frame ${className} ${image?.present ? "has-image" : "is-empty"}">
    ${image?.present
      ? `<img src="${esc(imageUrl(kind, image))}" alt="${kind.startsWith("voting") ? "Voting QR code" : kind === "wechat-payment-qr" ? "WeChat payment QR code" : "Guest group QR code"}" />`
      : `<span>QR code<br />not uploaded</span>`}
  </div>`;
}

export function activeVotingImage() {
  return state.meeting.qrSource === "manual" ? state.meeting.votingQr : state.meeting.systemVotingQr;
}

export function renderAgendaSyncTip(label) {
  return `<div class="agenda-sync-tip" role="status"><div class="sync-progress"><span aria-hidden="true"></span>${esc(label)}</div>${speakingTips.markup({ delayed: true })}</div>`;
}

function normalizedPersonName(name) {
  return String(name || "").split(",")[0].trim().toLocaleLowerCase();
}

export function memberForName(name) {
  const normalized = normalizedPersonName(name);
  return state.members.find((member) => normalizedPersonName(member.displayName) === normalized);
}

export function memberIdForName(name) {
  return memberForName(name)?.id || "";
}

export function allAgendaItems() {
  return state.meeting.blocks.flatMap((block) => block.items);
}

export function syncLinkedAgendaItem(item, changedKey, previousRoleId) {
  syncLinkedAgendaItems(allAgendaItems(), item, changedKey, previousRoleId);
}

export function totalMinutes() {
  if (!state.meeting) return 0;
  const itemCount = state.meeting.blocks.reduce((sum, block) => sum + block.items.length, 0);
  const durations = state.meeting.blocks.reduce((sum, block) => sum + block.items.reduce((blockSum, item) => blockSum + (Number(item.duration) || 0), 0), 0);
  return durations + (state.meeting.enableTransitionTime ? Math.max(0, itemCount - 1) * TRANSITION_MINUTES : 0);
}

export function saveStatusText() {
  if (DEMO_MODE) return "Demo data · saved in this browser";
  if (state.previewMode) return "Local preview · changes are not saved";
  if (state.saveStatus === "saving") return "Auto-saving to Feishu";
  if (state.saveStatus === "error") return `Save failed · ${state.saveError}`;
  if (state.saveStatus === "conflict") return "Save paused · newer remote version";
  if (state.savedAt) return `Auto-saved to Feishu · ${state.savedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  return "Connected to Feishu Base";
}

export function meetingStatusLabel(status) {
  return status === "final" ? "Final" : status === "archived" ? "Archived" : "Draft";
}

export function formatMeetingDate(date) {
  if (!date) return "Date not set";
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return new Intl.DateTimeFormat(navigator.language || undefined, { weekday: "short", month: "short", day: "numeric" }).format(parsed);
}

export function formatMeetingTime(time) {
  if (!time) return "Time not set";
  const parsed = new Date(`2000-01-01T${time}`);
  if (Number.isNaN(parsed.getTime())) return time;
  return new Intl.DateTimeFormat(navigator.language || undefined, { hour: "numeric", minute: "2-digit" }).format(parsed);
}

export function formatDuration(minutes) {
  const value = Math.max(0, Number(minutes) || 0);
  const hours = Math.floor(value / 60);
  const mins = value % 60;
  if (!hours) return `${mins}m`;
  return mins ? `${hours}h ${mins}m` : `${hours}h`;
}

export function isFuturePostersTask() {
  return state.activeStage === "preparation" && state.activeTask === "future-posters";
}

export function signupChangeById(id) {
  return state.signupImport.analysis?.changes.find((change) => change.id === id);
}

export function setSignupMember(change, member) {
  change.newMemberId = member?.id || "";
  change.newValue = member?.displayName || change.newValue;
  change.match = member ? "manual" : "unmatched";
  change.requiresConfirmation = !member || Boolean(change.conflictGroup);
  change.selected = Boolean(member) && !change.overwrite && !change.conflictGroup;
}

export function useGuestForSignup(prompt, member) {
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

export function loadLocalMeeting() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.meeting));
  } catch {
    return null;
  }
}

export function latestFinalizedMeetingSummary() {
  return [...state.meetings]
    .filter((meeting) => meeting.status === "final")
    .sort((a, b) => `${b.date} ${b.startTime || ""}`.localeCompare(`${a.date} ${a.startTime || ""}`))[0] || null;
}

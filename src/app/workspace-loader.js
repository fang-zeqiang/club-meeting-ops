import { loadDemoWorkspace, saveDemoWorkspace } from "../../demo-state.js";
import { sortMeetingsForPicker } from "../../workflow-helpers.js";
import { apiJson } from "./api.js";
import { DEMO_MODE, EMPTY_IMAGE, FUTURE_POSTER_KINDS, STORAGE_KEYS } from "./contract.js";
import { loadLocalMeeting, memberForName, normalizeMeetingState } from "./derivations.js";
import { flushSave, render, renderBlockEditorRegion, renderMediaRegion, renderOfficerRegion, renderOverlayRegion, renderPreviewRegion, renderSaaQuickActionsRegion, renderToastRegion } from "./render-engine.js";
import { defaultMeeting, emptySignupGeneration, emptySignupImport, runtime, state, uid } from "./state.js";

function localDrafts() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEYS.drafts) || "{}");
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

export function localDraft(meetingId) {
  return localDrafts()[meetingId]?.meeting || null;
}

export function saveLocalDraft() {
  if (state.previewMode || !state.meeting?.id) return;
  const drafts = localDrafts();
  drafts[state.meeting.id] = { meeting: structuredClone(state.meeting), savedAt: new Date().toISOString() };
  localStorage.setItem(STORAGE_KEYS.drafts, JSON.stringify(drafts));
}

export function clearLocalDraft(meetingId = state.meeting?.id) {
  if (!meetingId) return;
  const drafts = localDrafts();
  delete drafts[meetingId];
  localStorage.setItem(STORAGE_KEYS.drafts, JSON.stringify(drafts));
}

export function persistDemoWorkspace() {
  if (!DEMO_MODE || !state.meeting) return;
  runtime.demoMeetings.set(state.meeting.id, structuredClone(state.meeting));
  saveDemoWorkspace({
    activeMeetingId: state.meeting.id,
    members: state.members,
    meetings: [...runtime.demoMeetings.values()],
  });
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
  meeting.contestResults = {};
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

export function freshMeeting(source = defaultMeeting, meetingNumber) {
  const meeting = cloneMeetingStructure(source);
  if (meetingNumber) meeting.meetingNumber = meetingNumber;
  return meeting;
}

export function nextMeetingNumber() {
  return Math.max(0, ...state.meetings.map((meeting) => meeting.meetingNumber)) + 1;
}

export function templateFromMeeting(meeting, name) {
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

export function meetingFromTemplate(template, meetingNumber) {
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
  meeting.wordOfDay = { word: "", pronunciation: "", partOfSpeech: "", definition: "", usage: "", example: "" };
  meeting.votingCode = `DEMO-${meetingNumber}`;
  return meeting;
}

export function meetingFromFinalized(source, meetingNumber) {
  const meeting = cloneMeetingStructure(source);
  meeting.meetingNumber = meetingNumber;
  meeting.status = "draft";
  meeting.date = "";
  meeting.theme = "";
  meeting.votingCode = `DEMO-${meetingNumber}`;
  meeting.wordOfDay = { word: "", pronunciation: "", partOfSpeech: "", definition: "", usage: "", example: "" };
  meeting.photographerMemberId = "";
  meeting.photographer = "";
  meeting.meetingManagerMemberId = "";
  meeting.meetingManager = "";
  meeting.offAgendaRoles = (meeting.offAgendaRoles || []).map((entry) => ({ ...entry, memberId: "", member: "" }));
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
  meeting.contestResults = {};
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

export async function loadWorkspace() {
  state.loading = true;
  state.showLoadingTip = true;
  render();
  try {
    const { meetings } = await apiJson("/api/meetings");
    state.meetings = sortMeetingsForPicker(meetings);
    loadDeferredWorkspaceData();
    const localMeeting = loadLocalMeeting();
    state.migrationPrompt = Boolean(localMeeting && !localStorage.getItem(STORAGE_KEYS.migration));
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

export async function loadGuestMeeting(meetingNumber) {
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

export async function openGuestWorkspace() {
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
    apiJson("/api/members").then(({ members }) => {
      state.members = members;
      if (state.meeting) {
        renderOfficerRegion();
        renderPreviewRegion();
      }
    }),
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

export async function loadRoles() {
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

export function loadPreviewWorkspace(message = "") {
  state.previewMode = true;
  state.authenticated = true;
  state.loading = false;
  const demo = DEMO_MODE ? loadDemoWorkspace() : null;
  state.members = demo?.members || [
    { id: "preview-riley", displayName: "Riley HU, TM", memberType: "member", active: true },
    { id: "preview-quinn", displayName: "Quinn XU, PM", memberType: "member", active: true },
    { id: "preview-casey", displayName: "Casey KIM, PM5", memberType: "member", active: true },
    { id: "preview-alex", displayName: "Alex CHEN, TM", memberType: "member", active: true },
  ];
  runtime.demoMeetings = new Map((demo?.meetings || []).map((meeting) => [meeting.id, meeting]));
  const source = demo
    ? runtime.demoMeetings.get(demo.activeMeetingId) || demo.meetings[0]
    : freshMeeting(defaultMeeting, defaultMeeting.meetingNumber);
  state.meeting = normalizeMeetingState(structuredClone(source));
  if (DEMO_MODE) runtime.demoMeetings.set(state.meeting.id, structuredClone(state.meeting));
  state.selectedBlockId = state.meeting.blocks[0].id;
  state.meetings = (demo?.meetings || [state.meeting]).map((meeting) => ({
    id: meeting.id,
    meetingNumber: meeting.meetingNumber,
    date: meeting.date,
    startTime: meeting.startTime,
    theme: meeting.theme,
    status: meeting.status,
    revision: meeting.revision,
  }));
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
  state.toast = message || "";
  state.activeView = "advisor";
  state.activeStage = "preparation";
  state.activeTask = "meeting-details";
  state.advisorOriginLabel = "";
  state.signupImport = emptySignupImport();
  state.signupGeneration = emptySignupGeneration();
  render();
}

export function loadPdfSnapshotWorkspace(snapshot) {
  state.previewMode = true;
  state.authenticated = true;
  state.loading = false;
  state.members = Array.isArray(snapshot.members) ? snapshot.members : [];
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

export async function signOut() {
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
  if (state.agendaImagePrompt?.objectUrl) URL.revokeObjectURL(state.agendaImagePrompt.objectUrl);
  state.agendaImagePrompt = null;
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

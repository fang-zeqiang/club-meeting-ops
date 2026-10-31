import { loadMcpChanges } from "./advisor-workflow.js";
import { apiJson } from "./api.js";
import { DEMO_MODE, EMPTY_IMAGE } from "./contract.js";
import { latestFinalizedMeetingSummary, normalizeMeetingState } from "./derivations.js";
import { beforeCreateMeeting, updateMeetingSummary } from "./lifecycle-sync.js";
import { loadRoleRecommendations } from "./recommendations.js";
import { notify, render, renderNavigatorRegion, renderOverlayRegion, renderStatusRegion } from "./render-engine.js";
import { defaultMeeting, emptyRoleRecommendations, emptySignupGeneration, runtime, state } from "./state.js";
import { loadAwards, prewarmVotingForm, stopVotingConsoleRefresh } from "./voting-actions.js";
import { clearLocalDraft, loadPreviewWorkspace, loadWorkspace, localDraft, meetingFromFinalized, meetingFromTemplate, nextMeetingNumber, persistDemoWorkspace, saveLocalDraft } from "./workspace-loader.js";

export async function startNewMeetingFromSource(template = null) {
  if (!await beforeCreateMeeting()) return;
  const meetingNumber = nextMeetingNumber();
  const meeting = normalizeMeetingState(
    template ? meetingFromTemplate(template, meetingNumber) : meetingFromFinalized(DEMO_MODE ? state.meeting : defaultMeeting, meetingNumber),
  );
  meeting.enableTransitionTime = true;
  meeting.votingCode = `DEMO-${meetingNumber}`;
  state.meeting = meeting;
  state.selectedBlockId = state.meeting.blocks[0]?.id;
  state.templatePrompt = false;
  runtime.overlayReturnFocusKey = "";
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

export async function startNewMeetingFromFinalized() {
  if (!await beforeCreateMeeting()) return;
  const summary = latestFinalizedMeetingSummary();
  if (!summary) { state.newMeetingCreating = false; renderOverlayRegion(); return notify("No finalized meeting is available to reuse."); }
  let source = state.meeting?.id === summary.id ? state.meeting : null;
  if (!source && DEMO_MODE) source = structuredClone(runtime.demoMeetings.get(summary.id));
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
  state.meeting = normalizeMeetingState(meetingFromFinalized(source, meetingNumber));
  state.selectedBlockId = state.meeting.blocks[0]?.id;
  state.templatePrompt = false;
  runtime.overlayReturnFocusKey = "";
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

export async function recoverMcpChange(operationId) {
  if (!window.confirm("Restore this MCP change? Recovery creates a new revision and audit record. Global RoleCatalog roles are kept.")) return;
  state.mcpChanges.busy = true;
  render();
  try {
    const meetingId = state.meeting.id;
    const result = await apiJson(`/api/meetings/${encodeURIComponent(meetingId)}?action=mcp-recover`, {
      method: "POST",
      body: JSON.stringify({ operationId }),
    });
    await loadMeetingFromCloud(meetingId);
    state.activeView = "admin";
    state.activeStage = "preparation";
    state.activeTask = "mcp-changes";
    state.toast = `MCP change restored. Revision ${result.recovery.afterRevision}.`;
    await loadMcpChanges();
  } catch (error) {
    state.mcpChanges = { ...state.mcpChanges, busy: false, error: error.message };
    state.toast = error.message;
    render();
  }
}

export async function flushSave() {
  window.clearTimeout(runtime.saveTimer);
  runtime.saveTimer = null;
  const invalidExternalUrl = document.querySelector("[data-external-presentation-url]:invalid");
  if (invalidExternalUrl) {
    invalidExternalUrl.reportValidity();
    state.saveStatus = "error";
    state.saveError = invalidExternalUrl.validationMessage;
    renderStatusRegion();
    return;
  }
  if (state.previewMode) {
    state.saveStatus = "saved";
    state.dirty = false;
    state.savedAt = new Date();
    updateMeetingSummary(state.meeting);
    persistDemoWorkspace();
    renderNavigatorRegion();
    renderStatusRegion();
    return;
  }
  if (!state.authenticated || !state.meeting || state.conflict) return;
  if (state.persisted && !state.dirty) return;
  if (runtime.savePromise) {
    await runtime.savePromise;
    if (state.dirty && !state.conflict && state.saveStatus !== "error") return flushSave();
    return;
  }

  const snapshot = structuredClone(state.meeting);
  const savedMutationVersion = state.mutationVersion;
  const wasPersisted = state.persisted;
  state.saveStatus = "saving";
  renderStatusRegion();

  runtime.savePromise = (async () => {
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
      runtime.savePromise = null;
    }
  })();

  await runtime.savePromise;
  if (state.mutationVersion > savedMutationVersion && !state.conflict) {
    state.saveStatus = "saving";
    runtime.saveTimer = window.setTimeout(flushSave, 800);
  }
  renderStatusRegion();
  renderNavigatorRegion();
  if (state.saveStatus === "saved" && state.roleRecommendations.data) void loadRoleRecommendations({ quiet: true });
}

export async function discardConflictAndReloadRemote(meetingId) {
  state.conflict = null;
  state.dirty = false;
  state.saveStatus = "idle";
  clearLocalDraft(meetingId);
  await loadMeetingFromCloud(meetingId);
}

export async function loadMeetingFromCloud(meetingId) {
  await flushSave();
  if (["error", "conflict"].includes(state.saveStatus)) return;
  stopVotingConsoleRefresh();
  state.votingConsole.open = false;
  state.loading = true;
  state.showLoadingTip = true;
  render();
  try {
    const meeting = DEMO_MODE
      ? structuredClone(runtime.demoMeetings.get(meetingId))
      : (await apiJson(`/api/meetings/${encodeURIComponent(meetingId)}`)).meeting;
    if (!meeting) throw new Error("Demo meeting not found.");
    const draft = DEMO_MODE ? null : localDraft(meetingId);
    const useDraft = draft && Number(draft.revision || 0) === Number(meeting.revision || 0);
    if (draft && !useDraft) clearLocalDraft(meetingId);
    state.meeting = normalizeMeetingState({
      ...(useDraft ? draft : meeting),
      votingQr: meeting.votingQr || draft?.votingQr || { ...EMPTY_IMAGE },
      systemVotingQr: meeting.systemVotingQr || draft?.systemVotingQr || { ...EMPTY_IMAGE },
    });
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
    state.advisorExpanded = { risk: false };
    state.signupGeneration = emptySignupGeneration();
    state.mcpChanges = { items: [], busy: false, error: "" };
    state.roleRecommendations = emptyRoleRecommendations();
  } catch (error) {
    state.toast = error.message;
  } finally {
    state.loading = false;
    state.showLoadingTip = false;
    render();
  }
  if (state.meeting?.id === meetingId && state.dirty) {
    saveLocalDraft();
    window.clearTimeout(runtime.saveTimer);
    runtime.saveTimer = window.setTimeout(flushSave, 0);
  }
  if (state.meeting?.id === meetingId) await Promise.all([
    loadAwards({ quiet: true }),
    loadRoleRecommendations({ quiet: true }),
  ]);
}

export async function openWorkspace() {
  const health = await apiJson("/api/health");
  if (health.persistence === "local-only") {
    loadPreviewWorkspace("Local preview mode: changes are not saved to Feishu.");
    return;
  }
  await loadWorkspace();
  const params = new URLSearchParams(window.location.search);
  const meetingNumber = Number(params.get("meeting"));
  const task = params.get("task");
  if (params.get("view") !== "admin" || !["future-posters", "mcp-changes"].includes(task) || !Number.isInteger(meetingNumber) || meetingNumber < 1) return;
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
  state.activeTask = task;
  render();
  if (task === "mcp-changes") await loadMcpChanges();
}

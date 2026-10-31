import { bindEditorEvents } from "../../editor-events.js";
import * as advisorWorkflow from "./advisor-workflow.js";
import { highlightAdvisorTarget, loadMcpChanges } from "./advisor-workflow.js";
import * as agendaEditor from "./agenda-editor.js";
import { FUTURE_POSTER_KINDS, STORAGE_KEYS, WORKFLOW } from "./contract.js";
import { isFinalized, selectedBlock, syncLinkedAgendaItem, validationCounts } from "./derivations.js";
import * as lifecycleSync from "./lifecycle-sync.js";
import * as media from "./media.js";
import * as memberPicker from "./member-picker.js";
import { addGuestForItem, addGuestForMeetingRole, closeMemberPicker, refreshMemberPickerMembers } from "./member-picker.js";
import { discardConflictAndReloadRemote, flushSave, loadMeetingFromCloud, recoverMcpChange, startNewMeetingFromFinalized, startNewMeetingFromSource } from "./orchestration.js";
import * as printExport from "./print-export.js";
import * as prompts from "./prompts.js";
import * as recommendations from "./recommendations.js";
import { memberPickerTargetForAssignment, openRoleRecommendations, selectedRecommendationRole } from "./recommendations.js";
import { notify, refreshDerivedRegions, render, renderOverlayRegion, speakingTips } from "./render-engine.js";
import * as signup from "./signup.js";
import { handleSignupEmojiKeydown, updateSignupEmoji } from "./signup.js";
import { markDirty, state } from "./state.js";
import { closeVotingConsole, loadAwards, prewarmVotingForm, refreshVotingConsole, saveTableTopicsSpeakers, stopVotingConsoleRefresh } from "./voting-actions.js";
import * as votingAwards from "./voting-awards.js";
import { loadTableTopics } from "./voting-awards.js";
import { loadRoles, openGuestWorkspace } from "./workspace-loader.js";

let delegatedEventsBound = false;

export function bindEvents() {
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
    if (event.key === "Escape" && state.agendaImagePrompt) printExport.closeAgendaImagePrompt();
    else if (event.key === "Escape" && state.memberPicker) closeMemberPicker();
    else if (event.key === "Escape" && state.votingConsole.open) closeVotingConsole();
    else if (event.key === "Escape" && state.roleRecommendations.exclusion && !state.roleRecommendations.exclusion.openList) {
      state.roleRecommendations.exclusion = null;
      renderOverlayRegion();
    } else if (event.key === "Escape" && state.roleRecommendations.drawer) {
      state.roleRecommendations.drawer = null;
      renderOverlayRegion();
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopVotingConsoleRefresh();
    else if (state.votingConsole.open && state.votingConsole.phase === "live") refreshVotingConsole();
  });
  app.addEventListener("pointerdown", handleWorkspaceSplitPointerDown);
  app.addEventListener("dblclick", handleWorkspaceSplitDoubleClick);
  app.addEventListener("keydown", handleWorkspaceSplitKeydown);
  app.addEventListener("keydown", handleSignupEmojiKeydown);
  app.addEventListener("compositionend", (event) => {
    if (event.target.matches("[data-signup-generation-emoji]")) updateSignupEmoji(event.target);
  });
  app.addEventListener("touchstart", (event) => speakingTips.handleTouchStart(event), { passive: true });
  app.addEventListener("touchend", (event) => speakingTips.handleTouchEnd(event), { passive: true });
}

function workspacePreviewBounds(workspace) {
  const width = workspace.getBoundingClientRect().width;
  return { min: 340, max: Math.max(340, width - 430) };
}

export function setWorkspacePreviewWidth(workspace, splitter, value, { persist = false } = {}) {
  const { min, max } = workspacePreviewBounds(workspace);
  const width = Math.round(Math.min(max, Math.max(min, value)));
  workspace.style.setProperty("--preview-pane-width", `${width}px`);
  splitter.setAttribute("aria-valuemax", String(Math.round(max)));
  splitter.setAttribute("aria-valuenow", String(width));
  if (persist) localStorage.setItem(STORAGE_KEYS.previewPaneWidth, String(width));
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

async function handleDelegatedChange(event) {
  const input = event.target;
  // 分支已迁入 src/app/recommendations.js
  if (await recommendations.handleChange(input, event)) return;
  // 分支已迁入 src/app/voting-awards.js
  if (await votingAwards.handleConsoleChange(input, event)) return;
  // 分支已迁入 src/app/member-picker.js
  if (await memberPicker.handleSearchChange(input, event)) return;
  // 分支已迁入 src/app/signup.js
  if (await signup.handleChange(input, event)) return;
  // 分支已迁入 src/app/lifecycle-sync.js
  if (await lifecycleSync.handleChange(input, event)) return;
  const globalPosterUpload = input.matches("[data-upload-image]") && FUTURE_POSTER_KINDS.includes(input.dataset.uploadImage);
  if (isFinalized() && state.activeStage === "preparation" && !state.clubSettingsOpen && !globalPosterUpload && !input.matches("[data-meeting-select]") && !input.closest("[data-template-form], [data-rename-template-form]")) return notify("Reopen preparation before editing.");
  // 分支已迁入 src/app/agenda-editor.js
  if (await agendaEditor.handleChange(input, event)) return;
  // 分支已迁入 src/app/voting-awards.js
  if (await votingAwards.handleChange(input, event)) return;
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
  // 分支已迁入 src/app/member-picker.js
  if (await memberPicker.handleChange(input, event)) return;
  // 分支已迁入 src/app/media.js
  if (await media.handleChange(input, event)) return;
  // 分支已迁入 src/app/advisor-workflow.js
  if (await advisorWorkflow.handleChange(input, event)) return;
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
  if (await memberPicker.handleClick(button, event)) {
    // 分支已迁入 src/app/member-picker.js
  } else if (await advisorWorkflow.handleClick(button, event)) {
    // 分支已迁入 src/app/advisor-workflow.js
  } else if (await votingAwards.handleClick(button, event)) {
    // 分支已迁入 src/app/voting-awards.js
  } else if (button.matches("[data-recover-mcp-change]")) {
    await recoverMcpChange(button.dataset.recoverMcpChange);
  } else if (await signup.handleClick(button, event)) {
    // 分支已迁入 src/app/signup.js
  } else if (await recommendations.handleClick(button, event)) {
    // 分支已迁入 src/app/recommendations.js
  } else if (button.matches("[data-open-full-member-picker]")) {
    openFullMemberPickerForRecommendation();
  } else if (button.matches("[data-browse-meetings]")) {
    await openGuestWorkspace();
  } else if (button.matches("[data-view]")) {
    state.activeView = button.dataset.view;
    if (state.activeView === "admin") state.mobileView = "edit";
    if (state.activeView === "admin") state.advisorOriginLabel = "";
    render();
    if (state.activeView === "advisor") await loadAwards({ quiet: true });
  } else if (button.matches("[data-advisor-action]")) {
    await navigateFromAdvisor(button);
  } else if (button.matches("[data-task]")) {
    state.highlightReviewItems = button.matches("[data-review-badge]");
    state.activeStage = button.dataset.stageTarget || Object.entries(WORKFLOW).find(([, tasks]) => tasks.some((task) => task.id === button.dataset.task))?.[0] || state.activeStage;
    state.activeTask = button.dataset.task;
    render();
    if (state.highlightReviewItems) document.querySelector('[data-region="validation"]')?.scrollIntoView({ block: "start" });
    if (state.activeTask === "awards") await loadAwards();
    if (state.activeTask === "prepare-voting") { await prewarmVotingForm(); await loadTableTopics(); }
    if (state.activeTask === "mcp-changes") await loadMcpChanges();
  } else if (await prompts.handleClick(button, event)) {
    // 分支已迁入 src/app/prompts.js
  } else if (button.matches("[data-retry-roles]")) {
    await loadRoles();
  } else if (button.matches("[data-continue-workflow]")) {
    const tasks = WORKFLOW.preparation;
    const index = tasks.findIndex((task) => task.id === state.activeTask);
    state.activeTask = tasks[Math.min(tasks.length - 1, index + 1)].id;
    render();
    if (state.activeTask === "prepare-voting") { await prewarmVotingForm(); await loadTableTopics(); }
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
  } else if (await agendaEditor.handleClick(button, event)) {
    // 分支已迁入 src/app/agenda-editor.js
  } else if (await media.handleClick(button, event)) {
    // 分支已迁入 src/app/media.js
  } else if (await lifecycleSync.handleClick(button, event)) {
    // 分支已迁入 src/app/lifecycle-sync.js
  } else if (button.matches("[data-open-meeting]")) {
    await loadMeetingFromCloud(button.dataset.openMeeting);
  } else if (await printExport.handleClick(button, event)) {
    // 打印 / 导出分支已迁到 src/app/print-export.js
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
  } else if (button.matches("[data-reload-remote]")) {
    await discardConflictAndReloadRemote(state.conflict.meetingId);
  }
}

async function navigateFromAdvisor(button) {
  if (button.dataset.task === "role-recommendations") return openRoleRecommendations();
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

function openFullMemberPickerForRecommendation() {
  const role = selectedRecommendationRole();
  const target = memberPickerTargetForAssignment(role?.assignmentId || "");
  if (!target) return;
  state.memberPicker = { target, label: `全部会员 · ${role.role}`, selectedId: "", selectedLabel: "", allowEmpty: true, allowGuest: true, returnFocusKey: "", query: "", refreshing: false, error: "" };
  renderOverlayRegion();
  refreshMemberPickerMembers(state.memberPicker);
}

async function handleDelegatedSubmit(event) {
  const form = event.target;
  if (await recommendations.handleSubmit(form, event)) {
    // 分支已迁入 src/app/recommendations.js
  } else if (await votingAwards.handleSubmit(form, event)) {
    // 分支已迁入 src/app/voting-awards.js
  } else if (await printExport.handleSubmit(form, event)) {
    // 打印表单分支已迁到 src/app/print-export.js
  } else if (await lifecycleSync.handleSubmit(form, event)) {
    // 分支已迁入 src/app/lifecycle-sync.js
  } else if (await memberPicker.handleSubmit(form, event)) {
    // 分支已迁入 src/app/member-picker.js
  }
}

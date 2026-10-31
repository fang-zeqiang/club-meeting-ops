import { resetDemoWorkspace } from "../../demo-state.js";
import { sortMeetingsForPicker } from "../../workflow-helpers.js";
import { esc } from "../shared/html.js";
import { apiJson } from "./api.js";
import { DEMO_MODE, DEMO_WORKSPACE_IMAGE_URL, STORAGE_KEYS, TRANSITION_MINUTES } from "./contract.js";
import { fromMinutes, loadLocalMeeting, normalizeMeetingState, saveStatusText, toMinutes } from "./derivations.js";
import { flushSave, notify, render, renderOverlayRegion, renderStatusRegion } from "./render-engine.js";
import { runtime, state } from "./state.js";
// 与 workspace-loader.js 是同一个 lifecycle feature 拆成的两半(600 行上限所迫),依赖方向固定为 lifecycle-sync → workspace-loader
import { freshMeeting, loadGuestMeeting, loadPreviewWorkspace, nextMeetingNumber, persistDemoWorkspace, saveLocalDraft, signOut, templateFromMeeting } from "./workspace-loader.js";

export function applyDirty() {
  state.dirty = true;
  state.mutationVersion += 1;
  saveLocalDraft();
  if (state.previewMode) {
    state.saveStatus = "saved";
    state.dirty = false;
    state.savedAt = new Date();
    updateMeetingSummary(state.meeting);
    persistDemoWorkspace();
    return;
  }
  state.saveStatus = "saving";
  state.saveError = "";
  renderStatusRegion();
  window.clearTimeout(runtime.saveTimer);
  runtime.saveTimer = window.setTimeout(flushSave, 800);
}

export function renderLogin() {
  return `<main class="auth-shell">
    <nav class="public-links" aria-label="Related tools">
      <a class="division-template-link" href="/about">← Club Meeting Ops</a>
      <a class="division-template-link" href="/division-l-template.html">Division O 模板 <span aria-hidden="true">↗</span></a>
      <a class="division-template-link" href="/education">VPE Education <span aria-hidden="true">↗</span></a>
      <a class="division-template-link" href="/mcp">Agenda MCP <span aria-hidden="true">↗</span></a>
      <a class="companion-link" href="https://tmcompanion.netlify.app/" target="_blank" rel="noopener noreferrer">TM Companion <span aria-hidden="true">↗</span></a>
    </nav>
    <section class="auth-card auth-gateway">
      <aside class="auth-demo-entry">
        <div class="auth-demo-copy">
          <span>Interactive demo</span>
          <h1>Explore the VPE workspace.</h1>
          <p>Use real workflows with fictional data stored only in this browser.</p>
        </div>
        <figure class="auth-demo-visual">
          <img src="${esc(DEMO_WORKSPACE_IMAGE_URL)}" alt="Agenda Maker Admin workspace and live agenda preview" />
        </figure>
        <a class="public-demo-button" href="/demo"><strong>Open interactive demo</strong><span aria-hidden="true">→</span></a>
        <button class="public-browse-button" type="button" data-browse-meetings>Browse as guest: finalized meetings</button>
      </aside>
      <div class="auth-signin">
        <span class="eyebrow">Secure workspace</span>
        <h2>Open the meeting desk</h2>
        <p>Enter the shared editing passcode to load club meetings.</p>
        <form data-login-form>
          <label class="field"><span>Edit passcode</span><input name="passcode" type="password" autocomplete="current-password" required autofocus /></label>
          <button class="button primary" type="submit">Sign in</button>
          <p class="form-error" data-login-error></p>
        </form>
      </div>
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

export function renderGuestWorkspace() {
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

export function renderMeetingNavigator() {
  return `<label class="topbar-meeting-select" data-region="navigator"><span class="eyebrow">Current meeting</span><select data-meeting-select>${state.meetings.map((meeting) => `<option value="${esc(meeting.id)}" ${meeting.id === state.meeting.id ? "selected" : ""}>${esc(meetingOptionLabel(meeting))}</option>`).join("")}</select></label>`;
}

export function renderWorkspaceIdentity() {
  return `<div class="workspace-identity"><a href="/about">Club Meeting Ops</a><strong>Meeting Workspace</strong><span${DEMO_MODE ? ' class="demo-badge"' : ""}>${DEMO_MODE ? "Demo · fictional data" : "Plan · Run · Review"}</span></div>`;
}

function meetingOptionLabel(meeting) {
  return `#${meeting.meetingNumber} · ${meeting.date || "Date not set"}`;
}

export function renderSaveStatus() {
  const icon = state.saveStatus === "saving" ? "↻" : state.saveStatus === "error" || state.saveStatus === "conflict" ? "!" : "✓";
  const tag = state.saveStatus === "error" ? "button" : "span";
  const action = state.saveStatus === "error" ? ' type="button" data-retry-save aria-label="Save failed, retry"' : "";
  return `<${tag} class="topbar-save save-${esc(state.saveStatus)}"${action}><span aria-hidden="true">${icon}</span>${esc(saveStatusText())}</${tag}>`;
}

async function createNewMeeting() {
  runtime.overlayReturnFocusKey = "new-meeting";
  state.templatePrompt = true;
  renderOverlayRegion();
  ensureTemplates();
}

export async function beforeCreateMeeting() {
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
  runtime.overlayReturnFocusKey = "save-template";
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
    renderOverlayRegion(state.saveTemplatePrompt ? "" : runtime.overlayReturnFocusKey);
    if (!state.saveTemplatePrompt) runtime.overlayReturnFocusKey = "";
  }
}

export function updateMeetingSummary(meeting) {
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
  if (state.saveStatus === "saved") localStorage.setItem(STORAGE_KEYS.migration, "imported");
}

export async function handleClick(button, event) {
  if (button.matches("[data-new-meeting]")) {
    await createNewMeeting();
  } else if (button.matches("[data-save-template]")) {
    await ensureTemplates();
    openSaveTemplatePrompt();
  } else if (button.matches("[data-reset-demo]")) {
    if (!window.confirm("Reset demo data stored in this browser?")) return true;
    resetDemoWorkspace();
    loadPreviewWorkspace("Demo reset. No club data was changed.");
  } else if (button.matches("[data-sign-out]")) {
    await signOut();
  } else if (button.matches("[data-import-local]")) {
    await importLocalMeeting();
  } else if (button.matches("[data-save-copy]")) {
    await saveConflictCopy();
  } else {
    return false;
  }
  return true;
}

export async function handleChange(input, event) {
  if (input.matches("[data-guest-meeting]")) {
    await loadGuestMeeting(input.value);
  } else {
    return false;
  }
  return true;
}

export async function handleSubmit(form, event) {
  if (form.matches("[data-rename-template-form]")) {
    event.preventDefault();
    await renameTemplate(String(new FormData(form).get("name") || ""));
  } else if (form.matches("[data-template-form]")) {
    event.preventDefault();
    const name = String(new FormData(form).get("name") || "").trim();
    if (name) await saveTemplate(name);
  } else {
    return false;
  }
  return true;
}

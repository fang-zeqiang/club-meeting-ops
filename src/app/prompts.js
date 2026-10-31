import productUpdatesMarkdown from "../../docs/CHANGELOG.md?raw";
import { esc } from "../shared/html.js";
import { STORAGE_KEYS } from "./contract.js";
import { latestFinalizedMeetingSummary, loadLocalMeeting, meetingStatusLabel } from "./derivations.js";
import { renderOverlayRegion } from "./render-engine.js";
import { runtime, state } from "./state.js";

export function renderMigrationPrompt() {
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

export function renderConflictPrompt() {
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

export function renderTemplatePrompt() {
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

export function renderRenameTemplatePrompt() {
  if (!state.renameTemplatePrompt) return "";
  return `<div class="modal-backdrop"><section class="modal-card"><span class="eyebrow">Shared template</span><h2>Rename template</h2>
    <form data-rename-template-form><label class="field"><span>Template name</span><input name="name" maxlength="120" required autofocus value="${esc(state.renameTemplatePrompt.name)}"></label>
      <div class="modal-actions"><button class="button" type="button" data-cancel-rename-template>Cancel</button><button class="button primary" ${state.templateBusy ? "disabled" : ""}>${state.templateBusy ? "Renaming…" : "Rename"}</button></div>
    </form></section></div>`;
}

export function renderMeetingSwitchboardRow(meeting, leadLabel = "") {
  return `<button class="switchboard-row${leadLabel ? " is-next" : ""}" data-open-meeting="${esc(meeting.id)}">
    <span class="switchboard-number">#${esc(meeting.meetingNumber)}</span>
    <span class="switchboard-copy">${leadLabel ? `<span class="switchboard-next-label">${leadLabel}</span>` : ""}<strong>${esc(meeting.theme || "Untitled meeting")}</strong><small>${esc(meeting.date || "Date not set")} · ${esc(meeting.startTime || "Time not set")}</small></span>
    <span class="switchboard-status status-${esc(meeting.status || "draft")}">${meetingStatusLabel(meeting.status)}</span>
  </button>`;
}

export function renderSaveTemplatePrompt() {
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

export function renderAboutProductPrompt() {
  if (!state.aboutProductOpen) return "";
  return `<div class="modal-backdrop"><section class="modal-card club-settings-modal" role="dialog" aria-modal="true" aria-labelledby="about-product-title">
    <div class="modal-title-row"><div><span class="eyebrow">VPE Agenda</span><h2 id="about-product-title">About Product</h2></div><button class="icon-button" data-close-about-product aria-label="Close About Product">×</button></div>
    <div class="club-settings-scroll">${renderProductUpdates()}</div>
  </section></div>`;
}

export function renderToastRegionMarkup() {
  return `<div data-region="toast">${state.toast ? `<div class="toast">${esc(state.toast)}</div>` : ""}</div>`;
}

export async function handleClick(button, event) {
  if (button.matches("[data-club-settings]")) {
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
  } else if (button.matches("[data-rename-template]")) {
    if (state.newMeetingCreating) return true;
    const template = state.templates.find((candidate) => candidate.id === button.dataset.renameTemplate);
    if (template) {
      state.renameTemplatePrompt = { id: template.id, name: template.name };
      renderOverlayRegion();
    }
  } else if (button.matches("[data-cancel-template-choice]")) {
    state.templatePrompt = false;
    renderOverlayRegion(runtime.overlayReturnFocusKey);
    runtime.overlayReturnFocusKey = "";
  } else if (button.matches("[data-cancel-rename-template]")) {
    state.renameTemplatePrompt = null;
    renderOverlayRegion();
  } else if (button.matches("[data-cancel-save-template]")) {
    state.saveTemplatePrompt = false;
    renderOverlayRegion(runtime.overlayReturnFocusKey);
    runtime.overlayReturnFocusKey = "";
  } else if (button.matches("[data-skip-migration]")) {
    localStorage.setItem(STORAGE_KEYS.migration, "ignored");
    state.migrationPrompt = false;
    renderOverlayRegion();
  } else {
    return false;
  }
  return true;
}

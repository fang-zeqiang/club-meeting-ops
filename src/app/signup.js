import { roleIdentity } from "../../role-awards.js";
import { applySignupChanges } from "../../signup-import-apply.js";
import { splitEmojiGraphemes, validateVacancyEmoji } from "../../vacancy-emoji.js";
import { esc } from "../shared/html.js";
import { apiJson } from "./api.js";
import { SIGNUP_IMPORT_MODEL, SIGNUP_TEXT_MAX, SIGNUP_TEXT_MIN } from "./contract.js";
import { allAgendaItems, normalizeMeetingState, renderAgendaSyncTip, signupChangeById } from "./derivations.js";
import { clearLocalDraft, flushSave, notify, render, renderOverlayRegion, updateMeetingSummary } from "./render-engine.js";
import { emptySignupGeneration, emptySignupImport, runtime, state } from "./state.js";

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

export function renderSignupImportPrompt() {
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

export function renderSignupGenerationPrompt() {
  const preview = state.signupGeneration;
  if (!preview.open) return "";
  const emojiChoices = ["🌸", "🌼", "🌺", "🌻", "🌹", "🈳", "🙋", "🟡", "🔴", "🟢"];
  return `<div class="modal-backdrop signup-import-backdrop"><section class="modal-card signup-import-modal signup-generate-modal" role="dialog" aria-modal="true" aria-labelledby="signup-generate-title">
    <header class="signup-modal-head"><div><div class="signup-beta-lockup"><span class="eyebrow">Agenda → WeChat</span></div><h2 id="signup-generate-title">Generate signup</h2><p>Copy-ready text from Meeting #${esc(state.meeting.meetingNumber)}.</p></div><button class="icon-button" data-close-signup-generation aria-label="Close signup preview">×</button></header>
    <div class="signup-generate-controls">
      <label>Language<select data-signup-generation-language>
        <option value="bilingual" ${preview.language === "bilingual" ? "selected" : ""}>中英双语</option>
        <option value="zh-CN" ${preview.language === "zh-CN" ? "selected" : ""}>中文</option>
        <option value="en" ${preview.language === "en" ? "selected" : ""}>English</option>
      </select></label>
      <div class="signup-emoji-field"><span>空缺标记</span><div class="signup-emoji-input"><input data-signup-generation-emoji value="${esc(preview.vacancyEmoji)}" aria-label="空缺标记" aria-describedby="signup-emoji-help signup-emoji-error" aria-invalid="false" autocomplete="off" spellcheck="false"><button class="icon-button signup-emoji-toggle" type="button" data-toggle-signup-emoji popovertarget="signup-emoji-popover" aria-label="Choose vacancy Emoji" title="Choose Emoji">🙂</button></div>
        <div class="signup-emoji-popover" id="signup-emoji-popover" data-signup-emoji-popover popover aria-label="Common vacancy Emoji"><div class="signup-emoji-grid">${emojiChoices.map((emoji) => `<button type="button" data-pick-signup-emoji="${emoji}" aria-label="Add ${emoji}">${emoji}</button>`).join("")}</div><div class="signup-emoji-actions"><button type="button" data-clear-signup-emoji>清空</button><button type="button" data-backspace-signup-emoji aria-label="Delete last Emoji">⌫</button></div></div>
      </div>
      <label class="signup-generate-check"><input type="checkbox" data-signup-generation-titles ${preview.includeSpeechDetails ? "checked" : ""}><span>Include speech titles</span></label>
      <small id="signup-emoji-help">Use complete marker as entered, e.g. 🈳, 🙋🙋🙋, 🟡🟡.</small>
      <small class="signup-emoji-error" id="signup-emoji-error" data-signup-generation-error role="alert" hidden></small>
    </div>
    <div class="signup-generate-preview" aria-busy="${preview.busy}">
      <textarea readonly aria-label="Generated signup text">${esc(preview.text)}</textarea>
    </div>
    <footer class="signup-modal-footer"><span class="signup-footer-status" data-signup-generation-status aria-live="polite">${preview.busy ? "Updating preview…" : "Current Agenda · no changes made"}</span><div><button class="button" type="button" data-close-signup-generation>Close</button><button class="button primary" type="button" data-copy-signup-generation ${!preview.text || preview.busy ? "disabled" : ""}>Copy signup</button></div></footer>
  </section></div>`;
}

export function renderSignupAdvisorCard() {
  return `<section class="signup-advisor-toolbar" aria-label="WeChat signup tools">
    <div class="signup-advisor-copy">
      <div class="signup-advisor-heading"><h2>微信接龙</h2><span class="advisor-source signup-ai-meta" title="DeepSeek · ${SIGNUP_IMPORT_MODEL}">AI 导入 · BETA</span></div>
      <p>从群接龙更新本场 Agenda</p>
    </div>
    <div class="signup-advisor-actions"><button class="button primary" data-open-signup-import data-focus-key="signup-import">导入接龙</button><button class="button" data-open-signup-generation data-focus-key="signup-generation">生成接龙</button></div>
  </section>`;
}

function previewSignupAnalysis() {
  const items = allAgendaItems();
  const timerTargets = items.filter((item) => roleIdentity(item.role, item.roleId).id === "timer").map((item) => item.id);
  const speech = items.find((item) => item.kind === "speech" && !item.member) || items.find((item) => item.kind === "speech");
  const member = (name) => state.members.find((candidate) => candidate.displayName.startsWith(name));
  const riley = member("Riley HU");
  const quinn = member("Quinn XU");
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
    exactPerson("preview-timer", "agenda", "member", "Timer · linked role", "role", timerTargets, items.find((item) => timerTargets.includes(item.id))?.member, riley),
    exactPerson("preview-speaker", "agenda", "member", speech?.role || "Prepared Speaker", "speaker", [speech.id], speech.member, quinn),
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
  runtime.overlayReturnFocusKey = "signup-import";
  state.signupImport = {
    ...emptySignupImport(),
    open: true,
    text: state.previewMode ? `Meeting #${state.meeting.meetingNumber}\nDate: ${state.meeting.date}\nTheme: The courage to begin\nMeeting Manager: Alex CHEN\nTimer: Riley HU\nPrepared Speaker 2: Quinn XU\nEvaluator 2: Casey KIM\nSpeech title: A Question Worth Asking` : "",
  };
  renderOverlayRegion();
}

function updateSignupGenerationPreview() {
  const preview = state.signupGeneration;
  const modal = document.querySelector(".signup-generate-modal");
  if (!modal) return;
  const input = modal.querySelector("[data-signup-generation-emoji]");
  const validation = validateVacancyEmoji(preview.vacancyEmoji);
  input?.setAttribute("aria-invalid", String(!validation.valid));
  const error = modal.querySelector("[data-signup-generation-error]");
  if (error) {
    error.textContent = preview.error;
    error.hidden = !preview.error;
  }
  const previewRegion = modal.querySelector(".signup-generate-preview");
  previewRegion?.setAttribute("aria-busy", String(preview.busy));
  const textarea = previewRegion?.querySelector("textarea");
  if (textarea && textarea.value !== preview.text) textarea.value = preview.text;
  const status = modal.querySelector("[data-signup-generation-status]");
  if (status) status.textContent = preview.busy ? "Updating preview…" : "Current Agenda · no changes made";
  const copy = modal.querySelector("[data-copy-signup-generation]");
  if (copy) copy.disabled = !preview.text || preview.busy;
}

async function generateSignupPreview(requestId) {
  const preview = state.signupGeneration;
  if (!preview.open || preview.requestId !== requestId) return;
  preview.busy = true;
  preview.error = "";
  updateSignupGenerationPreview();
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
      updateSignupGenerationPreview();
    }
  }
}

function scheduleSignupPreview(delay = 0) {
  window.clearTimeout(runtime.signupGenerationTimer);
  const requestId = ++state.signupGeneration.requestId;
  runtime.signupGenerationTimer = window.setTimeout(() => generateSignupPreview(requestId), delay);
}

export function updateSignupEmoji(input, delay = 300) {
  state.signupGeneration.vacancyEmoji = input.value;
  const validation = validateVacancyEmoji(input.value);
  state.signupGeneration.error = validation.message;
  input.setAttribute("aria-invalid", String(!validation.valid));
  window.clearTimeout(runtime.signupGenerationTimer);
  if (validation.valid) scheduleSignupPreview(delay);
  else {
    state.signupGeneration.requestId += 1;
    state.signupGeneration.busy = false;
    updateSignupGenerationPreview();
  }
}

function openSignupGeneration() {
  runtime.overlayReturnFocusKey = "signup-generation";
  state.signupGeneration = { ...emptySignupGeneration(), open: true };
  renderOverlayRegion();
  scheduleSignupPreview();
}

function closeSignupGeneration() {
  window.clearTimeout(runtime.signupGenerationTimer);
  state.signupGeneration = emptySignupGeneration();
  renderOverlayRegion(runtime.overlayReturnFocusKey);
  runtime.overlayReturnFocusKey = "";
}

function setSignupEmojiValue(value) {
  const input = document.querySelector("[data-signup-generation-emoji]");
  if (!input) return;
  input.value = value;
  input.focus({ preventScroll: true });
  input.setSelectionRange(value.length, value.length);
  updateSignupEmoji(input);
}

function pickSignupEmoji(emoji) {
  const input = document.querySelector("[data-signup-generation-emoji]");
  if (!input) return;
  if (state.signupGeneration.replaceEmojiOnNextPick) {
    state.signupGeneration.replaceEmojiOnNextPick = false;
    setSignupEmojiValue(emoji);
    return;
  }
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  input.setRangeText(emoji, start, end, "end");
  setSignupEmojiValue(input.value);
}

export function handleSignupEmojiKeydown(event) {
  const button = event.target.closest(".signup-emoji-popover button");
  if (!button || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
  const buttons = [...button.closest(".signup-emoji-popover").querySelectorAll("button")];
  const offset = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -5, ArrowDown: 5 }[event.key];
  const next = Math.max(0, Math.min(buttons.length - 1, buttons.indexOf(button) + offset));
  event.preventDefault();
  buttons[next].focus();
}

function closeSignupImport() {
  const refresh = state.signupImport.step === "success";
  state.signupImport = emptySignupImport();
  if (refresh) render();
  else {
    renderOverlayRegion(runtime.overlayReturnFocusKey);
    runtime.overlayReturnFocusKey = "";
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

export async function handleChange(input, event) {
  if (input.matches("[data-signup-generation-language], [data-signup-generation-emoji], [data-signup-generation-titles]")) {
    if (input.matches("[data-signup-generation-language]")) state.signupGeneration.language = input.value;
    else if (input.matches("[data-signup-generation-emoji]")) {
      state.signupGeneration.vacancyEmoji = input.value;
      if (event.isComposing) return true;
      updateSignupEmoji(input);
      return true;
    }
    else state.signupGeneration.includeSpeechDetails = input.checked;
    scheduleSignupPreview();
  } else if (input.matches("[data-signup-text]")) {
    state.signupImport.text = input.value;
    state.signupImport.error = "";
    const count = input.closest(".signup-import-modal")?.querySelector("[data-signup-count]");
    if (count) count.textContent = `${input.value.length.toLocaleString()} / ${SIGNUP_TEXT_MAX.toLocaleString()}`;
    const analyze = input.closest(".signup-import-modal")?.querySelector("[data-analyze-signup]");
    if (analyze) analyze.disabled = input.value.trim().length < SIGNUP_TEXT_MIN || input.value.trim().length > SIGNUP_TEXT_MAX;
  } else if (input.matches("[data-signup-change-check]")) {
    const change = signupChangeById(input.dataset.signupChangeCheck);
    if (!change) return true;
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
  } else if (input.matches("[data-signup-change-member]")) {
    const change = signupChangeById(input.dataset.signupChangeMember);
    if (!change) return true;
    if (input.value === "__create_guest__") {
      runtime.overlayReturnFocusKey = `signup-member:${change.id}`;
      state.guestPrompt = { kind: "signup", changeId: change.id, defaultName: change.newValue };
      renderOverlayRegion();
      return true;
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
  } else if (input.matches("[data-signup-change-value]")) {
    const change = signupChangeById(input.dataset.signupChangeValue);
    if (change) change.newValue = input.value;
  } else {
    return false;
  }
  return true;
}

export async function handleClick(button, event) {
  if (button.matches("[data-open-signup-generation]")) {
    openSignupGeneration();
  } else if (button.matches("[data-toggle-signup-emoji]")) {
    const popover = document.querySelector("[data-signup-emoji-popover]");
    if (!popover?.matches(":popover-open")) {
      const input = document.querySelector("[data-signup-generation-emoji]");
      const rect = button.getBoundingClientRect();
      popover.style.left = `${Math.max(12, Math.min(window.innerWidth - 276, rect.right - 260))}px`;
      popover.style.top = `${rect.bottom + 196 < window.innerHeight ? rect.bottom + 8 : Math.max(12, rect.top - 188)}px`;
      state.signupGeneration.replaceEmojiOnNextPick = true;
      input?.focus({ preventScroll: true });
      input?.select();
    }
  } else if (button.matches("[data-pick-signup-emoji]")) {
    pickSignupEmoji(button.dataset.pickSignupEmoji);
  } else if (button.matches("[data-clear-signup-emoji]")) {
    state.signupGeneration.replaceEmojiOnNextPick = false;
    setSignupEmojiValue("");
  } else if (button.matches("[data-backspace-signup-emoji]")) {
    state.signupGeneration.replaceEmojiOnNextPick = false;
    const graphemes = splitEmojiGraphemes(state.signupGeneration.vacancyEmoji);
    setSignupEmojiValue(graphemes.slice(0, -1).join(""));
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
  } else {
    return false;
  }
  return true;
}

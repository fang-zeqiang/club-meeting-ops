import { buildMeetingPhases } from "../../advisor-tasks.js";
import { buildQualityMetrics, qualityConfidence, qualityScore } from "../../meeting-quality.js";
import { OFFICER_ROLES } from "../../officer-roles.js";
import { recommendationAdvisorTask } from "../../role-recommendations.js";
import { esc } from "../shared/html.js";
import { apiJson } from "./api.js";
import { DEMO_MODE, STAGE_LABELS, WORKFLOW } from "./contract.js";
import { formatDuration, formatMeetingDate, formatMeetingTime, getValidation, isFinalized, meetingStatusLabel, officerAssignmentsFromMembers, renderAgendaSyncTip, saveStatusText, totalMinutes, validationCounts } from "./derivations.js";
import { elementForFocusKey, flushSave, notify, render, renderToastRegion, replaceRegion, speakingTips } from "./render-engine.js";
import { state } from "./state.js";

export function renderStatusCluster() {
  const { blockers, recommendations } = validationCounts();
  return `<div class="status-cluster" data-region="status">
    <span class="status-pill save-${state.saveStatus}"><span class="status-dot"></span>${esc(saveStatusText())}</span>
    <span class="status-pill">${totalMinutes()} min total</span>
    <span class="status-pill ${blockers ? "has-blockers" : "is-ready"}">${blockers ? `${blockers} blocker${blockers === 1 ? "" : "s"}` : "Ready to finalize"}</span>
    ${recommendations ? `<span class="status-pill">${recommendations} recommendation${recommendations === 1 ? "" : "s"}</span>` : ""}
  </div>`;
}

export function renderStageNavigation() {
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

export function renderMobileActionDock() {
  return `<nav class="mobile-action-dock" aria-label="Mobile workspace controls">
    <div class="mobile-view-switch" aria-label="Workspace view"><button class="${state.mobileView === "edit" ? "active" : ""}" data-mobile-view="edit">Edit</button><button class="${state.mobileView === "preview" ? "active" : ""}" data-mobile-view="preview">Preview</button></div>
  </nav>`;
}

function advisorActionAttrs(item, fallback = false) {
  if (!fallback && item.action.disabled) return 'disabled aria-disabled="true"';
  if (!fallback && item.action.task === "refresh-recommendations") return "data-refresh-recommendations";
  if (!fallback && item.action.task === "voting-console") return `data-open-voting-console data-label="${esc(item.title)}"`;
  const target = fallback ? { ...item.action, task: item.action.task === "voting-console" ? "awards" : item.action.task, focusKey: "" } : item.action;
  return `data-advisor-action data-stage-target="${esc(target.stage)}" data-task="${esc(target.task)}" data-focus-key="${esc(target.focusKey || "")}" data-label="${esc(item.title)}"`;
}

export function renderAdvisorCard(item, mode = "") {
  return `<article class="advisor-task-card ${esc(item.tone || "now")} ${esc(mode)}" ${item.action.loading ? 'role="status" aria-live="polite"' : ""}>
    <div class="advisor-task-meta">
      <span class="advisor-source">${esc(item.source)}</span>
      <span class="advisor-urgency">${esc(item.urgency)}</span>
    </div>
    <h2>${esc(item.title)}</h2>
    <p>${esc(item.reason)}</p>
    <div class="advisor-card-actions">
      <button class="button primary" ${advisorActionAttrs(item)}>${item.action.loading ? '<span class="advisor-loading-mark" aria-hidden="true"></span>' : ""}${esc(item.action.title)}</button>
      ${item.hideAdminAction ? "" : `<button class="button" ${advisorActionAttrs(item, true)}>Open Admin</button>`}
    </div>
  </article>`;
}

export function renderAdvisorHeader() {
  return `<section class="advisor-header">
    <div>
      <span class="eyebrow">Meeting #${esc(state.meeting.meetingNumber)}</span>
      <h1>${esc(state.meeting.theme || "Untitled meeting")}</h1>
      <div class="run-sheet-meta">
        <span>${esc(formatMeetingDate(state.meeting.date))}</span>
        <span>${esc(formatMeetingTime(state.meeting.startTime))}</span>
        <span title="${esc(state.meeting.venue || "Venue not set")}">${esc(state.meeting.venue || "Venue not set")}</span>
        <span class="status-pill status-${esc(state.meeting.status || "draft")}">${esc(meetingStatusLabel(state.meeting.status))}</span>
      </div>
    </div>
  </section>`;
}

function renderMeetingStageStep(phase, index, { currentIndex, allDone, isLast }) {
  const done = allDone || index < currentIndex;
  const current = !allDone && index === currentIndex;
  const closed = allDone && isLast;
  const tone = closed ? "is-closed" : done ? "is-done" : current ? "is-current" : "";
  const dot = closed || done ? "✓" : index + 1;
  const eyebrow = closed ? "Closed" : done ? "Done" : current ? "Current stage" : `Step ${index + 1}`;
  return `<li class="meeting-stage-step ${tone}">
    <div class="meeting-stage-step-bar"></div>
    <div class="meeting-stage-step-head"><span class="meeting-stage-step-dot">${dot}</span><span class="meeting-stage-step-eyebrow">${esc(eyebrow)}</span></div>
    <span class="meeting-stage-step-label">${esc(phase.label)}</span>
  </li>`;
}

export function renderMeetingStageCard(tasks) {
  const phases = buildMeetingPhases({ meeting: state.meeting, votingResults: state.votingResults || (state.awards ? { responseCount: state.awards.responseCount } : null), awards: state.awards });
  const allDone = Boolean(tasks.empty);
  const recruitDone = phases[0].done;
  const recommendationTask = recommendationAdvisorTask(state.roleRecommendations, { previewMode: state.previewMode });
  const primary = allDone ? null : !recruitDone ? recommendationTask : tasks.now;
  const firstPending = phases.findIndex((phase) => !phase.done);
  const resolvedIndex = allDone ? phases.length - 1 : !recruitDone ? 0 : firstPending === -1 ? phases.length - 1 : firstPending;
  const steps = phases.map((phase, index) => renderMeetingStageStep(phase, index, { currentIndex: resolvedIndex, allDone, isLast: index === phases.length - 1 })).join("");
  const item = allDone
    ? { title: tasks.empty.title, reason: tasks.empty.reason, source: "Advisor", urgency: "Done", tone: "done", action: tasks.empty.action }
    : primary;
  const prevLabel = phases[resolvedIndex - 1]?.label;
  const nextLabel = phases[resolvedIndex + 1]?.label;
  return `<section class="meeting-stage-card ${allDone ? "is-complete" : ""}">
    <div class="meeting-stage-accent"></div>
    <div class="meeting-stage-body">
      <ol class="meeting-stage-steps">${steps}</ol>
      <div class="meeting-stage-now">
        ${allDone ? "" : `<span class="meeting-stage-phase-badge">Do next · Phase ${resolvedIndex + 1} of ${phases.length}</span>`}
        ${renderAdvisorCard(item, "large")}
        ${prevLabel || nextLabel ? `<div class="meeting-stage-captions">${prevLabel ? `<span>↑ ${esc(prevLabel)}</span>` : ""}${nextLabel ? `<span>↓ ${esc(nextLabel)}</span>` : ""}</div>` : ""}
      </div>
    </div>
  </section>`;
}

export function saaAction({ id, icon, title, help, status, tone = "neutral", href = "", attrs = "" }) {
  const demoBlocked = DEMO_MODE && href;
  const tag = href && !demoBlocked ? "a" : "button";
  const behavior = href && !demoBlocked
    ? `href="${esc(href)}" target="_blank" rel="noopener"`
    : `type="button" ${demoBlocked ? 'disabled aria-disabled="true" title="Unavailable in demo"' : attrs}`;
  return `<${tag} class="saa-action" ${behavior} aria-describedby="saa-help-${id}">
    <span class="saa-action-top"><span class="saa-action-icon" aria-hidden="true">${icon}</span><span class="saa-action-status ${tone}">${esc(status)}</span></span>
    <span class="saa-action-title"><strong>${esc(title)}</strong><span class="saa-action-info" aria-hidden="true">i</span></span>
    <span class="saa-action-tooltip" id="saa-help-${id}" role="tooltip">${esc(help)}</span>
  </${tag}>`;
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

export function renderRunSheetHeader() {
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

export function renderTaskSidebar() {
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

export function renderClubProfileSummary() {
  const assignments = officerAssignmentsFromMembers();
  const configuredOfficers = Object.values(assignments).filter(Boolean).length;
  return `<section class="section-card"><div class="section-heading"><div><span class="eyebrow">Shared profile</span><h2>Club profile</h2></div><button class="button" data-club-settings data-focus-key="club-settings">Manage club settings</button></div><div class="section-content profile-status-grid"><span><strong>${configuredOfficers}/${OFFICER_ROLES.length}</strong> officers assigned</span><span><strong>${state.groupQr.present ? "Ready" : "Missing"}</strong> guest group QR</span><span><strong>${state.officerTeamPhoto.present ? "Ready" : "Missing"}</strong> officer photo</span></div></section>`;
}

export function renderFinalizeTask() {
  const { blockers, recommendations } = validationCounts();
  return `<section class="section-card finalize-card"><div class="section-heading"><div><span class="eyebrow">Agenda state</span><h2>${isFinalized() ? "Agenda finalized" : "Finalize meeting"}</h2></div></div><div class="section-content">
    <p>${isFinalized() ? "Preparation content is locked. Live Execution remains available." : blockers ? `Resolve ${blockers} blocker${blockers === 1 ? "" : "s"} before finalizing.` : recommendations ? `${recommendations} recommendation${recommendations === 1 ? "" : "s"} remain. They do not block finalization.` : "All checks passed. This meeting is ready to finalize."}</p>
    ${isFinalized() ? '<button class="button" data-reopen-meeting>Reopen for editing</button>' : `<button class="button primary" data-finalize-meeting data-focus-key="finalize-meeting" ${blockers ? "disabled" : ""}>Finalize meeting</button>`}
  </div></section>`;
}

export function renderShareTask() {
  const { blockers } = validationCounts();
  const presentationUrl = `/m/${encodeURIComponent(state.meeting.meetingNumber)}/presentation`;
  const presentation = DEMO_MODE
    ? '<button class="button primary presentation-open" disabled title="Unavailable in demo">Open presentation</button>'
    : `<a class="button primary presentation-open" href="${esc(presentationUrl)}" target="_blank" rel="noopener">Open presentation</a>`;
  return `<section class="section-card"><div class="section-heading"><div><span class="eyebrow">Distribution</span><h2>Share or print</h2></div></div><div class="section-content share-actions">${presentation}<button class="button" data-summary>Copy group summary</button><button class="button" data-print>Print / PDF</button>${blockers ? `<span class="presentation-note">Agenda has blockers</span>` : ""}</div></section>`;
}

export function renderMeetingDayChecklist() {
  return `<section class="section-card meeting-day-checklist"><div class="section-heading"><div><span class="eyebrow">Meeting Manager SOP</span><h2>Meeting-day materials</h2></div></div><div class="section-content"><ul><li>Prepare thank-you gifts for sharing guests</li><li>Prepare welcome gifts for new members</li></ul></div></section>`;
}

export function renderMcpChangesTask() {
  if (state.mcpChanges.busy) return `<section class="section-card"><div class="section-heading"><div><span class="eyebrow">MCP audit</span><h2>Loading changes…</h2></div></div></section>`;
  if (state.mcpChanges.error) return `<section class="section-card"><div class="section-heading"><div><span class="eyebrow">MCP audit</span><h2>Changes unavailable</h2></div><button class="button" data-reload-mcp-changes>Retry</button></div><div class="section-content"><p>${esc(state.mcpChanges.error)}</p></div></section>`;
  const rows = state.mcpChanges.items.map((audit) => {
    const canRecover = audit.canRecover && Number(audit.afterRevision) === Number(state.meeting.revision);
    return `<article class="mcp-change-row">
      <header><div><strong>revision ${esc(audit.beforeRevision)} → ${esc(audit.afterRevision || "—")}</strong><span>${esc(audit.principalName || "Unknown operator")} · ${esc(audit.createdAt || "")}</span></div><b class="mcp-change-status">${esc(audit.status || "unknown")}</b></header>
      <ul>${(audit.diff || []).map((change) => `<li><strong>${esc(change.label)}</strong><span>${esc(change.before ?? "—")} → ${esc(change.after ?? "—")}</span></li>`).join("") || "<li>No user-facing diff recorded.</li>"}</ul>
      ${audit.canRecover ? `<button class="button ${canRecover ? "danger-link" : ""}" data-recover-mcp-change="${esc(audit.operationId)}" ${canRecover ? "" : "disabled"}>${canRecover ? "Restore this change" : "Later revision exists · manual recovery"}</button>` : ""}
    </article>`;
  }).join("");
  return `<section class="section-card mcp-changes-card"><div class="section-heading"><div><span class="eyebrow">MCP audit & recovery</span><h2>Conversational edits</h2></div><button class="button" data-reload-mcp-changes>Refresh</button></div><div class="section-content">${rows || "<p>No MCP Agenda changes recorded for this meeting.</p>"}</div></section>`;
}

export function evaluationForms() {
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

export function renderEvaluationForms() {
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
    responseCount: state.votingResults?.responseCount || state.awards?.responseCount || 0,
    feedback: state.votingResults?.feedback || null,
    awardsReady: Boolean(state.awards?.ready),
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

export function renderMeetingReviewTask() {
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

export function renderAdvisorOriginBanner() {
  if (!state.advisorOriginLabel) return "";
  return `<div class="advisor-origin-banner">
    <span>From Advisor: ${esc(state.advisorOriginLabel)}</span>
    <button class="button" data-view="advisor">Back to Advisor</button>
  </div>`;
}

export function highlightAdvisorTarget(focusKey) {
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

export async function loadMcpChanges() {
  if (!state.meeting?.id || state.previewMode) return;
  state.mcpChanges = { ...state.mcpChanges, busy: true, error: "" };
  if (state.activeTask === "mcp-changes") render();
  try {
    const result = await apiJson(`/api/meetings/${encodeURIComponent(state.meeting.id)}?action=mcp-audit`);
    state.mcpChanges = { items: result.audits || [], busy: false, error: "" };
  } catch (error) {
    state.mcpChanges = { items: [], busy: false, error: error.message };
  }
  if (state.activeTask === "mcp-changes") render();
}

export async function handleChange(input, event) {
  if (input.matches("[data-review-field]")) {
    const key = input.dataset.reviewField;
    state.meeting.review = state.meeting.review && typeof state.meeting.review === "object" ? state.meeting.review : {};
    state.meeting.review[key] = key === "skippedReason"
      ? input.value
      : input.value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    return true;
  }
  return false;
}

export async function handleClick(button, event) {
  if (button.matches("[data-reload-mcp-changes]")) {
    await loadMcpChanges();
  } else if (button.matches("[data-advisor-toggle]")) {
    const lane = button.dataset.advisorToggle;
    state.advisorExpanded[lane] = !state.advisorExpanded[lane];
    render();
  } else if (button.matches("[data-stage]")) {
    state.activeStage = button.dataset.stage;
    state.activeTask = isFinalized() && state.activeStage === "preparation" ? "review-share" : WORKFLOW[state.activeStage][0].id;
    render();
  } else if (button.matches("[data-mobile-view]")) {
    state.mobileView = button.dataset.mobileView;
    render();
  } else if (button.matches("[data-issue-index]")) {
    navigateToIssue(getValidation()[Number(button.dataset.issueIndex)]);
  } else if (button.matches("[data-preview-block]")) {
    navigateFromPreview(button.dataset.previewBlock, button.dataset.previewItem || "");
  } else if (button.matches("[data-complete-review]")) {
    await saveMeetingReview("complete");
  } else if (button.matches("[data-skip-review]")) {
    await saveMeetingReview("skip");
  } else {
    return false;
  }
  return true;
}

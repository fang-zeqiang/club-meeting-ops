import { buildAdvisorTasks } from "../../advisor-tasks.js";
import { OFFICER_ROLES } from "../../officer-roles.js";
import { renderThemeSwitcher } from "../../theme.js";
import { agendaPrintRecommendation, groupMeetingsForSwitchboard, isShanghaiMeetingToday } from "../../workflow-helpers.js";
import { esc } from "../shared/html.js";
import { evaluationForms, renderAdvisorCard, renderAdvisorHeader, renderAdvisorOriginBanner, renderClubProfileSummary, renderEvaluationForms, renderFinalizeTask, renderMcpChangesTask, renderMeetingDayChecklist, renderMeetingReviewTask, renderMeetingStageCard, renderMobileActionDock, renderRunSheetHeader, renderShareTask, renderStageNavigation, renderStatusCluster, renderTaskSidebar, saaAction } from "./advisor-workflow.js";
import { renderBlockEditor, renderBlockList, renderMemberSelect, renderMetaEditor, renderValidation } from "./agenda-editor.js";
import { bindAgendaPreviewSizing, renderPreviewOutput, renderPreviewToolbar } from "./agenda-preview.js";
import { DEMO_MODE, STAGE_LABELS, STORAGE_KEYS, WORKFLOW } from "./contract.js";
import { activeVotingImage, getValidation, isFinalized, isFuturePostersTask, officerAssignmentsFromMembers, renderAgendaSyncTip, renderQrFrame, validationCounts } from "./derivations.js";
import { setWorkspacePreviewWidth } from "./events.js";
import { renderGuestWorkspace, renderLogin, renderMeetingNavigator, renderSaveStatus, renderWorkspaceIdentity } from "./lifecycle-sync.js";
import { renderClubIntroPhotoEditor, renderFuturePostersTask, renderImageEditor, renderOfficerImageEditor } from "./media.js";
import { renderGuestPrompt, renderMemberPickerPrompt, renderRolePrompt } from "./member-picker.js";
import { renderAgendaImagePrompt, renderPrintPrompt } from "./print-export.js";
import { renderAboutProductPrompt, renderConflictPrompt, renderMeetingSwitchboardRow, renderMigrationPrompt, renderRenameTemplatePrompt, renderSaveTemplatePrompt, renderTemplatePrompt, renderToastRegionMarkup } from "./prompts.js";
import { renderOutreachPrompt, renderRecommendationExclusionPrompt, renderRoleRecommendations } from "./recommendations.js";
import { bindEvents, bindLogin, finishRender, speakingTips } from "./render-engine.js";
import { renderSignupAdvisorCard, renderSignupGenerationPrompt, renderSignupImportPrompt } from "./signup.js";
import { defaultMeeting, state } from "./state.js";
import { votingCandidateDiff } from "./voting-actions.js";
import { renderAwardsEditor, renderCandidateSummary, renderLiveVoting, renderTableTopicsTask, renderVotingConsolePrompt, renderVotingSource } from "./voting-awards.js";

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
        ${!prepared ? `<button class="button primary" data-voting-prepare ${busy || state.previewMode ? "disabled" : ""} title="${state.previewMode ? "Unavailable in demo" : ""}">${state.votingBusy === "prewarm" ? "Preparing ahead…" : state.votingBusy === "prepare" ? "Preparing…" : "Prepare voting form"}</button>` : diff.needsUpdate ? `<button class="button primary" data-voting-sync ${busy || state.previewMode ? "disabled" : ""}>${state.votingBusy === "prewarm" ? "Syncing ahead…" : state.votingBusy === "sync" ? "Updating…" : "Update voting form"}</button>` : ""}
        ${prepared && m.votingForm?.shareUrl ? `<a class="button" href="${esc(m.votingForm.shareUrl)}" target="_blank" rel="noopener">Preview form ↗</a>` : ""}
        ${prepared ? `<details class="voting-more"><summary>More</summary><div>${m.votingForm?.editUrl ? `<a href="${esc(m.votingForm.editUrl)}" target="_blank" rel="noopener">Edit voting table ↗</a>` : ""}<button data-voting-prepare>Repair voting form</button></div></details>` : ""}
      </div>
      ${state.votingProgress ? `<p class="voting-progress" role="status">${esc(state.votingProgress)}</p>` : ""}
      ${busy && state.votingBusy !== "prewarm" ? renderAgendaSyncTip(state.votingProgress || "Syncing voting data…") : ""}
      ${prepared && !authorizationReady ? `<div class="voting-alert"><span>${esc(authorization?.message || "Editor authorization is pending.")}</span><button class="text-button" data-voting-authorize>${state.votingBusy === "authorize" ? "Retrying…" : "Retry authorization"}</button></div>` : ""}
    </div></article>`;
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

function renderMeetingSwitchboard() {
  const { next, nearby, more } = groupMeetingsForSwitchboard(state.meetings);
  const meetingRows = [
    next ? renderMeetingSwitchboardRow(next, isShanghaiMeetingToday(next) ? "Today’s meeting" : "Next meeting") : "",
    next && nearby.length ? '<div class="switchboard-divider" role="separator"><span>Nearby meetings</span></div>' : "",
    ...nearby.map((meeting) => renderMeetingSwitchboardRow(meeting)),
    more.length ? `<details class="switchboard-more"><summary><span><strong>More meetings</strong><small>${more.length} hidden · expand full list</small></span><i aria-hidden="true">⌄</i></summary><div class="switchboard-more-list">${more.map((meeting) => renderMeetingSwitchboardRow(meeting)).join("")}</div></details>` : "",
  ].join("");
  return `<main class="switchboard-shell">
    <header class="topbar switchboard-topbar">
      ${renderWorkspaceIdentity()}
      <div class="topbar-actions">${renderThemeSwitcher()}<details class="more-menu"><summary class="icon-button" aria-label="More actions">•••</summary><div class="more-menu-popover"><button data-new-meeting>New meeting</button><button data-about-product>About Product</button>${DEMO_MODE ? '<button data-reset-demo>Reset demo</button>' : '<button data-sign-out>Sign out</button>'}</div></details></div>
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
  const resultStatus = unavailable
    ? ["Status unavailable", "error"]
    : checking
      ? ["Checking…", "loading"]
      : state.awards?.ready
        ? ["Ready", "ready"]
        : ["Waiting", "warning"];
  const awardUrl = `/m/${encodeURIComponent(state.meeting.meetingNumber)}/presentation?jump=awards`;
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
        ${saaAction({ id: "agenda-image", icon: "▣", title: "生成分享长图", help: DEMO_MODE ? "Demo 模式下不可生成长图。" : "生成当前 Agenda 首页长图，可长按保存或下载 PNG。", status: DEMO_MODE ? "Unavailable" : "PNG", attrs: DEMO_MODE ? 'disabled aria-disabled="true" title="Unavailable in demo"' : 'data-share-agenda-image data-focus-key="share-agenda-image"' })}
        ${saaAction({ id: "evaluations", icon: "▤", title: "Print Evaluation Forms", help: "Print one official form per prepared speech as needed. Use color and double-sided printing.", status: evaluationStatus[0], tone: evaluationStatus[1], attrs: 'data-advisor-action data-stage-target="preparation" data-task="review-share" data-focus-key="evaluation-forms" data-label="Print Evaluation Forms"' })}
        </div></section>
      <section class="support-shortcut-group support-shortcut-live"><div class="support-shortcut-group-head"><div><span class="eyebrow">During meeting</span><h3>Run of show</h3></div><small>Useful for rehearsal</small></div><div class="saa-action-grid">
        ${saaAction({ id: "presentation", icon: "▶", title: "Open Presentation", help: "Launch the public meeting presentation in a new tab.", status: blockers ? `${blockers} blocker${blockers === 1 ? "" : "s"}` : "Ready", tone: blockers ? "warning" : "ready", href: `/m/${encodeURIComponent(state.meeting.meetingNumber)}/presentation` })}
        ${saaAction({ id: "voting", icon: "✓", title: "Manage Voting", help: "Open Admin · Live Execution · Open voting.", status: votingStatus[0], tone: votingStatus[1], attrs: 'data-advisor-action data-stage-target="live" data-task="start-voting" data-label="Manage Voting"' })}
        ${saaAction({ id: "review-results", icon: "◎", title: "Review Results", help: "Review live voting totals before presenting awards.", status: resultStatus[0], tone: resultStatus[1], attrs: state.previewMode ? 'disabled aria-disabled="true" title="Unavailable in demo"' : 'data-open-voting-console data-label="Review Results"' })}
        ${saaAction({ id: "awards", icon: "★", title: "Present Awards", help: "Open Awards in the meeting presentation. Certificates appear when live results are available.", status: resultStatus[0], tone: resultStatus[1], href: awardUrl })}
      </div></section>
    </div>
  </section>`;
}

function renderAdvisorHome() {
  const tasks = buildAdvisorTasks({ meeting: state.meeting, issues: getValidation(), votingResults: state.votingResults || (state.awards ? { responseCount: state.awards.responseCount } : null), awards: state.awards });
  const promotesSignup = state.meeting.status === "draft";
  const risks = state.advisorExpanded.risk ? tasks.risks : tasks.risks.slice(0, 3);
  const more = (lane, items) => items.length > 3
    ? `<button class="advisor-more" type="button" data-advisor-toggle="${lane}" aria-expanded="${state.advisorExpanded[lane]}">${state.advisorExpanded[lane] ? "Show less" : `More (${items.length - 3})`}</button>`
    : "";
  return `<main class="advisor-home">
    ${renderAdvisorHeader()}
    ${promotesSignup ? renderSignupAdvisorCard() : ""}
    ${renderMeetingStageCard(tasks)}
    <section class="advisor-lane risk-lane" aria-label="Risks">
      <div class="advisor-lane-head"><span class="eyebrow">Risk</span><strong>${risks.length ? "Needs attention" : "No major risk"}</strong></div>
      ${risks.length ? risks.map((item) => renderAdvisorCard(item)).join("") : '<p class="advisor-lane-empty">No blockers affecting meeting flow.</p>'}
      ${more("risk", tasks.risks)}
    </section>
    ${renderSaaQuickActions()}
  </main>`;
}

function renderVotingTask({ includeUpload = false } = {}) {
  if (state.meeting.meetingType === "contest") return `<section class="section-card" data-region="media"><div class="section-heading"><div><span class="eyebrow">Meeting voting</span><h2>No public voting</h2></div></div><div class="section-content"><p class="award-help">演讲模拟赛不设公开投票；Ballot Counter 汇总评委结果后，在 Awards 录入前三名。</p><div class="add-row"><button class="button primary" data-task="awards" data-stage-target="live">Go to Awards</button></div></div></section>`;
  return `<section class="section-card" data-region="media"><div class="section-heading"><div><span class="eyebrow">Meeting voting</span><h2>${includeUpload ? "Prepare voting" : "Live voting"}</h2></div></div><div class="section-content image-upload-list">${includeUpload ? renderVotingPreparation() : renderLiveVoting()}</div></section>`;
}

function renderReviewShareTask() {
  return `${renderMeetingDayChecklist()}${renderEvaluationForms()}${renderClubProfileSummary()}${renderValidation()}${renderShareTask()}${renderFinalizeTask()}`;
}

function renderActiveTask() {
  let content = "";
  switch (state.activeTask) {
    case "meeting-details": content = renderMetaEditor(); break;
    case "build-agenda": content = `${renderBlockList()}${renderBlockEditor()}`; break;
    case "prepare-voting": content = `${renderVotingTask({ includeUpload: true })}${renderTableTopicsTask()}`; break;
    case "future-posters": content = renderFuturePostersTask(); break;
    case "mcp-changes": content = renderMcpChangesTask(); break;
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

function renderOverlayRegionMarkup() {
  return `<div data-region="overlays">
    ${renderVotingConsolePrompt()}
    ${renderMigrationPrompt()}
    ${renderConflictPrompt()}
    ${renderTemplatePrompt()}
    ${renderRenameTemplatePrompt()}
    ${renderSaveTemplatePrompt()}
    ${renderPrintPrompt()}
    ${renderAgendaImagePrompt()}
    ${renderClubSettingsPrompt()}
    ${renderAboutProductPrompt()}
    ${renderSignupImportPrompt()}
    ${renderSignupGenerationPrompt()}
    ${renderGuestPrompt()}
    ${renderRolePrompt()}
    ${renderMemberPickerPrompt()}
    ${renderOutreachPrompt()}
    ${renderRecommendationExclusionPrompt()}
  </div>`;
}

export function render() {
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
  const storedPreviewWidth = Number(localStorage.getItem(STORAGE_KEYS.previewPaneWidth));
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
        ${renderWorkspaceIdentity()}
        ${renderMeetingNavigator()}
        <div class="topbar-actions">
          ${state.activeView === "advisor"
            ? '<button class="button primary advisor-nav-action" data-view="admin">Open Admin</button>'
            : '<button class="button advisor-nav-action advisor-nav-back" data-view="advisor" aria-label="Back to Advisor"><span class="advisor-nav-label-full">Back to Advisor</span><span class="advisor-nav-label-short" aria-hidden="true">Advisor</span></button>'}
          ${renderSaveStatus()}
          ${renderThemeSwitcher()}
          <details class="more-menu"><summary class="icon-button" aria-label="More actions">•••</summary><div class="more-menu-popover"><button data-new-meeting>New meeting</button><button data-club-settings>Club settings</button>${state.previewMode ? "" : '<button data-save-template data-focus-key="save-template">Save as template</button>'}<button data-export-json>Export JSON</button><a href="/education">Education</a><button data-about-product>About Product</button>${DEMO_MODE ? '<button data-reset-demo>Reset demo</button>' : '<button data-sign-out>Sign out</button>'}</div></details>
        </div>
      </header>
      ${state.activeView === "advisor" ? renderAdvisorHome() : state.activeView === "recommendations" ? renderRoleRecommendations() : adminMarkup}
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

export const regions = {
  navigator: renderMeetingNavigator,
  "workflow-sidebar": renderTaskSidebar,
  media: () => state.activeTask === "prepare-voting"
    ? renderVotingTask({ includeUpload: true })
    : state.activeTask === "future-posters" ? renderFuturePostersTask()
      : state.activeTask === "start-voting" ? renderVotingTask() : renderMediaEditor(),
  officers: renderOfficerEditor,
  awards: renderAwardsEditor,
  "saa-quick-actions": renderSaaQuickActions,
  "block-list": renderBlockList,
  "block-editor": renderBlockEditor,
  validation: renderValidation,
  status: renderStatusCluster,
  preview: renderPreviewOutput,
  toast: renderToastRegionMarkup,
  overlays: renderOverlayRegionMarkup,
};

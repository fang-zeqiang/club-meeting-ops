import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const APP_DIR = new URL("../src/app/", import.meta.url);
const appSource = await readFile(new URL("../app.js", import.meta.url), "utf8");
const renderSource = await readFile(new URL("../src/app/render.js", import.meta.url), "utf8");
const eventsSource = await readFile(new URL("../src/app/events.js", import.meta.url), "utf8");
const orchestrationSource = await readFile(new URL("../src/app/orchestration.js", import.meta.url), "utf8");
// app.js 已收缩为入口,原先针对整份 app.js 的"不得出现"断言必须扫描 app.js + 全部 src/app 模块才等价,
// 只盯单个 feature 文件会让被删掉的东西挪到隔壁模块也照样通过
const appModuleFiles = (await readdir(APP_DIR)).filter((file) => file.endsWith(".js")).sort();
const appAll = [appSource, ...(await Promise.all(appModuleFiles.map((file) => readFile(new URL(file, APP_DIR), "utf8"))))].join("\n");
const contractSource = await readFile(new URL("../src/app/contract.js", import.meta.url), "utf8");
const stateSource = await readFile(new URL("../src/app/state.js", import.meta.url), "utf8");
const derivationsSource = await readFile(new URL("../src/app/derivations.js", import.meta.url), "utf8");
const renderEngineSource = await readFile(new URL("../src/app/render-engine.js", import.meta.url), "utf8");
const printExportSource = await readFile(new URL("../src/app/print-export.js", import.meta.url), "utf8");
const mediaSource = await readFile(new URL("../src/app/media.js", import.meta.url), "utf8");
const votingAwardsSource = await readFile(new URL("../src/app/voting-awards.js", import.meta.url), "utf8");
const votingActionsSource = await readFile(new URL("../src/app/voting-actions.js", import.meta.url), "utf8");
const signupSource = await readFile(new URL("../src/app/signup.js", import.meta.url), "utf8");
const memberPickerSource = await readFile(new URL("../src/app/member-picker.js", import.meta.url), "utf8");
const recommendationsSource = await readFile(new URL("../src/app/recommendations.js", import.meta.url), "utf8");
const promptsSource = await readFile(new URL("../src/app/prompts.js", import.meta.url), "utf8");
const advisorWorkflowSource = await readFile(new URL("../src/app/advisor-workflow.js", import.meta.url), "utf8");
const agendaEditorSource = await readFile(new URL("../src/app/agenda-editor.js", import.meta.url), "utf8");
const agendaPreviewSource = await readFile(new URL("../src/app/agenda-preview.js", import.meta.url), "utf8");
const lifecycleSyncSource = await readFile(new URL("../src/app/lifecycle-sync.js", import.meta.url), "utf8");
const workspaceLoaderSource = await readFile(new URL("../src/app/workspace-loader.js", import.meta.url), "utf8");
const awardRepositorySource = await readFile(new URL("../server/award-repository.js", import.meta.url), "utf8");
const stylesSource = await readFile(new URL("../styles.css", import.meta.url), "utf8");
const speakingTipSource = await readFile(new URL("../speaking-tips.js", import.meta.url), "utf8");
const speakingTipStyles = await readFile(new URL("../speaking-tip-card.css", import.meta.url), "utf8");
const productUpdatesSource = await readFile(new URL("../docs/CHANGELOG.md", import.meta.url), "utf8");
const advisorTasksSource = await readFile(new URL("../advisor-tasks.js", import.meta.url), "utf8");

test("More menu opens the compact bilingual product history", () => {
  assert.match(promptsSource, /import productUpdatesMarkdown from "\.\.\/\.\.\/docs\/CHANGELOG\.md\?raw"/);
  assert.match(renderSource, /data-about-product>About Product/);
  assert.match(promptsSource, /function renderAboutProductPrompt/);
  assert.match(productUpdatesSource, /Club Meeting Ops connects role booking/);
  assert.equal(productUpdatesSource.match(/^- 2026-/gm)?.length, 7);
});

test("workspace exposes lifecycle stages and task navigation", () => {
  for (const label of ["Preparation", "Live Execution", "Review"]) assert.match(contractSource, new RegExp(label));
  for (const task of ["Meeting details", "Build agenda", "Prepare voting", "Future posters", "Review & share", "Start voting", "Awards", "Meeting review"]) assert.match(contractSource, new RegExp(task.replace(/[&]/g, "\\&")));
  assert.doesNotMatch(appAll, /Publication Check/);
  assert.doesNotMatch(appAll, /Preview & finalize/);
  assert.match(advisorWorkflowSource, /data-stage=/);
  assert.match(advisorWorkflowSource, /data-task=/);
  assert.match(stylesSource, /\.stage-tab > \.stage-index/);
  assert.doesNotMatch(stylesSource, /\.stage-tab span,/);
});

test("meeting advisor v2a opens a cue desk before admin", () => {
  assert.match(advisorWorkflowSource, /Meeting Advisor/);
  assert.match(stateSource, /activeView: "advisor"/);
  assert.match(renderSource, /function renderAdvisorHome/);
  assert.match(renderSource, /Open Admin/);
  assert.match(renderSource, /Back to Advisor/);
  assert.match(advisorWorkflowSource, /advisor-origin-banner/);
  assert.match(stylesSource, /\.advisor-home/);
  assert.match(stylesSource, /\.meeting-stage-card/);
  assert.match(stylesSource, /\.topbar-actions \.advisor-nav-action/);
  assert.match(advisorWorkflowSource, /data-complete-review/);
  assert.match(advisorWorkflowSource, /data-skip-review/);
  assert.match(mediaSource, /Future meeting posters/);
  assert.match(mediaSource, /Club introduction photo/);
  assert.match(mediaSource, /1920 \/ Math\.max\(image\.naturalWidth, image\.naturalHeight\)/);
  assert.match(mediaSource, /canvas\.toBlob\(resolve, "image\/jpeg", 0\.82\)/);
  assert.match(renderSource, /case "future-posters": content = renderFuturePostersTask\(\)/);
  assert.match(stylesSource, /\.quality-board/);
});

test("Advisor exposes fixed SAA controls with live status routing", () => {
  assert.match(renderSource, /function renderSaaQuickActions/);
  const advisorHome = renderSource.slice(renderSource.indexOf("function renderAdvisorHome"), renderSource.indexOf("function renderVotingTask"));
  assert.ok(advisorHome.indexOf("renderMeetingStageCard(tasks)") < advisorHome.indexOf("renderSaaQuickActions()"));
  for (const label of ["Meeting Support Shortcut", "Print Agenda", "Open Presentation", "Manage Voting", "Review Results", "Present Awards", "Print Evaluation Forms"]) {
    assert.match(renderSource, new RegExp(label));
  }
  for (const label of ["Before meeting", "MM desk", "Print pack", "PHYSICAL", "During meeting", "Run of show", "Useful for rehearsal"]) {
    assert.match(renderSource, new RegExp(label.replace("+", "\\+")));
  }
  for (const label of ["Download Agenda PDF", "生成分享长图", "DIGITAL · 1 PDF / 2 PAGES", "Preparing…", "Retry"]) {
    assert.match(renderSource, new RegExp(label.replace("+", "\\+")));
  }
  assert.match(renderSource, /agendaPrintRecommendation\(state\.meeting\)/);
  assert.match(printExportSource, /data-print-form[\s\S]*Agenda sets[\s\S]*field-info[\s\S]*attendance buffer[\s\S]*name="copies"[\s\S]*Select a color printer[\s\S]*Color \+ Double-sided/);
  assert.doesNotMatch(appAll, /SAA Quick Actions|Five fixed controls|Live control/);
  assert.match(renderSource, /Status unavailable/);
  assert.match(renderSource, /Checking…/);
  assert.match(eventsSource, /loadAwards\(\{ quiet: true \}\)/);
  assert.match(renderSource, /data-stage-target="live" data-task="start-voting"/);
  assert.match(renderSource, /data-open-voting-console/);
  assert.match(renderSource, /data-stage-target="preparation" data-task="review-share" data-focus-key="evaluation-forms"/);
  assert.match(renderSource, /data-download-agenda-pdf/);
  assert.match(renderSource, /saaAction\(\{ id: "agenda-image"[\s\S]*data-share-agenda-image/);
  assert.match(printExportSource, /async function downloadAgendaPdf\(\)/);
  assert.match(printExportSource, /\/api\/preview-agenda\.pdf/);
  assert.match(printExportSource, /\/api\/meetings\/\$\{encodeURIComponent\(state\.meeting\.id\)\}\?action=pdf/);
  assert.match(advisorWorkflowSource, /function renderEvaluationForms/);
  assert.match(advisorWorkflowSource, /pdfUrl: form && project && form\.projectId === project\.projectId \? form\.pdfUrl : ""/);
  assert.match(stylesSource, /\.support-shortcut-groups\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\)/s);
  assert.match(stylesSource, /\.print-pack-route\s*\{[^}]*grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/s);
  assert.match(stylesSource, /\.support-shortcut-live \.saa-action-grid\s*\{[^}]*grid-template-columns: repeat\(4/s);
  assert.match(stylesSource, /@media screen and \(max-width: 720px\)[\s\S]*\.print-pack-route\s*\{[^}]*grid-template-columns: 1fr/s);
  assert.doesNotMatch(stylesSource, /\.agenda-pdf-shortcut\s*\{/);
  assert.match(stylesSource, /\.support-shortcut-group-stats\s*\{/);
  assert.match(stylesSource, /@media screen and \(max-width: 680px\)[\s\S]*\.saa-action-grid\s*\{[^}]*grid-template-columns: repeat\(2/s);
  assert.match(stylesSource, /@media \(hover: none\)[\s\S]*\.saa-action-tooltip/);
  assert.match(stylesSource, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.saa-action/);
});

test("WeChat signup is a draft-only toolbar above Advisor tasks", () => {
  assert.match(signupSource, /class="signup-advisor-toolbar"/);
  assert.match(signupSource, /微信接龙/);
  assert.match(signupSource, /从群接龙更新本场 Agenda/);
  assert.match(signupSource, /class="advisor-source signup-ai-meta"[\s\S]*AI 导入 · BETA/);
  assert.match(signupSource, /DeepSeek · \$\{SIGNUP_IMPORT_MODEL\}/);
  assert.match(renderSource, /\$\{renderAdvisorHeader\(\)\}[\s\S]*\$\{promotesSignup \? renderSignupAdvisorCard\(\) : ""\}[\s\S]*\$\{renderMeetingStageCard\(tasks\)\}/);
  assert.doesNotMatch(appAll, /promotesSignup \? \[tasks\.now/);
  assert.match(signupSource, /data-open-signup-import/);
  assert.doesNotMatch(appAll, /signup-more-entry/);
  assert.doesNotMatch(stylesSource, /\.signup-more-entry/);
  assert.match(signupSource, /data-analyze-signup/);
  assert.match(signupSource, /data-apply-signup/);
  assert.match(signupSource, /action=analyze-signup/);
  assert.match(stylesSource, /\.signup-advisor-toolbar/);
  assert.match(stylesSource, /\.signup-import-modal/);
  assert.match(stylesSource, /\.signup-review-screen/);
});

test("Advisor generates copy-ready signup text through the shared server rule", () => {
  assert.match(recommendationsSource, /data-open-signup-generation/);
  assert.match(signupSource, /action=generate-signup/);
  assert.match(signupSource, /data-signup-generation-language[\s\S]*中英双语[\s\S]*中文[\s\S]*English/);
  assert.match(signupSource, /data-signup-generation-emoji/);
  assert.match(signupSource, /data-signup-generation-titles/);
  assert.match(signupSource, /navigator\.clipboard\.writeText\(state\.signupGeneration\.text\)/);
  assert.match(stylesSource, /\.signup-generate-controls/);
});

test("signup Emoji picker keeps controls mounted and patches only preview state", () => {
  const generatePreviewSource = signupSource.slice(signupSource.indexOf("async function generateSignupPreview"), signupSource.indexOf("function scheduleSignupPreview"));
  assert.match(signupSource, /data-signup-emoji-popover popover/);
  assert.match(signupSource, /🌸[\s\S]*🌼[\s\S]*🌺[\s\S]*🌻[\s\S]*🌹/);
  assert.match(signupSource, /function updateSignupGenerationPreview\(\)[\s\S]*textarea\.value = preview\.text/);
  assert.doesNotMatch(generatePreviewSource, /renderOverlayRegion\(\)/);
  assert.match(signupSource, /event\.isComposing/);
  assert.match(signupSource, /splitEmojiGraphemes[\s\S]*slice\(0, -1\)/);
  assert.match(stylesSource, /\.signup-emoji-popover[\s\S]*\.signup-emoji-grid/);
});

test("Advisor shows a single 5-phase Meeting Stage card instead of a current-stage label", () => {
  assert.doesNotMatch(appAll, /advisor-current-stage/);
  assert.doesNotMatch(appAll, /class="advisor-stage-strip"/);
  assert.match(advisorTasksSource, /export function buildMeetingPhases/);
  assert.match(advisorTasksSource, /"Recruit and coordinate"[\s\S]*"Prepare meeting"[\s\S]*"Finalize and rehearse"[\s\S]*"Run meeting"[\s\S]*"Close meeting"/);
  assert.match(advisorWorkflowSource, /function renderMeetingStageCard/);
  assert.match(advisorWorkflowSource, /class="meeting-stage-steps"/);
  assert.match(renderSource, /data-advisor-toggle="\$\{lane\}"/);
  assert.match(orchestrationSource, /state\.advisorExpanded = \{ risk: false \}/);
});

test("member picker keeps the full directory and resets scroll after search", () => {
  assert.match(memberPickerSource, /const groups = groupMemberOptions\(state\.members\);/);
  assert.match(memberPickerSource, /results\.scrollTop = 0/);
  assert.match(stylesSource, /\.member-picker-option\[hidden\]\s*\{\s*display: none;/);
  assert.match(memberPickerSource, /member-picker-guest-tag">Guest/);
  assert.match(stylesSource, /\.member-picker-group > h3,[\s\S]*position: sticky/);
});

test("Club settings can replace the shared WeChat payment QR code", () => {
  assert.match(renderSource, /function renderClubSettingsPrompt\(\)[\s\S]*renderImageEditor\("wechat-payment-qr"[\s\S]*state\.paymentQr/);
  const clubSettings = renderSource.slice(renderSource.indexOf("function renderClubSettingsPrompt"), renderSource.indexOf("function renderSaaQuickActions"));
  assert.doesNotMatch(clubSettings, /Future meeting posters/);
});

test("future posters are a required global preparation step with exact presentation preview", () => {
  assert.match(contractSource, /id: "prepare-voting"[\s\S]*id: "future-posters"[\s\S]*id: "review-share"/);
  assert.match(derivationsSource, /Future meeting poster 1 is required\.[\s\S]*"future-posters", "future-poster-1"/);
  assert.match(agendaPreviewSource, /Poster slide not generated/);
  assert.match(agendaPreviewSource, /preview=future-posters/);
  assert.match(agendaPreviewSource, /poster-stage-preview[\s\S]*iframe/);
  assert.match(renderSource, /!\["review-share", "future-posters"\]\.includes\(state\.activeTask\)/);
  assert.match(stylesSource, /\.poster-stage-preview[\s\S]*aspect-ratio: 16 \/ 9[\s\S]*overflow: hidden/);
  assert.match(stylesSource, /\.poster-preview-empty[\s\S]*overflow-wrap: anywhere/);
});

test("validation issues navigate to stable workflow targets", () => {
  assert.match(derivationsSource, /severity, text, stage, task, focusKey/);
  assert.match(agendaEditorSource, /data-issue-index/);
  assert.match(advisorWorkflowSource, /function navigateToIssue/);
  assert.match(agendaPreviewSource, /data-preview-block/);
  assert.match(advisorWorkflowSource, /function navigateFromPreview/);
});

test("finalization is explicit and reversible", () => {
  assert.match(eventsSource, /data-finalize-meeting/);
  assert.match(eventsSource, /Resolve all blockers before finalizing/);
  assert.match(eventsSource, /data-reopen-meeting/);
  assert.match(eventsSource, /data-go-live/);
  assert.match(advisorWorkflowSource, /Preparation content is locked\. Live Execution remains available/);
  assert.doesNotMatch(appAll, /renderField\("Status"/);
});

test("new meeting flow prioritizes finalized reuse and resets meeting-specific data", () => {
  assert.match(renderSource, /function renderMeetingSwitchboard/);
  assert.match(renderSource, /Pick the run sheet to open/);
  assert.match(eventsSource, /data-open-meeting/);
  assert.doesNotMatch(appAll, /Preparing your first meeting/);
  assert.doesNotMatch(appAll, /prepareFirstMeeting/);
  assert.match(promptsSource, /Reuse latest finalized meeting/);
  assert.match(workspaceLoaderSource, /item\.externalPresentationUrl = ""/);
  assert.match(workspaceLoaderSource, /meeting\.votingCode = `DEMO-\$\{meetingNumber\}`/);
  assert.match(workspaceLoaderSource, /meeting\.wordOfDay = \{ word: "", pronunciation: "", partOfSpeech: "", definition: "", usage: "", example: "" \}/);
  assert.match(workspaceLoaderSource, /item\.member = ""/);
  assert.match(workspaceLoaderSource, /item\.speechObjective = ""/);
  assert.match(promptsSource, /state\.templatePrompt = false;\s+renderOverlayRegion/);
  assert.doesNotMatch(appAll, /\+ New meeting/);
  assert.match(stylesSource, /\.switchboard-row/);
  assert.match(lifecycleSyncSource, /async function createNewMeeting\(\)[\s\S]*state\.templatePrompt = true;[\s\S]*renderOverlayRegion\(\);[\s\S]*ensureTemplates\(\);/);
  assert.match(orchestrationSource, /state\.newMeetingCreating/);
  assert.match(promptsSource, /data-rename-template/);
  assert.match(orchestrationSource, /meeting\.enableTransitionTime = true;/);
});

test("meeting switchboard avoids duplicate number rails", () => {
  assert.doesNotMatch(appAll, /meeting-number-rail/);
  assert.match(promptsSource, /class="switchboard-number"/);
});

test("meeting switchboard explains why the next meeting is pinned", () => {
  assert.match(renderSource, /function renderMeetingSwitchboard\(\)[\s\S]*groupMeetingsForSwitchboard\(state\.meetings\)[\s\S]*Nearby meetings[\s\S]*switchboard-more[\s\S]*More meetings/);
  assert.match(stylesSource, /\.switchboard-row\.is-next[\s\S]*\.switchboard-next-label[\s\S]*\.switchboard-divider::before[\s\S]*\.switchboard-more summary::before/);
});

test("external presentation URL uses shared strong validation", () => {
  assert.match(agendaEditorSource, /field-info/);
  assert.match(agendaEditorSource, /data-external-presentation-url/);
  assert.match(agendaEditorSource, /externalPresentationUrlError/);
  assert.match(agendaEditorSource, /reportValidity/);
  assert.match(agendaEditorSource, /external-url-error/);
  assert.doesNotMatch(appAll, /\$\{isBreak \? "" : renderItemField\(item, "External presentation URL/);
  assert.match(stylesSource, /\.field-info/);
});

test("Admin exposes MCP audit and revision-guarded recovery", () => {
  assert.match(contractSource, /\{ id: "mcp-changes", label: "MCP changes" \}/);
  assert.match(advisorWorkflowSource, /function renderMcpChangesTask\(\)/);
  assert.match(advisorWorkflowSource, /Number\(audit\.afterRevision\) === Number\(state\.meeting\.revision\)/);
  assert.match(advisorWorkflowSource, /action=mcp-audit/);
  assert.match(orchestrationSource, /action=mcp-recover/);
  assert.match(stylesSource, /\.mcp-change-row/);
});

test("Agenda role titles use shared RoleCatalog with guarded global creation", () => {
  assert.match(renderEngineSource, /createSpeakingTipCarousel/);
  assert.match(workspaceLoaderSource, /apiJson\("\/api\/roles"\)/);
  assert.match(agendaEditorSource, /data-role-item=/);
  assert.match(agendaEditorSource, /＋ Add new role…/);
  assert.match(agendaEditorSource, /Current ·[\s\S]*Legacy/);
  assert.match(agendaEditorSource, /Role catalog unavailable ·[\s\S]*data-retry-roles/);
  assert.match(memberPickerSource, /AbortSignal\.timeout\(15_000\)/);
  assert.match(renderSource, /speakingTips\.markup\(\{ delayed: true \}\)/);
  assert.doesNotMatch(appAll, /role-title-options/);
  assert.match(speakingTipSource, /setInterval\(\(\) => show\(1\), 4000\)/);
  assert.match(speakingTipStyles, /\.speaking-tip-card/);
  assert.match(stylesSource, /prefers-reduced-motion: reduce[\s\S]*\.sync-progress span/);
});

test("meeting creation refreshes the mounted topbar selector", () => {
  assert.match(lifecycleSyncSource, /function renderMeetingNavigator\(\)[\s\S]*topbar-meeting-select[\s\S]*data-region="navigator"/);
  assert.match(renderSource, /<header class="topbar">[\s\S]*\$\{renderMeetingNavigator\(\)\}/);
  assert.match(orchestrationSource, /updateMeetingSummary[\s\S]*renderNavigatorRegion\(\)/);
});

test("workspace header keeps product hierarchy compact", () => {
  assert.match(lifecycleSyncSource, /function renderWorkspaceIdentity\(\)[\s\S]*?href="\/about">Club Meeting Ops[\s\S]*?Meeting Workspace[\s\S]*?Plan · Run · Review/);
  assert.equal((renderSource.match(/\$\{renderWorkspaceIdentity\(\)\}/g) || []).length, 2);
  assert.match(stylesSource, /\.workspace-identity \{[\s\S]*?flex: 0 0 220px/);
  assert.match(stylesSource, /\.workspace-identity a:focus-visible/);
  assert.match(stylesSource, /@media screen and \(max-width: 680px\)[\s\S]*?\.topbar \{[\s\S]*?flex-wrap: wrap/);
  assert.doesNotMatch(appAll, /class="workspace-parent-link"/);
});

test("finalized meetings keep template naming editable without rebuilding the modal", () => {
  assert.match(renderEngineSource, /function renderToastRegion\(\) \{\s+return replaceRegion/);
  assert.match(eventsSource, /!input\.closest\("\[data-template-form\], \[data-rename-template-form\]"\)/);
});

test("public guest browse and related tool links stay read-only", () => {
  assert.match(lifecycleSyncSource, /data-browse-meetings/);
  assert.match(lifecycleSyncSource, /Browse as guest/);
  assert.match(workspaceLoaderSource, /view=guest/);
  assert.match(lifecycleSyncSource, /Public read-only view/);
  assert.match(lifecycleSyncSource, /tmcompanion\.netlify\.app/);
  assert.match(lifecycleSyncSource, /rel="noopener noreferrer"/);
  assert.match(stylesSource, /\.guest-agenda-table/);
});

test("mobile workspace switches between edit and preview", () => {
  assert.match(advisorWorkflowSource, /data-mobile-view="edit"/);
  assert.match(advisorWorkflowSource, /data-mobile-view="preview"/);
  assert.match(stylesSource, /\.workspace\.mobile-preview \.editor-panel/);
  assert.match(advisorWorkflowSource, /class="mobile-action-dock"/);
  assert.match(renderSource, /renderStageNavigation/);
  assert.match(stylesSource, /\.mobile-view-switch/);
});

test("mobile agenda assignments pair roles and people with equal-height companion fields", () => {
  assert.match(agendaEditorSource, /class="item-card \$\{isBreak \? "item-break" : "has-assignment"\}"/);
  assert.match(agendaEditorSource, /renderMemberField\(item, "Evaluator", "evaluator"\)/);
  assert.doesNotMatch(appAll, /renderMemberField\(item, "Evaluator", "evaluator", true\)/);
  assert.match(stylesSource, /\.item-card\.has-assignment > \.form-grid\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\) minmax\(116px, 0\.68fr\)/s);
  assert.match(stylesSource, /\.item-card\.has-assignment \.agenda-speech-card\s*\{[^}]*grid-column: 1 \/ -1/s);
  assert.match(stylesSource, /\.item-field-role,\s*\.item-field-duration\s*\{[^}]*align-content: start/s);
  assert.match(stylesSource, /\.item-field-role select,\s*\.item-field-duration input\s*\{[^}]*min-height: 38px/s);
  assert.match(stylesSource, /\.item-field-member,[\s\S]*\.item-field-evaluatorStatus\s*\{[^}]*grid-template-rows: auto minmax\(46px, 1fr\) auto/s);
});

test("break sessions have a minimal editor and span agenda assignment columns", () => {
  assert.match(agendaEditorSource, /data-add-item="break"/);
  assert.match(agendaEditorSource, /isBreak \? 5/);
  assert.match(agendaEditorSource, /isBreak \? "Break"/);
  assert.match(agendaPreviewSource, /class="break-row"/);
  assert.match(agendaPreviewSource, /colspan="3"/);
  assert.match(stylesSource, /tr\.break-row td/);
});

test("both agenda pages use a plain club blue header", () => {
  assert.match(stylesSource, /\.agenda-header\s*\{[^}]*background: var\(--ink\)/s);
  assert.doesNotMatch(stylesSource, /\.agenda-header::after/);
});

test("print mode isolates exactly the two A4 agenda pages", () => {
  assert.doesNotMatch(stylesSource, /@media \((?:min|max)-width:/);
  assert.match(stylesSource, /@media print[\s\S]*\.run-sheet-header[\s\S]*display: none !important/);
  assert.match(stylesSource, /@media print[\s\S]*\.preview-panel[\s\S]*display: block !important/);
  assert.match(stylesSource, /@media print[\s\S]*\.preview-scroll \.agenda-page[\s\S]*width: 210mm[\s\S]*height: 297mm[\s\S]*zoom: 1/);
  assert.doesNotMatch(stylesSource, /page-break-after: always/);
  assert.match(printExportSource, /async function openPrintPrompt\(\)[\s\S]*state\.activeView = "admin"[\s\S]*state\.mobileView = "preview"[\s\S]*waitForPrintLayout\(\)[\s\S]*printLayoutWarnings\(\)/);
  assert.match(printExportSource, /async function waitForPrintLayout\(\)[\s\S]*document\.fonts\?\.ready[\s\S]*\.agenda-page img[\s\S]*setTimeout\(resolve, 2000\)/);
  assert.match(printExportSource, /function printLayoutWarnings\(\)[\s\S]*matchMedia\("\(max-width: 680px\)"\)[\s\S]*page\.style\.zoom = "1"[\s\S]*scrollHeight > page\.clientHeight \+ 1[\s\S]*page\.style\.zoom = zooms\[index\]/);
  assert.match(printExportSource, /async function printAgenda\(copies = 1,[\s\S]*cloneNode\(true\)[\s\S]*addEventListener\("afterprint", restore, \{ once: true \}\)[\s\S]*window\.print\(\)/);
  assert.match(printExportSource, /catch \(error\) \{[\s\S]*removeEventListener\("afterprint", restore\)[\s\S]*restore\(\)[\s\S]*throw error/);
  assert.match(printExportSource, /button\.matches\("\[data-print\]"\)[\s\S]*await openPrintPrompt\(\)/);
  assert.match(printExportSource, /form\.matches\("\[data-print-form\]"\)[\s\S]*await printAgenda\(copies, state\.printPrompt\)/);
  assert.match(printExportSource, /Agenda sets[\s\S]*Select a color printer[\s\S]*Keep Copies at 1[\s\S]*Print anyway/);
});

test("Agenda member picker groups, searches, refreshes, and creates guests", () => {
  assert.match(agendaEditorSource, /function renderMemberSelect[\s\S]*data-open-member-picker[\s\S]*aria-haspopup="dialog"/);
  assert.match(memberPickerSource, /groupMemberOptions\(state\.members\)/);
  assert.match(memberPickerSource, /Members[\s\S]*Guests[\s\S]*None \/ Unassigned[\s\S]*Add guest/);
  assert.match(memberPickerSource, /async function refreshMemberPickerMembers[\s\S]*apiJson\("\/api\/members"\)/);
  assert.match(memberPickerSource, /apiJson\("\/api\/members", \{ method: "POST"[\s\S]*const latest = await apiJson\("\/api\/members"\)/);
  assert.match(memberPickerSource, /Amy, Guest[\s\S]*Amy, PM3@AF TMC[\s\S]*Add anyway/);
  assert.match(memberPickerSource, /withUiContinuity\(\(\) => render\(\), returnFocusKey\)/);
  assert.match(stylesSource, /\.member-picker-modal[\s\S]*max-height: calc\(100dvh - 32px\)[\s\S]*overflow: hidden/);
  assert.match(stylesSource, /\.member-picker-option[\s\S]*min-height: 48px[\s\S]*overflow-wrap: anywhere/);
});

test("prepare-voting task manages Table Topics with a full load, add, delete, error cycle", () => {
  assert.match(renderSource, /case "prepare-voting": content = `\$\{renderVotingTask\(\{ includeUpload: true \}\)\}\$\{renderTableTopicsTask\(\)\}`/);
  assert.match(votingAwardsSource, /async function loadTableTopics\(\)[\s\S]*view=table-topics/);
  assert.match(votingAwardsSource, /async function addTableTopic\(topicText\)[\s\S]*action=table-topics-add/);
  assert.match(votingAwardsSource, /async function deleteTableTopic\(key\)[\s\S]*action=table-topics-delete/);
  assert.match(votingAwardsSource, /data-table-topics-form/);
  assert.match(votingAwardsSource, /data-delete-table-topic/);
  assert.match(votingAwardsSource, /data-reload-table-topics/);
  assert.match(votingAwardsSource, /aria-label="New Table Topics prompt"/);
  assert.match(votingAwardsSource, /aria-label="Delete topic: \$\{esc\(topic\.topicText\)\}"/);
  assert.match(votingAwardsSource, /role="status">Loading topics…/);
});

test("Agenda saves Table Topics speakers through structured stable entries", () => {
  assert.match(votingActionsSource, /action=table-topics-entries/);
  assert.match(votingActionsSource, /tableTopicsEntries/);
  assert.doesNotMatch(votingActionsSource, /action=speakers/);
});

test("Advisor share-image shortcut opens a standalone full-screen preview", () => {
  const printPrompt = printExportSource.slice(printExportSource.indexOf("export function renderPrintPrompt"), printExportSource.indexOf("export async function handleClick"));
  assert.doesNotMatch(printPrompt, /data-share-agenda-image|print-share-image/);
  assert.match(printExportSource, /async function shareAgendaImage\(\)[\s\S]*action=png/);
  assert.match(printExportSource, /function renderAgendaImagePrompt\([\s\S]*aria-modal="true"[\s\S]*长按图片，保存到相册[\s\S]*data-download-agenda-image/);
  assert.match(printExportSource, /function closeAgendaImagePrompt\([\s\S]*URL\.revokeObjectURL/);
  assert.match(printExportSource, /button\.matches\("\[data-close-agenda-image\]"\)[\s\S]*closeAgendaImagePrompt\(\)/);
  assert.match(eventsSource, /event\.key === "Escape" && state\.agendaImagePrompt[\s\S]*closeAgendaImagePrompt\(\)/);
  assert.match(stylesSource, /\.agenda-image-backdrop\s*\{[^}]*padding:\s*0/s);
  assert.match(stylesSource, /\.agenda-image-modal\s*\{[^}]*width:\s*100vw[^}]*height:\s*100dvh/s);
  assert.match(stylesSource, /\.agenda-image-stage\s*\{[^}]*overflow:\s*auto/s);
});

test("speech objectives compact before showing a preview-only A4 limit", () => {
  assert.match(agendaPreviewSource, /getSpeechObjectiveDensityClass\(objectiveCount\)/);
  assert.match(stylesSource, /\.objectives-overflow-risk::after[\s\S]*top: 1120px[\s\S]*A4 limit/);
  assert.match(stylesSource, /@media print[\s\S]*\.objectives-overflow-risk::after[\s\S]*display: none/);
});

test("officer photo preserves its original ratio within the A4 back page", () => {
  assert.doesNotMatch(stylesSource, /\.officer-team-photo\s*\{[^}]*(?:aspect-ratio|max-height)/s);
  assert.match(stylesSource, /\.officer-team-photo img\s*\{[^}]*width:\s*auto[^}]*max-width:\s*100%[^}]*height:\s*auto[^}]*max-height:\s*170px/s);
});

test("voting preparation and live voting expose phase-specific actions", () => {
  assert.match(renderSource, /function renderVotingPreparation/);
  assert.match(votingAwardsSource, /function renderLiveVoting/);
  assert.match(renderSource, /Prepare voting form/);
  assert.match(votingActionsSource, /async function prewarmVotingForm/);
  assert.match(votingActionsSource, /Claiming a prebuilt voting form/);
  assert.match(eventsSource, /state\.activeTask === "prepare-voting"[\s\S]*prewarmVotingForm/);
  assert.match(renderSource, /Update voting form/);
  assert.match(renderSource, /Preview form ↗/);
  assert.match(advisorWorkflowSource, /Open presentation/);
  assert.match(renderSource, /\/m\/\$\{encodeURIComponent\(state\.meeting\.meetingNumber\)\}\/presentation/);
  assert.match(advisorWorkflowSource, /Agenda has blockers/);
  assert.match(votingAwardsSource, /Save speakers & update form/);
  assert.match(eventsSource, /tableTopicsDraftDirty/);
  assert.doesNotMatch(votingAwardsSource, /awardsNeedReconfirmation/);
  assert.match(votingAwardsSource, /Adjust agenda roles/);
  assert.match(votingActionsSource, /VOTING_RESPONSE_RESET_REQUIRED/);
  assert.match(votingActionsSource, /permanently delete all .* existing responses/);
  assert.match(votingAwardsSource, /Open presentation/);
  assert.doesNotMatch(awardRepositorySource, /confirmed_awards_json/);
});

test("recognition awards stay outside the voting form fields", () => {
  assert.match(votingAwardsSource, /Recognition awards/);
  assert.match(votingAwardsSource, /Sharing Master ·/);
  assert.doesNotMatch(appAll, /data-sharing-master-role/);
  assert.doesNotMatch(appAll, /data-sharing-master-names/);
});

test("meeting-day SOP includes gifts for sharing guests and new members", () => {
  assert.match(advisorWorkflowSource, /Meeting Manager SOP/);
  assert.match(advisorWorkflowSource, /Prepare thank-you gifts for sharing guests/);
  assert.match(advisorWorkflowSource, /Prepare welcome gifts for new members/);
  assert.match(renderSource, /renderMeetingDayChecklist\(\)/);
});

test("Voting Console monitors live results without a freeze step", () => {
  assert.match(votingAwardsSource, /Live voting results/);
  assert.match(votingAwardsSource, /Open presentation/);
  assert.doesNotMatch(votingAwardsSource, /Confirm & Freeze/);
  assert.doesNotMatch(appAll, /Review & Confirm|Review Changes/);
});

test("QR asset previews remain square and contain the full image", () => {
  assert.match(stylesSource, /\.qr-frame\.asset-preview\s*\{[^}]*aspect-ratio: 1 \/ 1/s);
  assert.match(stylesSource, /\.asset-upload-card \.qr-frame\.asset-preview img\s*\{[^}]*object-fit: contain[^}]*object-position: center/s);
});

test("Agenda front page pairs equal-height voting and WeChat payment images", () => {
  assert.match(agendaPreviewSource, /class="front-qr-row"[\s\S]*wechat-payment-qr[\s\S]*Member ¥20 \| Guest ¥30/);
  assert.match(stylesSource, /\.front-qr-row\s*\{[^}]*display: flex[^}]*align-items: flex-start[^}]*gap: 15mm/s);
  assert.match(stylesSource, /\.qr-frame img\s*\{[^}]*object-fit: contain/s);
});

test("live voting actions share a non-overlapping footer layout", () => {
  assert.match(votingAwardsSource, /class="voting-live-footer"/);
  assert.match(stylesSource, /\.voting-live-footer\s*\{[^}]*display: grid[^}]*gap: 12px[^}]*border-top/s);
  assert.match(stylesSource, /\.voting-live \.button\.primary:disabled\s*\{[^}]*box-shadow: none/s);
  assert.match(stylesSource, /@media screen and \(max-width: 680px\)[\s\S]*\.more-menu-popover[\s\S]*position: fixed/);
  assert.match(stylesSource, /@media screen and \(max-width: 680px\)[\s\S]*\.voting-more > div[\s\S]*position: static/);
  assert.match(stylesSource, /@media screen and \(max-width: 680px\)[\s\S]*\.toast[\s\S]*max-width: calc\(100vw - 24px\)/);
});

test("desktop workspace supports persistent pointer and keyboard resizing", () => {
  assert.match(renderSource, /data-workspace-splitter role="separator"/);
  assert.match(contractSource, /previewPaneWidth: "vpe-agenda-preview-pane-width-v1"/);
  assert.match(renderSource, /STORAGE_KEYS\.previewPaneWidth/);
  assert.match(eventsSource, /handleWorkspaceSplitPointerDown/);
  assert.match(eventsSource, /\["ArrowLeft", "ArrowRight"\]/);
  assert.match(stylesSource, /grid-template-columns: minmax\(420px, 1fr\) 10px minmax\(340px, var\(--preview-pane-width, 390px\)\)/);
  assert.match(stylesSource, /\.workspace-splitter\s*\{[^}]*cursor: col-resize/s);
});

test("agenda preview scale follows the resized preview container", () => {
  assert.match(agendaPreviewSource, /availableWidth \/ \(210 \* 96 \/ 25\.4\)/);
  assert.match(agendaPreviewSource, /new ResizeObserver/);
  assert.match(agendaPreviewSource, /--agenda-preview-scale/);
  assert.match(stylesSource, /\.preview-scroll \.agenda-page\s*\{[^}]*width: 210mm;[^}]*height: 297mm;[^}]*padding: 10mm;/s);
  assert.match(stylesSource, /\.print-note\s*\{[^}]*margin-top: auto;/s);
  assert.match(stylesSource, /zoom: var\(--agenda-preview-scale, 0\.38\)/);
});

test("officer roles auto-fill the assigned club member in agenda items", () => {
  assert.match(derivationsSource, /function autofillAgendaOfficer/);
  assert.match(agendaEditorSource, /input\.matches\("\[data-role-item\]"\)[\s\S]*autofillAgendaOfficer\(item, item\.role\)/);
  assert.match(derivationsSource, /const memberId = officerAssignmentsFromMembers\(\)\[role\]/);
  assert.match(derivationsSource, /item\.member = member\.displayName/);
});

test("awards role stays editable and server does not overwrite agenda assignments", async () => {
  const serverSource = await readFile(new URL("../server/meetings-repository.js", import.meta.url), "utf8");
  assert.doesNotMatch(appAll, /Fixed for Awards/);
  assert.match(agendaEditorSource, /renderMemberField\(item, "Member", "member"\)/);
  assert.doesNotMatch(appAll, /renderMemberField\(item, "Member", "member", false, awards\)/);
  assert.doesNotMatch(serverSource, /assignMeetingPresident/);
});

test("member loading refreshes officer names before unrelated assets finish", () => {
  assert.match(workspaceLoaderSource, /apiJson\("\/api\/members"\)\.then\(\(\{ members \}\) => \{\s*state\.members = members;\s*if \(state\.meeting\) \{\s*renderOfficerRegion\(\);\s*renderPreviewRegion\(\);\s*\}\s*\}\)/);
});

test("browser downloads keep their anchor and blob URL alive briefly", () => {
  const downloadSource = printExportSource.slice(printExportSource.indexOf("function downloadFile"), printExportSource.indexOf("function triggerBrowserDownload"));
  assert.match(downloadSource, /window\.setTimeout\(\(\) => \{\s*link\.remove\(\);\s*URL\.revokeObjectURL\(url\);\s*\}, 1000\)/);
});

test("PDF snapshots keep officer members without re-downloading assets in the browser", () => {
  const snapshotSource = printExportSource.slice(printExportSource.indexOf("function buildAgendaPdfSnapshot"), printExportSource.indexOf("async function downloadAgendaPdf"));
  assert.match(snapshotSource, /members: structuredClone\(state\.members\)/);
  assert.doesNotMatch(snapshotSource, /snapshotPdfImage|Promise\.all/);
  assert.doesNotMatch(appAll, /function fileToDataUrl|function snapshotPdfImage/);
  assert.match(workspaceLoaderSource, /function loadPdfSnapshotWorkspace\(snapshot\)[\s\S]*state\.members = Array\.isArray\(snapshot\.members\) \? snapshot\.members : \[\]/);
});

test("PDF routes rebuild their snapshot from the latest meeting and Pathways catalog", async () => {
  const meetingApiSource = await readFile(new URL("../api/meetings/[id].js", import.meta.url), "utf8");
  assert.match(meetingApiSource, /async function loadLatestPdfSnapshot\(meetingId\)[\s\S]*getMeeting\(meetingId\)[\s\S]*getMembers\(\)[\s\S]*getPathwaysCatalog\(\)/);
  assert.match(meetingApiSource, /sendMeetingPdf\(request, response, await loadLatestPdfSnapshot\(signedId\)\)/);
  assert.match(meetingApiSource, /sendMeetingPdf\(request, response, await loadLatestPdfSnapshot\(id\)\)/);
});

test("Word of Day print preserves every field with an IPA-capable font", () => {
  assert.match(agendaPreviewSource, /class="word-of-day-copy"[\s\S]*m\.wordOfDay\.word[\s\S]*m\.wordOfDay\.pronunciation[\s\S]*m\.wordOfDay\.example/);
  assert.match(stylesSource, /family=Noto\+Sans/);
  assert.match(stylesSource, /\.word-of-day-copy\s*\{[^}]*font-family:\s*"Noto Sans"/s);
});

test("Agenda prepared speech editor mirrors Book grouping and cascade", () => {
  assert.match(agendaEditorSource, /agenda-speech-card span-2[\s\S]*Same information used in Role Book/);
  assert.match(agendaEditorSource, /agenda-speech-modes mode-\$\{mode \|\| "required"\}[\s\S]*Pathways[\s\S]*Custom/);
  assert.doesNotMatch(agendaEditorSource.slice(agendaEditorSource.indexOf("function renderSpeechDetailsEditor"), agendaEditorSource.indexOf("function renderMemberField")), /Decide later/);
  assert.match(agendaEditorSource, /agenda-path-level[\s\S]*pathwaysPath[\s\S]*pathwaysLevel/);
  assert.match(agendaEditorSource, /forms\.length === 1[\s\S]*pathwaysFormId: forms\[0\]\.formId/);
  assert.match(derivationsSource, /needs complete Pathways details or a custom speech objective/);
  assert.match(stylesSource, /\.agenda-speech-card[\s\S]*\.agenda-speech-modes::before[\s\S]*\.agenda-path-level/);
  assert.match(stylesSource, /@media screen and \(max-width: 680px\)[\s\S]*\.agenda-path-level \{ grid-template-columns: 1fr; \}/);
});

test("autosave writes a local draft and syncs the latest snapshot only", () => {
  assert.match(contractSource, /drafts: "vpe-agenda-maker-drafts-v1"/);
  assert.match(workspaceLoaderSource, /function saveLocalDraft/);
  assert.match(workspaceLoaderSource, /function clearLocalDraft/);
  assert.match(lifecycleSyncSource, /function applyDirty\(\)[\s\S]*saveLocalDraft\(\)/);
  assert.match(derivationsSource, /Auto-saving to Feishu/);
  assert.match(orchestrationSource, /if \(runtime\.savePromise\)[\s\S]*if \(state\.dirty && !state\.conflict && state\.saveStatus !== "error"\) return flushSave\(\)/);
  assert.match(orchestrationSource, /if \(state\.dirty\) saveLocalDraft\(\);\s*else clearLocalDraft\(snapshot\.id\)/);
});

test("workspace paints the current meeting before deferred data finishes", () => {
  assert.match(workspaceLoaderSource, /const \{ meetings \} = await apiJson\("\/api\/meetings"\)/);
  assert.match(workspaceLoaderSource, /loadDeferredWorkspaceData\(\)/);
  assert.match(workspaceLoaderSource, /apiJson\("\/api\/members"\)/);
  assert.match(workspaceLoaderSource, /apiJson\("\/api\/templates"\)/);
  assert.match(workspaceLoaderSource, /apiJson\("\/api\/assets\/group-qr\?metadata=1"\)/);
  assert.doesNotMatch(appAll, /const \[\{ meetings \}, \{ members \}, \{ templates \}/);
});

test("awards load for Advisor status and Admin award tasks", () => {
  assert.match(orchestrationSource, /Promise\.all\(\[\s*loadAwards\(\{ quiet: true \}\),\s*loadRoleRecommendations\(\{ quiet: true \}\)/);
  assert.match(eventsSource, /state\.activeTask === "awards"[\s\S]*await loadAwards\(\)/);
});

test("Guest recommendation UI keeps identity separate and shows Photographer checks", () => {
  assert.match(recommendationsSource, /recommendation-guest-tag/);
  assert.match(recommendationsSource, /愿意拍照 · 可使用手机或相机 · 已知并接受照片使用方式/);
  assert.match(recommendationsSource, /全部合格候选人/);
});

test("loading a meeting refreshes systemVotingQr from the cloud even when a stale draft is used", () => {
  assert.match(orchestrationSource, /systemVotingQr: meeting\.systemVotingQr \|\| draft\?\.systemVotingQr \|\| \{ \.\.\.EMPTY_IMAGE \}/);
});

test("Load remote version discards the stale local draft instead of re-attempting the failing save", () => {
  assert.match(orchestrationSource, /export async function discardConflictAndReloadRemote\(meetingId\) \{\s*state\.conflict = null;\s*state\.dirty = false;\s*state\.saveStatus = "idle";\s*clearLocalDraft\(meetingId\);\s*await loadMeetingFromCloud\(meetingId\);/);
  assert.match(eventsSource, /data-reload-remote[\s\S]{0,80}discardConflictAndReloadRemote\(state\.conflict\.meetingId\)/);
});

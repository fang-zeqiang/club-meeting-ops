import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appSource = await readFile(new URL("../app.js", import.meta.url), "utf8");
const awardRepositorySource = await readFile(new URL("../server/award-repository.js", import.meta.url), "utf8");
const stylesSource = await readFile(new URL("../styles.css", import.meta.url), "utf8");
const speakingTipSource = await readFile(new URL("../speaking-tips.js", import.meta.url), "utf8");
const speakingTipStyles = await readFile(new URL("../speaking-tip-card.css", import.meta.url), "utf8");
const productUpdatesSource = await readFile(new URL("../docs/CHANGELOG.md", import.meta.url), "utf8");

test("More menu opens the compact bilingual product history", () => {
  assert.match(appSource, /import productUpdatesMarkdown from "\.\/docs\/CHANGELOG\.md\?raw"/);
  assert.match(appSource, /data-about-product>About Product/);
  assert.match(appSource, /function renderAboutProductPrompt/);
  assert.match(productUpdatesSource, /Club Meeting Ops connects role booking/);
  assert.equal(productUpdatesSource.match(/^- 2026-/gm)?.length, 6);
});

test("workspace exposes lifecycle stages and task navigation", () => {
  for (const label of ["Preparation", "Live Execution", "Review"]) assert.match(appSource, new RegExp(label));
  for (const task of ["Meeting details", "Build agenda", "Prepare voting", "Future posters", "Review & share", "Start voting", "Awards", "Meeting review"]) assert.match(appSource, new RegExp(task.replace(/[&]/g, "\\&")));
  assert.doesNotMatch(appSource, /Publication Check/);
  assert.doesNotMatch(appSource, /Preview & finalize/);
  assert.match(appSource, /data-stage=/);
  assert.match(appSource, /data-task=/);
  assert.match(stylesSource, /\.stage-tab > \.stage-index/);
  assert.doesNotMatch(stylesSource, /\.stage-tab span,/);
});

test("meeting advisor v2a opens a cue desk before admin", () => {
  assert.match(appSource, /Meeting Advisor/);
  assert.match(appSource, /activeView: "advisor"/);
  assert.match(appSource, /function renderAdvisorHome/);
  assert.match(appSource, /Open Admin/);
  assert.match(appSource, /Back to Advisor/);
  assert.match(appSource, /advisor-origin-banner/);
  assert.match(stylesSource, /\.advisor-home/);
  assert.match(stylesSource, /\.advisor-grid/);
  assert.match(stylesSource, /\.topbar-actions \.advisor-nav-action/);
  assert.match(appSource, /data-complete-review/);
  assert.match(appSource, /data-skip-review/);
  assert.match(appSource, /Future meeting posters/);
  assert.match(appSource, /Club introduction photo/);
  assert.match(appSource, /1920 \/ Math\.max\(image\.naturalWidth, image\.naturalHeight\)/);
  assert.match(appSource, /canvas\.toBlob\(resolve, "image\/jpeg", 0\.82\)/);
  assert.match(appSource, /case "future-posters": content = renderFuturePostersTask\(\)/);
  assert.match(stylesSource, /\.quality-board/);
});

test("Advisor exposes fixed SAA controls with live status routing", () => {
  assert.match(appSource, /function renderSaaQuickActions/);
  const advisorHome = appSource.slice(appSource.indexOf("function renderAdvisorHome"), appSource.indexOf("const RUN_SHEET_TAB_LABELS"));
  assert.ok(advisorHome.indexOf('class="advisor-grid"') < advisorHome.indexOf("renderSaaQuickActions()"));
  for (const label of ["Meeting Support Shortcut", "Print Agenda", "Open Presentation", "Manage Voting", "Confirm Results", "Present Awards", "Print Evaluation Forms"]) {
    assert.match(appSource, new RegExp(label));
  }
  for (const label of ["Before meeting", "MM desk", "Print pack", "PHYSICAL", "During meeting", "Run of show", "Useful for rehearsal"]) {
    assert.match(appSource, new RegExp(label.replace("+", "\\+")));
  }
  for (const label of ["Download Agenda PDF", "DIGITAL · 1 PDF / 2 PAGES", "Preparing…", "Retry"]) {
    assert.match(appSource, new RegExp(label.replace("+", "\\+")));
  }
  assert.match(appSource, /agendaPrintRecommendation\(state\.meeting\)/);
  assert.match(appSource, /data-print-form[\s\S]*Agenda sets[\s\S]*field-info[\s\S]*attendance buffer[\s\S]*name="copies"[\s\S]*Select a color printer[\s\S]*Color \+ Double-sided/);
  assert.doesNotMatch(appSource, /SAA Quick Actions|Five fixed controls|Live control/);
  assert.match(appSource, /Status unavailable/);
  assert.match(appSource, /Checking…/);
  assert.match(appSource, /loadAwards\(\{ quiet: true \}\)/);
  assert.match(appSource, /data-stage-target="live" data-task="start-voting"/);
  assert.match(appSource, /data-open-voting-console/);
  assert.match(appSource, /data-stage-target="preparation" data-task="review-share" data-focus-key="evaluation-forms"/);
  assert.match(appSource, /data-download-agenda-pdf/);
  assert.match(appSource, /async function downloadAgendaPdf\(\)/);
  assert.match(appSource, /\/api\/preview-agenda\.pdf/);
  assert.match(appSource, /\/api\/meetings\/\$\{encodeURIComponent\(state\.meeting\.id\)\}\?action=pdf/);
  assert.match(appSource, /function renderEvaluationForms/);
  assert.match(appSource, /pdfUrl: form && project && form\.projectId === project\.projectId \? form\.pdfUrl : ""/);
  assert.match(stylesSource, /\.support-shortcut-groups\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\)/s);
  assert.match(stylesSource, /\.print-pack-route\s*\{[^}]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/s);
  assert.match(stylesSource, /\.support-shortcut-live \.saa-action-grid\s*\{[^}]*grid-template-columns: repeat\(4/s);
  assert.match(stylesSource, /@media screen and \(max-width: 720px\)[\s\S]*\.print-pack-route\s*\{[^}]*grid-template-columns: 1fr/s);
  assert.doesNotMatch(stylesSource, /\.agenda-pdf-shortcut\s*\{/);
  assert.match(stylesSource, /\.support-shortcut-group-stats\s*\{/);
  assert.match(stylesSource, /@media screen and \(max-width: 680px\)[\s\S]*\.saa-action-grid\s*\{[^}]*grid-template-columns: repeat\(2/s);
  assert.match(stylesSource, /@media \(hover: none\)[\s\S]*\.saa-action-tooltip/);
  assert.match(stylesSource, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.saa-action/);
});

test("WeChat signup import is promoted with matching AI and BETA tags", () => {
  assert.match(appSource, /微信接龙导入/);
  assert.match(appSource, /class="advisor-source signup-ai-tag"[\s\S]*>AI/);
  assert.match(appSource, /class="advisor-source signup-card-beta">BETA/);
  assert.match(appSource, /DeepSeek · \$\{SIGNUP_IMPORT_MODEL\}/);
  assert.match(appSource, /data-open-signup-import/);
  assert.doesNotMatch(appSource, /signup-more-entry/);
  assert.doesNotMatch(stylesSource, /\.signup-more-entry/);
  assert.match(appSource, /data-analyze-signup/);
  assert.match(appSource, /data-apply-signup/);
  assert.match(appSource, /action=analyze-signup/);
  assert.match(stylesSource, /\.signup-ai-model-trigger:hover \.signup-ai-model/);
  assert.match(stylesSource, /\.signup-import-modal/);
  assert.match(stylesSource, /\.signup-review-screen/);
});

test("Advisor generates copy-ready signup text through the shared server rule", () => {
  assert.match(appSource, /data-open-signup-generation/);
  assert.match(appSource, /action=generate-signup/);
  assert.match(appSource, /data-signup-generation-language[\s\S]*中英双语[\s\S]*中文[\s\S]*English/);
  assert.match(appSource, /data-signup-generation-emoji/);
  assert.match(appSource, /data-signup-generation-titles/);
  assert.match(appSource, /navigator\.clipboard\.writeText\(state\.signupGeneration\.text\)/);
  assert.match(stylesSource, /\.signup-generate-controls/);
});

test("Advisor uses one current-stage label and collapsible task lanes", () => {
  assert.match(appSource, /advisor-current-stage">Current · \$\{stage\}/);
  assert.doesNotMatch(appSource, /class="advisor-stage-strip"/);
  assert.match(appSource, /data-advisor-toggle="\$\{lane\}"/);
  assert.match(appSource, /state\.advisorExpanded = \{ next: false, risk: false \}/);
});

test("member picker keeps the full directory and resets scroll after search", () => {
  assert.match(appSource, /const groups = groupMemberOptions\(state\.members\);/);
  assert.match(appSource, /results\.scrollTop = 0/);
  assert.match(stylesSource, /\.member-picker-option\[hidden\]\s*\{\s*display: none;/);
  assert.match(appSource, /member-picker-guest-tag">Guest/);
  assert.match(stylesSource, /\.member-picker-group > h3,[\s\S]*position: sticky/);
});

test("Club settings can replace the shared WeChat payment QR code", () => {
  assert.match(appSource, /function renderClubSettingsPrompt\(\)[\s\S]*renderImageEditor\("wechat-payment-qr"[\s\S]*state\.paymentQr/);
  const clubSettings = appSource.slice(appSource.indexOf("function renderClubSettingsPrompt"), appSource.indexOf("function signupChangeIsPerson"));
  assert.doesNotMatch(clubSettings, /Future meeting posters/);
});

test("future posters are a required global preparation step with exact presentation preview", () => {
  assert.match(appSource, /id: "prepare-voting"[\s\S]*id: "future-posters"[\s\S]*id: "review-share"/);
  assert.match(appSource, /Future meeting poster 1 is required\.[\s\S]*"future-posters", "future-poster-1"/);
  assert.match(appSource, /Poster slide not generated/);
  assert.match(appSource, /preview=future-posters/);
  assert.match(appSource, /poster-stage-preview[\s\S]*iframe/);
  assert.match(appSource, /!\["review-share", "future-posters"\]\.includes\(state\.activeTask\)/);
  assert.match(stylesSource, /\.poster-stage-preview[\s\S]*aspect-ratio: 16 \/ 9[\s\S]*overflow: hidden/);
  assert.match(stylesSource, /\.poster-preview-empty[\s\S]*overflow-wrap: anywhere/);
});

test("validation issues navigate to stable workflow targets", () => {
  assert.match(appSource, /severity, text, stage, task, focusKey/);
  assert.match(appSource, /data-issue-index/);
  assert.match(appSource, /function navigateToIssue/);
  assert.match(appSource, /data-preview-block/);
  assert.match(appSource, /function navigateFromPreview/);
});

test("finalization is explicit and reversible", () => {
  assert.match(appSource, /data-finalize-meeting/);
  assert.match(appSource, /Resolve all blockers before finalizing/);
  assert.match(appSource, /data-reopen-meeting/);
  assert.match(appSource, /data-go-live/);
  assert.match(appSource, /Preparation content is locked\. Live Execution remains available/);
  assert.doesNotMatch(appSource, /renderField\("Status"/);
});

test("new meeting flow prioritizes finalized reuse and resets meeting-specific data", () => {
  assert.match(appSource, /function renderMeetingSwitchboard/);
  assert.match(appSource, /Pick the run sheet to open/);
  assert.match(appSource, /data-open-meeting/);
  assert.doesNotMatch(appSource, /Preparing your first meeting/);
  assert.doesNotMatch(appSource, /prepareFirstMeeting/);
  assert.match(appSource, /Reuse latest finalized meeting/);
  assert.match(appSource, /item\.externalPresentationUrl = ""/);
  assert.match(appSource, /meeting\.votingCode = `DEMO-\$\{meetingNumber\}`/);
  assert.match(appSource, /meeting\.wordOfDay = \{ word: "", pronunciation: "", example: "" \}/);
  assert.match(appSource, /item\.member = ""/);
  assert.match(appSource, /item\.speechObjective = ""/);
  assert.match(appSource, /state\.templatePrompt = false;\s+renderOverlayRegion/);
  assert.doesNotMatch(appSource, /\+ New meeting/);
  assert.match(stylesSource, /\.switchboard-row/);
  assert.match(appSource, /async function createNewMeeting\(\)[\s\S]*state\.templatePrompt = true;[\s\S]*renderOverlayRegion\(\);[\s\S]*ensureTemplates\(\);/);
  assert.match(appSource, /state\.newMeetingCreating/);
  assert.match(appSource, /data-rename-template/);
  assert.match(appSource, /meeting\.enableTransitionTime = true;/);
});

test("meeting switchboard avoids duplicate number rails", () => {
  assert.doesNotMatch(appSource, /meeting-number-rail/);
  assert.match(appSource, /class="switchboard-number"/);
});

test("meeting switchboard explains why the next meeting is pinned", () => {
  assert.match(appSource, /function renderMeetingSwitchboard\(\)[\s\S]*groupMeetingsForSwitchboard\(state\.meetings\)[\s\S]*Nearby meetings[\s\S]*switchboard-more[\s\S]*More meetings/);
  assert.match(stylesSource, /\.switchboard-row\.is-next[\s\S]*\.switchboard-next-label[\s\S]*\.switchboard-divider::before[\s\S]*\.switchboard-more summary::before/);
});

test("external presentation URL explains embedded Tencent Docs support", () => {
  assert.match(appSource, /field-info/);
  assert.match(appSource, /public Tencent Docs presentation link/);
  assert.match(stylesSource, /\.field-info/);
});

test("Agenda role titles use shared RoleCatalog with guarded global creation", () => {
  assert.match(appSource, /createSpeakingTipCarousel/);
  assert.match(appSource, /apiJson\("\/api\/roles"\)/);
  assert.match(appSource, /data-role-item=/);
  assert.match(appSource, /＋ Add new role…/);
  assert.match(appSource, /Current ·[\s\S]*Legacy/);
  assert.match(appSource, /Role catalog unavailable ·[\s\S]*data-retry-roles/);
  assert.match(appSource, /AbortSignal\.timeout\(15_000\)/);
  assert.match(appSource, /speakingTips\.markup\(\{ delayed: true \}\)/);
  assert.doesNotMatch(appSource, /role-title-options/);
  assert.match(speakingTipSource, /setInterval\(\(\) => show\(1\), 4000\)/);
  assert.match(speakingTipStyles, /\.speaking-tip-card/);
  assert.match(stylesSource, /prefers-reduced-motion: reduce[\s\S]*\.sync-progress span/);
});

test("meeting creation refreshes the mounted topbar selector", () => {
  assert.match(appSource, /function renderMeetingNavigator\(\)[\s\S]*topbar-meeting-select[\s\S]*data-region="navigator"/);
  assert.match(appSource, /<header class="topbar">[\s\S]*\$\{renderMeetingNavigator\(\)\}/);
  assert.match(appSource, /updateMeetingSummary[\s\S]*renderNavigatorRegion\(\)/);
});

test("finalized meetings keep template naming editable without rebuilding the modal", () => {
  assert.match(appSource, /function renderToastRegion\(\) \{\s+return replaceRegion/);
  assert.match(appSource, /!input\.closest\("\[data-template-form\], \[data-rename-template-form\]"\)/);
});

test("public guest browse and related tool links stay read-only", () => {
  assert.match(appSource, /data-browse-meetings/);
  assert.match(appSource, /Browse as guest/);
  assert.match(appSource, /view=guest/);
  assert.match(appSource, /Public read-only view/);
  assert.doesNotMatch(appSource, /TM Companion/);
  assert.match(stylesSource, /\.guest-agenda-table/);
});

test("mobile workspace switches between edit and preview", () => {
  assert.match(appSource, /data-mobile-view="edit"/);
  assert.match(appSource, /data-mobile-view="preview"/);
  assert.match(stylesSource, /\.workspace\.mobile-preview \.editor-panel/);
  assert.match(appSource, /class="mobile-action-dock"/);
  assert.match(appSource, /renderStageNavigation/);
  assert.match(stylesSource, /\.mobile-view-switch/);
});

test("mobile agenda assignments pair roles and people with equal-height companion fields", () => {
  assert.match(appSource, /class="item-card \$\{isBreak \? "item-break" : "has-assignment"\}"/);
  assert.match(appSource, /renderMemberField\(item, "Evaluator", "evaluator"\)/);
  assert.doesNotMatch(appSource, /renderMemberField\(item, "Evaluator", "evaluator", true\)/);
  assert.match(stylesSource, /\.item-card\.has-assignment > \.form-grid\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\) minmax\(116px, 0\.68fr\)/s);
  assert.match(stylesSource, /\.item-card\.has-assignment \.agenda-speech-card\s*\{[^}]*grid-column: 1 \/ -1/s);
  assert.match(stylesSource, /\.item-field-role,\s*\.item-field-duration\s*\{[^}]*align-content: start/s);
  assert.match(stylesSource, /\.item-field-role select,\s*\.item-field-duration input\s*\{[^}]*min-height: 38px/s);
  assert.match(stylesSource, /\.item-field-member,[\s\S]*\.item-field-evaluatorStatus\s*\{[^}]*grid-template-rows: auto minmax\(46px, 1fr\) auto/s);
});

test("break sessions have a minimal editor and span agenda assignment columns", () => {
  assert.match(appSource, /data-add-item="break"/);
  assert.match(appSource, /isBreak \? 5/);
  assert.match(appSource, /isBreak \? "Break"/);
  assert.match(appSource, /class="break-row"/);
  assert.match(appSource, /colspan="3"/);
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
  assert.match(stylesSource, /@media print[\s\S]*\.preview-scroll \.agenda-page[\s\S]*width: 210mm[\s\S]*height: 287mm[\s\S]*zoom: 1/);
  assert.doesNotMatch(stylesSource, /page-break-after: always/);
  assert.match(appSource, /async function openPrintPrompt\(\)[\s\S]*state\.activeView = "admin"[\s\S]*state\.mobileView = "preview"[\s\S]*waitForPrintLayout\(\)[\s\S]*printLayoutWarnings\(\)/);
  assert.match(appSource, /async function waitForPrintLayout\(\)[\s\S]*document\.fonts\?\.ready[\s\S]*\.agenda-page img[\s\S]*setTimeout\(resolve, 2000\)/);
  assert.match(appSource, /function printLayoutWarnings\(\)[\s\S]*matchMedia\("\(max-width: 680px\)"\)[\s\S]*page\.style\.zoom = "1"[\s\S]*scrollHeight > page\.clientHeight \+ 1[\s\S]*page\.style\.zoom = zooms\[index\]/);
  assert.match(appSource, /async function printAgenda\(copies = 1,[\s\S]*cloneNode\(true\)[\s\S]*addEventListener\("afterprint", restore, \{ once: true \}\)[\s\S]*window\.print\(\)/);
  assert.match(appSource, /catch \(error\) \{[\s\S]*removeEventListener\("afterprint", restore\)[\s\S]*restore\(\)[\s\S]*throw error/);
  assert.match(appSource, /button\.matches\("\[data-print\]"\)[\s\S]*await openPrintPrompt\(\)/);
  assert.match(appSource, /form\.matches\("\[data-print-form\]"\)[\s\S]*await printAgenda\(copies, state\.printPrompt\)/);
  assert.match(appSource, /Agenda sets[\s\S]*Select a color printer[\s\S]*Keep Copies at 1[\s\S]*Print anyway/);
});

test("Agenda member picker groups, searches, refreshes, and creates guests", () => {
  assert.match(appSource, /function renderMemberSelect[\s\S]*data-open-member-picker[\s\S]*aria-haspopup="dialog"/);
  assert.match(appSource, /groupMemberOptions\(state\.members\)/);
  assert.match(appSource, /Members[\s\S]*Guests[\s\S]*None \/ Unassigned[\s\S]*Add guest/);
  assert.match(appSource, /async function refreshMemberPickerMembers[\s\S]*apiJson\("\/api\/members"\)/);
  assert.match(appSource, /apiJson\("\/api\/members", \{ method: "POST"[\s\S]*const latest = await apiJson\("\/api\/members"\)/);
  assert.match(appSource, /Amy, Guest[\s\S]*Amy, PM3@AF TMC[\s\S]*Add anyway/);
  assert.match(appSource, /withUiContinuity\(\(\) => render\(\), returnFocusKey\)/);
  assert.match(stylesSource, /\.member-picker-modal[\s\S]*max-height: calc\(100dvh - 32px\)[\s\S]*overflow: hidden/);
  assert.match(stylesSource, /\.member-picker-option[\s\S]*min-height: 48px[\s\S]*overflow-wrap: anywhere/);
});

test("speech objectives compact before showing a preview-only A4 limit", () => {
  assert.match(appSource, /objectiveCount >= 5[\s\S]*objectives-overflow-risk/);
  assert.match(appSource, /objectiveCount >= 4[\s\S]*speech-objective-density-tight/);
  assert.match(appSource, /objectiveCount >= 3[\s\S]*speech-objective-density-compact/);
  assert.match(stylesSource, /\.objectives-overflow-risk::after[\s\S]*top: 1120px[\s\S]*A4 limit/);
  assert.match(stylesSource, /@media print[\s\S]*\.objectives-overflow-risk::after[\s\S]*display: none/);
});

test("officer photo preserves its original ratio within the A4 back page", () => {
  assert.doesNotMatch(stylesSource, /\.officer-team-photo\s*\{[^}]*(?:aspect-ratio|max-height)/s);
  assert.match(stylesSource, /\.officer-team-photo img\s*\{[^}]*width:\s*auto[^}]*max-width:\s*100%[^}]*height:\s*auto[^}]*max-height:\s*170px/s);
});

test("voting preparation and live voting expose phase-specific actions", () => {
  assert.match(appSource, /function renderVotingPreparation/);
  assert.match(appSource, /function renderLiveVoting/);
  assert.match(appSource, /Prepare voting form/);
  assert.match(appSource, /async function prewarmVotingForm/);
  assert.match(appSource, /Claiming a prebuilt voting form/);
  assert.match(appSource, /state\.activeTask === "prepare-voting"[\s\S]*prewarmVotingForm/);
  assert.match(appSource, /Update voting form/);
  assert.match(appSource, /Preview form ↗/);
  assert.match(appSource, /Open presentation/);
  assert.match(appSource, /\/m\/\$\{encodeURIComponent\(state\.meeting\.meetingNumber\)\}\/presentation/);
  assert.match(appSource, /Agenda has blockers/);
  assert.match(appSource, /Save speakers & update form/);
  assert.match(appSource, /tableTopicsDraftDirty/);
  assert.match(appSource, /⚠ Reconfirm awards/);
  assert.match(appSource, /Adjust agenda roles/);
  assert.match(appSource, /VOTING_RESPONSE_RESET_REQUIRED/);
  assert.match(appSource, /permanently delete all .* existing responses/);
  assert.match(appSource, /Reconfirm awards to enable presentation/);
  assert.match(awardRepositorySource, /Collect at least one new response before reconfirming awards/);
});

test("recognition awards stay outside the voting form fields", () => {
  assert.match(appSource, /Recognition awards/);
  assert.match(appSource, /data-sharing-master-role/);
  assert.match(appSource, /data-sharing-master-names/);
  assert.match(appSource, /recognitionAwardConfig/);
});

test("QR asset previews remain square and contain the full image", () => {
  assert.match(stylesSource, /\.qr-frame\.asset-preview\s*\{[^}]*aspect-ratio: 1 \/ 1/s);
  assert.match(stylesSource, /\.asset-upload-card \.qr-frame\.asset-preview img\s*\{[^}]*object-fit: contain[^}]*object-position: center/s);
});

test("Agenda front page pairs equal-height voting and WeChat payment images", () => {
  assert.match(appSource, /class="front-qr-row"[\s\S]*wechat-payment-qr[\s\S]*Member ¥20 \| Guest ¥30/);
  assert.match(stylesSource, /\.front-qr-row\s*\{[^}]*display: flex[^}]*align-items: flex-start[^}]*gap: 15mm/s);
  assert.match(stylesSource, /\.qr-frame img\s*\{[^}]*object-fit: contain/s);
});

test("live voting actions share a non-overlapping footer layout", () => {
  assert.match(appSource, /class="voting-live-footer"/);
  assert.match(stylesSource, /\.voting-live-footer\s*\{[^}]*display: grid[^}]*gap: 12px[^}]*border-top/s);
  assert.match(stylesSource, /\.voting-live \.button\.primary:disabled\s*\{[^}]*box-shadow: none/s);
  assert.match(stylesSource, /@media screen and \(max-width: 680px\)[\s\S]*\.more-menu-popover[\s\S]*position: fixed/);
  assert.match(stylesSource, /@media screen and \(max-width: 680px\)[\s\S]*\.voting-more > div[\s\S]*position: static/);
  assert.match(stylesSource, /@media screen and \(max-width: 680px\)[\s\S]*\.toast[\s\S]*max-width: calc\(100vw - 24px\)/);
});

test("desktop workspace supports persistent pointer and keyboard resizing", () => {
  assert.match(appSource, /data-workspace-splitter role="separator"/);
  assert.match(appSource, /PREVIEW_PANE_WIDTH_KEY/);
  assert.match(appSource, /handleWorkspaceSplitPointerDown/);
  assert.match(appSource, /\["ArrowLeft", "ArrowRight"\]/);
  assert.match(stylesSource, /grid-template-columns: minmax\(420px, 1fr\) 10px minmax\(340px, var\(--preview-pane-width, 390px\)\)/);
  assert.match(stylesSource, /\.workspace-splitter\s*\{[^}]*cursor: col-resize/s);
});

test("agenda preview scale follows the resized preview container", () => {
  assert.match(appSource, /availableWidth \/ \(210 \* 96 \/ 25\.4\)/);
  assert.match(appSource, /new ResizeObserver/);
  assert.match(appSource, /--agenda-preview-scale/);
  assert.match(stylesSource, /\.preview-scroll \.agenda-page\s*\{[^}]*width: 210mm;[^}]*height: 297mm;[^}]*padding: 10mm;/s);
  assert.match(stylesSource, /\.print-note\s*\{[^}]*margin-top: auto;/s);
  assert.match(stylesSource, /zoom: var\(--agenda-preview-scale, 0\.38\)/);
});

test("officer roles auto-fill the assigned club member in agenda items", () => {
  assert.match(appSource, /function autofillAgendaOfficer/);
  assert.match(appSource, /input\.matches\("\[data-role-item\]"\)[\s\S]*autofillAgendaOfficer\(item, item\.role\)/);
  assert.match(appSource, /const memberId = officerAssignmentsFromMembers\(\)\[role\]/);
  assert.match(appSource, /item\.member = member\.displayName/);
});

test("Agenda prepared speech editor mirrors Book grouping and cascade", () => {
  assert.match(appSource, /agenda-speech-card span-2[\s\S]*Same information used in Role Book/);
  assert.match(appSource, /agenda-speech-modes mode-\$\{mode \|\| "required"\}[\s\S]*Learning path[\s\S]*Custom/);
  assert.doesNotMatch(appSource.slice(appSource.indexOf("function renderSpeechDetailsEditor"), appSource.indexOf("function normalizedPersonName")), /Decide later/);
  assert.match(appSource, /agenda-path-level[\s\S]*pathwaysPath[\s\S]*pathwaysLevel/);
  assert.match(appSource, /forms\.length === 1[\s\S]*pathwaysFormId: forms\[0\]\.formId/);
  assert.match(appSource, /needs complete learning-path details or a custom speech objective/);
  assert.match(stylesSource, /\.agenda-speech-card[\s\S]*\.agenda-speech-modes::before[\s\S]*\.agenda-path-level/);
  assert.match(stylesSource, /@media screen and \(max-width: 680px\)[\s\S]*\.agenda-path-level \{ grid-template-columns: 1fr; \}/);
});

test("autosave writes a local draft and syncs the latest snapshot only", () => {
  assert.match(appSource, /const DRAFTS_KEY = "vpe-agenda-maker-drafts-v1"/);
  assert.match(appSource, /function saveLocalDraft/);
  assert.match(appSource, /function clearLocalDraft/);
  assert.match(appSource, /function markDirty\(\)[\s\S]*saveLocalDraft\(\)/);
  assert.match(appSource, /Auto-saving to Feishu/);
  assert.match(appSource, /if \(savePromise\)[\s\S]*if \(state\.dirty && !state\.conflict && state\.saveStatus !== "error"\) return flushSave\(\)/);
  assert.match(appSource, /if \(state\.dirty\) saveLocalDraft\(\);\s*else clearLocalDraft\(snapshot\.id\)/);
});

test("workspace paints the current meeting before deferred data finishes", () => {
  assert.match(appSource, /const \{ meetings \} = await apiJson\("\/api\/meetings"\)/);
  assert.match(appSource, /loadDeferredWorkspaceData\(\)/);
  assert.match(appSource, /apiJson\("\/api\/members"\)/);
  assert.match(appSource, /apiJson\("\/api\/templates"\)/);
  assert.match(appSource, /apiJson\("\/api\/assets\/group-qr\?metadata=1"\)/);
  assert.doesNotMatch(appSource, /const \[\{ meetings \}, \{ members \}, \{ templates \}/);
});

test("awards load for Advisor status and Admin award tasks", () => {
  assert.match(appSource, /if \(state\.meeting\?\.id === meetingId\) await loadAwards\(\{ quiet: true \}\)/);
  assert.match(appSource, /state\.activeTask === "awards"[\s\S]*await loadAwards\(\)/);
});

import { CLUB_PROFILE } from "../../club-profile.js";

export const STORAGE_KEYS = Object.freeze({
  meeting: "vpe-agenda-maker-v1",
  drafts: "vpe-agenda-maker-drafts-v1",
  migration: "vpe-agenda-maker-bitable-migration-v1",
  previewPaneWidth: "vpe-agenda-preview-pane-width-v1",
});
export const DEMO_MODE = typeof window !== "undefined" && /^\/demo\/?$/.test(window.location.pathname);
export const MAX_QR_IMAGE_BYTES = 2 * 1024 * 1024;
export const MAX_OFFICER_IMAGE_BYTES = 5 * 1024 * 1024;
export const FUTURE_POSTER_KINDS = Object.freeze(["future-poster-1", "future-poster-2"]);
const OFFICER_IMAGE_RATIO = 16 / 9;
export const TRANSITION_MINUTES = 1;
export const SIGNUP_TEXT_MIN = 20;
export const SIGNUP_TEXT_MAX = 10_000;
export const SIGNUP_IMPORT_MODEL = "deepseek-v4-flash";
export const EMPTY_IMAGE = Object.freeze({ present: false, name: "", type: "", size: 0, version: "" });
export const CLUB_LOGO_URL = CLUB_PROFILE.logo;
export const DEMO_WORKSPACE_IMAGE_URL = new URL("../../assets/about/workspace-demo-admin.png", import.meta.url).href;
export const WORKFLOW = Object.freeze({
  preparation: [
    { id: "meeting-details", label: "Meeting details" },
    { id: "build-agenda", label: "Build agenda" },
    { id: "prepare-voting", label: "Prepare voting" },
    { id: "future-posters", label: "Future posters" },
    { id: "mcp-changes", label: "MCP changes" },
    { id: "review-share", label: "Review & share" },
  ],
  live: [
    { id: "start-voting", label: "Start voting" },
    { id: "awards", label: "Awards" },
  ],
  review: [
    { id: "meeting-review", label: "Meeting review" },
  ],
});
export const STAGE_LABELS = Object.freeze({ preparation: "Preparation", live: "Live Execution", review: "Review" });

// 各 feature 模块在自己的 handleClick/handleChange/handleSubmit 里处理的委托选择器清单。
// 纯索引:没有代码消费它,作用是让人和 agent 反查"某个 data-* 按钮归哪个模块"。加分支时同步这里。
export const ACTIONS = Object.freeze({
  printExport: Object.freeze([
    "data-download-agenda-pdf",
    "data-print",
    "data-summary",
    "data-export-json",
    "data-cancel-print",
    "data-share-agenda-image",
    "data-close-agenda-image",
    "data-download-agenda-image",
    "data-print-form",
  ]),
  media: Object.freeze([
    "data-upload-image",
    "data-remove-image",
  ]),
  votingAwards: Object.freeze([
    "data-role-taker-role",
    "data-table-topics-speakers",
    "data-voting-source",
    "data-reload-table-topics",
    "data-delete-table-topic",
    "data-open-voting-console",
    "data-close-voting-console",
    "data-refresh-voting-console",
    "data-voting-prepare",
    "data-voting-sync",
    "data-voting-results",
    "data-voting-clear",
    "data-voting-authorize",
    "data-save-table-topics",
    "data-refresh-awards",
    "data-contest-place",
    "data-table-topics-form",
  ]),
  signup: Object.freeze([
    "data-signup-generation-language",
    "data-signup-generation-emoji",
    "data-signup-generation-titles",
    "data-signup-text",
    "data-signup-change-check",
    "data-signup-change-member",
    "data-signup-change-value",
    "data-open-signup-generation",
    "data-toggle-signup-emoji",
    "data-pick-signup-emoji",
    "data-clear-signup-emoji",
    "data-backspace-signup-emoji",
    "data-close-signup-generation",
    "data-retry-signup-generation",
    "data-copy-signup-generation",
    "data-open-signup-import",
    "data-close-signup-import",
    "data-analyze-signup",
    "data-back-signup-import",
    "data-apply-signup",
  ]),
  memberPicker: Object.freeze([
    "data-member-picker-search",
    "data-officer-role",
    "data-open-member-picker",
    "data-close-member-picker",
    "data-keep-current-member",
    "data-pick-member",
    "data-clear-member",
    "data-add-picker-guest",
    "data-cancel-role",
    "data-cancel-guest",
    "data-guest-form",
    "data-role-form",
  ]),
  recommendations: Object.freeze([
    "data-outreach-draft",
    "data-outreach-tone",
    "data-exclusion-scope",
    "data-refresh-recommendations",
    "data-select-recommendation-role",
    "data-start-recommendations",
    "data-toggle-all-recommendations",
    "data-open-outreach",
    "data-open-recommendation-details",
    "data-close-outreach",
    "data-outreach-language",
    "data-outreach-status",
    "data-outreach-primary",
    "data-copy-outreach-again",
    "data-polish-outreach",
    "data-dismiss-recommendation",
    "data-restore-dismissed",
    "data-restore-exclusion",
    "data-open-exclusion",
    "data-close-exclusion",
    "data-open-excluded",
    "data-open-current-members",
    "data-open-picker-recommendations",
    "data-recommendation-exclusion-form",
  ]),
  prompts: Object.freeze([
    "data-club-settings",
    "data-close-club-settings",
    "data-about-product",
    "data-close-about-product",
    "data-rename-template",
    "data-cancel-template-choice",
    "data-cancel-rename-template",
    "data-cancel-save-template",
    "data-skip-migration",
  ]),
  advisorWorkflow: Object.freeze([
    "data-review-field",
    "data-reload-mcp-changes",
    "data-advisor-toggle",
    "data-stage",
    "data-mobile-view",
    "data-issue-index",
    "data-preview-block",
    "data-complete-review",
    "data-skip-review",
  ]),
  agendaEditor: Object.freeze([
    "data-path",
    "data-block-key",
    "data-speech-item",
    "data-role-item",
    "data-external-presentation-url",
    "data-item",
    "data-select-block",
    "data-move-block",
    "data-move-item",
    "data-delete-item",
    "data-add-block",
    "data-duplicate-block",
    "data-delete-block",
    "data-add-item",
    "data-autofill-wod",
  ]),
  lifecycleSync: Object.freeze([
    "data-new-meeting",
    "data-save-template",
    "data-reset-demo",
    "data-sign-out",
    "data-import-local",
    "data-save-copy",
    "data-guest-meeting",
    "data-rename-template-form",
    "data-template-form",
  ]),
});

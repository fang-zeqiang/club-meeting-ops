import { createSpeakingTipCarousel } from "../../speaking-tips.js";
import { state } from "./state.js";

export const speakingTips = createSpeakingTipCarousel(document);

const hooks = { render: () => {}, regions: {}, bindLogin: () => {}, bindEvents: () => {}, flushSave: async () => {}, updateMeetingSummary: () => {}, clearLocalDraft: () => {} };

// 由 app.js 入口注册,feature 模块只 import 本文件,永不反向依赖 render.js
export function registerRenderHooks(next) {
  Object.assign(hooks, next);
}

export function render() {
  hooks.render();
}

// 保存链路的实现在 orchestration.js,这里只做转发,避免 feature 之间互相 import
export function flushSave() {
  return hooks.flushSave();
}

export function updateMeetingSummary(meeting) {
  return hooks.updateMeetingSummary(meeting);
}

export function clearLocalDraft(meetingId) {
  return hooks.clearLocalDraft(meetingId);
}

export function bindLogin() {
  hooks.bindLogin();
}

export function bindEvents() {
  hooks.bindEvents();
}

// ---- 以下为 app.js 原文,仅把 renderXxx() markup 调用换成 hooks.regions.xxx() ----

export function replaceRegion(name, markup) {
  const current = document.querySelector(`[data-region="${name}"]`);
  if (!current) return false;
  current.outerHTML = markup;
  return true;
}

function updateRegionContent(name, markup) {
  const current = document.querySelector(`[data-region="${name}"]`);
  if (!current) return false;
  current.innerHTML = markup;
  return true;
}

function captureUiContinuity() {
  const active = document.activeElement;
  const editor = document.querySelector(".editor-scroll");
  const preview = document.querySelector(".preview-scroll");
  const selection = active && ["INPUT", "TEXTAREA"].includes(active.tagName)
    ? { start: active.selectionStart, end: active.selectionEnd, direction: active.selectionDirection }
    : null;
  return {
    editorScrollTop: editor?.scrollTop || 0,
    editorScrollLeft: editor?.scrollLeft || 0,
    previewScrollTop: preview?.scrollTop || 0,
    previewScrollLeft: preview?.scrollLeft || 0,
    windowScrollX: window.scrollX,
    windowScrollY: window.scrollY,
    focusKey: active?.dataset?.focusKey || "",
    selection,
  };
}

export function elementForFocusKey(focusKey) {
  if (!focusKey) return null;
  return [...document.querySelectorAll("[data-focus-key]")]
    .find((element) => element.dataset.focusKey === focusKey) || null;
}

function restoreUiContinuity(snapshot, preferredFocusKey = "") {
  const focusTarget = elementForFocusKey(preferredFocusKey || snapshot.focusKey);
  focusTarget?.focus({ preventScroll: true });
  if (focusTarget && snapshot.selection && ["INPUT", "TEXTAREA"].includes(focusTarget.tagName)) {
    const max = focusTarget.value.length;
    focusTarget.setSelectionRange(
      Math.min(snapshot.selection.start ?? max, max),
      Math.min(snapshot.selection.end ?? max, max),
      snapshot.selection.direction || "none",
    );
  }
  const editor = document.querySelector(".editor-scroll");
  const preview = document.querySelector(".preview-scroll");
  if (editor) {
    editor.scrollTop = snapshot.editorScrollTop;
    editor.scrollLeft = snapshot.editorScrollLeft;
  }
  if (preview) {
    preview.scrollTop = snapshot.previewScrollTop;
    preview.scrollLeft = snapshot.previewScrollLeft;
  }
  window.scrollTo(snapshot.windowScrollX, snapshot.windowScrollY);
}

export function withUiContinuity(update, preferredFocusKey = "") {
  const snapshot = captureUiContinuity();
  update();
  restoreUiContinuity(snapshot, preferredFocusKey);
}

export function renderNavigatorRegion() {
  replaceRegion("navigator", hooks.regions.navigator());
}

function renderWorkflowSidebarRegion() {
  replaceRegion("workflow-sidebar", hooks.regions["workflow-sidebar"]());
}

export function renderMediaRegion() {
  replaceRegion("media", hooks.regions.media());
  speakingTips.start();
}

export function renderOfficerRegion() {
  replaceRegion("officers", hooks.regions.officers());
}

export function renderAwardsRegion(preferredFocusKey = "") {
  withUiContinuity(() => replaceRegion("awards", hooks.regions.awards()), preferredFocusKey);
  speakingTips.start();
}

export function renderSaaQuickActionsRegion() {
  replaceRegion("saa-quick-actions", hooks.regions["saa-quick-actions"]());
}

function renderBlockListRegion() {
  replaceRegion("block-list", hooks.regions["block-list"]());
}

export function renderBlockEditorRegion() {
  replaceRegion("block-editor", hooks.regions["block-editor"]());
}

export function renderValidationRegion() {
  replaceRegion("validation", hooks.regions.validation());
}

export function renderStatusRegion() {
  replaceRegion("status", hooks.regions.status());
}

export function renderPreviewRegion() {
  updateRegionContent("preview", hooks.regions.preview());
}

export function renderToastRegion() {
  return replaceRegion("toast", hooks.regions.toast());
}

export function renderOverlayRegion(preferredFocusKey = "") {
  replaceRegion("overlays", hooks.regions.overlays());
  document.body.classList.toggle("has-modal", Boolean(document.querySelector(".modal-backdrop")));
  speakingTips.start();
  const autofocus = document.querySelector('[data-region="overlays"] [autofocus]');
  const focusTarget = autofocus || elementForFocusKey(preferredFocusKey);
  focusTarget?.focus({ preventScroll: true });
}

export function refreshDerivedRegions({ blockList = false, navigator = false } = {}) {
  if (blockList) renderBlockListRegion();
  if (navigator) renderNavigatorRegion();
  renderOfficerRegion();
  renderValidationRegion();
  renderWorkflowSidebarRegion();
  renderStatusRegion();
  renderPreviewRegion();
}

export function refreshStructure(preferredFocusKey = "") {
  withUiContinuity(() => {
    renderBlockListRegion();
    renderBlockEditorRegion();
    renderValidationRegion();
    renderWorkflowSidebarRegion();
    renderStatusRegion();
    renderPreviewRegion();
  }, preferredFocusKey);
}

export function finishRender() {
  document.body.classList.toggle("has-modal", Boolean(document.querySelector(".modal-backdrop")));
  speakingTips.start();
}

export function notify(message) {
  state.toast = message;
  if (!renderToastRegion()) render();
  window.setTimeout(() => {
    state.toast = "";
    renderToastRegion();
  }, 2200);
}


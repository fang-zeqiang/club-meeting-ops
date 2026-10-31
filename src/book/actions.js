import { MEMBER_STORAGE_KEY, apiJson, speakingTips, state } from "./state.js";
import { render, showToast } from "./render.js";
import { closeSheet, openGuestConfirmation } from "./sheets.js";

export async function loadInitialData() {
  if (state.memberId) {
    try {
      await loadDashboard(false);
      return;
    } catch (error) {
      if (error.code !== "MEMBER_NOT_FOUND") throw error;
    }
    state.memberId = "";
    state.dashboard = null;
    localStorage.removeItem(MEMBER_STORAGE_KEY);
  }
  const { members } = await apiJson("/api/members?view=book");
  state.members = members;
}

export async function loadDashboard(preserveScroll = true) {
  const scroll = window.scrollY;
  const [dashboardResult, catalogResult] = await Promise.all([
    apiJson(`/api/meetings?view=book&memberId=${encodeURIComponent(state.memberId)}`),
    state.pathwaysCatalog === null
      ? apiJson("/api/pathways-catalog?audience=book").catch(() => ({ catalog: false }))
      : Promise.resolve({ catalog: state.pathwaysCatalog }),
  ]);
  const { dashboard } = dashboardResult;
  state.pathwaysCatalog = catalogResult.catalog;
  state.dashboard = dashboard;
  state.members = dashboard.members;
  render();
  if (preserveScroll) queueMicrotask(() => window.scrollTo(0, scroll));
}

export async function selectMember(memberId) {
  state.memberId = memberId;
  localStorage.setItem(MEMBER_STORAGE_KEY, memberId);
  state.loading = true;
  render();
  try {
    await loadDashboard(false);
  } catch (error) {
    state.error = error.message;
    state.memberId = "";
  } finally {
    state.loading = false;
    render();
  }
}

export function setSyncBusy(form, busy) {
  const scope = form || document.querySelector("#book-sheet[open] .book-sheet-body");
  if (!scope) return false;
  scope.setAttribute("aria-busy", String(busy));
  scope.querySelectorAll("button, input, select, textarea").forEach((control) => { control.disabled = busy; });
  const anchor = scope.querySelector(".book-sheet-actions") || scope.querySelector('[type="submit"]');
  const stage = scope.querySelector("[data-sync-stage]");
  if (busy && !scope.querySelector("[data-loading-tip]")) {
    if (stage) stage.innerHTML = speakingTips.markup();
    else anchor?.insertAdjacentHTML("beforebegin", speakingTips.markup());
  }
  if (!busy) scope.querySelector("[data-loading-tip]")?.remove();
  speakingTips.start();
  const submit = form?.querySelector('[type="submit"]') || scope.querySelector("[data-confirm-cancel], [data-confirm-transfer]");
  if (!submit) return true;
  if (busy) {
    submit.dataset.idleLabel = submit.textContent;
    submit.dataset.loading = "true";
    submit.textContent = "同步中…";
  } else {
    submit.textContent = submit.dataset.idleLabel || submit.textContent;
    delete submit.dataset.idleLabel;
    delete submit.dataset.loading;
  }
  return true;
}

export async function runAction(action, body, successMessage, form = null) {
  if (state.busy) return;
  state.busy = true;
  let saved = false;
  const inlineLoading = setSyncBusy(form, true);
  if (!inlineLoading) { state.loading = true; render(); }
  try {
    const result = await apiJson(`/api/meetings?view=book&action=${encodeURIComponent(action)}`, { method: "POST", body: JSON.stringify({ memberId: state.memberId, ...body }) });
    saved = true;
    state.pending = null;
    await loadDashboard();
    showToast(successMessage, result.deleted);
  } catch (error) {
    if (saved) closeSheet();
    if (["GUEST_POSSIBLE_DUPLICATE", "GUEST_CONFIRMATION_REQUIRED"].includes(error.code) && error.details) {
      openGuestConfirmation({ inspection: error.details });
    }
    if (["ROLE_TAKEN", "GUEST_CREATED_ROLE_TAKEN", "REVISION_CONFLICT"].includes(error.code)) await loadDashboard();
    showToast(saved ? "数据已同步，请刷新页面查看。" : error.message);
  } finally {
    setSyncBusy(form, false);
    state.busy = false;
    if (!inlineLoading) { state.loading = false; render(); }
  }
}

export async function initialize() {
  try {
    const session = await apiJson("/api/session?view=book");
    state.authenticated = session.authenticated;
    if (state.authenticated) await loadInitialData();
  } catch (error) {
    state.error = error.message;
  } finally {
    state.loading = false;
    render();
  }
}

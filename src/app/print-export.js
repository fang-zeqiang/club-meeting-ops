import { CLUB_PROFILE } from "../../club-profile.js";
import { agendaPrintRecommendation } from "../../workflow-helpers.js";
import { esc } from "../shared/html.js";
import { DEMO_MODE } from "./contract.js";
import { getTimeline, getValidation } from "./derivations.js";
import { notify, render, renderOverlayRegion, speakingTips } from "./render-engine.js";
import { runtime, state } from "./state.js";

async function waitForPrintLayout() {
  await Promise.race([
    Promise.all([
      document.fonts?.ready,
      ...[...document.querySelectorAll(".agenda-page img")].filter((image) => !image.complete).map((image) => new Promise((resolve) => {
        image.addEventListener("load", resolve, { once: true });
        image.addEventListener("error", resolve, { once: true });
      })),
    ]),
    new Promise((resolve) => setTimeout(resolve, 2000)),
  ]);
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

function printLayoutWarnings() {
  // ponytail: mobile screen media differs from print; add a print-media probe if mobile preflight becomes necessary.
  if (window.matchMedia("(max-width: 680px)").matches) return [];
  const pages = [...document.querySelectorAll(".agenda-page")];
  const zooms = pages.map((page) => page.style.zoom);
  pages.forEach((page) => { page.style.zoom = "1"; });
  const warnings = pages
    .filter((page) => page.scrollHeight > page.clientHeight + 1)
    .map((page) => `${page.classList.contains("front-page") ? "Front" : "Back"} page exceeds A4 and may be clipped or split.`);
  pages.forEach((page, index) => { page.style.zoom = zooms[index]; });
  return warnings;
}

function restorePrintView(prompt) {
  state.activeView = prompt.previousView;
  state.mobileView = prompt.previousMobileView;
  state.activeStage = prompt.previousStage;
  state.activeTask = prompt.previousTask;
  state.printPrompt = null;
  render();
}

async function openPrintPrompt() {
  const prompt = {
    ...agendaPrintRecommendation(state.meeting),
    blockers: getValidation().filter((issue) => issue.severity === "blocker").map((issue) => issue.text),
    layoutWarnings: [],
    checking: true,
    previousView: state.activeView,
    previousMobileView: state.mobileView,
    previousStage: state.activeStage,
    previousTask: state.activeTask,
  };
  state.printPrompt = prompt;
  state.activeView = "admin";
  state.mobileView = "preview";
  state.activeStage = "preparation";
  state.activeTask = "review-share";
  render();
  await waitForPrintLayout();
  if (state.printPrompt !== prompt) return;
  prompt.layoutWarnings = printLayoutWarnings();
  prompt.checking = false;
  renderOverlayRegion();
}

async function printAgenda(copies = 1, prompt = state.printPrompt) {
  if (!prompt) return;
  const restore = () => restorePrintView(prompt);
  try {
    const preview = document.querySelector(".preview-scroll");
    const pages = [...(preview?.querySelectorAll(":scope > .agenda-page") || [])];
    if (pages.length !== 2) {
      restore();
      notify("Agenda preview is not ready. Please try again.");
      return;
    }
    const copyCount = Math.min(50, Math.max(1, Math.round(Number(copies) || 1)));
    for (let copy = 1; copy < copyCount; copy += 1) pages.forEach((page) => preview.append(page.cloneNode(true)));
    window.addEventListener("afterprint", restore, { once: true });
    window.print();
  } catch (error) {
    window.removeEventListener("afterprint", restore);
    restore();
    throw error;
  }
}

async function shareAgendaImage() {
  if (state.agendaImagePrompt?.busy || !state.meeting) return;
  if (DEMO_MODE) return notify("长图分享在 demo 模式下不可用，请使用打印 / PDF。");
  if (state.agendaImagePrompt?.objectUrl) URL.revokeObjectURL(state.agendaImagePrompt.objectUrl);
  const prompt = { busy: true, error: "", objectUrl: "", file: null };
  state.agendaImagePrompt = prompt;
  renderOverlayRegion();
  try {
    const response = await fetch(`/api/meetings/${encodeURIComponent(state.meeting.id)}?action=png`, { credentials: "same-origin" });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.message || "长图生成失败。");
    }
    const file = await response.blob();
    const objectUrl = URL.createObjectURL(file);
    if (state.agendaImagePrompt !== prompt) return URL.revokeObjectURL(objectUrl);
    Object.assign(prompt, { busy: false, objectUrl, file });
  } catch (error) {
    if (state.agendaImagePrompt === prompt) Object.assign(prompt, { busy: false, error: error.message || "长图生成失败。" });
  } finally {
    if (state.agendaImagePrompt === prompt) renderOverlayRegion();
  }
}

export function closeAgendaImagePrompt() {
  if (state.agendaImagePrompt?.objectUrl) URL.revokeObjectURL(state.agendaImagePrompt.objectUrl);
  state.agendaImagePrompt = null;
  renderOverlayRegion(runtime.overlayReturnFocusKey);
  runtime.overlayReturnFocusKey = "";
}

function agendaPdfUrl() {
  if (!state.meeting) return "";
  return state.previewMode
    ? "/api/preview-agenda.pdf"
    : `/api/meetings/${encodeURIComponent(state.meeting.id)}?action=pdf`;
}

function buildAgendaPdfSnapshot() {
  return {
    meeting: structuredClone(state.meeting),
    members: structuredClone(state.members),
    pathwaysCatalog: structuredClone(state.pathwaysCatalog),
    groupQr: structuredClone(state.groupQr),
    paymentQr: structuredClone(state.paymentQr),
    officerTeamPhoto: structuredClone(state.officerTeamPhoto),
  };
}

async function downloadAgendaPdf() {
  const url = agendaPdfUrl();
  if (!url || state.agendaPdfBusy) return;
  if (DEMO_MODE) return notify("PDF download is unavailable in demo. Use Print / PDF instead.");
  state.agendaPdfBusy = true;
  state.agendaPdfError = "";
  render();
  try {
    const response = await fetch(url, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ snapshot: await buildAgendaPdfSnapshot() }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      if (state.previewMode && response.status === 404) {
        throw new Error("Direct PDF download is unavailable in frontend-only preview. Run `npm run dev` to enable the local PDF API.");
      }
      throw new Error(body.message || "Could not create agenda PDF.");
    }
    const file = await response.blob();
    downloadFile(`Agenda-${state.meeting?.meetingNumber || "preview"}.pdf`, file, "application/pdf");
    notify("Agenda PDF downloaded.");
  } catch (error) {
    state.agendaPdfError = error.message || "Could not create agenda PDF.";
    notify(state.agendaPdfError);
  } finally {
    state.agendaPdfBusy = false;
    render();
  }
}

function downloadFile(name, content, type) {
  const link = document.createElement("a");
  const url = URL.createObjectURL(new Blob([content], { type }));
  link.href = url;
  link.download = name;
  link.hidden = true;
  document.body.append(link);
  link.click();
  window.setTimeout(() => {
    link.remove();
    URL.revokeObjectURL(url);
  }, 1000);
}

function triggerBrowserDownload(url, name = "") {
  const link = document.createElement("a");
  link.href = url;
  if (name) link.download = name;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
}

function exportJson() {
  downloadFile(`meeting-${state.meeting.meetingNumber}.json`, JSON.stringify(state.meeting, null, 2), "application/json");
  notify("Canonical meeting JSON exported.");
}

async function exportSummary() {
  const lines = [
    `${DEMO_MODE ? "Riverside Speakers Club" : CLUB_PROFILE.clubName} #${state.meeting.meetingNumber}`,
    `${state.meeting.date} ${state.meeting.startTime}`,
    `Theme: ${state.meeting.theme}`,
    `WOD: ${state.meeting.wordOfDay.word}`,
    "",
    ...getTimeline().map((item) => `${item.start} · ${item.session} · ${item.role}: ${item.member || "Vacant"}`),
  ];
  const summary = lines.join("\n");
  try {
    await navigator.clipboard.writeText(summary);
    notify("Group summary copied to clipboard.");
  } catch {
    downloadFile(`meeting-${state.meeting.meetingNumber}-summary.txt`, summary, "text/plain");
    notify("Group summary downloaded.");
  }
}

export function renderAgendaImagePrompt() {
  const prompt = state.agendaImagePrompt;
  if (!prompt) return "";
  const content = prompt.busy
    ? `<div class="agenda-image-state" role="status" aria-live="polite"><div class="sync-progress"><span aria-hidden="true"></span>正在生成分享长图…</div><p>请稍候，完成后会自动显示预览。</p></div>`
    : prompt.error
      ? `<div class="agenda-image-state is-error" role="alert"><h3>长图生成失败</h3><p>${esc(prompt.error)}</p><button class="button primary" type="button" data-share-agenda-image>重试</button></div>`
      : `<div class="agenda-image-stage"><img src="${prompt.objectUrl}" alt="Agenda 分享长图预览" /></div>`;
  return `<div class="modal-backdrop agenda-image-backdrop"><section class="agenda-image-modal" role="dialog" aria-modal="true" aria-labelledby="agenda-image-title">
    <header><div><h2 id="agenda-image-title">分享长图</h2><p>预览当前 Agenda 首页</p></div><button class="icon-button" type="button" data-close-agenda-image aria-label="关闭长图预览" autofocus>×</button></header>
    ${content}
    ${prompt.objectUrl ? `<footer><strong>长按图片，保存到相册</strong><button class="button primary" type="button" data-download-agenda-image>下载 PNG</button></footer>` : ""}
  </section></div>`;
}

export function renderPrintPrompt() {
  if (!state.printPrompt) return "";
  const { copies, roleTakers, upliftPercent, blockers, layoutWarnings, checking } = state.printPrompt;
  const hasWarnings = blockers.length || layoutWarnings.length;
  return `<div class="modal-backdrop"><section class="modal-card print-setup-modal" role="dialog" aria-modal="true" aria-labelledby="print-setup-title">
    <header><span class="eyebrow">Print setup</span><h2 id="print-setup-title">Print Agenda</h2></header>
    <form data-print-form><div class="print-setup-scroll">
      ${blockers.length ? `<section class="print-warning"><h3>Agenda blockers · ${blockers.length}</h3><ul>${blockers.map((blocker) => `<li>${esc(blocker)}</li>`).join("")}</ul></section>` : ""}
      ${checking ? `<section class="print-checking" role="status"><div class="sync-progress"><span aria-hidden="true"></span>Checking print layout…</div>${speakingTips.markup({ delayed: true })}</section>` : layoutWarnings.length ? `<section class="print-warning layout"><h3>Print layout warning</h3><ul>${layoutWarnings.map((warning) => `<li>${esc(warning)}</li>`).join("")}</ul></section>` : ""}
      <div class="field"><div class="field-label"><label for="agenda-sets">Agenda sets</label><button class="field-info" type="button" aria-label="Recommended: ${esc(copies)} sets for ${esc(roleTakers)} scheduled role taker${roleTakers === 1 ? "" : "s"}, including a ${esc(upliftPercent)}% attendance buffer." data-tooltip="Recommended: ${esc(copies)} sets for ${esc(roleTakers)} scheduled role taker${roleTakers === 1 ? "" : "s"}, including a ${esc(upliftPercent)}% attendance buffer.">i</button></div><input id="agenda-sets" name="copies" type="number" min="1" max="50" value="${esc(copies)}" required autofocus></div>
      <div class="system-print-note"><strong>In the print dialog</strong><span>Select a color printer, then Color + Double-sided. Keep Copies at 1.</span></div>
    </div>
      <div class="modal-actions"><button class="button" type="button" data-cancel-print>Cancel</button><button class="button primary" type="submit" ${checking ? "disabled" : ""}>${hasWarnings ? "Print anyway" : "Continue to print"}</button></div>
    </form>
  </section></div>`;
}

export async function handleClick(button, event) {
  if (button.matches("[data-download-agenda-pdf]")) {
    await downloadAgendaPdf();
  } else if (button.matches("[data-print]")) {
    runtime.overlayReturnFocusKey = button.dataset.focusKey || "";
    await openPrintPrompt();
  } else if (button.matches("[data-summary]")) {
    await exportSummary();
  } else if (button.matches("[data-export-json]")) {
    exportJson();
  } else if (button.matches("[data-cancel-print]")) {
    if (state.printPrompt) restorePrintView(state.printPrompt);
    runtime.overlayReturnFocusKey = "";
  } else if (button.matches("[data-share-agenda-image]")) {
    runtime.overlayReturnFocusKey = button.dataset.focusKey || runtime.overlayReturnFocusKey;
    await shareAgendaImage();
  } else if (button.matches("[data-close-agenda-image]")) {
    closeAgendaImagePrompt();
  } else if (button.matches("[data-download-agenda-image]")) {
    const share = state.agendaImagePrompt;
    if (share?.file) downloadFile(`Agenda-${state.meeting?.meetingNumber || "preview"}.png`, share.file, "image/png");
  } else {
    return false;
  }
  return true;
}

export async function handleSubmit(form, event) {
  if (form.matches("[data-print-form]")) {
    event.preventDefault();
    const copies = Math.min(50, Math.max(1, Number(new FormData(form).get("copies")) || 1));
    await printAgenda(copies, state.printPrompt);
  } else {
    return false;
  }
  return true;
}

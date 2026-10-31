import "./styles.css";
import "./speaking-tip-card.css";
import { apiJson } from "./src/app/api.js";
import { DEMO_MODE } from "./src/app/contract.js";
import { bindEvents } from "./src/app/events.js";
import { applyDirty, updateMeetingSummary } from "./src/app/lifecycle-sync.js";
import { flushSave, loadMeetingFromCloud, openWorkspace } from "./src/app/orchestration.js";
import { regions, render } from "./src/app/render.js";
import { registerRenderHooks } from "./src/app/render-engine.js";
import { setDirtyHandler, state } from "./src/app/state.js";
import { clearLocalDraft, loadPdfSnapshotWorkspace, loadPreviewWorkspace } from "./src/app/workspace-loader.js";

function bindLogin() {
  const form = document.querySelector("[data-login-form]");
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const errorNode = form.querySelector("[data-login-error]");
    const button = form.querySelector("button");
    button.disabled = true;
    errorNode.textContent = "";
    try {
      await apiJson("/api/session", { method: "POST", body: JSON.stringify({ passcode: new FormData(form).get("passcode") }) });
      state.authenticated = true;
      await openWorkspace();
    } catch (error) {
      errorNode.textContent = error.message;
      button.disabled = false;
    }
  });
}

async function bootstrap() {
  const pdfSnapshot = window.__AGENDA_PDF_SNAPSHOT__;
  const previewParams = new URLSearchParams(window.location.search);
  const pdfMeetingId = previewParams.get("pdfMeeting");
  if (pdfSnapshot?.meeting) {
    loadPdfSnapshotWorkspace(pdfSnapshot);
    return;
  }
  if (DEMO_MODE) {
    loadPreviewWorkspace();
    return;
  }
  if (import.meta.env.DEV && previewParams.has("preview")) {
    loadPreviewWorkspace();
    if (previewParams.has("pdf")) {
      state.activeView = "admin";
      state.mobileView = "preview";
      state.activeTask = "review-share";
      render();
    }
    return;
  }
  if (pdfMeetingId) {
    state.loading = true;
    render();
    try {
      const session = await apiJson("/api/session");
      state.authenticated = session.authenticated;
      if (state.authenticated) {
        await loadMeetingFromCloud(pdfMeetingId);
        if (state.meeting) {
          state.activeView = "admin";
          state.mobileView = "preview";
          state.activeStage = "preparation";
          state.activeTask = "review-share";
          render();
        }
      } else {
        state.loading = false;
        render();
      }
    } catch {
      state.loading = false;
      render();
    }
    return;
  }
  render();
  try {
    const session = await apiJson("/api/session");
    state.authenticated = session.authenticated;
    state.loading = false;
    if (state.authenticated) await openWorkspace();
    else render();
  } catch {
    state.loading = false;
    render();
  }
}

// render-engine / state 只持有钩子,真正的渲染与生命周期实现在 src/app/render.js、src/app/orchestration.js,避免基础设施反向依赖 feature
setDirtyHandler(applyDirty);
registerRenderHooks({
  render,
  bindLogin,
  bindEvents,
  flushSave,
  updateMeetingSummary,
  clearLocalDraft,
  regions,
});

bindEvents();
bootstrap();

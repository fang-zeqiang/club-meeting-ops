import "./presentation-remote.css";
import { createPresentationRemote, isRemoteCommand, normalizeRemoteState } from "./presentation-remote.js";

const meetingNumber = window.location.pathname.match(/^\/m\/(\d+)\/presentation\/remote\/?$/)?.[1] || "";
const roomId = decodeRoomId(location.hash.slice(1));
let status = "connecting";
let state = normalizeRemoteState();
let remote;

function decodeRoomId(value) { try { return decodeURIComponent(value); } catch { return ""; } }
function statusCopy() { return { connecting: "连接中…", subscribed: "已连接", disconnected: "已断开", ended: "遥控已结束" }[status] || "连接中…"; }
function isDisabled(command) {
  if (status !== "subscribed") return true;
  if (command === "previous") return state.index <= 0;
  if (command === "next") return !state.total || state.index >= state.total - 1;
  if (command === "draw-topic") return !state.canDrawTopic;
  if (command === "timer-start") return state.timer === "running";
  if (command === "timer-pause") return state.timer !== "running";
  if (command === "refresh-deck") return !state.canRefreshDeck;
  if (command === "reload-external") return !state.canReloadExternal;
  if (command === "fullscreen-external") return !state.canFullscreenExternal;
  if (command === "refresh-awards") return !state.canRefreshAwards;
  return false;
}
function button(command, label, primary = false) { return `<button class="presentation-remote-button ${primary ? "primary" : "secondary"}" type="button" data-remote-command="${command}">${label}</button>`; }
function navigation() {
  return `<section class="presentation-remote-group"><h2>演示导航</h2><div class="presentation-remote-actions">${button("previous", "上一页")}${button("next", "下一页", true)}</div>${state.total ? `<form class="presentation-remote-jump" data-remote-jump><label>跳至页码 <input name="page" type="number" min="1" max="${state.total}" value="${state.index + 1}" inputmode="numeric"></label><button class="presentation-remote-button secondary" type="submit">跳转</button></form>` : ""}</section>`;
}
function render() {
  document.title = `会议 #${meetingNumber} 遥控器`;
  document.body.innerHTML = `<main class="presentation-remote" aria-live="polite"><section class="presentation-remote-card"><header><p class="presentation-remote-label">会议 #${meetingNumber || "—"} · 演示遥控器</p><h1>下一步，由你掌控</h1><p class="presentation-remote-status" data-status="${status}">${statusCopy()}</p><p class="presentation-remote-position">${state.total ? `第 ${state.index + 1} / ${state.total} 页` : "等待演示页状态"}</p></header>${navigation()}<section class="presentation-remote-group"><h2>现场动作</h2><div class="presentation-remote-actions">${state.canDrawTopic ? button("draw-topic", state.drawTopicMode === "redraw" ? "换一题（需按两次）" : "抽取话题", state.drawTopicMode !== "redraw") : ""}${state.canRefreshAwards ? button("refresh-awards", "刷新奖项", true) : ""}</div></section><section class="presentation-remote-group"><h2>计时</h2><div class="presentation-remote-actions">${button("timer-start", "开始计时")}${button("timer-pause", "暂停计时")}${button("timer-reset", "重置计时")}</div></section><section class="presentation-remote-group"><h2>内容与运行</h2><div class="presentation-remote-actions">${state.canRefreshDeck ? button("refresh-deck", "刷新议程") : ""}${state.canReloadExternal ? button("reload-external", "重新加载外部内容") : ""}${state.canFullscreenExternal ? button("fullscreen-external", "外链全屏") : ""}</div></section></section></main>`;
  document.querySelectorAll("[data-remote-command]").forEach((item) => { item.disabled = isDisabled(item.dataset.remoteCommand); });
}
function updateStatus(value) {
  status = value === "SUBSCRIBED" ? "subscribed" : ["CLOSED", "CHANNEL_ERROR", "TIMED_OUT"].includes(value) ? "disconnected" : ["invalid-room", "unavailable"].includes(value) ? "ended" : "connecting";
  render();
  if (status === "subscribed") remote?.requestState();
}
document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-remote-command]"); const command = button?.dataset.remoteCommand;
  if (!button || button.disabled || !isRemoteCommand(command)) return;
  button.disabled = true;
  try { await remote.publishCommand(command); } catch { status = "disconnected"; render(); }
});
document.addEventListener("submit", async (event) => {
  const form = event.target.closest("[data-remote-jump]"); if (!form) return;
  event.preventDefault();
  try { await remote.publishCommand("go-to", { page: Number(new FormData(form).get("page")) }); } catch { status = "disconnected"; render(); }
});
render();
remote = createPresentationRemote({ roomId, onState(nextState) { state = normalizeRemoteState(nextState); render(); }, onStatus: updateStatus });
window.addEventListener("pagehide", () => remote.close(), { once: true });

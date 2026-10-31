import { esc } from "../shared/html.js";
import { state } from "./state.js";
import { selectMember } from "./actions.js";

const LONG_PRESS_MS = 500;
const MOVE_CANCEL_PX = 10;

// 一次长按切换的全部运行时状态；没有长按进行中时为 null。
let press = null;

function openOverlay(anchor) {
  // 当前会员也留在列表里，拖回自己就等于取消切换。
  const members = state.members || [];
  if (members.length < 2) return false;
  const rect = anchor.getBoundingClientRect();
  const overlay = document.createElement("div");
  overlay.className = "book-member-switch";
  overlay.setAttribute("role", "listbox");
  overlay.setAttribute("aria-label", "快速切换会员");
  // 列表可能比锚点下方的剩余空间还高，贴视口底部往上留白，避免超出屏幕。
  const maxHeight = Math.max(160, window.innerHeight - rect.bottom - 16);
  overlay.style.top = `${Math.round(rect.bottom + 8)}px`;
  overlay.style.right = `${Math.round(window.innerWidth - rect.right)}px`;
  overlay.style.maxHeight = `${Math.round(maxHeight)}px`;
  overlay.innerHTML = `<p class="book-member-switch-tip">上下拖动选择，松手切换</p>${members.map((member) => `<span class="book-member-switch-option" role="option" data-member-option="${esc(member.id)}" aria-selected="${member.id === state.memberId}">${esc(member.displayName)}</span>`).join("")}`;
  document.body.append(overlay);
  press.overlay = overlay;
  press.options = [...overlay.querySelectorAll("[data-member-option]")];
  press.selectedId = state.memberId;
  navigator.vibrate?.(10);
  return true;
}

function highlight(clientY) {
  if (!press?.options) return;
  const first = press.options[0].getBoundingClientRect();
  const last = press.options.at(-1).getBoundingClientRect();
  const target = clientY <= first.top ? press.options[0]
    : clientY >= last.bottom ? press.options.at(-1)
      : press.options.find((option) => {
        const box = option.getBoundingClientRect();
        return clientY >= box.top && clientY <= box.bottom;
      });
  if (!target || target.dataset.memberOption === press.selectedId) return;
  press.selectedId = target.dataset.memberOption;
  press.options.forEach((option) => option.setAttribute("aria-selected", String(option === target)));
  navigator.vibrate?.(5);
}

// 长按结束后浏览器仍会给 summary 补一次 click，要吃掉它，否则会顺带展开会员菜单。
function suppressNextClick(anchor) {
  const swallow = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };
  anchor.addEventListener("click", swallow, { capture: true, once: true });
  setTimeout(() => anchor.removeEventListener("click", swallow, { capture: true }), 300);
}

function closeOverlay() {
  press?.overlay?.remove();
  clearTimeout(press?.timer);
  press = null;
}

export function bindMemberQuickSwitch(root) {
  root.addEventListener("pointerdown", (event) => {
    const anchor = event.target.closest("[data-member-longpress]");
    if (!anchor || event.button > 0) return;
    closeOverlay();
    press = { anchor, pointerId: event.pointerId, startY: event.clientY, overlay: null, options: null, selectedId: state.memberId };
    press.timer = setTimeout(() => {
      if (!press || !openOverlay(anchor)) return;
      anchor.setPointerCapture(press.pointerId);
      highlight(press.startY);
    }, LONG_PRESS_MS);
  });

  root.addEventListener("pointermove", (event) => {
    if (!press || event.pointerId !== press.pointerId) return;
    if (press.overlay) {
      event.preventDefault();
      highlight(event.clientY);
      return;
    }
    if (Math.abs(event.clientY - press.startY) > MOVE_CANCEL_PX) closeOverlay();
  });

  root.addEventListener("pointerup", async (event) => {
    if (!press || event.pointerId !== press.pointerId) return;
    const { anchor, overlay, selectedId } = press;
    closeOverlay();
    if (!overlay) return;
    suppressNextClick(anchor);
    if (selectedId && selectedId !== state.memberId) await selectMember(selectedId);
  });

  root.addEventListener("pointercancel", closeOverlay);
  window.addEventListener("blur", closeOverlay);
}

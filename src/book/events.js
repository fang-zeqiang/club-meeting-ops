import { matchesMemberSearch } from "../../book-helpers.js";
import { resetDemoBook } from "../../book-demo-state.js";
import { esc } from "../shared/html.js";
import { MEMBER_STORAGE_KEY, apiJson, root, runtime, speakingTips, state } from "./state.js";
import { filteredMeetings, render } from "./render.js";
import {
  closeSheet,
  guestSearchResults,
  inspectGuestName,
  meetingAndAssignment,
  openBookingSheet,
  openCancelConfirmation,
  openGoalSheet,
  openGuestConfirmation,
  openGuestSearchSheet,
  openOwnRoleSheet,
  openPresentationUrlSheet,
  openSelfBookingSheet,
  openSheet,
  openSpeechSheet,
  openTopicsSheet,
  openTransferConfirmation,
  openTransferSheet,
  refreshSpeechFields,
  refreshTopicsSheet,
  validatePresentationUrlInput,
} from "./sheets.js";
import { loadDashboard, loadInitialData, runAction, selectMember, setSyncBusy } from "./actions.js";
import { bindMemberQuickSwitch } from "./member-switch.js";

export function bindBookEvents() {
  bindMemberQuickSwitch(root);

  root.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.target;
    if (!form.reportValidity()) return;
    if (form.matches("[data-pin-form]")) {
      state.error = "";
      const passcode = new FormData(form).get("passcode");
      setSyncBusy(form, true);
      try {
        await apiJson("/api/session?view=book", { method: "POST", body: JSON.stringify({ passcode }) });
        state.authenticated = true;
        state.loading = true;
        render();
        await loadInitialData();
      } catch (error) {
        state.error = error.message;
      } finally {
        setSyncBusy(form, false);
        state.loading = false;
        render();
      }
      return;
    }
    if (form.matches("[data-goal-form]")) {
      const data = Object.fromEntries(new FormData(form));
      await runAction("save-goal", { goal: { id: data.id || undefined, role: data.role, targetCount: Number(data.targetCount), dueDate: data.dueDate } }, data.id ? "目标已更新" : "目标已创建", form);
      return;
    }
    if (form.matches("[data-book-form]")) {
      const details = Object.fromEntries(new FormData(form));
      const externalPresentationUrl = details.externalPresentationUrl;
      delete details.externalPresentationUrl;
      await runAction("book", { ...state.pending, speechDetails: details, externalPresentationUrl }, "预约成功", form);
      return;
    }
    if (form.matches("[data-guest-booking-form]")) {
      const data = new FormData(form);
      const externalPresentationUrl = data.get("externalPresentationUrl") || "";
      const transfer = state.pending.guestMode === "transfer";
      await runAction(transfer ? "transfer" : "book-guest", {
        meetingId: state.pending.meetingId,
        assignmentId: state.pending.assignmentId,
        targetGuestId: state.pending.targetGuestId || undefined,
        newGuestName: state.pending.newGuestName || undefined,
        duplicateConfirmed: Boolean(data.get("duplicateConfirmed")),
        warningsConfirmed: Boolean(data.get("warningsConfirmed")),
        guestConsentConfirmed: true,
        offlineConfirmed: transfer,
        externalPresentationUrl,
      }, transfer ? "Guest 角色已转让" : "Guest 预约成功", form);
      return;
    }
    if (form.matches("[data-transfer-form]")) {
      await runAction("transfer", { ...state.pending, offlineConfirmed: true }, "角色已转让", form);
      return;
    }
    if (form.matches("[data-speech-form]")) {
      const speechDetails = Object.fromEntries(new FormData(form));
      await runAction("update-speech", { ...state.pending, speechDetails }, "演讲信息已更新", form);
      return;
    }
    if (form.matches("[data-presentation-url-form]")) {
      const externalPresentationUrl = new FormData(form).get("externalPresentationUrl");
      await runAction("update-presentation-url", { ...state.pending, externalPresentationUrl }, "Presentation 链接已更新", form);
      return;
    }
    if (form.matches("[data-topic-form]")) {
      const topicTexts = String(new FormData(form).get("topicText") || "").split("\n").map((line) => line.trim()).filter(Boolean);
      if (!topicTexts.length) {
        state.topicsSheet.error = "话题内容不能为空。";
        refreshTopicsSheet();
        return;
      }
      setSyncBusy(form, true);
      try {
        const { topics } = await apiJson("/api/meetings?view=book&action=table-topic-add", {
          method: "POST",
          body: JSON.stringify({ memberId: state.memberId, meetingId: state.topicsSheet.meetingId, topicTexts }),
        });
        state.topicsSheet.topics.push(...topics);
        state.topicsSheet.added = topics.length;
        state.topicsSheet.error = "";
      } catch (error) {
        state.topicsSheet.error = error.message;
      } finally {
        setSyncBusy(form, false);
        refreshTopicsSheet();
      }
    }
  });

  root.addEventListener("input", (event) => {
    if (event.target.matches("[data-external-presentation-url]")) {
      validatePresentationUrlInput(event.target);
      return;
    }
    if (event.target.matches("[data-guest-search]")) {
      const query = event.target.value.trim();
      const body = event.target.closest(".book-sheet-body");
      const results = body.querySelector("[data-guest-results]");
      results.innerHTML = guestSearchResults(query) || `<p class="book-empty">没有匹配的 active Guest。</p>`;
      body.querySelectorAll("[data-transfer-target][data-member-name]").forEach((button) => {
        button.hidden = !matchesMemberSearch(button.dataset.memberName, query);
      });
      const create = body.querySelector("[data-new-booking-guest]");
      create.disabled = !query;
      create.dataset.guestName = query;
      create.textContent = query ? `＋ 不是同一人，创建 “${query}”` : "＋ 输入完整 Guest 姓名后创建";
      return;
    }
    if (!event.target.matches("[data-member-search], [data-transfer-search]")) return;
    const query = event.target.value.trim().toLocaleLowerCase();
    const container = event.target.closest("section, .book-sheet-body");
    const picker = event.target.closest(".member-picker");
    const previousHeight = picker?.getBoundingClientRect().height;
    runtime.memberPickerAnimation?.cancel();
    container?.querySelectorAll("[data-member-name]").forEach((button) => {
      button.hidden = !matchesMemberSearch(button.dataset.memberName, query);
    });
    if (!picker) return;
    picker.scrollTop = 0;
    const nextHeight = picker.getBoundingClientRect().height;
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches && Math.abs(previousHeight - nextHeight) > 1) {
      runtime.memberPickerAnimation = picker.animate([{ height: `${previousHeight}px` }, { height: `${nextHeight}px` }], {
        duration: 220,
        easing: "cubic-bezier(.22, 1, .36, 1)",
      });
    }
  });

  root.addEventListener("change", (event) => {
    if (event.target.matches("[data-external-presentation-url]")) {
      validatePresentationUrlInput(event.target, true);
      return;
    }
    if (!event.target.matches("[data-speech-cascade]")) return;
    refreshSpeechFields(event.target.closest("form"));
  });

  root.addEventListener("click", async (event) => {
    if (event.target.matches("#book-sheet")) {
      closeSheet();
      return;
    }
    const button = event.target.closest("button");
    if (!button) return;
    if (speakingTips.handleClick(event)) {
      return;
    } else if (button.matches("[data-select-member]")) {
      await selectMember(button.dataset.selectMember);
    } else if (button.matches("[data-logout]")) {
      state.loading = true;
      render();
      await apiJson("/api/session?view=book", { method: "DELETE", body: "{}" }).catch(() => {});
      localStorage.removeItem(MEMBER_STORAGE_KEY);
      Object.assign(state, { authenticated: false, memberId: "", dashboard: null, pathwaysCatalog: null, error: "", loading: false });
      render();
    } else if (button.matches("[data-switch-demo-member]")) {
      localStorage.removeItem(MEMBER_STORAGE_KEY);
      Object.assign(state, { memberId: "", dashboard: null, tab: "goals", filter: "all", openMeetingId: "", highlightAssignmentId: "" });
      render();
    } else if (button.matches("[data-reset-demo]")) {
      if (!window.confirm("重置此浏览器中的 Role Book Demo 数据？")) return;
      resetDemoBook();
      localStorage.removeItem(MEMBER_STORAGE_KEY);
      Object.assign(state, { authenticated: true, memberId: "", dashboard: null, pathwaysCatalog: null, tab: "goals", filter: "all", openMeetingId: "", highlightAssignmentId: "" });
      await loadInitialData();
      render();
    } else if (button.matches("[data-tab]")) {
      state.tab = button.dataset.tab;
      state.openMeetingId = "";
      state.highlightAssignmentId = "";
      render();
    } else if (button.matches("[data-new-goal]")) {
      openGoalSheet();
    } else if (button.matches("[data-edit-goal]")) {
      openGoalSheet(state.dashboard.goals.find((goal) => goal.id === button.dataset.editGoal));
    } else if (button.matches("[data-delete-goal]")) {
      const goal = state.dashboard.goals.find((candidate) => candidate.id === button.dataset.deleteGoal);
      if (goal) await runAction("delete-goal", { goalId: goal.id }, "目标已删除");
    } else if (button.matches("[data-undo-goal]")) {
      const goal = state.undoGoal;
      state.undoGoal = null;
      if (goal) await runAction("restore-goal", { goal }, "目标已恢复");
    } else if (button.matches("[data-find-role]")) {
      state.tab = "meetings";
      state.filter = button.dataset.findRole;
      state.openMeetingId = filteredMeetings()[0]?.id || "";
      render();
    } else if (button.matches("[data-jump-meeting]")) {
      state.tab = "meetings";
      state.filter = "all";
      state.openMeetingId = button.dataset.jumpMeeting;
      state.highlightAssignmentId = button.dataset.jumpAssignment;
      render();
    } else if (button.matches("[data-filter]")) {
      state.filter = button.dataset.filter;
      state.openMeetingId = state.filter === "all" ? "" : filteredMeetings()[0]?.id || "";
      state.highlightAssignmentId = "";
      render();
    } else if (button.matches("[data-role-info]")) {
      const role = button.dataset.roleInfo;
      const roleInfo = state.dashboard.roleCatalog.find((candidate) => candidate.name === role);
      const links = [
        roleInfo?.roleUrl ? `<a class="book-button" href="${esc(roleInfo.roleUrl)}" target="_blank" rel="noreferrer">角色资料 ↗</a>` : "",
        roleInfo?.sopUrl ? `<a class="book-button" href="${esc(roleInfo.sopUrl)}" target="_blank" rel="noreferrer">角色 SOP ↗</a>` : "",
      ].filter(Boolean).join("");
      openSheet(role, "角色说明", `<p>${esc(roleInfo?.description || "查看 Agenda 中该角色的具体职责。")}</p><div class="book-sheet-actions">${links}<button class="book-button primary" type="button" data-close-sheet>知道了</button></div>`);
    } else if (button.matches("[data-book-self]")) {
      const { meeting, assignment } = meetingAndAssignment(state.pending.meetingId, state.pending.assignmentId);
      if (meeting && assignment) openSelfBookingSheet(meeting, assignment);
    } else if (button.matches("[data-book-guest]")) {
      openGuestSearchSheet({ transfer: state.pending?.guestMode === "transfer" });
    } else if (button.matches("[data-guest-target]")) {
      const guest = state.dashboard.guests.find((candidate) => candidate.id === button.dataset.guestTarget);
      if (guest) openGuestConfirmation({ targetGuest: guest });
    } else if (button.matches("[data-new-booking-guest]")) {
      await inspectGuestName(button.dataset.guestName);
    } else if (button.matches("[data-book-role]")) {
      const { meeting, assignment } = meetingAndAssignment(button.dataset.meeting, button.dataset.bookRole);
      if (meeting && assignment) openBookingSheet(meeting, assignment);
    } else if (button.matches("[data-own-role]")) {
      const { meeting, assignment } = meetingAndAssignment(button.dataset.meeting, button.dataset.ownRole);
      if (meeting && assignment) openOwnRoleSheet(meeting, assignment);
    } else if (button.matches("[data-manage-topics]")) {
      await openTopicsSheet(button.dataset.manageTopics);
    } else if (button.matches("[data-delete-topic]")) {
      const key = button.dataset.deleteTopic;
      try {
        await apiJson("/api/meetings?view=book&action=table-topic-delete", {
          method: "POST",
          body: JSON.stringify({ memberId: state.memberId, meetingId: state.topicsSheet.meetingId, key }),
        });
        state.topicsSheet.topics = state.topicsSheet.topics.filter((topic) => topic.key !== key);
        state.topicsSheet.added = 0;
        state.topicsSheet.error = "";
      } catch (error) {
        state.topicsSheet.error = error.message;
      }
      refreshTopicsSheet();
    } else if (button.matches("[data-close-sheet]")) {
      closeSheet();
    } else if (button.matches("[data-cancel-role]")) {
      openCancelConfirmation();
    } else if (button.matches("[data-confirm-cancel]")) {
      await runAction("cancel", state.pending, "预约已取消");
    } else if (button.matches("[data-transfer-role]")) {
      openTransferSheet();
    } else if (button.matches("[data-transfer-guest-role]")) {
      openGuestSearchSheet({ transfer: true });
    } else if (button.matches("[data-transfer-target]")) {
      openTransferConfirmation(button.dataset.transferTarget);
    } else if (button.matches("[data-confirm-transfer]")) {
      await runAction("transfer", state.pending, "角色已转让");
    } else if (button.matches("[data-edit-speech]")) {
      openSpeechSheet();
    } else if (button.matches("[data-edit-presentation-url]")) {
      openPresentationUrlSheet();
    }
  });

  document.addEventListener("click", (event) => {
    document.querySelectorAll(".book-member-menu[open], .book-more[open]").forEach((menu) => {
      if (!menu.contains(event.target)) menu.open = false;
    });
  });

  root.addEventListener("toggle", (event) => {
    const meeting = event.target.closest?.("details[data-meeting-id]");
    if (!meeting || event.target !== meeting) return;
    if (meeting.open) {
      root.querySelectorAll("details[data-meeting-id][open]").forEach((candidate) => {
        if (candidate !== meeting) candidate.open = false;
      });
      state.openMeetingId = meeting.dataset.meetingId;
    } else if (state.openMeetingId === meeting.dataset.meetingId) {
      state.openMeetingId = "";
    }
  }, true);

  root.addEventListener("touchstart", (event) => {
    if (speakingTips.handleTouchStart(event)) return;
    const swipe = event.target.closest("[data-goal-swipe], [data-topic-swipe]");
    if (!swipe) return;
    runtime.touchStart = { x: event.touches[0].clientX, swipe };
  }, { passive: true });

  root.addEventListener("touchend", (event) => {
    if (speakingTips.handleTouchEnd(event)) return;
    if (!runtime.touchStart) return;
    const delta = event.changedTouches[0].clientX - runtime.touchStart.x;
    if (delta < -48) runtime.touchStart.swipe.classList.add("revealed");
    if (delta > 48) runtime.touchStart.swipe.classList.remove("revealed");
    runtime.touchStart = null;
  }, { passive: true });
}

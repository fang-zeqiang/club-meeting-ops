import { createSpeakingTipCarousel } from "../../speaking-tips.js";
import { demoBookApiJson } from "../../book-demo-state.js";
import { createApiJson } from "../shared/api-client.js";

export const root = document.getElementById("app");
export const BOOK_DEMO_MODE = /^\/book\/demo\/?$/.test(window.location.pathname);
export const MEMBER_STORAGE_KEY = BOOK_DEMO_MODE ? "club-meeting-ops.demo-role-book.member" : "role-booking-member-id";
export const state = {
  loading: true,
  authenticated: false,
  members: [],
  memberId: localStorage.getItem(MEMBER_STORAGE_KEY) || "",
  dashboard: null,
  pathwaysCatalog: null,
  tab: "goals",
  filter: "all",
  openMeetingId: "",
  highlightAssignmentId: "",
  busy: false,
  error: "",
  toast: "",
  undoGoal: null,
  pending: null,
  topicsSheet: null,
};

// 跨模块共享的可变运行时句柄（原 book.js 顶层的三个 let 变量）
export const runtime = { toastTimer: undefined, touchStart: null, memberPickerAnimation: undefined };

export const speakingTips = createSpeakingTipCarousel(root);

export const apiJson = createApiJson({ demoHandler: BOOK_DEMO_MODE ? demoBookApiJson : null, fallbackMessage: "请求失败，请重试。 " });

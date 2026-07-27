import "./book.css";
import "./speaking-tip-card.css";
import { groupMeetingAssignments, matchesMemberSearch, memberSpeechDefaults } from "./book-helpers.js";
import { CLUB_PROFILE } from "./club-profile.js";
import { createSpeakingTipCarousel } from "./speaking-tips.js";

const root = document.getElementById("app");
const MEMBER_STORAGE_KEY = "role-booking-member-id";
const state = {
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
};

let toastTimer;
let touchStart = null;
let memberPickerAnimation;
const speakingTips = createSpeakingTipCarousel(root);

document.title = `Role Book · ${CLUB_PROFILE.clubName}`;
document.documentElement.lang = "zh-CN";
document.body.className = "book-page";

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function apiJson(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.message || "请求失败，请重试。 ");
    error.status = response.status;
    error.code = body.code;
    throw error;
  }
  return body;
}

function render() {
  speakingTips.stop();
  if (state.loading) {
    root.innerHTML = `<main class="book-auth-shell"><section class="book-auth-card book-loading-card"><div class="book-loading-mark">R</div><p class="book-kicker">Role Book</p><h1>正在同步</h1>${speakingTips.markup()}</section></main>`;
    speakingTips.start();
    return;
  }
  if (!state.authenticated) {
    root.innerHTML = renderPin();
    return;
  }
  if (!state.memberId || !state.dashboard) {
    root.innerHTML = renderMemberPicker();
    return;
  }
  root.innerHTML = renderWorkspace();
  queueMicrotask(() => {
    const meeting = document.querySelector(`[data-meeting-id="${CSS.escape(state.openMeetingId)}"]`);
    const target = state.highlightAssignmentId ? meeting?.querySelector(`[data-assignment-id="${CSS.escape(state.highlightAssignmentId)}"]`) : meeting;
    target?.scrollIntoView({ block: state.highlightAssignmentId ? "center" : "nearest" });
  });
}

function renderPin() {
  return `<main class="book-auth-shell">
    <section class="book-auth-card">
      <div class="book-brand-mark">R</div>
      <p class="book-kicker">${esc(CLUB_PROFILE.clubName)}</p>
      <h1>Role Book</h1>
      <p>查看目标，预约未来会议角色。</p>
      <form data-pin-form>
        <label>会员共用 PIN<input name="passcode" type="password" inputmode="numeric" autocomplete="current-password" required autofocus></label>
        ${state.error ? `<p class="book-form-error" role="alert">${esc(state.error)}</p>` : ""}
        <button class="book-button primary block" type="submit">进入</button>
      </form>
    </section>
  </main>`;
}

function renderMemberPicker() {
  const members = state.members.map((member) => `<button class="book-member-option" type="button" data-select-member="${esc(member.id)}" data-member-name="${esc(member.displayName.toLocaleLowerCase())}">
    <span>${esc(member.displayName)}</span><span aria-hidden="true">→</span>
  </button>`).join("");
  return `<main class="book-auth-shell member-picker-shell">
    <section class="book-auth-card member-picker">
      <div class="book-brand-mark">R</div>
      <p class="book-kicker">Role Book</p>
      <h1>选择你的姓名</h1>
      <label class="book-search"><span class="sr-only">搜索会员</span><input type="search" data-member-search placeholder="搜索会员"></label>
      <div class="book-member-list">${members || `<p class="book-empty">暂无可选会员。</p>`}</div>
      ${state.error ? `<p class="book-form-error" role="alert">${esc(state.error)}</p>` : ""}
      <button class="book-text-button" type="button" data-logout>退出 PIN 会话</button>
    </section>
  </main>`;
}

function renderWorkspace() {
  const member = state.dashboard.currentMember;
  return `<div class="book-shell">
    <header class="book-header">
      <div class="book-lockup"><span class="book-brand-mark small">R</span><span><strong>Role Book</strong><small>${esc(CLUB_PROFILE.clubName)}</small></span></div>
      <details class="book-member-menu">
        <summary><span><strong>${esc(member.displayName)}</strong><small>当前会员</small></span><span aria-hidden="true">⌄</span></summary>
        <div><button type="button" data-logout>退出</button></div>
      </details>
    </header>
    <main class="book-main">
      ${state.tab === "goals" ? renderGoals() : renderMeetings()}
    </main>
    <nav class="book-tabs" aria-label="一级导航">
      <button type="button" data-tab="goals" aria-current="${state.tab === "goals" ? "page" : "false"}"><span aria-hidden="true">◎</span>目标</button>
      <button type="button" data-tab="meetings" aria-current="${state.tab === "meetings" ? "page" : "false"}"><span aria-hidden="true">▦</span>会议</button>
    </nav>
    <div id="book-toast-region">${renderToast()}</div>
    <dialog class="book-sheet" id="book-sheet"><div id="book-sheet-content"></div></dialog>
  </div>`;
}

function renderGoals() {
  const goals = state.dashboard.goals;
  return `<section class="book-panel">
    <section class="book-section" aria-labelledby="my-goals-heading">
      <div class="book-section-head"><h1 id="my-goals-heading">我的目标</h1><button class="book-button primary compact" type="button" data-new-goal>＋ 新建</button></div>
      ${goals.length ? `<div class="book-goal-list">${goals.map(renderGoal).join("")}</div>` : `<div class="book-empty-state"><p>还没有目标。</p><div><button class="book-button primary" type="button" data-new-goal>创建第一个目标</button><button class="book-button" type="button" data-tab="meetings">看看会议空缺</button></div></div>`}
    </section>
    <section class="book-section" aria-labelledby="my-reservations-heading">
      <h1 id="my-reservations-heading">我的未来预约</h1>
      ${state.dashboard.reservations.length ? `<div class="book-reservations">${state.dashboard.reservations.map(renderReservation).join("")}</div>` : `<p class="book-empty">暂无未来预约。</p>`}
    </section>
    <section class="book-section" aria-labelledby="everyone-goals-heading">
      <h1 id="everyone-goals-heading">大家的目标</h1>
      <div class="book-everyone">${state.dashboard.everyoneGoals.filter((member) => member.id !== state.memberId).map(renderMemberGoals).join("") || `<p class="book-empty">暂无其他会员目标。</p>`}</div>
    </section>
  </section>`;
}

function renderGoal(goal, index) {
  const covered = Math.min(goal.targetCount, goal.completed + goal.booked);
  const segments = Array.from({ length: goal.targetCount }, (_, segment) => `<i class="${segment < goal.completed ? "done" : segment < covered ? "booked" : ""}"></i>`).join("");
  const status = goal.status === "completed" ? "已完成" : goal.status === "missed" ? "未完成" : goal.booked ? "已有预约" : "进行中";
  return `<div class="book-goal-swipe" data-goal-swipe>
    <button class="book-swipe-delete" type="button" data-delete-goal="${esc(goal.id)}">删除</button>
    <article class="book-goal-card ${index % 2 ? "coral" : ""}">
      <div class="book-goal-top"><div><h2>${esc(goal.role)}</h2><p>截止 ${esc(goal.dueDate)}</p></div><span class="book-status ${esc(goal.status)}">${esc(status)}</span></div>
      <div class="book-progress" aria-label="已完成 ${goal.completed} 次，已预约 ${goal.booked} 次，目标 ${goal.targetCount} 次">
        <strong>${goal.completed} 完成 · ${goal.booked} 预约 · ${goal.targetCount} 目标</strong>
        <div class="book-segments" style="--segments:${goal.targetCount}">${segments}</div>
      </div>
      <div class="book-goal-actions">
        <details class="book-more"><summary aria-label="目标操作">•••</summary><div><button type="button" data-edit-goal="${esc(goal.id)}">编辑</button><button class="danger" type="button" data-delete-goal="${esc(goal.id)}">删除</button></div></details>
        <button class="book-button compact" type="button" data-find-role="${esc(goal.role)}">找空缺 →</button>
      </div>
    </article>
  </div>`;
}

function renderReservation(item) {
  const date = dateParts(item.date);
  const sopUrl = state.dashboard.roleCatalog.find((role) => role.name === item.role)?.sopUrl;
  return `<div class="book-reservation">
    <button type="button" data-jump-meeting="${esc(item.meetingId)}" data-jump-assignment="${esc(item.assignmentId)}">
      <span class="book-date"><strong>${date.day}</strong><small>${date.month} · ${date.weekday}</small></span>
      <span><strong>${esc(item.role)}</strong><small>Meeting #${item.meetingNumber} · ${esc(item.theme || "主题待定")}</small></span>
      <span aria-hidden="true">↗</span>
    </button>
    ${sopUrl ? `<a href="${esc(sopUrl)}" target="_blank" rel="noopener noreferrer">查看角色 SOP ↗</a>` : ""}
  </div>`;
}

function renderMemberGoals(member) {
  const active = member.goals.filter((goal) => goal.status === "active");
  const history = member.goals.filter((goal) => goal.status !== "active");
  return `<details class="book-member-goals" ${member.id === state.memberId ? "open" : ""}>
    <summary><span><strong>${esc(member.displayName)}</strong><small>${active.length} 个进行中</small></span><span aria-hidden="true">⌄</span></summary>
    <div>
      ${active.map((goal) => `<p><span>${esc(goal.role)}</span><strong>${goal.completed + goal.booked} / ${goal.targetCount}</strong></p>`).join("") || `<p class="book-empty">暂无进行中目标。</p>`}
      ${history.length ? `<details class="book-goal-history"><summary>查看历史目标</summary>${history.map((goal) => `<p><span>${esc(goal.role)} · ${goal.status === "completed" ? "已完成" : "未完成"}</span><strong>${goal.completed} / ${goal.targetCount}</strong></p>`).join("")}</details>` : ""}
    </div>
  </details>`;
}

function renderMeetings() {
  const visible = filteredMeetings();
  const grouped = visible.reduce((result, meeting) => {
    const month = meeting.date.slice(0, 7);
    if (!result.has(month)) result.set(month, []);
    result.get(month).push(meeting);
    return result;
  }, new Map());
  const groups = [...grouped.entries()].map(([month, meetings]) => `<div class="book-month"><div class="book-month-head"><span>${monthLabel(month)} · ${meetings.length} 场</span></div>${meetings.map(renderMeeting).join("")}</div>`).join("");
  return `<section class="book-panel meetings">
    <section class="book-section">
      <div><h1>会议预约</h1></div>
      <div class="book-filters" aria-label="会议筛选">
        <button type="button" data-filter="all" aria-pressed="${state.filter === "all"}">全部</button>
        <button type="button" data-filter="goals" aria-pressed="${state.filter === "goals"}">匹配我的目标</button>
      </div>
      <div class="book-meeting-list">${groups || `<div class="book-empty-state"><p>未来会议暂无匹配空缺。</p><button class="book-button" type="button" data-filter="all">清除筛选</button></div>`}</div>
    </section>
  </section>`;
}

function filteredMeetings() {
  if (state.filter === "all") return state.dashboard.meetings;
  return state.dashboard.meetings.filter((meeting) => meeting.assignments.some((assignment) => {
    if (!assignment.bookable) return false;
    if (state.filter === "goals") return assignment.matchesGoal;
    return assignment.role === state.filter;
  }));
}

function renderMeeting(meeting) {
  const date = dateParts(meeting.date);
  const open = state.openMeetingId === meeting.id;
  const vacant = meeting.assignments.filter((assignment) => assignment.bookable).length;
  const mine = meeting.assignments.filter((assignment) => assignment.mine).map((assignment) => assignment.role);
  const roleGroups = groupMeetingAssignments(meeting.assignments, state.dashboard.roleCatalog);
  return `<details class="book-meeting" name="book-meetings" data-meeting-id="${esc(meeting.id)}" ${open ? "open" : ""}>
    <summary>
      <span class="book-date"><strong>${date.day}</strong><small>${date.month} · ${date.weekday}</small></span>
      <span class="book-meeting-copy"><strong>${esc(meeting.theme || "主题待定")}</strong><small>Meeting #${meeting.meetingNumber} · ${meeting.status} · ${meeting.status === "draft" ? `${vacant} 个空缺` : "只读"}${mine.length ? ` · 我的角色：${esc(mine.join(" / "))}` : ""}</small></span>
      <span class="book-status ${meeting.status === "final" ? "locked" : "available"}">${meeting.status === "final" ? "▣ 已锁定" : "可预约"}</span>
      <span class="book-chevron" aria-hidden="true">⌃</span>
    </summary>
    <div class="book-meeting-body">
      ${roleGroups.map((group) => renderRoleGroup(group.label, group.assignments, meeting)).join("")}
    </div>
  </details>`;
}

function renderRoleGroup(label, assignments, meeting) {
  if (!assignments.length) return "";
  return `<section class="book-role-group"><h2>${label}</h2>${assignments.map((assignment) => renderRole(assignment, meeting)).join("")}</section>`;
}

function renderRole(assignment, meeting) {
  const roleInfo = state.dashboard.roleCatalog.find((candidate) => candidate.name === assignment.role);
  const subtitle = assignment.mine && meeting.status === "draft"
    ? assignment.role === "Prepared Speaker" ? "可编辑演讲信息 · 转让 · 取消" : "可转让 · 取消"
    : assignment.memberName ? `已由 ${assignment.memberName} 预约` : assignment.speakerName ? `评估 ${assignment.speakerName}` : "";
  let action;
  if (assignment.bookable) action = `<button class="book-button ${assignment.matchesGoal ? "primary" : ""} compact" type="button" data-book-role="${esc(assignment.id)}" data-meeting="${esc(meeting.id)}">预约</button>`;
  else if (assignment.mine && meeting.status === "draft") action = `<button class="book-manage-button" type="button" data-own-role="${esc(assignment.id)}" data-meeting="${esc(meeting.id)}" aria-label="管理 ${esc(assignment.role)} 预约">管理预约 <span aria-hidden="true">→</span></button>`;
  else if (assignment.mine) action = `<span class="book-status mine">✓ 我的角色</span>`;
  else if (meeting.status === "final") action = `<span class="book-status locked">已锁定</span>`;
  else action = `<span class="book-status taken">已占</span>`;
  return `<div class="book-role-row ${state.openMeetingId === meeting.id && state.highlightAssignmentId === assignment.id ? "highlighted" : ""}" data-assignment-id="${esc(assignment.id)}">
    <div><strong>${esc(assignment.role)}${roleInfo?.advanced ? ` <span class="book-advanced">进阶</span>` : ""} <button class="book-info" type="button" data-role-info="${esc(assignment.role)}" aria-label="查看 ${esc(assignment.role)} 角色说明">ⓘ</button></strong>${subtitle ? `<small>${esc(subtitle)}</small>` : ""}</div>
    ${action}
  </div>`;
}

function dateParts(date) {
  const parsed = new Date(`${date}T12:00:00+08:00`);
  return {
    day: date.slice(8, 10),
    month: parsed.toLocaleDateString("en-US", { month: "short", timeZone: "Asia/Shanghai" }).toUpperCase(),
    weekday: parsed.toLocaleDateString("en-US", { weekday: "short", timeZone: "Asia/Shanghai" }).toUpperCase(),
  };
}

function monthLabel(value) {
  const [year, month] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).toUpperCase();
}

function renderToast() {
  if (!state.toast) return "";
  return `<div class="book-toast" role="status"><span>${esc(state.toast)}</span>${state.undoGoal ? `<button type="button" data-undo-goal>撤销</button>` : ""}</div>`;
}

function showToast(message, undoGoal = null) {
  clearTimeout(toastTimer);
  state.toast = message;
  state.undoGoal = undoGoal;
  const region = document.getElementById("book-toast-region");
  if (region) region.innerHTML = renderToast();
  toastTimer = setTimeout(() => {
    state.toast = "";
    state.undoGoal = null;
    const current = document.getElementById("book-toast-region");
    if (current) current.innerHTML = "";
  }, 5000);
}

function openSheet(title, copy, body) {
  const dialog = document.getElementById("book-sheet");
  document.getElementById("book-sheet-content").innerHTML = `<header><div><h2>${esc(title)}</h2>${copy ? `<p>${esc(copy)}</p>` : ""}</div><button type="button" data-close-sheet aria-label="关闭">×</button></header><div class="book-sheet-body">${body}</div>`;
  if (!dialog.open) dialog.showModal();
}

function closeSheet() {
  document.getElementById("book-sheet")?.close();
  state.pending = null;
}

function openGoalSheet(goal = null) {
  const options = state.dashboard.goalRoles.map((role) => `<option value="${esc(role)}" ${goal?.role === role ? "selected" : ""}>${esc(role)}</option>`).join("");
  openSheet(goal ? "编辑目标" : "新建目标", "", `<form class="book-form" data-goal-form>
    <input type="hidden" name="id" value="${esc(goal?.id || "")}">
    <label>角色<select name="role" required>${options}</select></label>
    <label>目标次数<input name="targetCount" type="number" min="1" max="20" value="${goal?.targetCount || 3}" required></label>
    <label>截止日期<input name="dueDate" type="date" value="${esc(goal?.dueDate || defaultDueDate())}" required></label>
    <div class="book-sheet-actions"><button class="book-button" type="button" data-close-sheet>取消</button><button class="book-button primary" type="submit">${goal ? "保存修改" : "创建目标"}</button></div>
  </form>`);
}

function defaultDueDate() {
  const date = new Date();
  date.setMonth(date.getMonth() + 3);
  return date.toISOString().slice(0, 10);
}

function meetingAndAssignment(meetingId, assignmentId) {
  const meeting = state.dashboard.meetings.find((candidate) => candidate.id === meetingId);
  return { meeting, assignment: meeting?.assignments.find((candidate) => candidate.id === assignmentId) };
}

function speechFields(details = {}) {
  const mode = ["pathways", "custom"].includes(details.pathwaysMode) ? details.pathwaysMode : "";
  const catalog = state.pathwaysCatalog;
  const options = (values, selected, placeholder) => `<option value="">${esc(placeholder)}</option>${values.map((value) => `<option value="${esc(value.value)}" ${value.value === selected ? "selected" : ""}>${esc(value.label)}</option>`).join("")}`;
  const pathProjects = catalog && details.pathwaysPath
    ? catalog.projects.filter((project) => [...project.requiredPaths, ...project.electivePaths].includes(details.pathwaysPath))
    : [];
  const levels = [...new Set(pathProjects.map((project) => project.level))].sort();
  const projects = pathProjects.filter((project) => project.level === details.pathwaysLevel);
  const project = projects.find((candidate) => candidate.projectId === details.pathwaysProjectId);
  const forms = catalog && project ? catalog.forms.filter((form) => form.projectId === project.projectId) : [];
  const form = forms.find((candidate) => candidate.formId === details.pathwaysFormId) || (forms.length === 1 ? forms[0] : null);
  const formField = forms.length === 1
    ? `<input type="hidden" name="pathwaysFormId" value="${esc(form.formId)}">`
    : `<label>Speech variant<select name="pathwaysFormId" data-speech-cascade required ${project ? "" : "disabled"}>${options(forms.map((value) => ({ value: value.formId, label: value.variant })), details.pathwaysFormId, "请选择 Speech variant")}</select></label>`;
  const legacy = details.pathwaysMode === "legacy"
    ? `<p class="book-warning">旧版演讲信息：${esc([details.legacyProject, details.pathwaysLevel, details.speechObjective].filter(Boolean).join(" · "))}。保存时请选择新版类型。</p>`
    : "";
  const fields = mode === "pathways"
    ? catalog
      ? `<div class="book-path-level"><label>Path<select name="pathwaysPath" data-speech-cascade required>${options(catalog.paths.map((value) => ({ value, label: value })), details.pathwaysPath, "请选择 Path")}</select></label>
        <label>Level<select name="pathwaysLevel" data-speech-cascade required ${details.pathwaysPath ? "" : "disabled"}>${options(levels.map((value) => ({ value, label: `Level ${value}` })), details.pathwaysLevel, "请选择 Level")}</select></label></div>
        <label>Project<select name="pathwaysProjectId" data-speech-cascade required ${details.pathwaysLevel ? "" : "disabled"}>${options(projects.map((value) => ({ value: value.projectId, label: value.name })), details.pathwaysProjectId, "请选择 Project")}</select></label>
        ${formField}
        <label>Official speech purpose<textarea rows="4" readonly>${esc(form?.speechPurpose || (forms.length > 1 ? "选择 Speech variant 后自动显示" : "选择 Project 后自动显示"))}</textarea></label>`
      : '<p class="book-warning">Learning catalog 暂不可用。可选 Custom 或 Decide later。</p>'
    : mode === "custom"
      ? `<label>Custom speech objective<textarea name="speechObjective" rows="4" maxlength="1000">${esc(details.speechObjective || "")}</textarea></label>`
      : "";
  return `<div data-speech-fields><label>Speech title（演讲标题）<input name="session" maxlength="200" value="${esc(details.session || "")}"></label>${legacy}<div class="book-speech-type"><span>Speech type</span><div class="book-speech-modes mode-${mode || "later"}" role="radiogroup" aria-label="Speech type">
    <label><input class="sr-only" type="radio" name="pathwaysMode" value="pathways" data-speech-cascade ${mode === "pathways" ? "checked" : ""}><span>Learning path</span></label>
    <label><input class="sr-only" type="radio" name="pathwaysMode" value="custom" data-speech-cascade ${mode === "custom" ? "checked" : ""}><span>Custom</span></label>
    <label><input class="sr-only" type="radio" name="pathwaysMode" value="" data-speech-cascade ${mode ? "" : "checked"}><span>Decide later</span></label>
  </div></div>${fields}</div>`;
}

function refreshSpeechFields(form) {
  const details = Object.fromEntries(new FormData(form));
  form.querySelector("[data-speech-fields]").outerHTML = speechFields(details);
}

function openBookingSheet(meeting, assignment) {
  state.pending = { meetingId: meeting.id, assignmentId: assignment.id };
  const hasOtherRole = meeting.assignments.some((candidate) => candidate.mine && candidate.id !== assignment.id);
  openSheet(`预约 ${assignment.role}`, `Meeting #${meeting.meetingNumber} · ${meeting.date} · ${meeting.theme || "主题待定"}`, `<form class="book-form" data-book-form>
    ${hasOtherRole ? `<p class="book-warning">你在本场已有其他角色。允许多角色，请确认时间充足。</p>` : ""}
    ${assignment.role === "Prepared Speaker" ? speechFields(memberSpeechDefaults({}, state.dashboard.currentMember, state.pathwaysCatalog)) : ""}
    <p>预约后立即写入 Agenda，无需官员审批。</p>
    <div class="book-sheet-actions"><button class="book-button" type="button" data-close-sheet>取消</button><button class="book-button primary" type="submit">确认预约</button></div>
  </form>`);
}

function openOwnRoleSheet(meeting, assignment) {
  state.pending = { meetingId: meeting.id, assignmentId: assignment.id };
  openSheet(assignment.role, `Meeting #${meeting.meetingNumber} · ${meeting.date}`, `<div class="book-action-stack">
    ${assignment.role === "Prepared Speaker" ? `<button class="book-button" type="button" data-edit-speech>编辑演讲信息</button>` : ""}
    <button class="book-button" type="button" data-transfer-role>转让</button>
    <button class="book-button danger" type="button" data-cancel-role>取消预约</button>
  </div>`);
}

function openTransferSheet() {
  const members = state.dashboard.members.filter((member) => member.id !== state.memberId);
  openSheet("转让角色", "选择已线下确认的接收人。", `<label class="book-search"><span class="sr-only">搜索会员</span><input type="search" data-transfer-search placeholder="搜索会员" autofocus></label>
    <div class="book-member-list transfer-list">${members.map((member) => `<button class="book-member-option" type="button" data-transfer-target="${esc(member.id)}" data-member-name="${esc(member.displayName.toLocaleLowerCase())}"><span>${esc(member.displayName)}</span><span aria-hidden="true">→</span></button>`).join("")}</div>`);
}

function openTransferConfirmation(memberId) {
  const member = state.dashboard.members.find((candidate) => candidate.id === memberId);
  state.pending.targetMemberId = memberId;
  const { meeting } = meetingAndAssignment(state.pending.meetingId, state.pending.assignmentId);
  const warning = meeting.assignments.some((assignment) => assignment.memberId === memberId);
  openSheet("确认转让", `接收人：${member.displayName}`, `${warning ? `<p class="book-warning">接收人在本场已有其他角色。允许多角色。</p>` : ""}<p>确认后立即写入 Agenda。</p><div class="book-sheet-actions"><button class="book-button" type="button" data-transfer-role>返回</button><button class="book-button primary" type="button" data-confirm-transfer>确认转让</button></div>`);
}

function openCancelConfirmation() {
  const pending = { ...state.pending };
  const { assignment } = meetingAndAssignment(pending.meetingId, pending.assignmentId);
  state.pending = pending;
  openSheet("取消预约", `角色：${assignment.role}`, `<p>取消后角色恢复为空缺。</p><div class="book-sheet-actions"><button class="book-button" type="button" data-close-sheet>保留预约</button><button class="book-button danger" type="button" data-confirm-cancel>确认取消</button></div>`);
}

function openSpeechSheet() {
  const pending = { ...state.pending };
  const { assignment } = meetingAndAssignment(pending.meetingId, pending.assignmentId);
  state.pending = pending;
  openSheet("编辑演讲信息", "", `<form class="book-form" data-speech-form>${speechFields(memberSpeechDefaults(assignment.speechDetails, state.dashboard.currentMember, state.pathwaysCatalog))}
    <div class="book-submit-dock"><div class="book-sync-stage" data-sync-stage></div>
      <div class="book-sheet-actions"><button class="book-button" type="button" data-close-sheet>取消</button><button class="book-button primary" type="submit">保存修改</button></div>
    </div>
  </form>`);
}

async function loadInitialData() {
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

async function loadDashboard(preserveScroll = true) {
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

function setSyncBusy(form, busy) {
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

async function runAction(action, body, successMessage, form = null) {
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
    if (["ROLE_TAKEN", "REVISION_CONFLICT"].includes(error.code)) await loadDashboard();
    showToast(saved ? "数据已同步，请刷新页面查看。" : error.message);
  } finally {
    setSyncBusy(form, false);
    state.busy = false;
    if (!inlineLoading) { state.loading = false; render(); }
  }
}

root.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
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
    await runAction("book", { ...state.pending, speechDetails: details }, "预约成功", form);
    return;
  }
  if (form.matches("[data-speech-form]")) {
    const speechDetails = Object.fromEntries(new FormData(form));
    await runAction("update-speech", { ...state.pending, speechDetails }, "演讲信息已更新", form);
  }
});

root.addEventListener("input", (event) => {
  if (!event.target.matches("[data-member-search], [data-transfer-search]")) return;
  const query = event.target.value.trim().toLocaleLowerCase();
  const container = event.target.closest("section, .book-sheet-body");
  const picker = event.target.closest(".member-picker");
  const previousHeight = picker?.getBoundingClientRect().height;
  memberPickerAnimation?.cancel();
  container?.querySelectorAll("[data-member-name]").forEach((button) => {
    button.hidden = !matchesMemberSearch(button.dataset.memberName, query);
  });
  if (!picker) return;
  picker.scrollTop = 0;
  const nextHeight = picker.getBoundingClientRect().height;
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches && Math.abs(previousHeight - nextHeight) > 1) {
    memberPickerAnimation = picker.animate([{ height: `${previousHeight}px` }, { height: `${nextHeight}px` }], {
      duration: 220,
      easing: "cubic-bezier(.22, 1, .36, 1)",
    });
  }
});

root.addEventListener("change", (event) => {
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
    state.memberId = button.dataset.selectMember;
    localStorage.setItem(MEMBER_STORAGE_KEY, state.memberId);
    state.loading = true;
    render();
    try { await loadDashboard(false); } catch (error) { state.error = error.message; state.memberId = ""; }
    finally { state.loading = false; render(); }
  } else if (button.matches("[data-logout]")) {
    state.loading = true;
    render();
    await apiJson("/api/session?view=book", { method: "DELETE", body: "{}" }).catch(() => {});
    localStorage.removeItem(MEMBER_STORAGE_KEY);
    Object.assign(state, { authenticated: false, memberId: "", dashboard: null, pathwaysCatalog: null, error: "", loading: false });
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
  } else if (button.matches("[data-book-role]")) {
    const { meeting, assignment } = meetingAndAssignment(button.dataset.meeting, button.dataset.bookRole);
    if (meeting && assignment) openBookingSheet(meeting, assignment);
  } else if (button.matches("[data-own-role]")) {
    const { meeting, assignment } = meetingAndAssignment(button.dataset.meeting, button.dataset.ownRole);
    if (meeting && assignment) openOwnRoleSheet(meeting, assignment);
  } else if (button.matches("[data-close-sheet]")) {
    closeSheet();
  } else if (button.matches("[data-cancel-role]")) {
    openCancelConfirmation();
  } else if (button.matches("[data-confirm-cancel]")) {
    await runAction("cancel", state.pending, "预约已取消");
  } else if (button.matches("[data-transfer-role]")) {
    openTransferSheet();
  } else if (button.matches("[data-transfer-target]")) {
    openTransferConfirmation(button.dataset.transferTarget);
  } else if (button.matches("[data-confirm-transfer]")) {
    await runAction("transfer", state.pending, "角色已转让");
  } else if (button.matches("[data-edit-speech]")) {
    openSpeechSheet();
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
  const swipe = event.target.closest("[data-goal-swipe]");
  if (!swipe) return;
  touchStart = { x: event.touches[0].clientX, swipe };
}, { passive: true });

root.addEventListener("touchend", (event) => {
  if (speakingTips.handleTouchEnd(event)) return;
  if (!touchStart) return;
  const delta = event.changedTouches[0].clientX - touchStart.x;
  if (delta < -48) touchStart.swipe.classList.add("revealed");
  if (delta > 48) touchStart.swipe.classList.remove("revealed");
  touchStart = null;
}, { passive: true });

async function initialize() {
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

render();
initialize();

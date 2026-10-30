import { CLUB_PROFILE } from "../../club-profile.js";
import { groupMeetingAssignments, presentationPreviewUrl } from "../../book-helpers.js";
import { renderThemeSwitcher } from "../../theme.js";
import { esc } from "../shared/html.js";
import { BOOK_DEMO_MODE, root, runtime, speakingTips, state } from "./state.js";

export function render() {
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
    <section class="book-auth-layout">
      <aside class="book-auth-intro">
        <a class="book-parent-link" href="/about">← Club Meeting Ops</a>
        <div class="book-brand-mark">R</div>
        <p class="book-kicker">${esc(CLUB_PROFILE.clubName)}</p>
        <h1>下一次上台，从这里开始。</h1>
        <p>查看个人目标、未来会议与空缺角色。预约结果直接进入同一份 Agenda。</p>
        <dl class="book-auth-points">
          <div><dt>目标</dt><dd>看清下一步练习</dd></div>
          <div><dt>会议</dt><dd>选择合适日期</dd></div>
          <div><dt>角色</dt><dd>完成一次预约</dd></div>
        </dl>
      </aside>
      <section class="book-auth-card book-pin-card">
        <p class="book-kicker">Member access</p>
        <h2>打开 Role Book</h2>
        <p>使用俱乐部会员共用 PIN。</p>
        <form data-pin-form>
          <label>会员共用 PIN<input name="passcode" type="password" inputmode="numeric" autocomplete="current-password" required autofocus></label>
          ${state.error ? `<p class="book-form-error" role="alert">${esc(state.error)}</p>` : ""}
          <button class="book-button primary block" type="submit">进入</button>
        </form>
        <div class="book-demo-entry">
          <span>Interactive demo</span>
          <strong>先用虚构数据体验 Role Book</strong>
          <p>无需 PIN。预约与目标只保存在当前浏览器。</p>
          <a class="book-button block" href="/book/demo">体验 Role Book Demo <span aria-hidden="true">→</span></a>
        </div>
      </section>
    </section>
  </main>`;
}

function renderMemberPicker() {
  const members = state.members.map((member) => `<button class="book-member-option" type="button" data-select-member="${esc(member.id)}" data-member-name="${esc(member.displayName.toLocaleLowerCase())}">
    <span>${esc(member.displayName)}</span><span aria-hidden="true">→</span>
  </button>`).join("");
  return `<main class="book-auth-shell member-picker-shell">
    <section class="book-auth-card member-picker">
      <a class="book-parent-link" href="/about">← Club Meeting Ops</a>
      <div class="book-brand-mark">R</div>
      <p class="book-kicker">${BOOK_DEMO_MODE ? "Role Book · Demo" : "Role Book"}</p>
      <h1>选择你的姓名</h1>
      ${BOOK_DEMO_MODE ? '<p class="book-demo-note">虚构演示会员 · 数据仅保存在此浏览器</p>' : ""}
      <label class="book-search"><span class="sr-only">搜索会员</span><input type="search" data-member-search placeholder="搜索会员"></label>
      <div class="book-member-list">${members || `<p class="book-empty">暂无可选会员。</p>`}</div>
      ${state.error ? `<p class="book-form-error" role="alert">${esc(state.error)}</p>` : ""}
      ${BOOK_DEMO_MODE ? '<button class="book-text-button" type="button" data-reset-demo>重置 Demo</button>' : '<button class="book-text-button" type="button" data-logout>退出 PIN 会话</button>'}
    </section>
  </main>`;
}

function renderWorkspace() {
  const member = state.dashboard.currentMember;
  return `<div class="book-shell">
    <header class="book-header">
      <div class="book-product-nav">
        <a class="book-parent-link" href="/about">← Club Meeting Ops</a>
        <div class="book-lockup"><span class="book-brand-mark small">R</span><span><strong>Role Book${BOOK_DEMO_MODE ? ' <i class="book-demo-badge">Demo</i>' : ""}</strong><small>${BOOK_DEMO_MODE ? "Riverside Speakers Club · fictional data" : esc(CLUB_PROFILE.clubName)}</small></span></div>
      </div>
      ${renderThemeSwitcher()}
      <details class="book-member-menu">
        <summary data-member-longpress title="长按可上下切换会员"><span><strong>${esc(member.displayName)}</strong><small>${BOOK_DEMO_MODE ? "演示会员" : "当前会员"}</small></span><span aria-hidden="true">⌄</span></summary>
        <div>${BOOK_DEMO_MODE ? '<button type="button" data-switch-demo-member>切换演示会员</button><button type="button" data-reset-demo>重置 Demo</button>' : '<button type="button" data-logout>退出</button>'}</div>
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
  const historyReservations = state.dashboard.historyReservations || [];
  return `<section class="book-panel">
    <section class="book-section" aria-labelledby="my-goals-heading">
      <div class="book-section-head"><h1 id="my-goals-heading">我的目标</h1><button class="book-button primary compact" type="button" data-new-goal>＋ 新建</button></div>
      ${goals.length ? `<div class="book-goal-list">${goals.map(renderGoal).join("")}</div>` : `<div class="book-empty-state"><p>还没有目标。</p><div><button class="book-button primary" type="button" data-new-goal>创建第一个目标</button><button class="book-button" type="button" data-tab="meetings">看看会议空缺</button></div></div>`}
    </section>
    <section class="book-section" aria-labelledby="my-reservations-heading">
      <h1 id="my-reservations-heading">我的未来预约</h1>
      ${state.dashboard.reservations.length ? `<div class="book-reservations">${state.dashboard.reservations.map(renderReservation).join("")}</div>` : `<p class="book-empty">暂无未来预约。</p>`}
    </section>
    <section class="book-section" aria-labelledby="reservation-history-heading">
      <h1 id="reservation-history-heading">历史预约</h1>
      ${historyReservations.length ? `<div class="book-reservations">${historyReservations.map(renderHistoricalReservation).join("")}</div>` : `<p class="book-empty">暂无历史预约</p>`}
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

function renderHistoricalReservation(item) {
  const date = dateParts(item.date);
  return `<article class="book-reservation book-reservation-history">
    <span class="book-date"><strong>${date.day}</strong><small>${date.month} · ${date.weekday}</small></span>
    <div class="book-reservation-copy">
      <strong>${esc(item.role)}</strong>
      <small>Meeting #${item.meetingNumber} · ${esc(item.theme || "主题待定")}</small>
      ${item.role === "Prepared Speaker" ? renderHistoricalSpeechDetails(item.speechDetails) : ""}
    </div>
  </article>`;
}

function renderHistoricalSpeechDetails(details = {}) {
  const project = state.pathwaysCatalog?.projects.find((candidate) => candidate.projectId === details.pathwaysProjectId);
  const projectName = project?.name || details.legacyProject || details.pathwaysProjectId || "";
  const pathway = [details.pathwaysPath, details.pathwaysLevel ? `Level ${details.pathwaysLevel}` : "", projectName].filter(Boolean).join(" · ");
  const rows = [
    details.session ? ["演讲", details.session] : null,
    pathway ? ["Pathways", pathway] : null,
    details.pathwaysMode === "custom" && details.speechObjective ? ["演讲目标", details.speechObjective] : null,
    details.pathwaysMode === "legacy" && details.speechObjective ? ["演讲目标", details.speechObjective] : null,
  ].filter(Boolean);
  return rows.length ? `<dl class="book-history-details">${rows.map(([label, value]) => `<div><dt>${label}</dt><dd>${esc(value)}</dd></div>`).join("")}</dl>` : "";
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
  const historyMeetings = state.dashboard.historyMeetings || [];
  const groups = renderMeetingGroups(visible);
  const historyGroups = renderMeetingGroups(historyMeetings, { historical: true });
  return `<section class="book-panel meetings">
    <section class="book-section" aria-labelledby="booking-meetings-heading">
      <div><h1 id="booking-meetings-heading">会议预约</h1></div>
      <div class="book-filters" aria-label="会议筛选">
        <button type="button" data-filter="all" aria-pressed="${state.filter === "all"}">全部</button>
        <button type="button" data-filter="goals" aria-pressed="${state.filter === "goals"}">匹配我的目标</button>
      </div>
      <div class="book-meeting-list">${groups || `<div class="book-empty-state"><p>未来会议暂无匹配空缺。</p><button class="book-button" type="button" data-filter="all">清除筛选</button></div>`}</div>
    </section>
    <section class="book-section" aria-labelledby="meeting-history-heading">
      <h1 id="meeting-history-heading">历史会议</h1>
      <div class="book-meeting-list">${historyGroups || `<p class="book-empty">暂无历史会议</p>`}</div>
    </section>
  </section>`;
}

function renderMeetingGroups(meetings, { historical = false } = {}) {
  const grouped = meetings.reduce((result, meeting) => {
    const month = meeting.date.slice(0, 7);
    if (!result.has(month)) result.set(month, []);
    result.get(month).push(meeting);
    return result;
  }, new Map());
  return [...grouped.entries()].map(([month, values]) => `<div class="book-month"><div class="book-month-head"><span>${monthLabel(month)} · ${values.length} 场</span></div>${values.map((meeting) => renderMeeting(meeting, { historical })).join("")}</div>`).join("");
}

export function filteredMeetings() {
  if (state.filter === "all") return state.dashboard.meetings;
  return state.dashboard.meetings.filter((meeting) => meeting.assignments.some((assignment) => {
    if (!assignment.bookable) return false;
    if (state.filter === "goals") return assignment.matchesGoal;
    return assignment.role === state.filter;
  }));
}

function renderMeeting(meeting, { historical = false } = {}) {
  const date = dateParts(meeting.date);
  const open = state.openMeetingId === meeting.id;
  const vacant = meeting.assignments.filter((assignment) => assignment.bookable).length;
  const mine = meeting.assignments.filter((assignment) => assignment.mine).map((assignment) => assignment.role);
  const sharingGuest = sharingGuestStatus(meeting.sharingGuest);
  const roleGroups = groupMeetingAssignments(meeting.assignments, state.dashboard.roleCatalog);
  const statusLabel = historical ? "历史" : meeting.status === "final" ? "▣ 已锁定" : "可预约";
  const summary = historical
    ? `Meeting #${meeting.meetingNumber} · ${meeting.status} · 历史记录${mine.length ? ` · 我的角色：${esc(mine.join(" / "))}` : ""}`
    : `Meeting #${meeting.meetingNumber} · ${meeting.status} · ${meeting.status === "draft" ? `${vacant} 个空缺` : "只读"}${mine.length ? ` · 我的角色：${esc(mine.join(" / "))}` : ""}`;
  return `<details class="book-meeting ${historical ? "history" : ""}" name="${historical ? "book-history-meetings" : "book-meetings"}" data-meeting-id="${esc(meeting.id)}" ${open ? "open" : ""}>
    <summary>
      <span class="book-date"><strong>${date.day}</strong><small>${date.month} · ${date.weekday}</small></span>
      <span class="book-meeting-copy"><strong>${esc(meeting.theme || "主题待定")}</strong><small>${summary}</small>${renderSharingGuestStatus(sharingGuest)}</span>
      <span class="book-status ${historical || meeting.status === "final" ? "locked" : "available"}">${statusLabel}</span>
      <span class="book-chevron" aria-hidden="true">⌃</span>
    </summary>
    <div class="book-meeting-body">
      ${roleGroups.map((group) => renderRoleGroup(group.label, group.assignments, meeting, { historical })).join("")}
    </div>
  </details>`;
}

function sharingGuestStatus(master) {
  if (!master) return { state: "none", label: "无分享嘉宾", memberName: "" };
  if (master.status === "confirmed") return { state: "confirmed", label: "已确认", memberName: master.memberName };
  return { state: "pending", label: "待确认", memberName: "" };
}

function renderSharingGuestStatus(status) {
  if (status.state === "none") return `<span class="book-sharing-status none">${status.label}</span>`;
  return `<span class="book-sharing-status ${status.state}"><span>分享嘉宾</span><strong>${status.label}</strong>${status.memberName ? `<small>${esc(status.memberName)}</small>` : ""}</span>`;
}

function renderRoleGroup(label, assignments, meeting, { historical = false } = {}) {
  if (!assignments.length) return "";
  return `<section class="book-role-group"><h2>${label}</h2>${assignments.map((assignment) => renderRole(assignment, meeting, { historical })).join("")}</section>`;
}

function renderRole(assignment, meeting, { historical = false } = {}) {
  const roleInfo = state.dashboard.roleCatalog.find((candidate) => candidate.name === assignment.role);
  const subtitle = assignment.guest
    ? `${assignment.memberName}`
    : assignment.mine && meeting.status === "draft" && !historical
    ? assignment.role === "Prepared Speaker" ? "可编辑演讲信息 · 维护链接 · 转让 · 取消" : assignment.role === "TTM" ? "可维护链接 · 转让 · 取消" : "可转让 · 取消"
    : assignment.memberName ? `已由 ${assignment.memberName} 预约` : assignment.speakerName ? `评估 ${assignment.speakerName}` : "";
  const historicalStatus = historical ? assignment.status === "vacant" ? "空缺" : "已预约" : "";
  let action;
  if (historical) action = `<span class="book-status taken">${historicalStatus}</span>`;
  else if (assignment.bookable) action = `<button class="book-button ${assignment.matchesGoal ? "primary" : ""} compact" type="button" data-book-role="${esc(assignment.id)}" data-meeting="${esc(meeting.id)}">预约</button>`;
  else if (assignment.manageable) action = `<button class="book-manage-button" type="button" data-own-role="${esc(assignment.id)}" data-meeting="${esc(meeting.id)}" aria-label="管理 ${esc(assignment.role)} 预约">管理预约 <span aria-hidden="true">→</span></button>`;
  else if (assignment.mine) action = `<span class="book-status mine">✓ 我的角色</span>`;
  else if (meeting.status === "final") action = `<span class="book-status locked">已锁定</span>`;
  else action = `<span class="book-status taken">已占</span>`;
  const topicsButton = !historical && assignment.mine && assignment.role === "TTM" && meeting.status === "draft"
    ? `<button class="book-manage-button" type="button" data-manage-topics="${esc(meeting.id)}" aria-label="管理 Table Topics 话题">管理话题 <span aria-hidden="true">→</span></button>`
    : "";
  const externalPresentationUrl = /^https?:\/\//.test(assignment.externalPresentationUrl || "") ? assignment.externalPresentationUrl : "";
  const speechPreviewLink = historical && externalPresentationUrl
    ? `<a class="book-manage-button" href="${esc(externalPresentationUrl)}" target="_blank" rel="noopener noreferrer">查看 Presentation ↗</a>`
    : !historical && assignment.mine && assignment.role === "Prepared Speaker"
    ? (() => {
        // 依赖 meeting.assignments 与分组后的 assignment 是同一对象引用；如果分组逻辑改成 map 出新对象，这里的 indexOf 会失效
        const order = meeting.assignments.filter((candidate) => candidate.role === "Prepared Speaker").indexOf(assignment) + 1;
        const href = presentationPreviewUrl(meeting.meetingNumber, "ps", order);
        return href ? `<a class="book-manage-button" href="${esc(href)}" target="_blank" rel="noopener">预览效果 <span aria-hidden="true">→</span></a>` : "";
      })()
    : "";
  return `<div class="book-role-row ${historical ? "history" : ""} ${assignment.guest ? "guest" : ""} ${state.openMeetingId === meeting.id && state.highlightAssignmentId === assignment.id ? "highlighted" : ""}" data-assignment-id="${esc(assignment.id)}">
    <div><strong>${esc(assignment.role)}${roleInfo?.advanced ? ` <span class="book-advanced">进阶</span>` : ""} <button class="book-info" type="button" data-role-info="${esc(assignment.role)}" aria-label="查看 ${esc(assignment.role)} 角色说明">ⓘ</button></strong>${subtitle ? `<small>${esc(subtitle)}${assignment.guest ? ` <span class="book-guest-pass">Guest</span>` : ""}</small>` : ""}${historical && assignment.role === "Prepared Speaker" ? renderHistoricalSpeechDetails(assignment.speechDetails) : ""}</div>
    <span class="book-role-actions">${action}${topicsButton}${speechPreviewLink}</span>
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

export function showToast(message, undoGoal = null) {
  clearTimeout(runtime.toastTimer);
  state.toast = message;
  state.undoGoal = undoGoal;
  const region = document.getElementById("book-toast-region");
  if (region) region.innerHTML = renderToast();
  runtime.toastTimer = setTimeout(() => {
    state.toast = "";
    state.undoGoal = null;
    const current = document.getElementById("book-toast-region");
    if (current) current.innerHTML = "";
  }, 5000);
}

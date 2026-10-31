import { matchesMemberSearch, memberSpeechDefaults, presentationPreviewUrl } from "../../book-helpers.js";
import { externalPresentationUrlError } from "../../external-presentation-url.js";
import { esc } from "../shared/html.js";
import { apiJson, state } from "./state.js";
import { showToast } from "./render.js";

export function openSheet(title, copy, body) {
  const dialog = document.getElementById("book-sheet");
  document.getElementById("book-sheet-content").innerHTML = `<header><div><h2>${esc(title)}</h2>${copy ? `<p>${esc(copy)}</p>` : ""}</div><button type="button" data-close-sheet aria-label="关闭">×</button></header><div class="book-sheet-body">${body}</div>`;
  if (!dialog.open) dialog.showModal();
}

export function closeSheet() {
  document.getElementById("book-sheet")?.close();
  state.pending = null;
}

export function openGoalSheet(goal = null) {
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

export function meetingAndAssignment(meetingId, assignmentId) {
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
      : '<p class="book-warning">Pathways Catalog 暂不可用。可选 Custom 或 Decide later。</p>'
    : mode === "custom"
      ? `<label>Custom speech objective<textarea name="speechObjective" rows="4" maxlength="1000">${esc(details.speechObjective || "")}</textarea></label>`
      : "";
  return `<div data-speech-fields><label>Speech title（演讲标题）<input name="session" maxlength="200" value="${esc(details.session || "")}"></label>${legacy}<div class="book-speech-type"><span>Speech type</span><div class="book-speech-modes mode-${mode || "later"}" role="radiogroup" aria-label="Speech type">
    <label><input class="sr-only" type="radio" name="pathwaysMode" value="pathways" data-speech-cascade ${mode === "pathways" ? "checked" : ""}><span>Pathways</span></label>
    <label><input class="sr-only" type="radio" name="pathwaysMode" value="custom" data-speech-cascade ${mode === "custom" ? "checked" : ""}><span>Custom</span></label>
    <label><input class="sr-only" type="radio" name="pathwaysMode" value="" data-speech-cascade ${mode ? "" : "checked"}><span>Decide later</span></label>
  </div></div>${fields}</div>`;
}

export function refreshSpeechFields(form) {
  const details = Object.fromEntries(new FormData(form));
  form.querySelector("[data-speech-fields]").outerHTML = speechFields(details);
}

function canManagePresentationUrl(role) {
  return role === "Prepared Speaker" || role === "TTM";
}

function presentationUrlField(value = "") {
  return `<div class="book-presentation-url-field">
    <label>External Presentation URL<input name="externalPresentationUrl" type="url" data-external-presentation-url maxlength="2048" placeholder="https://… or http://…" value="${esc(value)}" aria-describedby="book-presentation-url-help book-presentation-url-error"></label>
    <p id="book-presentation-url-help">推荐使用腾讯文档，并始终设置为“互联网任何人可查看”。公开链接可持续更新，上台前的最后修改也会直接呈现在 Presentation 中。</p>
    <p class="book-form-error" id="book-presentation-url-error" role="alert" hidden></p>
  </div>`;
}

export function validatePresentationUrlInput(input, report = false) {
  const error = externalPresentationUrlError(input.value);
  const message = error ? "请只填写一个公开 HTTP 或 HTTPS 链接；不能包含空格、中文说明、账号密码或多个链接。" : "";
  input.setCustomValidity(message);
  input.setAttribute("aria-invalid", String(Boolean(message)));
  const errorNode = input.closest(".book-presentation-url-field")?.querySelector(".book-form-error");
  if (errorNode) {
    errorNode.hidden = !message;
    errorNode.textContent = message;
  }
  if (message && report) input.reportValidity();
  return !message;
}

export function openSelfBookingSheet(meeting, assignment) {
  state.pending = { meetingId: meeting.id, assignmentId: assignment.id };
  const hasOtherRole = meeting.assignments.some((candidate) => candidate.mine && candidate.id !== assignment.id);
  openSheet(`预约 ${assignment.role}`, `Meeting #${meeting.meetingNumber} · ${meeting.date} · ${meeting.theme || "主题待定"}`, `<form class="book-form" data-book-form>
    ${hasOtherRole ? `<p class="book-warning">你在本场已有其他角色。允许多角色，请确认时间充足。</p>` : ""}
    ${assignment.role === "Prepared Speaker" ? speechFields(memberSpeechDefaults({}, state.dashboard.currentMember, state.pathwaysCatalog)) : ""}
    ${canManagePresentationUrl(assignment.role) ? presentationUrlField() : ""}
    <p>预约后立即写入 Agenda，无需官员审批。</p>
    <div class="book-sheet-actions"><button class="book-button" type="button" data-close-sheet>取消</button><button class="book-button primary" type="submit">确认预约</button></div>
  </form>`);
}

export function openBookingSheet(meeting, assignment) {
  state.pending = { meetingId: meeting.id, assignmentId: assignment.id };
  if (!assignment.guestBookable) {
    openSelfBookingSheet(meeting, assignment);
    return;
  }
  openSheet(`预约 ${assignment.role}`, `Meeting #${meeting.meetingNumber} · ${meeting.date} · ${meeting.theme || "主题待定"}`, `<div class="book-booking-choice">
    <button type="button" data-book-self><span class="book-choice-icon">我</span><span><strong>预约给自己</strong><small>计入你的未来预约与角色目标</small></span><span aria-hidden="true">→</span></button>
    <button class="guest" type="button" data-book-guest><span class="book-choice-icon">G</span><span><strong>帮 Guest 预约</strong><small>搜索已有 Guest，或创建新 Guest</small></span><span aria-hidden="true">→</span></button>
  </div>`);
}

export function guestSearchResults(query) {
  const currentGuestId = state.pending?.guestMode === "transfer"
    ? meetingAndAssignment(state.pending.meetingId, state.pending.assignmentId).assignment?.memberId
    : "";
  const guests = state.dashboard.guests.filter((guest) => guest.id !== currentGuestId && matchesMemberSearch(guest.displayName, query));
  return guests.map((guest) => `<button class="book-member-option" type="button" data-guest-target="${esc(guest.id)}">
    <span><strong>${esc(guest.displayName)}</strong><small>现有 Guest · 可直接使用</small></span><span aria-hidden="true">→</span>
  </button>`).join("");
}

export function openGuestSearchSheet({ transfer = false } = {}) {
  state.pending.guestMode = transfer ? "transfer" : "book";
  const { meeting, assignment } = meetingAndAssignment(state.pending.meetingId, state.pending.assignmentId);
  const members = transfer ? state.dashboard.members : [];
  openSheet(transfer ? "选择接收人" : "选择 Guest", `${assignment.role} · Meeting #${meeting.meetingNumber} · ${meeting.date}`, `<label class="book-search"><span>${transfer ? "搜索 Member 或 Guest" : "搜索 Guest"}</span><input type="search" data-guest-search placeholder="输入姓名、头衔或俱乐部" autofocus></label>
    ${transfer ? `<p class="book-picker-label">MEMBERS</p><div class="book-member-list">${members.map((member) => `<button class="book-member-option" type="button" data-transfer-target="${esc(member.id)}" data-member-name="${esc(member.displayName.toLocaleLowerCase())}"><span><strong>${esc(member.displayName)}</strong><small>会员</small></span><span aria-hidden="true">→</span></button>`).join("")}</div><p class="book-picker-label">GUESTS</p>` : ""}
    <div class="book-member-list" data-guest-results>${guestSearchResults("") || `<p class="book-empty">暂无 active Guest。</p>`}</div>
    <button class="book-new-guest" type="button" data-new-booking-guest disabled>＋ 输入完整 Guest 姓名后创建</button>`);
}

function meetingRolesForMember(meeting, memberId, excludingId) {
  return meeting.assignments.filter((assignment) => assignment.id !== excludingId && assignment.memberId === memberId).map((assignment) => assignment.role);
}

function guestTicket(name, existing = false) {
  return `<div class="book-guest-ticket"><div><strong>${esc(name)}</strong><small>${existing ? "现有 Guest" : "新 Guest"}<br>不计入任何会员目标</small></div><span>GUEST<br>PASS</span></div>`;
}

export function openGuestConfirmation({ targetGuest = null, inspection = null } = {}) {
  const pending = { ...state.pending };
  const { meeting, assignment } = meetingAndAssignment(pending.meetingId, pending.assignmentId);
  const guest = targetGuest || inspection?.exactGuest;
  const displayName = guest?.displayName || inspection?.displayName || "";
  state.pending = {
    ...pending,
    targetGuestId: guest?.id || "",
    newGuestName: guest ? "" : displayName,
  };
  const otherRoles = guest ? meetingRolesForMember(meeting, guest.id, assignment.id) : [];
  const warnings = [
    ...(!guest ? inspection?.warnings || [] : []),
    ...(otherRoles.length ? [`该 Guest 本场已有角色：${otherRoles.join(" / ")}。允许多角色，请确认时间充足。`] : []),
  ];
  const candidates = !guest && inspection?.candidates?.length ? `<div class="book-duplicate-list"><strong>可能是已有人员</strong>${inspection.candidates.map((candidate) => `<button class="book-member-option" type="button" ${candidate.guest ? `data-guest-target="${esc(candidate.id)}"` : "disabled"}><span><strong>${esc(candidate.displayName)}</strong><small>${candidate.guest ? "使用现有 Guest" : "正式会员，请勿创建同名 Guest"}</small></span><span aria-hidden="true">${candidate.guest ? "→" : "!"}</span></button>`).join("")}<p>若不是同一人，可继续创建当前 Guest。</p></div>` : "";
  const url = assignment.role === "TTM" && pending.guestMode !== "transfer" ? presentationUrlField() : "";
  openSheet(pending.guestMode === "transfer" ? "确认 Guest 转让" : "确认 Guest 预约", pending.guestMode === "transfer" ? "确认后立即更新 Agenda" : "确认一次，预约立即写入 Agenda", `<form class="book-form" data-guest-booking-form>
    ${guestTicket(displayName, Boolean(guest))}
    ${candidates}
    ${warnings.length ? `<div class="book-guest-warnings">${warnings.map((warning) => `<p>• ${esc(warning)}</p>`).join("")}</div>` : ""}
    <div class="book-guest-summary"><p><span>会议</span><strong>#${meeting.meetingNumber} · ${meeting.date}</strong></p><p><span>角色</span><strong>${esc(assignment.role)}</strong></p><p><span>${pending.guestMode === "transfer" ? "转让给" : "预约给"}</span><strong>${esc(displayName)}</strong></p></div>
    ${url}
    ${!guest && inspection?.candidates?.length ? `<label class="book-consent"><input type="checkbox" name="duplicateConfirmed" required><span>我确认这不是同一人，继续创建新的 Guest。</span></label>` : ""}
    ${!guest && inspection?.warnings?.length ? `<label class="book-consent"><input type="checkbox" name="warningsConfirmed" required><span>我已核对以上 Guest 姓名信息。</span></label>` : ""}
    <label class="book-consent"><input type="checkbox" name="confirmed" required><span>${pending.guestMode === "transfer" ? "我已在线下与接收人确认。" : "我已获得 Guest 同意，并会线下转达预约结果。"}</span></label>
    <div class="book-sheet-actions"><button class="book-button" type="button" data-book-guest>返回</button><button class="book-button coral" type="submit">${pending.guestMode === "transfer" ? "确认转让" : "确认并预约"}</button></div>
  </form>`);
}

export async function inspectGuestName(displayName) {
  if (state.busy) return;
  state.busy = true;
  try {
    const { inspection } = await apiJson("/api/meetings?view=book&action=inspect-guest", {
      method: "POST",
      body: JSON.stringify({ memberId: state.memberId, displayName }),
    });
    openGuestConfirmation({ inspection });
  } catch (error) {
    showToast(error.message);
  } finally {
    state.busy = false;
  }
}

export function openOwnRoleSheet(meeting, assignment) {
  state.pending = { meetingId: meeting.id, assignmentId: assignment.id };
  openSheet(assignment.role, `Meeting #${meeting.meetingNumber} · ${meeting.date}`, `${assignment.guest ? `${guestTicket(assignment.memberName, true)}<p class="book-guest-manage-note">任一 Book 会员可协助管理。转让前，请先在线下与接收人确认。</p>` : ""}<div class="book-action-stack">
    ${assignment.role === "Prepared Speaker" ? `<button class="book-button" type="button" data-edit-speech>编辑演讲信息</button>` : ""}
    ${canManagePresentationUrl(assignment.role) ? `<button class="book-button" type="button" data-edit-presentation-url>维护 Presentation 链接</button>` : ""}
    <button class="book-button" type="button" ${assignment.guest ? "data-transfer-guest-role" : "data-transfer-role"}>转让</button>
    <button class="book-button danger" type="button" data-cancel-role>取消预约</button>
  </div>`);
}

export function openTransferSheet() {
  const members = state.dashboard.members.filter((member) => member.id !== state.memberId);
  openSheet("转让角色", "选择已线下确认的接收人。", `<label class="book-search"><span class="sr-only">搜索会员</span><input type="search" data-transfer-search placeholder="搜索会员" autofocus></label>
    <div class="book-member-list transfer-list">${members.map((member) => `<button class="book-member-option" type="button" data-transfer-target="${esc(member.id)}" data-member-name="${esc(member.displayName.toLocaleLowerCase())}"><span>${esc(member.displayName)}</span><span aria-hidden="true">→</span></button>`).join("")}</div>`);
}

export function openTransferConfirmation(memberId) {
  const member = state.dashboard.members.find((candidate) => candidate.id === memberId);
  state.pending.targetMemberId = memberId;
  const { meeting } = meetingAndAssignment(state.pending.meetingId, state.pending.assignmentId);
  const warning = meeting.assignments.some((assignment) => assignment.memberId === memberId);
  openSheet("确认转让", `接收人：${member.displayName}`, `<form class="book-form" data-transfer-form>${warning ? `<p class="book-warning">接收人在本场已有其他角色。允许多角色。</p>` : ""}<p>确认后立即写入 Agenda。</p><label class="book-consent"><input type="checkbox" name="confirmed" required><span>我已在线下与接收人确认。</span></label><div class="book-sheet-actions"><button class="book-button" type="button" data-transfer-role>返回</button><button class="book-button primary" type="submit">确认转让</button></div></form>`);
}

export function openCancelConfirmation() {
  const pending = { ...state.pending };
  const { assignment } = meetingAndAssignment(pending.meetingId, pending.assignmentId);
  state.pending = pending;
  openSheet("取消预约", `角色：${assignment.role}`, `<p>取消后角色恢复为空缺。</p><div class="book-sheet-actions"><button class="book-button" type="button" data-close-sheet>保留预约</button><button class="book-button danger" type="button" data-confirm-cancel>确认取消</button></div>`);
}

export function openSpeechSheet() {
  const pending = { ...state.pending };
  const { assignment } = meetingAndAssignment(pending.meetingId, pending.assignmentId);
  state.pending = pending;
  openSheet("编辑演讲信息", "", `<form class="book-form" data-speech-form>${speechFields(memberSpeechDefaults(assignment.speechDetails, state.dashboard.currentMember, state.pathwaysCatalog))}
    <div class="book-submit-dock"><div class="book-sync-stage" data-sync-stage></div>
      <div class="book-sheet-actions"><button class="book-button" type="button" data-close-sheet>取消</button><button class="book-button primary" type="submit">保存修改</button></div>
    </div>
  </form>`);
}

export function openPresentationUrlSheet() {
  const pending = { ...state.pending };
  const { assignment } = meetingAndAssignment(pending.meetingId, pending.assignmentId);
  state.pending = pending;
  openSheet("维护 Presentation 链接", assignment.role, `<form class="book-form" data-presentation-url-form>${presentationUrlField(assignment.externalPresentationUrl)}
    <div class="book-submit-dock"><div class="book-sync-stage" data-sync-stage></div>
      <div class="book-sheet-actions"><button class="book-button" type="button" data-close-sheet>取消</button><button class="book-button primary" type="submit">保存链接</button></div>
    </div>
  </form>`);
}

function previewLink(meeting) {
  const href = presentationPreviewUrl(meeting?.meetingNumber, "tabletopics");
  if (!href) return "";
  return `<a class="book-topic-preview" href="${esc(href)}" target="_blank" rel="noopener">预览 Presentation 效果 →</a>`;
}

function renderTopicsSheetBody(meeting) {
  const sheet = state.topicsSheet;
  const rows = sheet.topics.length
    ? `<div class="book-topic-list-head"><p class="book-topic-list-hint">左滑话题可删除</p>${previewLink(meeting)}</div><ul class="book-topic-list">${sheet.topics.map((topic) => `<li class="book-topic-swipe" data-topic-swipe><button class="book-swipe-delete" type="button" data-delete-topic="${esc(topic.key)}" aria-label="删除话题：${esc(topic.topicText)}">删除</button><div class="book-topic-row"><span>${esc(topic.topicText)}</span></div></li>`).join("")}</ul>`
    : sheet.busy ? `<p class="book-topic-empty" role="status">正在加载…</p>` : `<p class="book-topic-empty">还没有话题，添加第一条吧。</p>`;
  const success = sheet.added ? `<p class="book-topic-success" role="status">已录入 ${sheet.added} 条话题</p>` : "";
  return `${success}${rows}<form class="book-form" data-topic-form>
    <label><span>新话题</span><textarea name="topicText" rows="4" placeholder="输入即兴话题，一行一条可批量录入" required></textarea></label>
    <p class="book-topic-hint">每行一条，一次最多 50 条；空行会被忽略</p>
    ${sheet.error ? `<p class="book-warning" role="alert">${esc(sheet.error)}</p>` : ""}
    <div class="book-submit-dock"><div class="book-sync-stage" data-sync-stage></div>
      <div class="book-sheet-actions"><button class="book-button" type="button" data-close-sheet>关闭</button><button class="book-button primary" type="submit">添加话题</button></div>
    </div>
  </form>`;
}

export function refreshTopicsSheet() {
  const meeting = state.dashboard.meetings.find((candidate) => candidate.id === state.topicsSheet.meetingId);
  openSheet("管理 Table Topics 话题", meeting ? `Meeting #${meeting.meetingNumber} · ${meeting.date}` : "", renderTopicsSheetBody(meeting));
}

export async function openTopicsSheet(meetingId) {
  state.topicsSheet = { meetingId, topics: [], busy: true, error: "", added: 0 };
  refreshTopicsSheet();
  try {
    const { topics } = await apiJson(`/api/meetings?view=book&action=table-topics&meetingId=${encodeURIComponent(meetingId)}&memberId=${encodeURIComponent(state.memberId)}`);
    state.topicsSheet = { meetingId, topics, busy: false, error: "", added: 0 };
  } catch (error) {
    state.topicsSheet = { meetingId, topics: [], busy: false, error: error.message, added: 0 };
  }
  refreshTopicsSheet();
}

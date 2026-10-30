import { invitationDraft } from "../../role-recommendations.js";
import { esc } from "../shared/html.js";
import { apiJson } from "./api.js";
import { syncLinkedAgendaItem } from "./derivations.js";
import { flushSave, notify, render, renderOverlayRegion } from "./render-engine.js";
import { markDirty, state } from "./state.js";

export function selectedRecommendationRole() {
  const roles = state.roleRecommendations.data?.roles || [];
  return roles.find((role) => role.assignmentId === state.roleRecommendations.selectedAssignmentId) || roles[0] || null;
}

function outreachStatusLabel(status) {
  return ({ suggested: "待联系", copied: "已复制", contacted: "已联系", accepted: "已接受", declined: "已拒绝", no_response: "无回复", booked: "已排期", closed: "已关闭", cancelled: "已取消" })[status] || "待联系";
}

function recommendationCandidateMarkup(candidate, role) {
  const status = candidate.outreachStatus || "suggested";
  const primaryLabel = status === "suggested" ? "复制邀请" : outreachStatusLabel(status);
  const disabled = !state.roleRecommendations.data.outreachWritable || ["declined", "booked", "closed", "cancelled"].includes(status);
  const preferred = candidate.preferredAssignmentId && candidate.preferredAssignmentId !== role.assignmentId
    ? `<small>优先推荐为 ${esc(state.roleRecommendations.data.roles.find((item) => item.assignmentId === candidate.preferredAssignmentId)?.role || "其他角色")}</small>`
    : "";
  return `<article class="recommendation-candidate">
    <header><span class="recommendation-avatar" aria-hidden="true">${esc([...candidate.displayName][0] || "会")}</span><div><h3 class="${candidate.isGuest ? "guest-name" : ""}">${candidate.isGuest ? '<span class="recommendation-guest-tag">Guest</span>' : ""}<span>${esc(candidate.displayName)}</span></h3><small>${esc(candidate.details.relatedExperience)} · ${esc(candidate.details.workload)}</small>${preferred}</div><span class="recommendation-tag ${candidate.label === "成长人选" ? "growth" : candidate.label === "备选人选" ? "backup" : ""}">${esc(candidate.label)}</span></header>
    <div class="recommendation-reasons">${candidate.reasons.map((reason) => `<span>${esc(reason)}</span>`).join("")}</div>
    ${candidate.risk ? `<p class="recommendation-risk">${esc(candidate.risk)}</p>` : ""}
    <footer><button class="button text" type="button" data-open-recommendation-details="${esc(candidate.memberId)}" data-assignment-id="${esc(role.assignmentId)}">查看完整依据</button><div><button class="button danger-text" type="button" data-dismiss-recommendation="${esc(candidate.memberId)}" data-assignment-id="${esc(role.assignmentId)}" ${status !== "suggested" ? "disabled" : ""}>不考虑</button><button class="button primary" type="button" data-open-outreach="${esc(candidate.memberId)}" data-assignment-id="${esc(role.assignmentId)}" ${disabled ? "disabled" : ""}>${esc(primaryLabel)}</button></div></footer>
  </article>`;
}

function renderRecommendationEmpty(role) {
  return `<section class="recommendation-empty"><h3>${role.blockedReason || "暂无合格候选"}</h3><p>系统不会自动放宽硬性过滤，也不会让 DeepSeek 补充被排除会员。</p><div><button class="button" data-open-excluded>看已排除</button><button class="button" data-open-current-members>看本期已有</button><button class="button" data-open-full-member-picker>全部会员</button><button class="button" data-open-signup-generation>生成接龙</button></div></section>`;
}

export function renderRoleRecommendations() {
  const recommendations = state.roleRecommendations;
  const data = recommendations.data;
  if (recommendations.loading && !data) return `<main class="recommendation-page"><section class="recommendation-state" role="status"><h1>正在读取候选</h1><p>同步 Agenda、会员、角色规则与沟通状态。</p></section></main>`;
  if (recommendations.error && !data) return `<main class="recommendation-page"><section class="recommendation-state error"><h1>候选暂不可用</h1><p>${esc(recommendations.error)}</p><button class="button primary" data-refresh-recommendations>重试</button></section></main>`;
  if (!data?.available) return `<main class="recommendation-page"><section class="recommendation-state"><h1>当前会议不提供推荐</h1><p>${esc(data?.reason || "请打开未来可编辑的普通会议。")}</p></section></main>`;
  const role = selectedRecommendationRole();
  const candidates = recommendations.showAll ? role?.candidates || [] : role?.topCandidates || [];
  return `<main class="recommendation-page">
    <header class="recommendation-page-head"><div><h1>为本期空缺联系合适候选人</h1><p>推荐的是可联系候选人。对方接受后，才会进入正式 Agenda 分配。</p></div>${recommendations.loading ? '<span role="status">刷新中</span>' : ''}</header>
    <section class="recommendation-summary"><div class="main"><div><strong>${data.summary.vacancies} 个空缺，建议联系 ${data.summary.suggestedContacts} 人</strong><small>建议联系人数已去重，同一期只对每人发起一次邀请</small></div><button class="button" data-start-recommendations>从第一个空缺开始</button></div><div><strong>${data.summary.waiting || 0}</strong><small>待联系</small></div><div><strong>${data.summary.contacted || 0}</strong><small>已联系</small></div><div><strong>${data.summary.accepted || 0}</strong><small>已接受</small></div></section>
    ${!data.developmentDataAvailable ? '<p class="recommendation-degraded" role="status">成长资料暂不可用。当前只按历史经历与近期负担推荐。</p>' : ""}
    ${!data.outreachWritable ? '<p class="recommendation-degraded error" role="status">沟通状态暂不可用。候选仅供查看，复制和状态更新已暂停。</p>' : ""}
    <section class="recommendation-workspace">
      <aside class="recommendation-role-rail"><h2>空缺队列</h2><nav>${data.roles.map((item) => `<button type="button" class="${item.assignmentId === role?.assignmentId ? "active" : ""}" data-select-recommendation-role="${esc(item.assignmentId)}"><span><strong>${esc(item.role)}</strong><small>${esc(item.blockedReason || `${item.allCandidateCount} 位合格候选`)}</small></span><b>${item.blockedReason ? "待定" : item.topCandidates.length}</b></button>`).join("")}</nav><p>硬性过滤已生效：本期有任务、已拒绝、排期排除与不满足特殊资格者不进入候选。</p></aside>
      <section class="recommendation-panel">
        <header><div><h2>${esc(role?.role || "空缺")} 候选</h2><p>${role?.blockedReason ? esc(role.blockedReason) : "顺序基于明确意愿、成长路线、近期负担与相关经历。"}</p></div><div><button class="button" data-toggle-all-recommendations>${recommendations.showAll ? "显示前 3 位" : `全部合格候选人 (${role?.allCandidateCount || 0})`}</button><button class="button text" data-refresh-recommendations>刷新</button></div></header>
        ${candidates.length ? `<div class="recommendation-candidates">${candidates.map((candidate) => recommendationCandidateMarkup(candidate, role)).join("")}</div>` : renderRecommendationEmpty(role || {})}
        <details class="recommendation-excluded" ${recommendations.exclusion?.openList ? "open" : ""}><summary>已排除 ${data.exclusions.length + (data.dismissed?.length || 0)} 人 · 查看原因与恢复</summary><div>${[...data.exclusions.map((item) => ({ ...item, kind: "exclusion" })), ...(data.dismissed || []).map((item) => ({ ...item, kind: "dismissed" }))].map((item) => `<article><div><strong>${esc(item.displayName)}</strong><small>${esc(item.reason || "当前空缺不考虑")} · ${esc(item.scope || item.role || "当前角色")}</small></div><button class="button text" data-restore-${item.kind}="${esc(item.id || item.memberId)}" ${item.kind === "dismissed" ? `data-assignment-id="${esc(item.assignmentId)}"` : ""}>恢复</button></article>`).join("") || "<p>当前没有排除记录。</p>"}</div></details>
        <details class="recommendation-current" ${recommendations.currentMembersOpen ? "open" : ""}><summary>本期已有角色 ${data.currentAssignments?.length || 0} 项</summary><div>${(data.currentAssignments || []).map((item) => `<article><strong>${esc(item.role)}</strong><span>${esc(item.displayName || "未命名会员")}</span></article>`).join("") || "<p>当前还没有确认角色。</p>"}</div></details>
        <details class="recommendation-method"><summary>推荐口径：已归档角色为确认经历；已过期 Final 仅作参考；Pathways 超过 90 天不参与排序。</summary><p>是否做过读取全部有效历史；重复与轮换只看最近 12 场普通会议。问卷意愿与成长计划不是会员承诺。目标会议前后 30 天的确认任务只降低排序。</p></details>
      </section>
    </section>
  </main>`;
}

export function renderOutreachPrompt() {
  const drawer = state.roleRecommendations.drawer;
  if (!drawer) return "";
  const role = state.roleRecommendations.data?.roles.find((item) => item.assignmentId === drawer.assignmentId);
  const candidate = role?.candidates.find((item) => item.memberId === drawer.memberId) || role?.topCandidates.find((item) => item.memberId === drawer.memberId);
  if (!role || !candidate) return "";
  const status = drawer.status || candidate.outreachStatus || "suggested";
  const canReply = ["copied", "contacted", "no_response"].includes(status);
  const primary = status === "suggested" ? "复制邀请" : status === "copied" ? "标记已联系" : status === "accepted" ? "填入 Agenda" : "";
  return `<div class="modal-backdrop outreach-backdrop"><aside class="outreach-drawer" role="dialog" aria-modal="true" aria-labelledby="outreach-title">
    <header><div><h2 id="outreach-title">邀请${esc(candidate.displayName)}担任${esc(role.role)}</h2><p>#${esc(state.meeting.meetingNumber)} · ${esc(state.meeting.date)} ${esc(state.meeting.startTime)} · ${esc(role.role)}</p></div><button class="icon-button" data-close-outreach aria-label="关闭邀请">×</button></header>
    <nav aria-label="沟通状态"><span class="${status === "suggested" ? "active" : "done"}">准备文案</span><span class="${status === "copied" ? "active" : ["contacted", "accepted", "declined", "no_response", "booked"].includes(status) ? "done" : ""}">已复制</span><span class="${status === "contacted" ? "active" : ["accepted", "declined", "no_response", "booked"].includes(status) ? "done" : ""}">已联系</span><span class="${["accepted", "declined", "no_response", "booked"].includes(status) ? "active" : ""}">已回复</span></nav>
    <section class="outreach-body">
      <p class="outreach-status ${status === "accepted" || status === "booked" ? "success" : ""}">${esc(drawer.error || (status === "suggested" ? "系统只生成草稿，不会自动发送。复制成功后才会记录为已复制。" : status === "copied" ? "文案已复制。确认人工发送后，再标记为已联系。" : status === "contacted" ? "已记录为已联系。收到对方回复后，请手动选择结果。" : status === "accepted" ? "对方已明确接受。请确认角色仍为空缺，再填入 Agenda。" : `当前状态：${outreachStatusLabel(status)}`))}</p>
      ${role.role === "Photographer" ? '<div class="photographer-preflight" role="note"><strong>发送前确认</strong><span>愿意拍照 · 可使用手机或相机 · 已知并接受照片使用方式</span></div>' : ""}
      <div class="outreach-segment"><button class="${drawer.language === "zh-CN" ? "active" : ""}" data-outreach-language="zh-CN">中文</button><button class="${drawer.language === "en" ? "active" : ""}" data-outreach-language="en">English</button></div>
      <label class="outreach-field"><span>邀请文案</span><textarea data-outreach-draft>${esc(drawer.draft)}</textarea></label>
      <p class="outreach-privacy">DeepSeek 只润色不含姓名的当前安全草稿，不参与选人。不会发送问卷、CSP、姓名或联系方式。</p>
      <details class="outreach-evidence"><summary>查看完整依据</summary><dl><div><dt>为什么推荐</dt><dd>${candidate.reasons.map(esc).join("；")}</dd></div><div><dt>相关经历</dt><dd>${esc(candidate.details.relatedExperience)}</dd></div><div><dt>近期负担</dt><dd>${esc(candidate.details.workload)}</dd></div><div><dt>需要支持</dt><dd>${esc(candidate.details.support)}</dd></div></dl><button class="button" data-open-exclusion="${esc(candidate.memberId)}">排除范围与历史记录</button></details>
      ${canReply ? `<div class="outreach-responses"><button class="button success" data-outreach-status="accepted">已接受</button><button class="button" data-outreach-status="declined">已拒绝</button><button class="button" data-outreach-status="no_response">无回复</button></div>` : ""}
    </section>
    <footer><div><select data-outreach-tone aria-label="润色语气"><option ${drawer.tone === "自然" ? "selected" : ""}>自然</option><option ${drawer.tone === "更简短" ? "selected" : ""}>更简短</option><option ${drawer.tone === "更鼓励" ? "selected" : ""}>更鼓励</option></select><button class="button text" data-polish-outreach ${drawer.busy ? "disabled" : ""}>${drawer.busy === "polish" ? "润色中" : "DeepSeek 润色"}</button></div><div>${status !== "suggested" ? '<button class="button" data-copy-outreach-again>再次复制</button>' : ""}${primary ? `<button class="button primary" data-outreach-primary ${drawer.busy ? "disabled" : ""}>${drawer.busy ? "处理中" : primary}</button>` : ""}</div></footer>
  </aside></div>`;
}

export function renderRecommendationExclusionPrompt() {
  const prompt = state.roleRecommendations.exclusion;
  if (!prompt || prompt.openList) return "";
  const futureMeetings = state.meetings.filter((meeting) => ["draft", "final"].includes(meeting.status) && meeting.date >= state.meeting.date);
  return `<div class="modal-backdrop"><form class="modal-card recommendation-exclusion-modal" data-recommendation-exclusion-form><header><div><span class="eyebrow">Recommendation exclusion</span><h2>设置排期排除</h2></div><button class="icon-button" type="button" data-close-exclusion aria-label="关闭">×</button></header><p>只影响系统推荐，不改变会员身份、Role Book 或人工 Agenda 选择。</p>
    <label class="field"><span>范围</span><select name="scope" data-exclusion-scope><option value="meeting">仅当前会议</option><option value="selected_meetings">选择若干会议</option><option value="standing">长期排除，手动恢复</option></select></label>
    <fieldset data-exclusion-meetings hidden><legend>会议</legend>${futureMeetings.map((meeting) => `<label><input type="checkbox" name="meetingIds" value="${esc(meeting.id)}" ${meeting.id === state.meeting.id ? "checked" : ""}>#${esc(meeting.meetingNumber)} · ${esc(meeting.date)}</label>`).join("")}</fieldset>
    <label class="field"><span>原因</span><select name="reason"><option>确定无法参加</option><option>暂不邀约</option><option>已离职但仍是会员</option><option>其他</option></select></label>
    <label class="field"><span>备注（仅排期管理员可见）</span><textarea name="note" maxlength="500"></textarea></label>
    ${prompt.error ? `<p class="inline-error">${esc(prompt.error)}</p>` : ""}<footer class="modal-actions"><button class="button" type="button" data-close-exclusion>取消</button><button class="button primary" type="submit" ${prompt.busy ? "disabled" : ""}>${prompt.busy ? "保存中" : "保存排除"}</button></footer>
  </form></div>`;
}

export async function loadRoleRecommendations({ quiet = false } = {}) {
  if (state.previewMode || !state.meeting?.id) return;
  const recommendationState = state.roleRecommendations;
  recommendationState.loading = true;
  recommendationState.error = "";
  if (!quiet || state.activeView === "recommendations") render();
  try {
    const body = await apiJson(`/api/meetings/${encodeURIComponent(state.meeting.id)}?action=recommendations`);
    recommendationState.data = body.recommendations;
    const ids = new Set(body.recommendations.roles?.map((role) => role.assignmentId) || []);
    if (!ids.has(recommendationState.selectedAssignmentId)) recommendationState.selectedAssignmentId = body.recommendations.roles?.[0]?.assignmentId || "";
    recommendationState.error = "";
  } catch (error) {
    recommendationState.error = error.message;
  } finally {
    recommendationState.loading = false;
    if (state.activeView === "advisor" || state.activeView === "recommendations" || !quiet) render();
  }
}

export async function openRoleRecommendations(assignmentId = "") {
  state.memberPicker = null;
  state.activeView = "recommendations";
  state.roleRecommendations.showAll = false;
  if (assignmentId) state.roleRecommendations.selectedAssignmentId = assignmentId;
  render();
  await loadRoleRecommendations();
}

function recommendationCandidate(assignmentId, memberId) {
  const role = state.roleRecommendations.data?.roles.find((item) => item.assignmentId === assignmentId);
  const candidate = role?.candidates.find((item) => item.memberId === memberId) || role?.topCandidates.find((item) => item.memberId === memberId);
  return { role, candidate };
}

function openOutreach(assignmentId, memberId, { details = false } = {}) {
  const { role, candidate } = recommendationCandidate(assignmentId, memberId);
  if (!role || !candidate) return;
  const language = "zh-CN";
  state.roleRecommendations.drawer = {
    assignmentId,
    memberId,
    language,
    tone: "自然",
    status: candidate.outreachStatus || "suggested",
    draft: invitationDraft({ language, meeting: state.meeting, role: role.role, candidate, speakerName: role.speakerName, growthSkills: role.growthSkills }),
    busy: "",
    error: "",
    details,
  };
  renderOverlayRegion();
  if (details) document.querySelector(".outreach-evidence")?.setAttribute("open", "");
}

async function postRecommendationAction(action, body) {
  return apiJson(`/api/meetings/${encodeURIComponent(state.meeting.id)}?action=${action}`, { method: "POST", body: JSON.stringify(body) });
}

async function saveOutreachStatus(status) {
  const drawer = state.roleRecommendations.drawer;
  if (!drawer) return;
  const { candidate } = recommendationCandidate(drawer.assignmentId, drawer.memberId);
  drawer.busy = status;
  drawer.error = "";
  renderOverlayRegion();
  try {
    await postRecommendationAction("role-outreach", {
      assignmentId: drawer.assignmentId,
      memberId: drawer.memberId,
      status,
      safeReasonSnapshot: { reasons: candidate.reasons, risk: candidate.risk },
    });
    drawer.status = status;
    await loadRoleRecommendations({ quiet: true });
    notify(status === "copied" ? "已复制，等待你确认发送" : `已更新为${outreachStatusLabel(status)}`);
  } catch (error) {
    drawer.error = error.message;
  } finally {
    drawer.busy = "";
    renderOverlayRegion();
  }
}

async function copyOutreach({ again = false } = {}) {
  const drawer = state.roleRecommendations.drawer;
  if (!drawer) return;
  try {
    await navigator.clipboard.writeText(drawer.draft);
  } catch {
    drawer.error = "复制失败，未记录沟通状态。";
    return renderOverlayRegion();
  }
  if (again) return notify("邀请文案已再次复制，原状态保持不变");
  await saveOutreachStatus("copied");
}

async function polishOutreach() {
  const drawer = state.roleRecommendations.drawer;
  const { candidate } = recommendationCandidate(drawer?.assignmentId, drawer?.memberId);
  if (!drawer || !candidate) return;
  drawer.busy = "polish";
  drawer.error = "";
  renderOverlayRegion();
  const placeholder = "{{NAME}}";
  const safeDraft = drawer.draft.replaceAll(candidate.displayName, placeholder);
  try {
    const result = await postRecommendationAction("polish-outreach", { draft: safeDraft, tone: drawer.tone, memberName: candidate.displayName });
    drawer.draft = result.draft.replaceAll(placeholder, candidate.displayName);
  } catch (error) {
    drawer.error = error.message;
  } finally {
    drawer.busy = "";
    renderOverlayRegion();
  }
}

function assignRecommendationToMeeting(assignmentId, candidate) {
  if (assignmentId === "meeting:manager") {
    state.meeting.meetingManagerMemberId = candidate.memberId;
    state.meeting.meetingManager = candidate.displayName;
    return true;
  }
  if (assignmentId === "meeting:photographer") {
    state.meeting.photographerMemberId = candidate.memberId;
    state.meeting.photographer = candidate.displayName;
    return true;
  }
  const items = state.meeting.blocks.flatMap((block) => block.items || []);
  const targets = assignmentId.startsWith("role:")
    ? items.filter((item) => item.roleAssignmentId === assignmentId.slice(5))
    : items.filter((item) => item.id === assignmentId.slice(5));
  if (!targets.length) return false;
  targets.forEach((item) => {
    item.memberId = candidate.memberId;
    item.member = candidate.displayName;
    item.status = "confirmed";
    syncLinkedAgendaItem(item, "member");
  });
  return true;
}

async function bookAcceptedRecommendation() {
  const drawer = state.roleRecommendations.drawer;
  const { candidate } = recommendationCandidate(drawer?.assignmentId, drawer?.memberId);
  if (!drawer || !candidate || drawer.status !== "accepted") return;
  if (!assignRecommendationToMeeting(drawer.assignmentId, candidate)) {
    drawer.error = "角色空缺已变化，请刷新候选后重试。";
    return renderOverlayRegion();
  }
  drawer.busy = "booked";
  markDirty();
  await flushSave();
  if (state.saveStatus !== "saved") {
    drawer.busy = "";
    drawer.error = state.saveStatus === "conflict" ? "Agenda 已被其他人更新。沟通状态仍保留为已接受，请解决冲突后重试。" : state.saveError || "Agenda 保存失败，沟通状态未改变。";
    return renderOverlayRegion();
  }
  try {
    await postRecommendationAction("role-outreach", { assignmentId: drawer.assignmentId, memberId: drawer.memberId, status: "booked" });
    drawer.status = "booked";
    notify("已填入 Agenda，沟通记录进入已排期");
    await loadRoleRecommendations({ quiet: true });
  } catch (error) {
    drawer.error = error.message;
  } finally {
    drawer.busy = "";
    renderOverlayRegion();
  }
}

export function memberPickerTargetForAssignment(assignmentId) {
  if (assignmentId === "meeting:manager") return { kind: "meeting", key: "meetingManager" };
  if (assignmentId === "meeting:photographer") return { kind: "meeting", key: "photographer" };
  const id = assignmentId.startsWith("item:") ? assignmentId.slice(5) : "";
  if (id) return { kind: "item", itemId: id, key: "member" };
  const roleId = assignmentId.startsWith("role:") ? assignmentId.slice(5) : "";
  const item = state.meeting.blocks.flatMap((block) => block.items || []).find((candidate) => candidate.roleAssignmentId === roleId);
  return item ? { kind: "item", itemId: item.id, key: "member" } : null;
}

async function dismissRecommendation(assignmentId, memberId) {
  await postRecommendationAction("role-outreach", { assignmentId, memberId, status: "dismissed", safeReasonSnapshot: {} });
  await loadRoleRecommendations();
  notify("已从当前空缺隐藏，可在已排除区域恢复");
}

async function restoreDismissedRecommendation(assignmentId, memberId) {
  await postRecommendationAction("role-outreach", { assignmentId, memberId, restoreDismissed: true });
  await loadRoleRecommendations();
}

async function restoreExclusion(exclusionId) {
  await postRecommendationAction("recommendation-exclusion", { restoreExclusionId: exclusionId });
  await loadRoleRecommendations();
}

export async function handleChange(input, event) {
  if (input.matches("[data-outreach-draft]")) {
    if (state.roleRecommendations.drawer) state.roleRecommendations.drawer.draft = input.value;
  } else if (input.matches("[data-outreach-tone]")) {
    if (state.roleRecommendations.drawer) state.roleRecommendations.drawer.tone = input.value;
  } else if (input.matches("[data-exclusion-scope]")) {
    const meetings = input.closest("form")?.querySelector("[data-exclusion-meetings]");
    if (meetings) meetings.hidden = input.value !== "selected_meetings";
  } else {
    return false;
  }
  return true;
}

export async function handleClick(button, event) {
  if (button.matches("[data-refresh-recommendations]")) {
    await loadRoleRecommendations();
  } else if (button.matches("[data-select-recommendation-role]")) {
    state.roleRecommendations.selectedAssignmentId = button.dataset.selectRecommendationRole;
    state.roleRecommendations.showAll = false;
    render();
  } else if (button.matches("[data-start-recommendations]")) {
    state.roleRecommendations.selectedAssignmentId = state.roleRecommendations.data?.roles?.[0]?.assignmentId || "";
    state.roleRecommendations.showAll = false;
    render();
    document.querySelector(".recommendation-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
  } else if (button.matches("[data-toggle-all-recommendations]")) {
    state.roleRecommendations.showAll = !state.roleRecommendations.showAll;
    render();
  } else if (button.matches("[data-open-outreach]")) {
    openOutreach(button.dataset.assignmentId, button.dataset.openOutreach);
  } else if (button.matches("[data-open-recommendation-details]")) {
    openOutreach(button.dataset.assignmentId, button.dataset.openRecommendationDetails, { details: true });
  } else if (button.matches("[data-close-outreach]")) {
    state.roleRecommendations.drawer = null;
    renderOverlayRegion();
  } else if (button.matches("[data-outreach-language]")) {
    const drawer = state.roleRecommendations.drawer;
    const { role, candidate } = recommendationCandidate(drawer?.assignmentId, drawer?.memberId);
    if (drawer && role && candidate) {
      drawer.language = button.dataset.outreachLanguage;
      drawer.draft = invitationDraft({ language: drawer.language, meeting: state.meeting, role: role.role, candidate, speakerName: role.speakerName, growthSkills: role.growthSkills });
      renderOverlayRegion();
    }
  } else if (button.matches("[data-outreach-status]")) {
    await saveOutreachStatus(button.dataset.outreachStatus);
  } else if (button.matches("[data-outreach-primary]")) {
    const status = state.roleRecommendations.drawer?.status;
    if (status === "suggested") await copyOutreach();
    else if (status === "copied") await saveOutreachStatus("contacted");
    else if (status === "accepted") await bookAcceptedRecommendation();
  } else if (button.matches("[data-copy-outreach-again]")) {
    await copyOutreach({ again: true });
  } else if (button.matches("[data-polish-outreach]")) {
    await polishOutreach();
  } else if (button.matches("[data-dismiss-recommendation]")) {
    try {
      await dismissRecommendation(button.dataset.assignmentId, button.dataset.dismissRecommendation);
    } catch (error) {
      notify(error.message);
    }
  } else if (button.matches("[data-restore-dismissed]")) {
    await restoreDismissedRecommendation(button.dataset.assignmentId, button.dataset.restoreDismissed).catch((error) => notify(error.message));
  } else if (button.matches("[data-restore-exclusion]")) {
    await restoreExclusion(button.dataset.restoreExclusion).catch((error) => notify(error.message));
  } else if (button.matches("[data-open-exclusion]")) {
    state.roleRecommendations.exclusion = { memberId: button.dataset.openExclusion, busy: false, error: "" };
    renderOverlayRegion();
  } else if (button.matches("[data-close-exclusion]")) {
    state.roleRecommendations.exclusion = null;
    renderOverlayRegion();
  } else if (button.matches("[data-open-excluded]")) {
    state.roleRecommendations.exclusion = { openList: true };
    render();
    document.querySelector(".recommendation-excluded")?.scrollIntoView({ behavior: "smooth", block: "center" });
  } else if (button.matches("[data-open-current-members]")) {
    state.roleRecommendations.currentMembersOpen = true;
    render();
    document.querySelector(".recommendation-current")?.scrollIntoView({ behavior: "smooth", block: "center" });
  } else if (button.matches("[data-open-picker-recommendations]")) {
    state.memberPicker = null;
    await openRoleRecommendations(button.dataset.openPickerRecommendations);
  } else {
    return false;
  }
  return true;
}

export async function handleSubmit(form, event) {
  if (form.matches("[data-recommendation-exclusion-form]")) {
    event.preventDefault();
    const prompt = state.roleRecommendations.exclusion;
    if (!prompt?.memberId) return true;
    const data = new FormData(form);
    prompt.busy = true;
    prompt.error = "";
    renderOverlayRegion();
    try {
      await postRecommendationAction("recommendation-exclusion", {
        memberId: prompt.memberId,
        scope: data.get("scope"),
        meetingIds: data.getAll("meetingIds"),
        reason: data.get("reason"),
        note: data.get("note"),
      });
      state.roleRecommendations.drawer = null;
      state.roleRecommendations.exclusion = null;
      await loadRoleRecommendations();
      notify("排期排除已保存");
    } catch (error) {
      prompt.busy = false;
      prompt.error = error.message;
      renderOverlayRegion();
    }
  } else {
    return false;
  }
  return true;
}

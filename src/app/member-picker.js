import { groupMemberOptions, guestDisplayNameLooksStandard, matchesMemberSearch } from "../../book-helpers.js";
import { roleIdentity } from "../../role-awards.js";
import { esc } from "../shared/html.js";
import { apiJson } from "./api.js";
import { allAgendaItems, applyOfficerAssignments, autofillAgendaOfficer, officerAssignmentsFromMembers, setSignupMember, signupChangeById, syncLinkedAgendaItem, useGuestForSignup } from "./derivations.js";
import { elementForFocusKey, notify, refreshDerivedRegions, refreshStructure, render, renderBlockEditorRegion, renderOfficerRegion, renderOverlayRegion, speakingTips, withUiContinuity } from "./render-engine.js";
import { markDirty, runtime, state, uid } from "./state.js";

export function renderGuestPrompt() {
  if (!state.guestPrompt) return "";
  if (state.guestPrompt.busy) return `<div class="modal-backdrop"><section class="modal-card sync-modal" role="dialog" aria-modal="true" aria-labelledby="guest-sync-title" aria-busy="true">
    <span class="eyebrow">Guest directory</span><h2 id="guest-sync-title">Creating guest…</h2><p>Please wait while Agenda syncs the latest members from Feishu.</p><div class="sync-progress"><span aria-hidden="true"></span>Syncing members</div>${speakingTips.markup({ delayed: true })}
  </section></div>`;
  const signupGuest = state.guestPrompt.kind === "signup";
  return `<div class="modal-backdrop"><section class="modal-card">
    <span class="eyebrow">Guest placeholder</span>
    <h2>Add a guest</h2>
    <p>${signupGuest ? "Create this guest, then return to the import review." : "Create a guest option for this agenda assignment."}</p>
    <form data-guest-form>
      <label class="field"><span>Guest name</span><input name="displayName" autocomplete="off" minlength="2" maxlength="80" required autofocus value="${esc(state.guestPrompt.defaultName || "")}" /></label>
      <div class="guest-name-guide"><strong>Use a clear directory format</strong><span>Regular guest: <code>Amy, Guest</code></span><span>Club member: <code>Amy, PM3@AF TMC</code></span></div>
      ${state.guestPrompt.formatWarning ? '<p class="form-warning" role="alert">Name format looks unusual. Edit it or choose Add anyway.</p>' : ""}
      ${state.guestPrompt.error ? `<p class="form-error" role="alert">${esc(state.guestPrompt.error)}</p>` : ""}
      <div class="modal-actions">
        <button class="button" type="button" data-cancel-guest>Cancel</button>
        <button class="button primary" type="submit">${state.guestPrompt.formatWarning ? "Add anyway" : state.guestPrompt.error ? "Retry" : "Add guest"}</button>
      </div>
    </form>
  </section></div>`;
}

export function renderRolePrompt() {
  if (!state.rolePrompt) return "";
  if (state.rolePrompt.busy) return `<div class="modal-backdrop"><section class="modal-card sync-modal" role="dialog" aria-modal="true" aria-labelledby="role-sync-title" aria-busy="true">
    <span class="eyebrow">RoleCatalog</span><h2 id="role-sync-title">Syncing role…</h2><p>Adding ${esc(state.rolePrompt.name)} to the shared role catalog.</p><div class="sync-progress"><span aria-hidden="true"></span>Syncing with Base</div>${speakingTips.markup({ delayed: true })}
  </section></div>`;
  return `<div class="modal-backdrop"><section class="modal-card" role="dialog" aria-modal="true" aria-labelledby="role-create-title">
    <span class="eyebrow">RoleCatalog</span><h2 id="role-create-title">Add a shared role</h2><p>This role becomes available in every Agenda. Book visibility stays off.</p>
    <form data-role-form><label class="field"><span>Role name</span><input name="name" autocomplete="off" maxlength="80" required autofocus value="${esc(state.rolePrompt.name)}"></label>
      ${state.rolePrompt.error ? `<p class="form-error" role="alert">${esc(state.rolePrompt.error)}</p>` : ""}
      <div class="modal-actions"><button class="button" type="button" data-cancel-role>Cancel</button><button class="button primary" type="submit">Add role</button></div>
    </form>
  </section></div>`;
}

export function renderMemberPickerPrompt() {
  const picker = state.memberPicker;
  if (!picker) return "";
  const groups = groupMemberOptions(state.members);
  const selectedMember = state.members.find((member) => member.id === picker.selectedId);
  const currentIsHistorical = picker.target.kind !== "signup" && picker.selectedLabel && !selectedMember;
  const signupChange = picker.target.kind === "signup" ? signupChangeById(picker.target.changeId) : null;
  const suggestions = new Map((signupChange?.options || []).map((option) => [option.id, option.source]));
  const row = (member, group) => {
    const suggestion = suggestions.get(member.id);
    const note = suggestion === "ai_suggestion" ? "AI suggestion" : suggestion === "ambiguous" ? "Same name" : "";
    const hidden = !matchesMemberSearch(member.displayName, picker.query);
    return `<button class="member-picker-option" type="button" data-pick-member="${esc(member.id)}" data-member-name="${esc(member.displayName)}" data-member-group="${group}" ${hidden ? "hidden" : ""}><span><strong>${esc(member.displayName)}</strong>${group === "guests" ? '<small class="member-picker-guest-tag">Guest</small>' : note ? `<small>${esc(note)}</small>` : ""}</span>${member.id === picker.selectedId ? '<i aria-label="Selected">✓</i>' : ""}</button>`;
  };
  const group = (key, label, members) => {
    const count = members.filter((member) => matchesMemberSearch(member.displayName, picker.query)).length;
    return `<section class="member-picker-group" data-member-picker-group="${key}" ${count ? "" : "hidden"}><h3>${label} · <span data-member-group-count="${key}">${count}</span></h3><div>${members.map((member) => row(member, key)).join("")}</div></section>`;
  };
  const query = picker.query.trim();
  const matchCount = [...groups.members, ...groups.guests].filter((member) => matchesMemberSearch(member.displayName, picker.query)).length;
  const recommendationRole = state.roleRecommendations.data?.roles.find((role) => role.assignmentId === assignmentIdForMemberPickerTarget(picker.target));
  return `<div class="modal-backdrop member-picker-backdrop"><section class="member-picker-modal" role="dialog" aria-modal="true" aria-labelledby="member-picker-title">
    <header><div><span class="eyebrow">Member directory</span><h2 id="member-picker-title">${esc(picker.label)}</h2></div><button class="icon-button" type="button" data-close-member-picker aria-label="Close member picker">×</button></header>
    <label class="member-picker-search"><span class="sr-only">Search members and guests</span><input type="search" data-member-picker-search autocomplete="off" placeholder="Search name, level, or club" value="${esc(picker.query)}" autofocus></label>
    ${picker.refreshing ? '<p class="member-picker-refresh" role="status">Syncing latest members…</p>' : picker.error ? `<p class="member-picker-refresh is-error" role="status">${esc(picker.error)}</p>` : ""}
    <div class="member-picker-results">
      ${currentIsHistorical ? `<section class="member-picker-current"><h3>Current assignment</h3><button type="button" data-keep-current-member><span><strong>${esc(picker.selectedLabel)}</strong><small>Inactive · historical</small></span><i aria-label="Selected">✓</i></button></section>` : ""}
      ${group("members", "Members", groups.members)}
      ${group("guests", "Guests", groups.guests)}
      <p class="member-picker-empty" data-member-picker-empty ${matchCount ? "hidden" : ""}>No matching member or guest.</p>
    </div>
    <footer>
      ${recommendationRole ? `<button type="button" data-open-picker-recommendations="${esc(recommendationRole.assignmentId)}">查看 ${esc(recommendationRole.role)} 推荐</button>` : ""}
      ${picker.allowEmpty ? '<button type="button" data-clear-member>None / Unassigned</button>' : ""}
      ${picker.allowGuest ? `<button class="member-picker-add" type="button" data-add-picker-guest>＋ <span>${query ? `Add “${esc(query)}” as guest` : "Add guest…"}</span></button>` : ""}
    </footer>
  </section></div>`;
}

function assignmentIdForMemberPickerTarget(target) {
  if (!target) return "";
  if (target.kind === "meeting" && target.key === "meetingManager") return "meeting:manager";
  if (target.kind === "meeting" && target.key === "photographer") return "meeting:photographer";
  if (target.kind === "offAgendaRole") return `meeting:off-agenda:${state.meeting.offAgendaRoles?.[target.index]?.role.toLocaleLowerCase().replace(/\s+/g, "-")}`;
  if (target.kind !== "item") return "";
  const item = state.meeting?.blocks.flatMap((block) => block.items || []).find((candidate) => candidate.id === target.itemId);
  return item?.roleAssignmentId ? `role:${item.roleAssignmentId}` : item ? `item:${item.id}` : "";
}

function memberPickerTarget(button) {
  if (button.dataset.signupChangeMember) return { kind: "signup", changeId: button.dataset.signupChangeMember };
  if (button.dataset.memberItem) return { kind: "item", itemId: button.dataset.memberItem, key: button.dataset.memberKey };
  if (button.dataset.meetingMemberKey) return { kind: "meeting", key: button.dataset.meetingMemberKey };
  if (button.dataset.offAgendaRoleIndex) return { kind: "offAgendaRole", index: Number(button.dataset.offAgendaRoleIndex) };
  if (button.dataset.officerRole) return { kind: "officer", role: button.dataset.officerRole };
  return null;
}

export async function refreshMemberPickerMembers(picker) {
  if (state.previewMode) return;
  picker.refreshing = true;
  renderOverlayRegion();
  try {
    const { members } = await apiJson("/api/members");
    state.members = members;
    picker.error = "";
  } catch {
    picker.error = "Could not refresh members. Showing the cached list.";
  } finally {
    picker.refreshing = false;
    if (state.memberPicker === picker) renderOverlayRegion();
  }
}

function openMemberPicker(button) {
  const target = memberPickerTarget(button);
  if (!target) return;
  const picker = {
    target,
    label: button.dataset.pickerLabel || "Choose member",
    selectedId: button.dataset.selectedId || "",
    selectedLabel: button.dataset.selectedLabel || "",
    allowEmpty: button.dataset.allowEmpty === "true",
    allowGuest: button.dataset.allowGuest === "true",
    returnFocusKey: button.dataset.focusKey || "",
    query: "",
    refreshing: false,
    error: "",
  };
  state.memberPicker = picker;
  renderOverlayRegion();
  refreshMemberPickerMembers(picker);
}

export function closeMemberPicker() {
  const focusKey = state.memberPicker?.returnFocusKey || "";
  state.memberPicker = null;
  renderOverlayRegion(focusKey);
}

async function applyMemberToTarget(target, member, returnFocusKey = "") {
  if (target.kind === "signup") {
    const change = signupChangeById(target.changeId);
    if (change) setSignupMember(change, member);
    renderOverlayRegion(returnFocusKey);
    return;
  }
  if (target.kind === "officer") {
    renderOverlayRegion();
    await updateOfficerRole(target.role, member?.id || "");
    elementForFocusKey(returnFocusKey)?.focus({ preventScroll: true });
    return;
  }
  if (target.kind === "item") {
    const item = state.meeting.blocks.flatMap((block) => block.items).find((candidate) => candidate.id === target.itemId);
    if (!item) return renderOverlayRegion();
    item[`${target.key}Id`] = member?.id || "";
    item[target.key] = member?.displayName || "";
    syncLinkedAgendaItem(item, target.key);
    markDirty();
    if (state.activeView === "recommendations") render();
    else refreshStructure(`item:${item.id}:${target.key}`);
  } else if (target.kind === "offAgendaRole") {
    const role = state.meeting.offAgendaRoles?.[target.index];
    if (!role) return renderOverlayRegion();
    role.memberId = member?.id || "";
    role.member = member?.displayName || "";
    markDirty();
    withUiContinuity(() => render(), returnFocusKey);
    return;
  } else if (target.kind === "meeting") {
    state.meeting[`${target.key}MemberId`] = member?.id || "";
    state.meeting[target.key] = member?.displayName || "";
    markDirty();
    withUiContinuity(() => render(), returnFocusKey);
    if (state.activeView === "recommendations") notify("已选择会员，Agenda 正在保存");
    return;
  }
  renderOverlayRegion(returnFocusKey);
}

async function applyMemberPickerSelection(memberId) {
  const picker = state.memberPicker;
  if (!picker) return;
  const member = state.members.find((candidate) => candidate.id === memberId);
  state.memberPicker = null;
  await applyMemberToTarget(picker.target, member, picker.returnFocusKey);
}

function updateMemberPickerSearch(input) {
  const picker = state.memberPicker;
  if (!picker) return;
  picker.query = input.value;
  const results = input.closest(".member-picker-modal")?.querySelector(".member-picker-results");
  if (results) results.scrollTop = 0;
  let total = 0;
  ["members", "guests"].forEach((group) => {
    const section = input.closest(".member-picker-modal")?.querySelector(`[data-member-picker-group="${group}"]`);
    const options = [...(section?.querySelectorAll("[data-member-name]") || [])];
    let count = 0;
    options.forEach((option) => {
      option.hidden = !matchesMemberSearch(option.dataset.memberName, picker.query);
      if (!option.hidden) count += 1;
    });
    if (section) section.hidden = count === 0;
    const counter = section?.querySelector(`[data-member-group-count="${group}"]`);
    if (counter) counter.textContent = count;
    total += count;
  });
  const modal = input.closest(".member-picker-modal");
  const empty = modal?.querySelector("[data-member-picker-empty]");
  if (empty) empty.hidden = total > 0;
  const add = modal?.querySelector("[data-add-picker-guest] span");
  if (add) add.textContent = picker.query.trim() ? `Add “${picker.query.trim()}” as guest` : "Add guest…";
}

export async function addGuestForItem(item, key) {
  runtime.overlayReturnFocusKey = `item:${item.id}:${key}`;
  state.guestPrompt = { kind: "item", itemId: item.id, key };
  renderOverlayRegion();
}

export async function addGuestForMeetingRole(key) {
  runtime.overlayReturnFocusKey = `meeting-role:${key}`;
  state.guestPrompt = { kind: "meeting", key };
  renderOverlayRegion();
}

async function createGuestForTarget(displayName) {
  const prompt = state.guestPrompt;
  if (!prompt) return;
  prompt.busy = true;
  prompt.error = "";
  renderOverlayRegion();
  try {
    let createdMember;
    if (state.previewMode) {
      createdMember = {
        id: uid("guest"),
        displayName,
        englishName: displayName,
        memberType: "guest_placeholder",
        active: true,
      };
      state.members = [...state.members, createdMember].sort((a, b) => a.displayName.localeCompare(b.displayName));
    } else {
      const { member } = await apiJson("/api/members", { method: "POST", body: JSON.stringify({ displayName }) });
      const latest = await apiJson("/api/members");
      state.members = latest.members;
      createdMember = state.members.find((candidate) => candidate.id === member.id) || member;
      if (!state.members.some((candidate) => candidate.id === createdMember.id)) state.members.push(createdMember);
    }
    if (prompt.kind === "signup") {
      if (!useGuestForSignup(prompt, createdMember)) throw new Error("Signup review changed. Reopen the member picker.");
      state.guestPrompt = null;
      renderOverlayRegion(runtime.overlayReturnFocusKey);
    } else {
      const target = prompt.kind === "picker" ? prompt.target : prompt.kind === "item"
        ? { kind: "item", itemId: prompt.itemId, key: prompt.key }
        : { kind: "meeting", key: prompt.key };
      state.guestPrompt = null;
      await applyMemberToTarget(target, createdMember, runtime.overlayReturnFocusKey);
    }
    runtime.overlayReturnFocusKey = "";
  } catch (error) {
    prompt.busy = false;
    prompt.error = error.message;
    state.guestPrompt = prompt;
    renderOverlayRegion();
  }
}

async function updateOfficerRole(role, memberId) {
  const assignments = officerAssignmentsFromMembers();
  assignments[role] = memberId;
  try {
    state.officerBusy = true;
    if (state.previewMode) {
      applyOfficerAssignments(assignments);
      refreshDerivedRegions();
      return;
    }
    const body = await apiJson("/api/members", {
      method: "PUT",
      body: JSON.stringify({ officers: assignments }),
    });
    state.members = body.members;
    refreshDerivedRegions();
  } catch (error) {
    notify(error.message);
  } finally {
    state.officerBusy = false;
    renderOfficerRegion();
  }
}

async function createRoleForTarget(value) {
  if (!state.rolePrompt || state.rolePrompt.busy) return;
  state.rolePrompt.name = value.trim().replace(/ {2,}/g, " ");
  state.rolePrompt.error = "";
  state.rolePrompt.busy = true;
  renderOverlayRegion();
  try {
    const result = await apiJson("/api/roles", {
      method: "POST",
      body: JSON.stringify({ name: state.rolePrompt.name }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!state.roles.some((role) => role.name === result.role.name)) state.roles.push(result.role);
    state.roles.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
    const item = allAgendaItems().find((candidate) => candidate.id === state.rolePrompt.itemId);
    if (!item) throw new Error("Agenda item is no longer available.");
    const previousRoleId = item.roleId;
    item.role = result.role.name;
    item.roleId = roleIdentity(item.role).id;
    autofillAgendaOfficer(item, item.role);
    syncLinkedAgendaItem(item, "role", previousRoleId);
    const focusKey = `item:${item.id}:role`;
    state.rolePrompt = null;
    runtime.overlayReturnFocusKey = "";
    markDirty();
    renderOverlayRegion();
    refreshStructure(focusKey);
    notify(result.created ? `${result.role.name} added to RoleCatalog.` : `Using existing role ${result.role.name}.`);
  } catch (error) {
    state.rolePrompt.busy = false;
    state.rolePrompt.error = ["AbortError", "TimeoutError"].includes(error.name) ? "Sync timed out. Retry." : error.message;
    renderOverlayRegion();
  }
}

export async function handleSearchChange(input, event) {
  if (input.matches("[data-member-picker-search]")) {
    updateMemberPickerSearch(input);
  } else {
    return false;
  }
  return true;
}

export async function handleChange(input, event) {
  if (input.matches("[data-officer-role]")) {
    await updateOfficerRole(input.dataset.officerRole, input.value);
  } else {
    return false;
  }
  return true;
}

export async function handleClick(button, event) {
  if (button.matches("[data-open-member-picker]")) {
    openMemberPicker(button);
  } else if (button.matches("[data-close-member-picker], [data-keep-current-member]")) {
    closeMemberPicker();
  } else if (button.matches("[data-pick-member]")) {
    await applyMemberPickerSelection(button.dataset.pickMember);
  } else if (button.matches("[data-clear-member]")) {
    await applyMemberPickerSelection("");
  } else if (button.matches("[data-add-picker-guest]")) {
    const picker = state.memberPicker;
    if (!picker) return true;
    runtime.overlayReturnFocusKey = picker.returnFocusKey;
    state.memberPicker = null;
    state.guestPrompt = { kind: "picker", target: picker.target, defaultName: picker.query.trim(), busy: false, error: "", formatWarning: false };
    renderOverlayRegion();
  } else if (button.matches("[data-cancel-role]")) {
    state.rolePrompt = null;
    renderOverlayRegion();
    renderBlockEditorRegion();
    elementForFocusKey(runtime.overlayReturnFocusKey)?.focus({ preventScroll: true });
    runtime.overlayReturnFocusKey = "";
  } else if (button.matches("[data-cancel-guest]")) {
    state.guestPrompt = null;
    renderOverlayRegion(runtime.overlayReturnFocusKey);
    runtime.overlayReturnFocusKey = "";
  } else {
    return false;
  }
  return true;
}

export async function handleSubmit(form, event) {
  if (form.matches("[data-guest-form]")) {
    event.preventDefault();
    const displayName = String(new FormData(form).get("displayName") || "").trim();
    if (displayName.length < 2) return true;
    state.guestPrompt.defaultName = displayName;
    if (!guestDisplayNameLooksStandard(displayName) && !state.guestPrompt.formatWarning) {
      state.guestPrompt.formatWarning = true;
      renderOverlayRegion();
      return true;
    }
    await createGuestForTarget(displayName);
  } else if (form.matches("[data-role-form]")) {
    event.preventDefault();
    await createRoleForTarget(String(new FormData(form).get("name") || ""));
  } else {
    return false;
  }
  return true;
}

import { AWARD_DEFINITIONS } from "../../award-order.js";
import { ROLE_AWARD_POOLS, roleAwardConfig, roleAwardIssues, roleEntries, roleIdentity } from "../../role-awards.js";
import { esc } from "../shared/html.js";
import { apiJson } from "./api.js";
import { normalizeMeetingState } from "./derivations.js";
import { flushSave, notify, renderAwardsRegion, renderMediaRegion, renderOverlayRegion, renderPreviewRegion, renderSaaQuickActionsRegion, renderToastRegion, updateMeetingSummary } from "./render-engine.js";
import { runtime, state } from "./state.js";

export function votingCandidates() {
  const items = state.meeting.blocks.flatMap((block) => block.items || []);
  const speeches = state.meeting.blocks.flatMap((block) => block.type === "prepared_speeches" ? block.items.filter((item) => item.kind === "speech") : []);
  const unique = (values) => [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
  const configuredRoleTaker = roleAwardConfig(state.meeting.votingForm, roleEntries(state.meeting)).roleTakerRoleIds;
  const roles = (allowed, key) => {
    const seen = new Set();
    return items.map((item) => ({ item, identity: roleIdentity(item.role, item.roleId) }))
    .filter(({ item, identity }) => item.kind === "role" && allowed.has(identity.id) && item.status === "confirmed" && item.member)
    .filter(({ item, identity }) => {
      const id = item.roleAssignmentId || (key === "functionalRole" ? `${identity.id}:${item.member.trim().toLocaleLowerCase()}` : item.id);
      if (seen.has(id)) return false;
      seen.add(id); return true;
    }).map(({ item, identity }) => ({
      id: item.roleAssignmentId || (key === "functionalRole" ? `${identity.id}:${item.member.trim().toLocaleLowerCase()}` : item.id),
      label: `${identity.label} — ${item.member}`,
    }));
  };
  const evaluatorMap = new Map();
  speeches.filter((item) => item.evaluatorStatus === "confirmed" && item.evaluator).forEach((item) => {
    const id = item.evaluatorId || item.evaluator.toLocaleLowerCase();
    const value = evaluatorMap.get(id) || { id: `evaluator:${id}`, name: item.evaluator, speakers: [] };
    value.speakers.push(item.member || item.session); evaluatorMap.set(id, value);
  });
  return {
    roleTaker: roles(new Set([...ROLE_AWARD_POOLS.roleTaker, ...configuredRoleTaker]), "roleTaker"),
    facilitator: roles(new Set(ROLE_AWARD_POOLS.facilitator), "facilitator"),
    functionalRole: roles(new Set(ROLE_AWARD_POOLS.functionalRole), "functionalRole"),
    tableTopicsSpeaker: unique(state.meeting.tableTopicsSpeakers || []).map((name) => ({ id: `table-topics:${name.toLocaleLowerCase()}`, label: name })),
    preparedSpeaker: speeches.filter((item) => item.status === "confirmed" && item.member).map((item) => ({ id: item.id, label: `${item.member} — ${item.session}` })),
    evaluator: [...evaluatorMap.values()].map((item) => ({ id: item.id, label: `${item.name} — Evaluated: ${item.speakers.join(" / ")}` })),
  };
}

export function votingCandidateDiff() {
  const current = votingCandidates();
  const synced = state.meeting.votingForm?.syncedCandidates || {};
  let added = 0;
  let removed = 0;
  Object.keys(current).forEach((key) => {
    added += current[key].filter((item) => !(synced[key] || []).some((stored) => stored.id === item.id && stored.label === item.label)).length;
    removed += (synced[key] || []).filter((item) => !current[key].some((candidate) => candidate.id === item.id && candidate.label === item.label)).length;
  });
  return { added, removed, needsUpdate: Boolean(added || removed) };
}

const VOTING_AWARD_TYPES = new Set(AWARD_DEFINITIONS.map(({ type }) => type));

export function votingHostName() {
  return state.meeting?.blocks?.flatMap((block) => block.items || []).find((item) =>
    item.kind === "role" && roleIdentity(item.role, item.roleId).id === "voting_announcement_host" && item.status === "confirmed" && item.member,
  )?.member || "";
}

export function votingConsoleResults() {
  return (state.awards?.results || []).filter((result) => VOTING_AWARD_TYPES.has(result.type));
}

function renderVotingCandidate(candidate, total) {
  const percent = total ? Math.round((candidate.votes / total) * 100) : 0;
  return `<div class="voting-console-candidate" data-voting-candidate-key="${esc(candidate.id || candidate.label)}"><div><strong data-voting-candidate-name>${esc(candidate.name || candidate.label)}</strong><span data-voting-candidate-context ${candidate.context ? "" : "hidden"}>${esc(candidate.context || "")}</span><em data-voting-candidate-historical ${candidate.historical ? "" : "hidden"}>Historical</em></div><div class="voting-console-count"><b data-voting-candidate-votes>${candidate.votes}</b><span data-voting-candidate-percent>${percent}%</span></div><i style="--vote-width:${percent}%"></i></div>`;
}

export function renderVotingResultCard(result) {
  const total = result.totalVotes || 0;
  return `<article class="voting-console-card" data-voting-result-type="${esc(result.type)}">
    <header><div><span data-voting-result-title>${esc(result.title)}</span><strong data-voting-result-total>${total} vote${total === 1 ? "" : "s"}</strong></div><div class="voting-console-tags"><b data-voting-result-tie ${result.winners.length > 1 ? "" : "hidden"}>Tie</b></div></header>
    <div class="voting-console-candidates"><p class="voting-console-empty" data-voting-result-empty ${result.candidates.length ? "hidden" : ""}>No candidates · N/A</p>${result.candidates.map((candidate) => renderVotingCandidate(candidate, total)).join("")}</div>
  </article>`;
}

function updateVotingConsoleRegion() {
  const consoleState = state.votingConsole;
  const modal = document.querySelector(".voting-console-modal");
  if (!modal || modal.dataset.votingConsolePhase !== consoleState.phase) return renderOverlayRegion();
  const data = state.awards;
  const results = votingConsoleResults();
  const loadedAt = consoleState.loadedAt ? new Date(consoleState.loadedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—";
  modal.querySelector("[data-voting-responses]").textContent = data?.responseCount ?? "—";
  modal.querySelector("[data-voting-updated]").textContent = loadedAt;
  const refresh = modal.querySelector("[data-refresh-voting-console]");
  refresh.disabled = consoleState.busy;
  refresh.textContent = consoleState.busy ? "Refreshing…" : "Refresh";
  const error = modal.querySelector("[data-voting-console-error]");
  error.hidden = !consoleState.error;

  const resultsRoot = modal.querySelector(".voting-console-results");
  resultsRoot.querySelector("[data-voting-console-loading]").hidden = Boolean(results.length);
  const cards = new Map([...resultsRoot.children].filter((node) => node.dataset.votingResultType).map((node) => [node.dataset.votingResultType, node]));
  const resultTypes = new Set(results.map((result) => result.type));
  cards.forEach((card, type) => { if (!resultTypes.has(type)) card.remove(); });
  const orderedCards = results.map((result) => {
    const total = result.totalVotes || 0;
    let card = cards.get(result.type);
    if (!card) {
      card = document.createRange().createContextualFragment(renderVotingResultCard(result)).firstElementChild;
      cards.set(result.type, card);
    }
    card.querySelector("[data-voting-result-title]").textContent = result.title;
    card.querySelector("[data-voting-result-total]").textContent = `${total} vote${total === 1 ? "" : "s"}`;
    card.querySelector("[data-voting-result-tie]").hidden = result.winners.length < 2;
    const candidatesRoot = card.querySelector(".voting-console-candidates");
    candidatesRoot.querySelector("[data-voting-result-empty]").hidden = Boolean(result.candidates.length);
    const candidates = new Map([...candidatesRoot.children].filter((node) => node.dataset.votingCandidateKey).map((node) => [node.dataset.votingCandidateKey, node]));
    const candidateKeys = new Set(result.candidates.map((candidate) => candidate.id || candidate.label));
    candidates.forEach((candidate, key) => { if (!candidateKeys.has(key)) candidate.remove(); });
    const orderedCandidates = result.candidates.map((candidate) => {
      const key = candidate.id || candidate.label;
      const percent = total ? Math.round((candidate.votes / total) * 100) : 0;
      let row = candidates.get(key);
      if (!row) row = document.createRange().createContextualFragment(renderVotingCandidate(candidate, total)).firstElementChild;
      row.querySelector("[data-voting-candidate-name]").textContent = candidate.name || candidate.label;
      const context = row.querySelector("[data-voting-candidate-context]");
      context.hidden = !candidate.context;
      context.textContent = candidate.context || "";
      row.querySelector("[data-voting-candidate-historical]").hidden = !candidate.historical;
      row.querySelector("[data-voting-candidate-votes]").textContent = candidate.votes;
      row.querySelector("[data-voting-candidate-percent]").textContent = `${percent}%`;
      row.querySelector("i").style.setProperty("--vote-width", `${percent}%`);
      return row;
    });
    orderedCandidates.forEach((row, index) => {
      const current = [...candidatesRoot.children].filter((node) => node.dataset.votingCandidateKey)[index];
      if (current !== row) candidatesRoot.insertBefore(row, current || null);
    });
    return card;
  });
  orderedCards.forEach((card, index) => {
    const current = [...resultsRoot.children].filter((node) => node.dataset.votingResultType)[index];
    if (current !== card) resultsRoot.insertBefore(card, current || null);
  });

}

function candidateResetMessage(details) {
  const changes = details?.candidateChanges || {};
  const lines = [
    ...(changes.added || []).map((item) => `+ ${item.award}: ${item.label}`),
    ...(changes.removed || []).map((item) => `− ${item.award}: ${item.label}`),
  ];
  return `Candidate changes:\n${lines.join("\n") || "Candidate list updated"}\n\nConfirming this change will permanently delete all ${details?.responseCount || 0} existing responses and update the voting form.`;
}

async function withCandidateResetConfirmation(request) {
  try {
    return await request(false);
  } catch (error) {
    if (error.code !== "VOTING_RESPONSE_RESET_REQUIRED") throw error;
    if (!window.confirm(candidateResetMessage(error.details))) return null;
    return request(true);
  }
}

export async function runVotingAction(action) {
  await flushSave();
  if (["error", "conflict"].includes(state.saveStatus)) return;
  const issues = roleAwardIssues(state.meeting);
  if ((action === "prepare" || action === "sync") && issues.blockers.length) return notify(issues.blockers.join(" "));
  state.votingBusy = action;
  state.votingProgress = action === "prepare" ? "Checking existing voting resources…" : action === "sync" ? "Updating candidates…" : "";
  renderMediaRegion();
  const progressTimers = [
    window.setTimeout(() => { if (state.votingBusy === action) { state.votingProgress = "Updating Feishu form fields…"; renderMediaRegion(); } }, 3000),
    window.setTimeout(() => { if (state.votingBusy === action) { state.votingProgress = "Finishing QR code and permissions…"; renderMediaRegion(); } }, 8000),
  ];
  try {
    const base = `/api/meetings/${encodeURIComponent(state.meeting.id)}/voting`;
    if (action === "prepare") await timedVotingRequest(`${base}?action=prepare`, { method: "POST", body: "{}" });
    else if (action === "sync") {
      const result = await withCandidateResetConfirmation((confirmResponseReset) => timedVotingRequest(`${base}?action=sync`, {
        method: "POST",
        body: JSON.stringify({ confirmResponseReset }),
      }));
      if (!result) return;
      state.toast = result.clearedResponses ? `Voting form updated. ${result.clearedResponses} responses deleted.` : "Voting form updated.";
    }
    else if (action === "authorize") {
      const result = await apiJson(`${base}?action=authorize`, { method: "POST", body: "{}" });
      state.meeting.votingForm = result.votingForm;
      state.toast = result.votingForm.authorization?.status === "ready" ? "Voting table editors authorized." : result.votingForm.authorization?.message;
    }
    else if (action === "clear") {
      const status = await apiJson(`${base}?action=status`);
      if (!window.confirm(`Delete ${status.responseCount} responses? This cannot be undone.`)) return;
      const result = await apiJson(`${base}?action=responses`, { method: "DELETE" });
      state.toast = `${result.deleted} responses deleted.`;
      state.votingResults = null;
    } else state.votingResults = await apiJson(`${base}?action=results`);
    if (action === "prepare" || action === "sync") {
      const { meeting } = await apiJson(`/api/meetings/${encodeURIComponent(state.meeting.id)}`);
      state.meeting = normalizeMeetingState(meeting);
      if (action === "prepare") state.toast = "Voting form ready.";
    }
  } catch (error) { state.toast = error.message; }
  finally { progressTimers.forEach(window.clearTimeout); state.votingBusy = ""; state.votingProgress = ""; renderMediaRegion(); renderPreviewRegion(); renderToastRegion(); }
}

export async function prewarmVotingForm() {
  if (state.previewMode || state.votingBusy || state.meeting.qrSource !== "system" || state.meeting.meetingType === "contest") return;
  const diff = votingCandidateDiff();
  if (state.meeting.votingForm?.formId && !diff.needsUpdate) return;
  await flushSave();
  if (["error", "conflict"].includes(state.saveStatus)) return;
  const issues = roleAwardIssues(state.meeting);
  if (issues.blockers.length) return notify(issues.blockers.join(" "));
  const meetingId = state.meeting.id;
  state.votingBusy = "prewarm";
  state.votingProgress = "Claiming a prebuilt voting form…";
  renderMediaRegion();
  const timers = [
    window.setTimeout(() => { if (state.votingBusy === "prewarm") { state.votingProgress = "Syncing current candidates…"; renderMediaRegion(); } }, 3000),
    window.setTimeout(() => { if (state.votingBusy === "prewarm") { state.votingProgress = "Finishing voting QR and access…"; renderMediaRegion(); } }, 8000),
  ];
  try {
    await apiJson(`/api/meetings/${encodeURIComponent(meetingId)}/voting?action=prepare`, { method: "POST", body: "{}" });
    const { meeting } = await apiJson(`/api/meetings/${encodeURIComponent(meetingId)}`);
    if (state.meeting.id === meetingId) {
      state.meeting.votingForm = meeting.votingForm;
      state.meeting.systemVotingQr = meeting.systemVotingQr;
      state.meeting.qrSource = meeting.qrSource;
      updateMeetingSummary(meeting);
      state.toast = "Voting form prepared ahead of time.";
    }
  } catch (error) {
    if (state.meeting.id === meetingId) state.toast = `Voting prebuild failed · ${error.message}`;
  } finally {
    timers.forEach(window.clearTimeout);
    if (state.meeting.id === meetingId) {
      state.votingBusy = "";
      state.votingProgress = "";
      renderMediaRegion(); renderPreviewRegion(); renderToastRegion();
      if (state.activeView === "advisor") await loadAwards({ quiet: true });
    }
  }
}

async function timedVotingRequest(url, options) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15000);
  try { return await apiJson(url, { ...options, signal: controller.signal }); }
  catch (error) {
    if (error.name === "AbortError") throw new Error("Voting form update exceeded 15 seconds. Retry is safe and reuses existing resources.");
    throw error;
  } finally { window.clearTimeout(timeout); }
}

export async function saveTableTopicsSpeakers() {
  if (!state.tableTopicsDraftDirty || state.votingBusy) return;
  state.votingBusy = "speakers";
  renderMediaRegion();
  try {
    const speakers = [...new Set(state.tableTopicsDraft.split(/\r?\n/).map((name) => name.trim()).filter(Boolean))];
    const remainingEntries = [...(state.meeting.tableTopicsEntries || [])];
    const entries = speakers.map((name, index) => {
      const matchingIndex = remainingEntries.findIndex((entry) => String(entry.name || "").trim().toLocaleLowerCase() === name.toLocaleLowerCase());
      const existing = matchingIndex === -1 ? null : remainingEntries.splice(matchingIndex, 1)[0];
      return { ...existing, name, order: index + 1 };
    });
    const base = `/api/meetings/${encodeURIComponent(state.meeting.id)}/voting`;
    const result = await withCandidateResetConfirmation((confirmResponseReset) => apiJson(`${base}?action=table-topics-entries`, {
      method: "PUT",
      body: JSON.stringify({ entries, currentTableTopicsEntryId: state.meeting.currentTableTopicsEntryId || "", confirmResponseReset }),
    }));
    if (!result) return;
    state.meeting.tableTopicsEntries = result.tableTopicsEntries;
    state.meeting.tableTopicsSpeakers = result.tableTopicsSpeakers;
    state.meeting.currentTableTopicsEntryId = result.currentTableTopicsEntryId;
    state.tableTopicsDraft = result.tableTopicsSpeakers.join("\n");
    state.tableTopicsDraftDirty = false;
    state.votingResults = null;
    state.awards = null;
    state.awardsError = "";
    state.toast = result.clearedResponses
      ? `Speakers updated. ${result.clearedResponses} responses deleted.`
      : "Table Topics speakers saved. Voting form updated.";
  } catch (error) { state.toast = error.message; }
  finally { state.votingBusy = ""; renderMediaRegion(); renderPreviewRegion(); renderToastRegion(); }
}

export async function loadAwards({ quiet = false } = {}) {
  if (state.previewMode || !state.meeting) return;
  const meetingId = state.meeting.id;
  state.awardsBusy = true;
  state.awardsTip = !quiet;
  state.awardsError = "";
  renderAwardsRegion("awards-refresh");
  renderSaaQuickActionsRegion();
  try {
    const awards = await apiJson(`/api/meetings/${encodeURIComponent(meetingId)}/awards`);
    if (state.meeting?.id === meetingId) state.awards = awards;
  } catch (error) {
    if (state.meeting?.id === meetingId) {
      state.awardsError = error.message;
      if (!quiet) state.toast = error.message;
    }
  } finally {
    if (state.meeting?.id === meetingId) {
      state.awardsBusy = false;
      state.awardsTip = false;
      renderAwardsRegion("awards-refresh");
      renderSaaQuickActionsRegion();
      renderToastRegion();
    }
  }
}

export function stopVotingConsoleRefresh() {
  window.clearTimeout(runtime.votingConsoleTimer);
  runtime.votingConsoleTimer = null;
}

export function scheduleVotingConsoleRefresh() {
  stopVotingConsoleRefresh();
  if (!state.votingConsole.open || state.votingConsole.phase !== "live" || document.hidden) return;
  runtime.votingConsoleTimer = window.setTimeout(() => refreshVotingConsole(), 5000);
}

export async function refreshVotingConsole() {
  if (!state.votingConsole.open || !state.meeting || state.votingConsole.busy) return;
  const consoleState = state.votingConsole;
  const meetingId = state.meeting.id;
  consoleState.busy = true;
  updateVotingConsoleRegion();
  try {
    const awards = await apiJson(`/api/meetings/${encodeURIComponent(meetingId)}/awards`);
    if (state.meeting?.id !== meetingId || state.votingConsole !== consoleState || !consoleState.open) return;
    state.awards = awards;
    consoleState.error = "";
    consoleState.loadedAt = new Date().toISOString();
  } catch (error) {
    if (state.meeting?.id === meetingId && state.votingConsole === consoleState && consoleState.open) consoleState.error = error.message;
  } finally {
    if (state.meeting?.id === meetingId && state.votingConsole === consoleState && consoleState.open) {
      consoleState.busy = false;
      updateVotingConsoleRegion();
      renderSaaQuickActionsRegion();
      scheduleVotingConsoleRefresh();
    }
  }
}

export async function openVotingConsole() {
  runtime.overlayReturnFocusKey = "";
  state.votingConsole = {
    open: true,
    phase: "live",
    busy: false,
    error: "",
    loadedAt: "",
    operator: votingHostName(),
  };
  renderOverlayRegion();
  await refreshVotingConsole();
}

export function closeVotingConsole() {
  stopVotingConsoleRefresh();
  state.votingConsole.open = false;
  renderOverlayRegion();
}

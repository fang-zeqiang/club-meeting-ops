import { ROLE_AWARD_POOLS, roleAwardConfig, roleAwardIssues, roleEntries, setRoleTakerExtension } from "../../role-awards.js";
import { CONTEST_PLACES, contestants, setContestPlace } from "../../contest-results.js";
import { esc } from "../shared/html.js";
import { apiJson } from "./api.js";
import { activeVotingImage, isFinalized, renderAgendaSyncTip, renderQrFrame } from "./derivations.js";
import { flushSave, notify, render, renderAwardsRegion, renderMediaRegion, renderOverlayRegion, renderPreviewRegion, replaceRegion } from "./render-engine.js";
import { markDirty, state } from "./state.js";
import { closeVotingConsole, loadAwards, openVotingConsole, refreshVotingConsole, renderVotingResultCard, runVotingAction, saveTableTopicsSpeakers, votingCandidates, votingConsoleResults, votingHostName } from "./voting-actions.js";

function renderVotingResults() {
  if (!state.votingResults) return "";
  const feedback = state.votingResults.feedback || { averageRating: null, distribution: {}, comments: [] };
  return `<div class="voting-results"><strong>${state.votingResults.responseCount} responses</strong>${Object.values(state.votingResults.awards).map((award) => `<div><b>${esc(award.title)}</b>: ${award.winners.length ? award.winners.map((item) => esc(item.name)).join(", ") : "No result"}<br>${award.candidates.map((item) => `${esc(item.label || item.name)} ${item.votes}${item.historical ? " (historical)" : ""}`).join(" · ")}</div>`).join("")}<div><b>Meeting rating</b>: ${feedback.averageRating == null ? "No ratings" : `${feedback.averageRating} / 5`}<br>${[1, 2, 3, 4, 5].map((rating) => `${rating}★ ${feedback.distribution?.[rating] || 0}`).join(" · ")}</div>${feedback.comments?.length ? `<div><b>Comments</b>${feedback.comments.map((comment) => `<p>${esc(comment)}</p>`).join("")}</div>` : ""}</div>`;
}

function preparedSpeechCompletions() {
  return state.meeting.blocks
    .flatMap((block) => block.type === "prepared_speeches" ? block.items.filter((item) => item.kind === "speech") : [])
    .filter((item) => item.status === "confirmed" && item.member);
}

function sharingMasterAutoNames() {
  return [...new Set(state.meeting.blocks
    .flatMap((block) => block.items || [])
    .filter((item) => item.kind === "role" && item.status === "confirmed" && item.member)
    .filter((item) => String(item.role || "").trim().toLocaleLowerCase() === "sharing master")
    .map((item) => item.member.trim())
    .filter(Boolean))];
}

export function renderVotingSource() {
  return `<fieldset class="voting-source" ${state.votingBusy ? "disabled" : ""}><legend>Voting source</legend>
    <label class="${state.meeting.qrSource === "system" ? "active" : ""}"><input type="radio" name="voting-source" data-voting-source value="system" ${state.meeting.qrSource === "system" ? "checked" : ""}>System form</label>
    <label class="${state.meeting.qrSource === "manual" ? "active" : ""}"><input type="radio" name="voting-source" data-voting-source value="manual" ${state.meeting.qrSource === "manual" ? "checked" : ""}>Manual QR</label>
  </fieldset>`;
}

export function renderCandidateSummary() {
  const candidates = votingCandidates();
  const issues = roleAwardIssues(state.meeting);
  const list = (values, empty) => values.length ? values.map((item) => `<span>${esc(item.label)}</span>`).join("") : `<em>${empty}</em>`;
  return `<div class="candidate-summary">
    ${issues.blockers.length || issues.warnings.length ? `<div class="role-award-issues">${issues.blockers.map((item) => `<strong>${esc(item)}</strong>`).join("")}${issues.warnings.map((item) => `<span>${esc(item)}</span>`).join("")}</div>` : ""}
    <div><strong>Role takers <b>${candidates.roleTaker.length}</b></strong>${list(candidates.roleTaker, "Confirm TME, TTE and GE")}</div>
    <div><strong>Facilitators <b>${candidates.facilitator.length}</b></strong>${list(candidates.facilitator, "Confirm Warm-up Host, TTM, Guest Talk Host and Voting Host")}</div>
    <div><strong>Functional roles <b>${candidates.functionalRole.length}</b></strong>${list(candidates.functionalRole, "Confirm Timer, Grammarian and Ah-Counter")}</div>
    <div><strong>Prepared speakers <b>${candidates.preparedSpeaker.length}</b></strong>${list(candidates.preparedSpeaker, "Complete assignments in Build agenda")}</div>
    <div><strong>Evaluators <b>${candidates.evaluator.length}</b></strong>${list(candidates.evaluator, "Complete assignments in Build agenda")}</div>
    <div><strong>Table Topics</strong><em>Added during Live Voting</em></div>
  </div>${renderRoleTakerConfig()}${renderRecognitionConfig()}<button class="text-button" data-task="build-agenda" data-stage-target="preparation">Edit agenda →</button>`;
}

function renderRoleTakerConfig() {
  const config = roleAwardConfig(state.meeting.votingForm, roleEntries(state.meeting));
  const fixed = new Map([
    ...ROLE_AWARD_POOLS.roleTaker.map((id) => [id, "Best Role Taker default"]),
    ...ROLE_AWARD_POOLS.facilitator.map((id) => [id, "Best Facilitator"]),
    ...ROLE_AWARD_POOLS.functionalRole.map((id) => [id, "Best Functional Role"]),
  ]);
  const rows = roleEntries(state.meeting).map((role) => {
    const disabled = fixed.has(role.id);
    const checked = config.roleTakerRoleIds.includes(role.id);
    const note = disabled ? fixed.get(role.id) : role.standard ? "Can add to Best Role Taker" : "Custom role";
    return `<label class="${disabled ? "disabled" : ""}"><input type="checkbox" data-role-taker-role="${esc(role.id)}" ${checked ? "checked" : ""} ${disabled ? "disabled" : ""}>${esc(role.label)}<span>${esc(note)}</span></label>`;
  }).join("") || "<em>No agenda roles yet.</em>";
  return `<details class="role-award-config"><summary>Extend Best Role Taker</summary><div>${rows}</div></details>`;
}

function renderRecognitionConfig() {
  const speeches = preparedSpeechCompletions();
  const sharingMasters = sharingMasterAutoNames();
  return `<details class="role-award-config"><summary>Recognition awards</summary><div>
    <span>Speech Completion · ${speeches.length ? speeches.map((item) => esc(item.member)).join(" · ") : "No confirmed prepared speaker"}</span>
    <span>Sharing Master · ${sharingMasters.length ? sharingMasters.map(esc).join(" · ") : "No confirmed Agenda assignment"}</span>
  </div></details>`;
}

function ensureTableTopicsDraft() {
  if (state.tableTopicsDraftMeetingId === state.meeting.id) return;
  state.tableTopicsDraftMeetingId = state.meeting.id;
  state.tableTopicsDraft = state.meeting.tableTopicsSpeakers.join("\n");
  state.tableTopicsDraftDirty = false;
}

export function renderLiveVoting() {
  const m = state.meeting;
  ensureTableTopicsDraft();
  if (m.qrSource === "manual") return `<article class="voting-readiness">${renderQrFrame("voting", activeVotingImage(), "editor-qr")}<div class="voting-config"><div class="voting-state ready"><span></span><strong>Manual QR selected</strong></div><p>Voting entry is ready on the Agenda.</p></div></article>`;
  const prepared = Boolean(m.votingForm?.formId);
  return `<article class="voting-live">
    <div class="voting-live-head"><div><span class="eyebrow">Live candidates</span><h3>Table Topics speakers</h3></div><span class="draft-state ${state.tableTopicsDraftDirty ? "dirty" : ""}">${state.tableTopicsDraftDirty ? "Unsaved" : "Saved"}</span></div>
    <label>One full name per line<textarea data-table-topics-speakers placeholder="Add speakers as they take the stage" ${!prepared ? "disabled" : ""}>${esc(state.tableTopicsDraft)}</textarea></label>
    ${!prepared ? '<div class="voting-alert">Prepare system form before meeting starts.</div>' : ""}
    <div class="voting-live-footer">
      <div class="voting-primary-actions"><button class="button primary" data-save-table-topics ${!prepared || !state.tableTopicsDraftDirty || state.votingBusy ? "disabled" : ""}>${state.votingBusy === "speakers" ? "Saving…" : "Save speakers & update form"}</button><span>⌘S / Ctrl+S</span></div>
      <div class="live-voting-tools"><button class="button" data-task="${isFinalized() ? "review-share" : "build-agenda"}" data-stage-target="preparation">Adjust agenda roles</button>${prepared && m.votingForm?.shareUrl ? `<a class="button" href="${esc(m.votingForm.shareUrl)}" target="_blank" rel="noopener">Open voting form ↗</a>` : ""}<button class="button" data-voting-results ${state.previewMode ? 'disabled title="Unavailable in demo"' : ""}>Refresh results</button><details class="voting-more"><summary>Danger zone</summary><div><button class="danger-link" data-voting-clear ${state.previewMode ? "disabled" : ""}>Clear responses</button></div></details></div>
    </div>
    ${state.votingBusy ? renderAgendaSyncTip(state.votingBusy === "speakers" ? "Syncing speakers and voting form…" : "Syncing voting data…") : ""}
    ${renderVotingResults()}
  </article>`;
}

const contestantValue = (entry) => entry.memberId || `name:${entry.name}`;

// 模拟赛名次由 Ballot Counter 汇总后在此录入，随会议保存；投屏 Awards 页轮询到后即可揭晓
function renderContestPlaces() {
  const options = contestants(state.meeting);
  const results = state.meeting.contestResults || {};
  return CONTEST_PLACES.map(({ key, label }) => {
    const selected = results[key] ? contestantValue(results[key]) : "";
    return `<label class="field"><span>${esc(label)}</span><select data-contest-place="${key}" data-focus-key="contest-place:${key}"><option value="">Not decided</option>${options.map((entry) => `<option value="${esc(contestantValue(entry))}" ${contestantValue(entry) === selected ? "selected" : ""}>${esc(entry.name)}</option>`).join("")}</select></label>`;
  }).join("");
}

export function renderAwardsEditor() {
  const data = state.awards;
  const resultMarkup = data?.results?.map((result) => {
    const winnerNames = result.winners.map((winner) => winner.name).join(", ");
    const meta = result.totalVotes ? `${result.totalVotes} valid vote${result.totalVotes === 1 ? "" : "s"}` : result.winners.length ? "recognition" : "no votes";
    return `<div class="award-result"><div><strong>${esc(result.title)}</strong><span>${meta}</span></div><b>${esc(winnerNames || "No result — no certificate")}</b></div>`;
  }).join("") || '<p class="award-help">暂时没有可颁发结果</p>';
  return `<section class="section-card" data-region="awards">
    <div class="section-heading"><div><span class="eyebrow">Live ceremony</span><h2>Meeting awards</h2></div></div>
    <div class="section-content award-panel">
      ${state.meeting.meetingType === "contest" ? renderContestPlaces() : ""}
      ${resultMarkup}
      <div class="add-row">
        <button class="button" data-refresh-awards data-focus-key="awards-refresh" ${state.awardsBusy ? "disabled" : ""}>${state.awardsBusy ? "Loading…" : "Refresh results"}</button>
        <a class="button primary" href="/m/${encodeURIComponent(state.meeting.meetingNumber)}/presentation?jump=awards" target="_blank" rel="noopener">Open presentation</a>
      </div>
      ${state.awardsBusy && state.awardsTip ? renderAgendaSyncTip("Syncing award results…") : ""}
      ${data?.warnings?.map((warning) => `<p class="award-help">${esc(warning)}</p>`).join("") || ""}
    </div>
  </section>`;
}

export function renderTableTopicsTask() {
  const { items, busy, error, addBusy, addError } = state.tableTopics;
  const rows = busy
    ? `<p role="status">Loading topics…</p>`
    : error
      ? `<p role="status">${esc(error)}</p><button class="button" data-reload-table-topics>Retry</button>`
      : items.length
        ? `<ul class="table-topics-list">${items.map((topic) => `<li><span>${esc(topic.topicText)}</span><button class="button danger" type="button" data-delete-table-topic="${esc(topic.key)}" aria-label="Delete topic: ${esc(topic.topicText)}">Delete</button></li>`).join("")}</ul>`
        : "<p>No topics yet. TTM can also add topics from Role Book.</p>";
  return `<section class="section-card" data-region="table-topics"><div class="section-heading"><div><span class="eyebrow">Table Topics</span><h2>Topics for tonight</h2></div></div><div class="section-content">
    ${rows}
    <form class="table-topics-form" data-table-topics-form>
      <div class="field"><input type="text" name="topicText" maxlength="500" placeholder="Add a Table Topics prompt" aria-label="New Table Topics prompt" ${addBusy ? "disabled" : ""} required></div>
      <button class="button" type="submit" ${addBusy ? "disabled" : ""}>${addBusy ? "Adding…" : "Add"}</button>
    </form>
    ${addError ? `<p class="table-topics-error" role="status">${esc(addError)}</p>` : ""}
  </div></section>`;
}

export function renderVotingConsolePrompt() {
  const consoleState = state.votingConsole;
  if (!consoleState.open) return "";
  const data = state.awards;
  const results = votingConsoleResults();
  const loadedAt = consoleState.loadedAt ? new Date(consoleState.loadedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—";
  return `<div class="modal-backdrop voting-console-backdrop"><section class="voting-console-modal" data-voting-console-phase="live" role="dialog" aria-modal="true" aria-labelledby="voting-console-title">
    <aside><div><span class="voting-console-live"><i></i> Live ballot</span><h2>Voting<br> Console</h2></div><dl><div><dt>Responses</dt><dd data-voting-responses>${data?.responseCount ?? "—"}</dd></div><div><dt>Voting Host</dt><dd>${esc(votingHostName() || "Unassigned")}</dd></div><div><dt>Updated</dt><dd data-voting-updated>${esc(loadedAt)}</dd></div></dl><button data-close-voting-console aria-label="Close voting console">×</button></aside>
    <main><header><div><span class="eyebrow">Meeting #${esc(state.meeting.meetingNumber)}</span><h1 id="voting-console-title">Live voting results</h1></div><button class="button" data-refresh-voting-console ${consoleState.busy ? "disabled" : ""}>${consoleState.busy ? "Refreshing…" : "Refresh"}</button></header>
      <div class="voting-console-error" data-voting-console-error ${consoleState.error ? "" : "hidden"}><strong>Refresh failed.</strong> Showing the last loaded totals.</div>
      <section class="voting-console-results"><div class="voting-console-loading" data-voting-console-loading ${results.length ? "hidden" : ""}>Loading voting results…</div>${results.map(renderVotingResultCard).join("")}</section>
      <footer><span>${data?.ready ? `${data.availableAwardCount} 项结果 · 可直接颁奖` : "暂时没有可颁发结果"}</span><a class="button primary" href="/m/${encodeURIComponent(state.meeting.meetingNumber)}/presentation?jump=awards" target="_blank" rel="noopener">Open presentation</a></footer>
    </main>
  </section></div>`;
}

export async function loadTableTopics() {
  if (!state.meeting?.id || state.previewMode) return;
  state.tableTopics = { ...state.tableTopics, busy: true, error: "" };
  if (state.activeTask === "prepare-voting") render();
  try {
    const result = await apiJson(`/api/meetings/${encodeURIComponent(state.meeting.id)}?view=table-topics`);
    state.tableTopics = { items: result.topics || [], busy: false, error: "", addBusy: false, addError: "" };
  } catch (error) {
    state.tableTopics = { items: [], busy: false, error: error.message, addBusy: false, addError: "" };
  }
  if (state.activeTask === "prepare-voting") render();
}

async function addTableTopic(topicText) {
  if (!state.meeting?.id || state.tableTopics.addBusy) return;
  state.tableTopics = { ...state.tableTopics, addBusy: true, addError: "" };
  replaceRegion("table-topics", renderTableTopicsTask());
  try {
    const result = await apiJson(`/api/meetings/${encodeURIComponent(state.meeting.id)}?action=table-topics-add`, {
      method: "POST",
      body: JSON.stringify({ topicText }),
    });
    state.tableTopics = { ...state.tableTopics, items: [...state.tableTopics.items, result.topic], addBusy: false, addError: "" };
  } catch (error) {
    state.tableTopics = { ...state.tableTopics, addBusy: false, addError: error.message };
  }
  replaceRegion("table-topics", renderTableTopicsTask());
}

async function deleteTableTopic(key) {
  if (!state.meeting?.id) return;
  try {
    await apiJson(`/api/meetings/${encodeURIComponent(state.meeting.id)}?action=table-topics-delete`, {
      method: "POST",
      body: JSON.stringify({ key }),
    });
    state.tableTopics = { ...state.tableTopics, items: state.tableTopics.items.filter((topic) => topic.key !== key) };
  } catch (error) {
    state.tableTopics = { ...state.tableTopics, error: error.message };
  }
  replaceRegion("table-topics", renderTableTopicsTask());
}

// Voting Console 的操作员输入分支在 dispatcher 的 finalized 守卫之前,必须单独拼接
export async function handleConsoleChange() { return false; }

export async function handleChange(input, event) {
  if (input.matches("[data-role-taker-role]")) {
    state.meeting.votingForm = state.meeting.votingForm && typeof state.meeting.votingForm === "object" ? state.meeting.votingForm : {};
    state.meeting.votingForm.roleAwardConfig = setRoleTakerExtension(state.meeting.votingForm, roleEntries(state.meeting), input.dataset.roleTakerRole, input.checked);
    markDirty();
    renderMediaRegion();
  } else if (input.matches("[data-contest-place]")) {
    const contestant = contestants(state.meeting).find((entry) => contestantValue(entry) === input.value) || null;
    state.meeting.contestResults = setContestPlace(state.meeting.contestResults, input.dataset.contestPlace, contestant);
    markDirty();
    renderAwardsRegion(`contest-place:${input.dataset.contestPlace}`);
  } else if (input.matches("[data-table-topics-speakers]")) {
    state.tableTopicsDraft = input.value;
    state.tableTopicsDraftDirty = input.value !== state.meeting.tableTopicsSpeakers.join("\n");
    const panel = input.closest(".voting-live");
    const indicator = panel?.querySelector(".draft-state");
    const saveButton = panel?.querySelector("[data-save-table-topics]");
    if (indicator) { indicator.textContent = state.tableTopicsDraftDirty ? "Unsaved" : "Saved"; indicator.classList.toggle("dirty", state.tableTopicsDraftDirty); }
    if (saveButton) saveButton.disabled = !state.tableTopicsDraftDirty;
  } else if (input.matches("[data-voting-source]")) {
    if (event.type === "input") return true;
    if (state.previewMode) {
      state.meeting.qrSource = input.value;
      markDirty();
      renderMediaRegion();
      renderPreviewRegion();
      return true;
    }
    await flushSave();
    const body = await apiJson(`/api/meetings/${encodeURIComponent(state.meeting.id)}/voting?action=qr-source`, { method: "PUT", body: JSON.stringify({ qrSource: input.value }) });
    state.meeting.qrSource = body.qrSource;
    renderMediaRegion(); renderPreviewRegion();
  } else {
    return false;
  }
  return true;
}

export async function handleClick(button, event) {
  if (button.matches("[data-reload-table-topics]")) {
    await loadTableTopics();
  } else if (button.matches("[data-delete-table-topic]")) {
    await deleteTableTopic(button.dataset.deleteTableTopic);
  } else if (button.matches("[data-open-voting-console]")) {
    await openVotingConsole();
  } else if (button.matches("[data-close-voting-console]")) {
    closeVotingConsole();
  } else if (button.matches("[data-refresh-voting-console]")) {
    await refreshVotingConsole();
  } else if (button.matches("[data-voting-prepare]")) {
    await runVotingAction("prepare");
  } else if (button.matches("[data-voting-sync]")) {
    await runVotingAction("sync");
  } else if (button.matches("[data-voting-results]")) {
    await runVotingAction("results");
  } else if (button.matches("[data-voting-clear]")) {
    await runVotingAction("clear");
  } else if (button.matches("[data-voting-authorize]")) {
    await runVotingAction("authorize");
  } else if (button.matches("[data-save-table-topics]")) {
    await saveTableTopicsSpeakers();
  } else if (button.matches("[data-refresh-awards]")) {
    await loadAwards();
  } else {
    return false;
  }
  return true;
}

export async function handleSubmit(form, event) {
  if (form.matches("[data-table-topics-form]")) {
    event.preventDefault();
    const topicText = String(new FormData(form).get("topicText") || "").trim();
    form.reset();
    await addTableTopic(topicText);
  } else {
    return false;
  }
  return true;
}

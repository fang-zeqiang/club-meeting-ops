import { externalPresentationUrlError } from "../../external-presentation-url.js";
import { PRESENTATION_THEMES } from "../../presentation-themes.js";
import { roleIdentity } from "../../role-awards.js";
import { PRESENTATION_PHASE_OPTIONS } from "../../presentation-phases.js";
import { esc } from "../shared/html.js";
import { autofillAgendaOfficer, getValidation, memberIdForName, selectedBlock, syncLinkedAgendaItem } from "./derivations.js";
import { apiJson } from "./api.js";
import { notify, refreshDerivedRegions, refreshStructure, renderOverlayRegion, replaceRegion, withUiContinuity } from "./render-engine.js";
import { markDirty, runtime, state, uid } from "./state.js";

const WOD_DETAIL_KEYS = ["pronunciation", "partOfSpeech", "definition", "usage", "example"];
let wodAutofillBusy = false;

const rerenderMeta = () => withUiContinuity(() => replaceRegion("meta", renderMetaEditor()), "meta:wordOfDay.definition");

// 补全结果只写进表单并标记未保存，由用户核对后随议程一起保存
async function autofillWordOfDay() {
  const current = state.meeting.wordOfDay;
  if (!current.word.trim()) return notify("请先填写单词");
  if (WOD_DETAIL_KEYS.some((key) => String(current[key] || "").trim())
    && !window.confirm("自动补全会覆盖已填写的音标、词性、释义、用法和例句，继续吗？")) return;
  wodAutofillBusy = true;
  rerenderMeta();
  try {
    const { source, wordOfDay } = await apiJson(`/api/meetings/${encodeURIComponent(state.meeting.id)}?action=wod-autofill`, {
      method: "POST",
      body: JSON.stringify({ word: current.word }),
    });
    Object.assign(state.meeting.wordOfDay, Object.fromEntries(WOD_DETAIL_KEYS.map((key) => [key, wordOfDay[key] || ""])));
    if (source === "word_bank") state.meeting.wordOfDay.word = wordOfDay.word;
    markDirty();
    notify(source === "ai" ? "已用 AI 补全单词卡，请核对后保存" : "已从 WOD 词库补全，请核对后保存");
  } catch (error) {
    notify(error.message);
  } finally {
    wodAutofillBusy = false;
    rerenderMeta();
    refreshDerivedRegions();
  }
}

function updateField(path, value) {
  const parts = path.split(".");
  let target = state.meeting;
  parts.slice(0, -1).forEach((key) => (target = target[key]));
  target[parts.at(-1)] = value;
  markDirty();
  refreshDerivedRegions();
}

function renderField(label, path, value, options = {}) {
  const span = options.span ? " span-2" : "";
  const type = options.type || "text";
  const focusKey = `meta:${path}`;
  if (options.checkbox) {
    return `<div class="field checkbox-field${span}"><label><input data-path="${path}" data-focus-key="${focusKey}" type="checkbox" ${value ? "checked" : ""} /><span>${label}</span></label></div>`;
  }
  if (options.select) {
    return `<div class="field${span}"><label>${label}</label><select data-path="${path}" data-focus-key="${focusKey}">${options.select
      .map((option) => `<option value="${esc(option.value)}" ${option.value === value ? "selected" : ""}>${esc(option.label)}</option>`)
      .join("")}</select></div>`;
  }
  if (options.textarea) {
    return `<div class="field${span}"><label>${label}</label><textarea data-path="${path}" data-focus-key="${focusKey}">${esc(value)}</textarea></div>`;
  }
  return `<div class="field${span}"><label>${label}</label><input data-path="${path}" data-focus-key="${focusKey}" type="${type}" value="${esc(value)}" /></div>`;
}

export function renderMemberSelect(label, selectedId, attributes, { span = false, allowGuest = false, allowEmpty = true, disabled = false, selectedLabel = "", className = "" } = {}) {
  const selectedName = state.members.find((member) => member.id === selectedId)?.displayName || selectedLabel;
  return `<div class="field${span ? " span-2" : ""}${className ? ` ${esc(className)}` : ""}"><label>${label}</label><button class="member-picker-trigger" type="button" data-open-member-picker data-picker-label="${esc(label)}" data-selected-id="${esc(selectedId)}" data-selected-label="${esc(selectedName)}" data-allow-empty="${allowEmpty}" data-allow-guest="${allowGuest}" ${attributes} ${disabled ? "disabled" : ""} aria-haspopup="dialog"><span>${esc(selectedName || "None / Unassigned")}</span><i aria-hidden="true">⌄</i></button>${state.membersLoading ? '<small class="member-picker-status">Syncing members…</small>' : ""}</div>`;
}

function renderSupportRolesEditor() {
  return `<div class="subsection">
    <div class="subsection-heading">
      <h3>Support roles</h3>
      <p>Meeting-level roles shown in the first-page sidebar.</p>
    </div>
    <div class="form-grid">
      ${renderMemberSelect("Photographer", state.meeting.photographerMemberId, 'data-meeting-member-key="photographer" data-focus-key="meeting-role:photographer"', { allowGuest: true, selectedLabel: state.meeting.photographer })}
      ${renderMemberSelect("Meeting Manager", state.meeting.meetingManagerMemberId, 'data-meeting-member-key="meetingManager" data-focus-key="meeting-role:meetingManager"', { allowGuest: true, selectedLabel: state.meeting.meetingManager })}
      ${(state.meeting.offAgendaRoles || []).map((entry, index) => renderMemberSelect(entry.role, entry.memberId, `data-off-agenda-role-index="${index}" data-focus-key="off-agenda-role:${index}"`, { allowGuest: true, selectedLabel: entry.member })).join("")}
    </div>
  </div>`;
}

export function renderMetaEditor() {
  const m = state.meeting;
  return `
    <section class="section-card" data-region="meta" data-scroll-anchor="meta">
      <div class="section-heading"><div><span class="eyebrow">Meeting setup</span><h2>Meeting details</h2></div></div>
      <div class="section-content form-grid">
        ${renderField("Meeting no.", "meetingNumber", m.meetingNumber, { type: "number" })}
        ${renderField("Date", "date", m.date, { type: "date" })}
        ${renderField("Start time", "startTime", m.startTime, { type: "time" })}
        ${renderField("Theme", "theme", m.theme, { span: true })}
        ${renderField("Venue", "venue", m.venue, { span: true })}
        ${renderField("Presentation theme", "presentationTheme", m.presentationTheme, { span: true, select: PRESENTATION_THEMES.map((theme) => ({ value: theme.id, label: theme.label })) })}
        ${renderField("Enable transition time", "enableTransitionTime", m.enableTransitionTime, { checkbox: true, span: true })}
        <div class="field"><label>Word of the day</label><div class="field-inline"><input data-path="wordOfDay.word" data-focus-key="meta:wordOfDay.word" type="text" value="${esc(m.wordOfDay.word)}" /><button type="button" class="button" data-autofill-wod data-focus-key="meta:autofill-wod" ${wodAutofillBusy ? "disabled" : ""}>${wodAutofillBusy ? "补全中" : "自动补全"}</button></div></div>
        ${renderField("Pronunciation", "wordOfDay.pronunciation", m.wordOfDay.pronunciation)}
        ${renderField("词性", "wordOfDay.partOfSpeech", m.wordOfDay.partOfSpeech)}
        ${renderField("释义", "wordOfDay.definition", m.wordOfDay.definition, { span: true, textarea: true })}
        ${renderField("用法", "wordOfDay.usage", m.wordOfDay.usage, { span: true, textarea: true })}
        ${renderField("Example sentence", "wordOfDay.example", m.wordOfDay.example, { span: true, textarea: true })}
        ${renderField("Voting code", "votingCode", m.votingCode, { span: true })}
      </div>
      <div class="section-content section-content-divider">
        ${renderSupportRolesEditor()}
      </div>
    </section>`;
}

export function renderBlockList() {
  return `
    <section class="section-card" data-region="block-list" data-scroll-anchor="block-list">
      <div class="section-heading"><div><span class="eyebrow">Agenda structure</span><h2>Blocks</h2></div></div>
      <div class="section-content">
        <div class="block-list">
          ${state.meeting.blocks
            .map(
              (block, index) => `
                <div class="block-row ${block.id === state.selectedBlockId ? "active" : ""}">
                  <span class="block-index">${index + 1}</span>
                  <button class="block-copy" data-select-block="${block.id}" data-focus-key="block-select:${block.id}" type="button">
                    <strong>${esc(block.title)}</strong>
                    <span>${block.items.length} items · ${block.items.reduce((sum, item) => sum + Number(item.duration || 0), 0)} min</span>
                  </button>
                  <div class="block-actions">
                    <button class="icon-button" data-move-block="${block.id}" data-direction="-1" data-focus-key="block-move:${block.id}:-1" title="Move up">↑</button>
                    <button class="icon-button" data-move-block="${block.id}" data-direction="1" data-focus-key="block-move:${block.id}:1" title="Move down">↓</button>
                  </div>
                </div>`,
            )
            .join("")}
        </div>
        <div class="add-row">
          <button class="button" data-add-block data-focus-key="add-block">+ Add block</button>
          <button class="button" data-duplicate-block data-focus-key="duplicate-block">Duplicate</button>
        </div>
      </div>
    </section>`;
}

function renderItemEditor(item, index) {
  const showsSpeechObjective = selectedBlock()?.type === "prepared_speeches" && item.kind === "speech";
  const isBreak = item.kind === "break";
  const role = roleIdentity(item.role, item.roleId);
  return `
    <article class="item-card ${isBreak ? "item-break" : "has-assignment"}">
      <div class="item-card-head">
        <span class="item-kind ${isBreak ? "break" : ""}">${isBreak ? '<span class="break-mark">Ⅱ</span>' : `<span class="status-dot ${item.status}"></span>`}${esc(item.kind)} ${index + 1}</span>
        <div class="item-actions">
          <button class="icon-button" data-move-item="${item.id}" data-direction="-1" data-focus-key="item-move:${item.id}:-1">↑</button>
          <button class="icon-button" data-move-item="${item.id}" data-direction="1" data-focus-key="item-move:${item.id}:1">↓</button>
          <button class="icon-button" data-delete-item="${item.id}" data-focus-key="item-delete:${item.id}" title="Delete">×</button>
        </div>
      </div>
      <div class="form-grid">
        ${renderItemField(item, isBreak ? "Session" : "Session / speech title", "session", { span: true })}
        ${isBreak ? "" : renderRoleField(item, role)}
        ${item.kind === "role" ? renderItemField(item, "投屏展示类型", "presentationPhase", { span: true, select: PRESENTATION_PHASE_OPTIONS }) : ""}
        ${renderItemField(item, "Duration (min)", "duration", { type: "number" })}
        ${isBreak ? "" : renderMemberField(item, "Member", "member")}
        ${isBreak ? "" : renderItemField(item, "Status", "status", { select: ["confirmed", "pending", "vacant"] })}
        ${item.kind === "speech" ? renderMemberField(item, "Evaluator", "evaluator") : ""}
        ${item.kind === "speech" ? renderItemField(item, "Evaluator status", "evaluatorStatus", { select: ["confirmed", "pending", "vacant"] }) : ""}
        ${showsSpeechObjective ? renderSpeechDetailsEditor(item) : ""}
        ${renderItemField(item, "External presentation URL (public)", "externalPresentationUrl", { span: true, type: "url", externalUrl: true, placeholder: "https://… or http://…", info: "Paste one public HTTP or HTTPS presentation link. It appears as an embedded slide after this agenda item." })}
      </div>
    </article>`;
}

function renderSpeechDetailsEditor(item) {
  const catalog = state.pathwaysCatalog;
  const draftKey = `${state.meeting.id}:${item.id}`;
  const details = state.pathwaysDrafts[draftKey] || item;
  const mode = details.pathwaysMode || "";
  const option = (value, label, selected) => `<option value="${esc(value)}" ${value === selected ? "selected" : ""}>${esc(label)}</option>`;
  const activeOrSelected = (entry, id, key) => entry.active || entry[key] === id;
  const pathProjects = catalog && details.pathwaysPath
    ? catalog.projects.filter((project) => activeOrSelected(project, details.pathwaysProjectId, "projectId") && [...project.requiredPaths, ...project.electivePaths].includes(details.pathwaysPath))
    : [];
  const levels = [...new Set(pathProjects.map((project) => project.level))].sort();
  const projects = pathProjects.filter((project) => project.level === details.pathwaysLevel);
  const project = projects.find((candidate) => candidate.projectId === details.pathwaysProjectId);
  const forms = catalog && project ? catalog.forms.filter((form) => activeOrSelected(form, details.pathwaysFormId, "formId") && form.projectId === project.projectId) : [];
  const form = forms.find((candidate) => candidate.formId === details.pathwaysFormId) || (forms.length === 1 ? forms[0] : null);
  const select = (label, key, values, selected, disabled = false) => `<label class="field"><span>${esc(label)}</span><select data-speech-item="${esc(item.id)}" data-speech-key="${esc(key)}" ${disabled ? "disabled" : ""}><option value="">Select…</option>${values.map((entry) => option(entry.value, entry.label, selected)).join("")}</select></label>`;
  const legacy = !mode && details.speechObjective ? `<p class="agenda-speech-warning">Legacy objective: ${esc(details.speechObjective)}. Choose Pathways or Custom to update it.</p>` : "";
  const required = !mode ? '<p class="agenda-speech-warning required">Choose Pathways or Custom before finalizing this Agenda.</p>' : "";
  const fields = mode === "pathways"
    ? catalog
      ? `<div class="agenda-path-level">${select("Path", "pathwaysPath", catalog.paths.map((value) => ({ value, label: value })), details.pathwaysPath)}
        ${select("Level", "pathwaysLevel", levels.map((value) => ({ value, label: `Level ${value}` })), details.pathwaysLevel, !details.pathwaysPath)}</div>
        ${select("Project", "pathwaysProjectId", projects.map((value) => ({ value: value.projectId, label: value.name })), details.pathwaysProjectId, !details.pathwaysLevel)}
        ${forms.length === 1 ? "" : select("Speech variant", "pathwaysFormId", forms.map((value) => ({ value: value.formId, label: value.variant })), details.pathwaysFormId, !project)}
        <label class="field"><span>Official speech purpose</span><textarea rows="4" readonly>${esc(form?.speechPurpose || (forms.length > 1 ? "Select a speech variant." : "Select a project."))}</textarea></label>`
      : '<p class="agenda-speech-warning">Pathways Catalog unavailable. Choose Custom.</p>'
    : mode === "custom"
      ? `<label class="field"><span>Custom speech objective</span><textarea rows="4" data-item="${esc(item.id)}" data-item-key="speechObjective" maxlength="1000">${esc(details.speechObjective)}</textarea></label>`
      : "";
  const modeChoice = (value, label) => `<label><input type="radio" name="speech-mode-${esc(item.id)}" value="${esc(value)}" data-speech-item="${esc(item.id)}" data-speech-key="pathwaysMode" ${value === mode ? "checked" : ""}><span>${esc(label)}</span></label>`;
  return `<section class="agenda-speech-card span-2">
    <header><div><span class="eyebrow">Prepared speech</span><h4>Speech details</h4></div><small>Same information used in Role Book</small></header>
    <div class="agenda-speech-fields">${legacy}${required}<div class="agenda-speech-type"><span>Speech type</span><div class="agenda-speech-modes mode-${mode || "required"}" role="radiogroup" aria-label="Speech type" tabindex="-1" data-focus-key="item:${esc(item.id)}:speech-type">
      ${modeChoice("pathways", "Pathways")}${modeChoice("custom", "Custom")}
    </div></div>${fields}</div>
  </section>`;
}

function renderMemberField(item, label, key, span = false, disabled = false) {
  const idKey = `${key}Id`;
  const selectedId = item[idKey] || memberIdForName(item[key]);
  return renderMemberSelect(
    label,
    selectedId,
    `data-member-item="${item.id}" data-member-key="${key}" data-focus-key="item:${item.id}:${key}"`,
    { span, allowGuest: true, selectedLabel: item[key], className: `item-field-${key}`, disabled },
  );
}

function roleCatalogMatch(value) {
  const normalized = String(value || "").trim().toLocaleLowerCase();
  return state.roles.find((role) => [role.name, ...(role.aliases || [])].some((name) => String(name).trim().toLocaleLowerCase() === normalized));
}

function renderRoleField(item, identity) {
  const current = String(item.role || "");
  const match = roleCatalogMatch(current);
  const exact = match?.name === current;
  const currentOption = current && !exact
    ? `<option value="${esc(current)}" selected>Current · ${esc(current)}${match ? ` → ${esc(match.name)}` : " · Legacy"}</option>`
    : "";
  const options = state.roles.map((role) => `<option value="${esc(role.name)}" ${role.name === current ? "selected" : ""}>${esc(role.name)}</option>`).join("");
  const status = state.rolesLoading
    ? "<small>Loading role catalog…</small>"
    : state.rolesError
      ? `<small class="role-catalog-error" title="${esc(state.rolesError)}">Role catalog unavailable · <button type="button" data-retry-roles>Retry</button></small>`
      : `<small>${identity.standard ? `Recognized as ${esc(identity.label)}` : match ? `Matches ${esc(match.name)}` : current ? "Legacy role" : "Choose an active RoleCatalog role"}</small>`;
  return `<div class="field item-field-role"><div class="field-label"><label for="item-${esc(item.id)}-role">Role title</label></div>
    <select id="item-${esc(item.id)}-role" data-role-item="${esc(item.id)}" data-focus-key="item:${esc(item.id)}:role" ${state.rolesLoading || state.rolesError ? "disabled" : ""}>
      ${current ? "" : '<option value="" selected>Select role…</option>'}${currentOption}${options}${state.rolesLoading || state.rolesError ? "" : '<option value="__add_role__">＋ Add new role…</option>'}
    </select>${status}</div>`;
}

function renderItemField(item, label, key, options = {}) {
  const span = options.span ? " span-2" : "";
  const fieldClass = `field${span} item-field-${key}`;
  const inputId = `item-${item.id}-${key}`;
  const fieldLabel = `<div class="field-label"><label for="${esc(inputId)}">${esc(label)}</label>${options.info ? `<button class="field-info" type="button" aria-label="${esc(options.info)}" data-tooltip="${esc(options.info)}">i</button>` : ""}</div>`;
  if (options.select) {
    return `<div class="${fieldClass}">${fieldLabel}<select id="${esc(inputId)}" data-item="${item.id}" data-item-key="${key}" data-focus-key="item:${item.id}:${key}">${options.select
      .map((option) => {
        const value = typeof option === "object" ? option.value : option;
        const label = typeof option === "object" ? option.label : option || "Select member";
        return `<option value="${esc(value)}" ${value === (item[key] || "") ? "selected" : ""}>${esc(label)}</option>`;
      })
      .join("")}</select></div>`;
  }
  if (options.textarea) {
    return `<div class="${fieldClass}">${fieldLabel}<textarea id="${esc(inputId)}" data-item="${item.id}" data-item-key="${key}" data-focus-key="item:${item.id}:${key}" placeholder="Describe what the speaker wants to practice or achieve…">${esc(item[key])}</textarea></div>`;
  }
  const errorId = `${inputId}-error`;
  return `<div class="${fieldClass}">${fieldLabel}<input id="${esc(inputId)}" data-item="${item.id}" data-item-key="${key}" data-focus-key="item:${item.id}:${key}" type="${options.type || "text"}" ${options.externalUrl ? `data-external-presentation-url aria-describedby="${esc(errorId)}"` : ""} ${options.list ? `list="${esc(options.list)}"` : ""} ${options.placeholder ? `placeholder="${esc(options.placeholder)}"` : ""} value="${esc(item[key])}" />${options.externalUrl ? `<small class="external-url-error" id="${esc(errorId)}" role="alert" hidden></small>` : options.help ? `<small>${esc(options.help)}</small>` : ""}</div>`;
}

export function renderBlockEditor() {
  const block = selectedBlock();
  if (!block) return "";
  return `
    <section class="section-card" data-region="block-editor" data-scroll-anchor="block-editor">
      <div class="section-heading">
        <div><span class="eyebrow">${esc(block.type)}</span><h2>Edit selected block</h2></div>
        <button class="button danger" data-delete-block data-focus-key="delete-block">Delete block</button>
      </div>
      <div class="section-content">
        <div class="form-grid">
          <div class="field span-2"><label>Block title</label><input data-block-key="title" data-focus-key="block:${block.id}:title" value="${esc(block.title)}" /></div>
          <div class="field span-2"><label>Block type</label><select data-block-key="type" data-focus-key="block:${block.id}:type">
            ${["opening", "table_topics", "prepared_speeches", "evaluation", "break", "closing", "custom"].map((type) => `<option ${block.type === type ? "selected" : ""}>${type}</option>`).join("")}
          </select></div>
        </div>
        <div style="margin-top:12px">
          ${block.items.map(renderItemEditor).join("")}
        </div>
        <div class="add-row">
          <button class="button" data-add-item="role" data-focus-key="add-item:role">+ Role item</button>
          <button class="button" data-add-item="speech" data-focus-key="add-item:speech">+ Speech item</button>
          <button class="button" data-add-item="break" data-focus-key="add-item:break">+ Break</button>
        </div>
      </div>
    </section>`;
}

export function renderValidation() {
  const issues = getValidation();
  return `
    <section class="section-card validation-card ${state.highlightReviewItems ? "is-highlighted" : ""}" data-region="validation" data-scroll-anchor="validation">
      <div class="section-heading validation-head">
        <div><span class="eyebrow">Readiness check</span><h2>Validation</h2></div>
        <strong>${issues.length}</strong>
      </div>
      <div class="section-content validation-list">
        ${
          issues.length
            ? issues.map((issue, index) => `<button class="validation-item ${issue.type}" data-issue-index="${index}"><strong>${issue.type === "error" ? "!" : "•"}</strong><span>${esc(issue.text)}</span></button>`).join("")
            : '<div class="validation-item ok"><strong>✓</strong><span>Agenda is ready to publish.</span></div>'
        }
      </div>
    </section>`;
}

function moveInList(list, id, direction, focusKey = "") {
  const index = list.findIndex((entry) => entry.id === id);
  const next = index + direction;
  if (index < 0 || next < 0 || next >= list.length) return;
  [list[index], list[next]] = [list[next], list[index]];
  markDirty();
  refreshStructure(focusKey);
}

function addBlock() {
  const block = { id: uid("block"), type: "custom", title: "New Session", items: [] };
  state.meeting.blocks.push(block);
  state.selectedBlockId = block.id;
  markDirty();
  refreshStructure(`block:${block.id}:title`);
}

function duplicateBlock() {
  const source = selectedBlock();
  if (!source) return;
  const clone = structuredClone(source);
  clone.id = uid("block");
  clone.title = `${clone.title} Copy`;
  const itemIds = new Map(clone.items.map((item) => [item.id, uid("item")]));
  clone.items.forEach((item) => {
    item.id = itemIds.get(item.id);
    if (item.linkedSpeechId) item.linkedSpeechId = itemIds.get(item.linkedSpeechId) || "";
    if (item.roleAssignmentId) item.roleAssignmentId = `${item.roleAssignmentId}-${clone.id}`;
  });
  state.meeting.blocks.splice(state.meeting.blocks.indexOf(source) + 1, 0, clone);
  state.selectedBlockId = clone.id;
  markDirty();
  refreshStructure(`block:${clone.id}:title`);
}

function deleteBlock() {
  if (state.meeting.blocks.length === 1) return notify("An agenda needs at least one block.");
  const index = state.meeting.blocks.findIndex((block) => block.id === state.selectedBlockId);
  state.meeting.blocks.splice(index, 1);
  state.selectedBlockId = state.meeting.blocks[Math.max(0, index - 1)].id;
  markDirty();
  refreshStructure(`block:${state.selectedBlockId}:title`);
}

function addItem(kind) {
  const isBreak = kind === "break";
  const item = {
    id: uid("item"),
    kind,
    duration: isBreak ? 5 : kind === "speech" ? 7 : 3,
    session: isBreak ? "Break" : kind === "speech" ? "Prepared Speech" : "New Agenda Item",
    role: isBreak ? "" : kind === "speech" ? "Prepared Speaker" : "Role",
    member: "",
    evaluator: "",
    evaluatorStatus: kind === "speech" ? "vacant" : "",
    speechObjective: "",
    externalPresentationUrl: "",
    status: isBreak ? "" : "vacant",
  };
  selectedBlock().items.push(item);
  if (kind === "speech") {
    const evaluation = state.meeting.blocks.find((block) => block.type === "evaluation");
    if (evaluation) evaluation.items.push({
      id: uid("item"), kind: "role", duration: 3,
      session: `Speech Evaluation ${state.meeting.blocks.flatMap((block) => block.items).filter((candidate) => candidate.kind === "speech").length}`,
      role: "Individual Evaluator", member: "", memberId: "", status: "vacant", linkedSpeechId: item.id,
    });
  }
  markDirty();
  refreshStructure(`item:${item.id}:session`);
}

function deleteItem(itemId) {
  const items = selectedBlock().items;
  const index = items.findIndex((item) => item.id === itemId);
  if (index < 0) return;
  const [removed] = items.splice(index, 1);
  if (removed.kind === "speech") state.meeting.blocks.forEach((block) => {
    block.items = block.items.filter((item) => item.linkedSpeechId !== removed.id);
  });
  const next = items[Math.min(index, items.length - 1)];
  markDirty();
  refreshStructure(next ? `item:${next.id}:session` : `add-item:${removed.kind}`);
}

export async function handleChange(input, event) {
  if (input.matches("[data-path]")) {
    const value = input.type === "checkbox" ? input.checked : input.type === "number" ? Number(input.value) : input.value;
    updateField(input.dataset.path, value);
    return true;
  }
  if (input.matches("[data-block-key]")) {
    selectedBlock()[input.dataset.blockKey] = input.value;
    markDirty();
    refreshDerivedRegions({ blockList: true });
    return true;
  }
  if (input.matches("[data-speech-item]")) {
    const item = selectedBlock().items.find((candidate) => candidate.id === input.dataset.speechItem);
    const draftKey = `${state.meeting.id}:${item.id}`;
    const draft = { ...item, ...(state.pathwaysDrafts[draftKey] || {}) };
    const key = input.dataset.speechKey;
    draft[key] = input.value;
    if (key === "pathwaysMode") {
      draft.pathwaysPath = "";
      draft.pathwaysLevel = "";
      draft.pathwaysProjectId = "";
      draft.pathwaysFormId = "";
      if (input.value !== "custom") draft.speechObjective = "";
      if (input.value === "custom" && /^\[Pathways /m.test(draft.speechObjective)) {
        draft.speechObjective = draft.speechObjective.match(/^\[Speech Objective\]\s*(.*)$/m)?.[1] || "";
      }
    }
    if (key === "pathwaysPath") Object.assign(draft, { pathwaysLevel: "", pathwaysProjectId: "", pathwaysFormId: "", speechObjective: "" });
    if (key === "pathwaysLevel") Object.assign(draft, { pathwaysProjectId: "", pathwaysFormId: "", speechObjective: "" });
    if (key === "pathwaysProjectId") {
      Object.assign(draft, { pathwaysFormId: "", speechObjective: "" });
      const forms = state.pathwaysCatalog?.forms.filter((candidate) => candidate.projectId === input.value) || [];
      if (forms.length === 1) Object.assign(draft, { pathwaysFormId: forms[0].formId, speechObjective: forms[0].speechPurpose || "" });
    }
    if (key === "pathwaysFormId") {
      const form = state.pathwaysCatalog?.forms.find((candidate) => candidate.formId === input.value);
      draft.speechObjective = form?.speechPurpose || "";
    }
    const complete = draft.pathwaysMode !== "pathways" || Boolean(draft.pathwaysPath && draft.pathwaysLevel && draft.pathwaysProjectId && draft.pathwaysFormId);
    if (complete) {
      Object.assign(item, draft);
      delete state.pathwaysDrafts[draftKey];
      markDirty();
    } else state.pathwaysDrafts[draftKey] = draft;
    refreshStructure(`item:${item.id}:${key}`);
    return true;
  }
  if (input.matches("[data-role-item]")) {
    const item = selectedBlock().items.find((candidate) => candidate.id === input.dataset.roleItem);
    if (input.value === "__add_role__") {
      runtime.overlayReturnFocusKey = `item:${item.id}:role`;
      state.rolePrompt = { itemId: item.id, name: "", error: "", busy: false };
      renderOverlayRegion();
      return true;
    }
    const previousRoleId = item.roleId;
    item.role = input.value;
    item.roleId = roleIdentity(item.role).id;
    autofillAgendaOfficer(item, item.role);
    syncLinkedAgendaItem(item, "role", previousRoleId);
    markDirty();
    refreshDerivedRegions({ blockList: true });
    return true;
  }
  if (input.matches("[data-external-presentation-url]")) {
    const error = externalPresentationUrlError(input.value);
    const message = input.parentElement.querySelector(".external-url-error");
    input.setCustomValidity(error);
    input.setAttribute("aria-invalid", String(Boolean(error)));
    message.hidden = !error;
    message.textContent = error;
    if (error) {
      if (event.type === "change") input.reportValidity();
      return true;
    }
    const item = selectedBlock().items.find((candidate) => candidate.id === input.dataset.item);
    const value = input.value.trim();
    if (item.externalPresentationUrl === value) return true;
    item.externalPresentationUrl = value;
    markDirty();
    return true;
  }
  if (input.matches("[data-item]")) {
    const item = selectedBlock().items.find((candidate) => candidate.id === input.dataset.item);
    const previousRoleId = item.roleId;
    item[input.dataset.itemKey] = input.type === "number" ? Number(input.value) : input.value;
    if (input.dataset.itemKey === "role") {
      item.roleId = roleIdentity(item.role).id;
      autofillAgendaOfficer(item, item.role);
    }
    syncLinkedAgendaItem(item, input.dataset.itemKey, previousRoleId);
    markDirty();
    refreshDerivedRegions({ blockList: true });
    return true;
  }
  return false;
}

export async function handleClick(button, event) {
  if (button.matches("[data-select-block]")) {
    state.selectedBlockId = button.dataset.selectBlock;
    refreshStructure(button.dataset.focusKey);
  } else if (button.matches("[data-move-block]")) {
    moveInList(state.meeting.blocks, button.dataset.moveBlock, Number(button.dataset.direction), button.dataset.focusKey);
  } else if (button.matches("[data-move-item]")) {
    moveInList(selectedBlock().items, button.dataset.moveItem, Number(button.dataset.direction), button.dataset.focusKey);
  } else if (button.matches("[data-delete-item]")) {
    deleteItem(button.dataset.deleteItem);
  } else if (button.matches("[data-add-block]")) {
    addBlock();
  } else if (button.matches("[data-duplicate-block]")) {
    duplicateBlock();
  } else if (button.matches("[data-delete-block]")) {
    deleteBlock();
  } else if (button.matches("[data-add-item]")) {
    addItem(button.dataset.addItem);
  } else if (button.matches("[data-autofill-wod]")) {
    await autofillWordOfDay();
  } else {
    return false;
  }
  return true;
}

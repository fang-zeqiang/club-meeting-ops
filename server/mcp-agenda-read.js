import { signAgendaImageLink } from "./agenda-image-link.js";
import { ApiError } from "./bitable.js";
import { getGlobalAssetImage } from "./media-repository.js";
import { startsAtTimestamp } from "./meeting-schema.js";
import { getMeeting, listMeetings } from "./meetings-repository.js";
import { getPathwaysCatalog } from "./pathways-repository.js";
import { SIGNUP_DEFAULT_VACANCY_MARKER, validateVacancyEmoji } from "../vacancy-emoji.js";
import { ROLE_AWARD_POOLS, roleAwardConfig, roleEntries, roleIdentity } from "../role-awards.js";
import { shanghaiDate } from "../workflow-helpers.js";

const READ_ONLY = Object.freeze({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
const MEETING_NUMBER = { type: "integer", minimum: 1, description: "Agenda meeting number. Optional; defaults to the nearest active meeting." };
const MEETING_REFERENCE = { type: "string", enum: ["today", "next"], description: "Today or the nearest future meeting in Asia/Shanghai. Use this instead of guessing a date range with vpe_list_meetings when the user says 今天/下次/下周 relative to no stated meeting number. Pass either this or meeting_number, not both." };
const LANGUAGE = { type: "string", enum: ["zh-CN", "en", "bilingual"], description: "Output language. Defaults to bilingual." };
const FUNCTIONAL_ROLES = new Set(["timer", "grammarian", "ah-counter"]);

export const meetingSchema = (properties = {}) => ({
  type: "object",
  properties: { meeting_number: MEETING_NUMBER, meeting_reference: MEETING_REFERENCE, ...properties },
  additionalProperties: false,
});

export const AGENDA_READ_TOOLS = Object.freeze([
  {
    name: "vpe_list_meetings",
    title: "查询 Agenda 会议",
    description: "Find VPE Agenda meetings by status or date. Use before choosing a meeting when the user gives no meeting number.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["active", "draft", "final", "archived", "all"], description: "Defaults to active (non-archived)." },
        date_from: { type: "string", format: "date", description: "Optional inclusive start date, YYYY-MM-DD." },
        date_to: { type: "string", format: "date", description: "Optional inclusive end date, YYYY-MM-DD." },
        limit: { type: "integer", minimum: 1, maximum: 20, description: "Defaults to 10." },
      },
      additionalProperties: false,
    },
    annotations: READ_ONLY,
  },
  {
    name: "vpe_get_meeting_overview",
    title: "读取会议概况",
    description: "Read one meeting’s theme, time, status, support roles, agenda counts, and vacancy counts without changing Agenda.",
    inputSchema: meetingSchema(),
    annotations: READ_ONLY,
  },
  {
    name: "vpe_generate_signup_text",
    title: "从 Agenda 生成微信群接龙",
    description: "Generate copy-ready WeChat signup text from current Agenda order. Assigned people keep their names; vacancies default to 🌸🌸🌸, with a caller-selected emoji and count supported. Never invent or assign people.",
    inputSchema: meetingSchema({
      language: LANGUAGE,
      vacancy_emoji: { type: "string", minLength: 1, maxLength: 256, description: "Full vacancy marker containing 1–8 complete Emoji graphemes. Repeated input such as 🙋🙋🙋 is used exactly as supplied. Defaults to 🌸🌸🌸." },
      vacancy_emoji_count: { type: "integer", minimum: 1, maximum: 5, description: "Repeat vacancy_emoji 1–5 times only when the emoji is supplied once. Omit when vacancy_emoji already contains the intended repetitions." },
      include_pending: { type: "boolean", description: "Show pending assignments with ⏳. Defaults to true; false treats them as vacant." },
      include_speech_details: { type: "boolean", description: "Include prepared speech titles. Defaults to false." },
    }),
    annotations: READ_ONLY,
  },
  {
    name: "vpe_list_role_vacancies",
    title: "查询会议空缺角色",
    description: "List vacant meeting roles, prepared speakers, evaluators, Meeting Manager, and Photographer. Linked Intro/Report rows are merged.",
    inputSchema: meetingSchema({
      include_pending: { type: "boolean", description: "Treat pending assignments as filled. Defaults to true." },
    }),
    annotations: READ_ONLY,
  },
  {
    name: "vpe_generate_vacancy_call_text",
    title: "生成空缺角色招募文本",
    description: "Generate a short copy-ready group message containing only current vacancies. Vacancy emoji and repeat count are configurable; no member recommendation or write occurs.",
    inputSchema: meetingSchema({
      language: LANGUAGE,
      vacancy_emoji: { type: "string", minLength: 1, maxLength: 256, description: "Full vacancy marker containing 1–8 complete Emoji graphemes. Repeated input such as 🙋🙋🙋 is used exactly as supplied. Defaults to 🈳." },
      vacancy_emoji_count: { type: "integer", minimum: 1, maximum: 5, description: "Repeat vacancy_emoji 1–5 times only when the emoji is supplied once. Omit when vacancy_emoji already contains the intended repetitions." },
      include_pending: { type: "boolean", description: "Treat pending assignments as filled. Defaults to true." },
    }),
    annotations: READ_ONLY,
  },
  {
    name: "vpe_check_meeting_readiness",
    title: "检查会前准备状态",
    description: "Read Agenda and report Ready, Risk, and Next: required fields, agenda validity, vacancies, speech details, Voting readiness, duration, and required Future Poster.",
    inputSchema: meetingSchema({
      include_pending: { type: "boolean", description: "Treat pending assignments as filled. Defaults to true." },
    }),
    annotations: READ_ONLY,
  },
  {
    name: "vpe_get_meeting_links",
    title: "获取会议分享链接",
    description: "Return the public Presentation, Awards, Voting, Future Posters, Table Topics presentation deep link, guest browse, and editor links for one meeting.",
    inputSchema: meetingSchema(),
    annotations: READ_ONLY,
  },
  {
    name: "vpe_get_agenda_image",
    title: "获取 Agenda 长图分享链接",
    description: "Return a signed, time-limited PNG link of the agenda front page for sharing in group chats. The link expires in 24 hours and needs no login.",
    inputSchema: meetingSchema(),
    annotations: READ_ONLY,
  },
  {
    name: "vpe_get_agenda_pdf",
    title: "获取 Agenda PDF 下载链接",
    description: "Return a signed, time-limited PDF download link of the full printable Agenda (both A4 pages, same layout as print preview) for offline delivery or archiving. The link expires in 24 hours and needs no login.",
    inputSchema: meetingSchema(),
    annotations: READ_ONLY,
  },
  {
    name: "vpe_get_evaluation_forms",
    title: "获取备稿演讲评估表",
    description: "For each prepared speech in one meeting, return the assigned speaker and Individual Evaluator, the stated Pathways objective (project + level, or the custom free-text objective, or \"not set\"), and a downloadable evaluation form PDF link: the evaluation form for a Pathways project, or the club's generic evaluation resource for a custom objective. Reported as unavailable only when no matching form exists in the catalog.",
    inputSchema: meetingSchema(),
    annotations: READ_ONLY,
  },
]);

const READ_TOOL_NAMES = new Set(AGENDA_READ_TOOLS.map(({ name }) => name));

function objectArgs(raw, allowed) {
  const args = raw == null ? {} : raw;
  if (typeof args !== "object" || Array.isArray(args) || Object.keys(args).some((key) => !allowed.includes(key))) {
    throw new ApiError(400, "INVALID_ARGUMENTS", `Use only ${allowed.join(", ") || "an empty object"}.`);
  }
  return args;
}

function meetingNumber(args) {
  if (args.meeting_number != null && (!Number.isInteger(args.meeting_number) || args.meeting_number < 1)) {
    throw new ApiError(400, "INVALID_MEETING_NUMBER", "meeting_number must be a positive integer.");
  }
  return args.meeting_number || null;
}

function validDate(value, label) {
  if (value == null) return "";
  const timestamp = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? Date.parse(`${value}T00:00:00Z`) : NaN;
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) {
    throw new ApiError(400, "INVALID_DATE", `${label} must use YYYY-MM-DD.`);
  }
  return value;
}

function optionalBoolean(args, key) {
  if (args[key] != null && typeof args[key] !== "boolean") {
    throw new ApiError(400, "INVALID_ARGUMENTS", `${key} must be a boolean.`);
  }
}

function orderedMeetings(meetings) {
  const active = meetings.filter((meeting) => meeting.status !== "archived");
  const upcoming = active
    .filter((meeting) => meeting.status === "draft" && startsAtTimestamp(meeting.date, meeting.startTime) >= Date.now())
    .sort((a, b) => startsAtTimestamp(a.date, a.startTime) - startsAtTimestamp(b.date, b.startTime));
  const upcomingIds = new Set(upcoming.map(({ id }) => id));
  const recent = active.filter(({ id }) => !upcomingIds.has(id))
    .sort((a, b) => startsAtTimestamp(b.date, b.startTime) - startsAtTimestamp(a.date, a.startTime));
  return [...upcoming, ...recent];
}

export function referencedMeeting(meetings, reference, now = new Date()) {
  const today = shanghaiDate(now);
  if (reference === "today") {
    return meetings.filter((meeting) => meeting.date === today && meeting.status !== "archived");
  }
  if (reference === "next") {
    const future = meetings.filter((meeting) => meeting.date > today && meeting.status !== "archived")
      .sort((a, b) => `${a.date} ${a.startTime || "00:00"}`.localeCompare(`${b.date} ${b.startTime || "00:00"}`));
    return future.length ? future.filter((meeting) => meeting.date === future[0].date) : [];
  }
  throw new ApiError(400, "INVALID_MEETING_REFERENCE", "meeting_reference must be today or next.");
}

const meetingLabel = (meeting) => `#${meeting.meetingNumber} (${meeting.date})`;

// 期数与 today/next 同时传入时，只要期数落在 reference 命中范围内就放行（Agent 常先查到今天是哪期再一起传）；
// 不一致才拒绝，并写清两者各指向哪场，避免 Agent 拿到泛泛的报错后原样重试。
export function resolveMeetingSelector(meetings, requested, reference, now = new Date()) {
  const referenced = reference != null ? referencedMeeting(meetings, reference, now) : null;
  if (requested) {
    const matches = meetings.filter((meeting) => meeting.meetingNumber === requested);
    const active = matches.filter((meeting) => meeting.status !== "archived");
    if (active.length > 1 || (!active.length && matches.length > 1)) {
      throw new ApiError(409, "MEETING_NUMBER_AMBIGUOUS", `Meeting #${requested} is not unique.`);
    }
    const summary = active[0] || matches[0];
    if (!summary) throw new ApiError(404, "MEETING_NOT_FOUND", `Meeting #${requested} was not found.`);
    if (referenced && !referenced.includes(summary)) {
      const pointed = referenced.length ? referenced.map(meetingLabel).join(", ") : "no meeting";
      throw new ApiError(400, "INVALID_MEETING_SELECTOR", `meeting_number=${requested} is ${meetingLabel(summary)} but meeting_reference "${reference}" is ${pointed}. Pass only one of them.`);
    }
    return summary;
  }
  if (referenced) {
    if (referenced.length !== 1) {
      throw new ApiError(referenced.length ? 409 : 404, referenced.length ? "MEETING_SELECTOR_AMBIGUOUS" : "MEETING_NOT_FOUND", referenced.length ? `meeting_reference "${reference}" matched multiple meetings.` : `meeting_reference "${reference}" matched no meeting.`);
    }
    return referenced[0];
  }
  const summary = orderedMeetings(meetings)[0] || meetings[0];
  if (!summary) throw new ApiError(404, "MEETING_NOT_FOUND", "No meeting was found.");
  return summary;
}

export async function selectedMeeting(raw, allowed = ["meeting_number"]) {
  const args = objectArgs(raw, allowed);
  const requested = meetingNumber(args);
  const summary = resolveMeetingSelector(await listMeetings(), requested, args.meeting_reference);
  return { args, meeting: await getMeeting(summary.id) };
}

function rows(meeting) {
  return (meeting.blocks || []).flatMap((block) => (block.items || []).map((item) => ({ block, item })));
}

function assignedName(name, status, includePending) {
  const value = String(name || "").trim();
  if (!value || status === "vacant" || (!includePending && status === "pending")) return "";
  return value;
}

function assignmentEntries(meeting, includePending = true) {
  const all = rows(meeting);
  const speeches = all.filter(({ item }) => item.kind === "speech").map(({ item }) => item);
  const speechNumbers = new Map(speeches.map((speech, index) => [speech.id, index + 1]));
  const linkedEvaluators = new Set();
  const seen = new Set();
  const entries = [];

  for (const { item } of all) {
    if (item.kind === "break" || String(item.role || "").trim().toLocaleLowerCase() === "president") continue;
    if (item.kind === "speech") {
      entries.push({
        kind: "speaker",
        label: meeting.meetingType === "contest" ? `Prepared Speaker · ${item.session || speechNumbers.get(item.id)}` : item.role || `Prepared Speaker ${speechNumbers.get(item.id)}`,
        name: assignedName(item.member, item.status, includePending),
        status: item.status,
        session: item.session,
      });
      continue;
    }
    if (item.linkedSpeechId && speechNumbers.has(item.linkedSpeechId)) {
      linkedEvaluators.add(item.linkedSpeechId);
      entries.push({
        kind: "evaluator",
        label: `Individual Evaluator ${speechNumbers.get(item.linkedSpeechId)}`,
        name: assignedName(item.member, item.status, includePending),
        status: item.status,
        session: item.session,
      });
      continue;
    }
    const functional = FUNCTIONAL_ROLES.has(String(item.role || "").toLocaleLowerCase());
    const key = item.roleAssignmentId || (functional ? `functional:${String(item.role).toLocaleLowerCase()}` : item.id);
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({
      kind: "role",
      label: item.role || item.session,
      name: assignedName(item.member, item.status, includePending),
      status: item.status,
      session: item.session,
      awardRoleId: roleIdentity(item.role, item.roleId).id,
    });
  }

  (meeting.offAgendaRoles || []).filter((entry) => entry.signupOpen && !all.some(({ item }) => item.role === entry.role)).forEach((entry) => {
    entries.push({
      kind: "role",
      label: entry.role,
      name: String(entry.member || "").trim(),
      status: entry.memberId || entry.member ? "confirmed" : "vacant",
      session: "",
      awardRoleId: roleIdentity(entry.role).id,
    });
  });

  const hasEvaluationSession = (meeting.blocks || []).some((block) => block.type === "evaluation");
  speeches.filter((speech) => !linkedEvaluators.has(speech.id)
    && (meeting.meetingType !== "contest" || hasEvaluationSession || speech.evaluatorId || speech.evaluator)).forEach((speech) => {
    entries.push({
      kind: "evaluator",
      label: `Individual Evaluator ${speechNumbers.get(speech.id)}`,
      name: assignedName(speech.evaluator, speech.evaluatorStatus, includePending),
      status: speech.evaluatorStatus,
      session: speech.session,
    });
  });

  return entries;
}

export function meetingVacancies(meeting, { includePending = true } = {}) {
  const entries = [
    { kind: "support", label: "Meeting Manager", name: String(meeting.meetingManager || "").trim() },
    ...assignmentEntries(meeting, includePending),
    { kind: "support", label: "Photographer", name: String(meeting.photographer || "").trim() },
  ];
  const vacancies = entries.filter(({ name }) => !name).map(({ name: _name, awardRoleId: _awardRoleId, ...entry }) => entry);
  return {
    total: vacancies.length,
    support: vacancies.filter(({ kind }) => kind === "support"),
    roles: vacancies.filter(({ kind }) => kind === "role"),
    speakers: vacancies.filter(({ kind }) => kind === "speaker"),
    evaluators: vacancies.filter(({ kind }) => kind === "evaluator"),
  };
}

function languageCopy(language) {
  if (language === "en") return { title: "Meeting signup", date: "Date", theme: "Theme", venue: "Venue", vacancies: "Roles still open", none: "No vacancies." };
  if (language === "zh-CN") return { title: "会议接龙", date: "时间", theme: "主题", venue: "地点", vacancies: "仍需招募", none: "暂无空缺。" };
  return { title: "会议接龙 · Meeting signup", date: "时间 · Date", theme: "主题 · Theme", venue: "地点 · Venue", vacancies: "仍需招募 · Roles still open", none: "暂无空缺 · No vacancies." };
}

function displayName(entry, vacancyEmoji, includePending) {
  if (!entry.name) return vacancyEmoji;
  return entry.status === "pending" && includePending ? `${entry.name} ⏳` : entry.name;
}

export function generateSignupText(meeting, {
  language = "bilingual",
  vacancyEmoji = SIGNUP_DEFAULT_VACANCY_MARKER,
  vacancyEmojiCount = 1,
  includePending = true,
  includeSpeechDetails = false,
} = {}) {
  const copy = languageCopy(language);
  const vacancyMarker = vacancyEmoji.repeat(vacancyEmojiCount);
  const manager = {
    kind: "support",
    label: "Meeting Manager",
    name: String(meeting.meetingManager || "").trim(),
    status: meeting.meetingManager ? "confirmed" : "vacant",
  };
  const photographer = {
    kind: "support",
    label: "Photographer",
    name: String(meeting.photographer || "").trim(),
    status: meeting.photographer ? "confirmed" : "vacant",
  };
  const configuredRoleTaker = roleAwardConfig(meeting.votingForm, roleEntries(meeting)).roleTakerRoleIds;
  const roleOrder = [
    ...ROLE_AWARD_POOLS.functionalRole,
    ...ROLE_AWARD_POOLS.roleTaker,
    ...configuredRoleTaker.filter((id) => !ROLE_AWARD_POOLS.roleTaker.includes(id)),
    ...ROLE_AWARD_POOLS.facilitator,
  ];
  const roleRank = new Map(roleOrder.map((id, index) => [id, index]));
  const entries = assignmentEntries(meeting, includePending)
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => (roleRank.get(a.entry.awardRoleId) ?? roleOrder.length) - (roleRank.get(b.entry.awardRoleId) ?? roleOrder.length) || a.index - b.index)
    .map(({ entry }) => entry);
  const lines = [
    `🔥 ${copy.title} #${meeting.meetingNumber}`,
    `${copy.date}: ${meeting.date || "🈳"} ${meeting.startTime || ""}`.trim(),
    `${copy.theme}: ${meeting.theme || "🈳"}`,
    ...(meeting.venue ? [`${copy.venue}: ${meeting.venue}`] : []),
    `Meeting Manager: ${displayName(manager, vacancyMarker, includePending)}`,
    "",
    ...entries.map((entry) => {
      const detail = includeSpeechDetails && entry.kind === "speaker" && entry.session ? ` — ${entry.session}` : "";
      return `${entry.label}: ${displayName(entry, vacancyMarker, includePending)}${detail}`;
    }),
    `Photographer: ${displayName(photographer, vacancyMarker, includePending)}`,
  ];
  return lines.join("\n");
}

export function meetingReadiness(meeting, { posterPresent = false, includePending = true } = {}) {
  const blockers = [];
  const recommendations = [];
  const add = (target, code, message) => target.push({ code, message });
  if (!String(meeting.date || "").trim()) add(blockers, "missing_date", "Meeting date is required.");
  if (!String(meeting.theme || "").trim()) add(blockers, "missing_theme", "Meeting theme is required.");
  if (!(meeting.blocks || []).length) add(blockers, "missing_agenda", "Agenda needs at least one block.");
  for (const { item } of rows(meeting)) {
    if (!String(item.session || "").trim()) add(blockers, "missing_session", "Agenda item title is required.");
    if (Number(item.duration) <= 0) add(blockers, "invalid_duration", `${item.session || "Agenda item"} needs a valid duration.`);
    if (item.kind === "speech" && meeting.meetingType !== "contest") {
      const pathways = item.pathwaysMode === "pathways" && item.pathwaysPath && item.pathwaysLevel && item.pathwaysProjectId && item.pathwaysFormId;
      const custom = item.pathwaysMode === "custom" && String(item.speechObjective || "").trim();
      if (!pathways && !custom) add(blockers, "missing_speech_details", `${item.session || item.role} needs learning-path details or a custom objective.`);
    }
  }
  if (!posterPresent) add(blockers, "missing_future_poster", "Future Poster 1 is required.");
  if (meeting.meetingType !== "contest" && !String(meeting.wordOfDay?.word || "").trim()) add(recommendations, "missing_word_of_day", "Word of the Day is missing.");
  if (meeting.meetingType !== "contest" && !meeting.votingForm?.formId) add(recommendations, "voting_not_prepared", "Voting Form is not prepared.");
  const vacancies = meetingVacancies(meeting, { includePending });
  if (vacancies.total) add(recommendations, "role_vacancies", `${vacancies.total} assignment${vacancies.total === 1 ? "" : "s"} remain vacant.`);
  const durationMinutes = rows(meeting).reduce((total, { item }) => total + Math.max(0, Number(item.duration) || 0), 0)
    + (meeting.enableTransitionTime ? Math.max(0, rows(meeting).length - 1) : 0);
  if (durationMinutes > 120) add(recommendations, "agenda_over_target", `Agenda is ${durationMinutes} minutes, above the 120-minute target.`);
  const readyToFinalize = blockers.length === 0;
  return {
    status: readyToFinalize ? recommendations.length ? "ready_with_recommendations" : "ready" : "risk",
    readyToFinalize,
    blockers,
    recommendations,
    vacancies,
    durationMinutes,
    next: (blockers[0] || recommendations[0])?.message || "No action required.",
  };
}

// png（长图）、pdf（下载）复用同一套免登录签名短链：签名只绑定 meetingId + 过期时间，
// 不区分 action，两种导出对同一场会议的可读性天然一致，无需分开签发。
export function signedAgendaExportUrl(baseUrl, meeting, action) {
  const { sig, exp } = signAgendaImageLink(meeting.id);
  return {
    url: `${baseUrl}/api/meetings/${encodeURIComponent(meeting.id)}?action=${action}&sig=${sig}&exp=${exp}`,
    expiresAt: new Date(exp * 1000).toISOString(),
  };
}

export function tableTopicsPresentationUrl(baseUrl, meeting) {
  return `${baseUrl}/m/${encodeURIComponent(meeting.meetingNumber)}/presentation?jump=tabletopics`;
}

export function meetingLinks(baseUrl, meeting) {
  const number = encodeURIComponent(meeting.meetingNumber);
  return {
    presentationUrl: `${baseUrl}/m/${number}/presentation`,
    awardsUrl: `${baseUrl}/m/${number}/awards`,
    postersUrl: `${baseUrl}/m/${number}/posters`,
    votingUrl: meeting.votingForm?.shareUrl || null,
    tableTopicsUrl: tableTopicsPresentationUrl(baseUrl, meeting),
    guestBrowseUrl: baseUrl,
    editorUrl: baseUrl,
    futurePostersAdminUrl: `${baseUrl}/?meeting=${number}&view=admin&task=future-posters`,
    notes: {
      guestBrowseUrl: "Open Browse as guest; only final meetings are visible.",
      awardsUrl: "Available after awards are confirmed.",
      editorUrl: "Editor sign-in is required.",
      votingUrl: "Available once the Voting Form is prepared; null otherwise.",
    },
  };
}

export function meetingPresentations(meeting) {
  return rows(meeting)
    .filter(({ item }) => item.kind === "speech")
    .map(({ item }, index) => ({
      label: item.role || `Prepared Speaker ${index + 1}`,
      speaker: assignedName(item.member, item.status, true),
      session: item.session || "",
      slideOrder: index + 1,
      externalPresentationUrl: String(item.externalPresentationUrl || "").trim(),
    }))
    .filter((entry) => entry.externalPresentationUrl);
}

export function evaluationForms(meeting, catalog) {
  return rows(meeting)
    .filter(({ item }) => item.kind === "speech")
    .map(({ item }, index) => {
      const base = {
        speechNumber: index + 1,
        label: item.role || `Prepared Speaker ${index + 1}`,
        speaker: assignedName(item.member, item.status, true),
        evaluator: assignedName(item.evaluator, item.evaluatorStatus, true),
        session: item.session || "",
        pathwaysMode: item.pathwaysMode || "",
        // custom 模式下"目标"就是演讲人自己填的自由文本，跟 pathways 模式的项目/等级是同一个概念的两种表达；
        // 这个字段本身不是私密数据——它就印在正式发出的 Agenda 打印页上。
        pathwaysObjective: item.pathwaysMode === "custom"
          ? item.speechObjective || ""
          : item.pathwaysMode === "pathways"
            ? [item.pathwaysPath, item.pathwaysLevel ? `Level ${item.pathwaysLevel}` : ""].filter(Boolean).join(" · ")
            : "",
      };
      if (item.pathwaysMode === "custom") {
        // 跟前端 advisor-workflow.js 的 evaluationForms() 用同一条目录记录兜底：custom 目标没有专属 Pathways 表单，
        // 但俱乐部准备了一份通用评估表资源。
        const generic = catalog.formById.get("generic-evaluation-resource");
        if (!generic || !generic.pdfUrl) return { ...base, available: false, reason: "Generic evaluation form not found in catalog" };
        return { ...base, available: true, projectId: "", projectName: "", variant: generic.variant, pdfUrl: generic.pdfUrl, officialResourceUrl: generic.officialResourceUrl };
      }
      if (item.pathwaysMode !== "pathways" || !item.pathwaysFormId) {
        return { ...base, available: false, reason: "Pathways project not set" };
      }
      const form = catalog.formById.get(String(item.pathwaysFormId).trim());
      if (!form || !form.pdfUrl) return { ...base, available: false, reason: "Pathways form not found in catalog" };
      const project = catalog.projectById.get(String(item.pathwaysProjectId || form.projectId).trim());
      return {
        ...base,
        available: true,
        projectId: form.projectId,
        projectName: project?.name || "",
        variant: form.variant,
        pdfUrl: form.pdfUrl,
        officialResourceUrl: form.officialResourceUrl,
      };
    });
}

function overview(meeting) {
  const assignments = assignmentEntries(meeting);
  const vacancies = meetingVacancies(meeting);
  return {
    presentations: meetingPresentations(meeting),
    meetingNumber: meeting.meetingNumber,
    date: meeting.date,
    startTime: meeting.startTime,
    theme: meeting.theme,
    venue: meeting.venue,
    status: meeting.status,
    revision: meeting.revision,
    meetingManager: meeting.meetingManager,
    photographer: meeting.photographer,
    offAgendaRoles: meeting.offAgendaRoles || [],
    blocks: (meeting.blocks || []).map((block) => ({ title: block.title, type: block.type, itemCount: (block.items || []).length })),
    assignmentCounts: {
      total: assignments.length + 2,
      filled: assignments.filter(({ name }) => name).length + Boolean(meeting.meetingManager) + Boolean(meeting.photographer),
      vacant: vacancies.total,
    },
    vacancyCounts: {
      support: vacancies.support.length,
      roles: vacancies.roles.length,
      speakers: vacancies.speakers.length,
      evaluators: vacancies.evaluators.length,
    },
  };
}

async function listMeetingTool(raw) {
  const args = objectArgs(raw, ["status", "date_from", "date_to", "limit"]);
  const status = args.status || "active";
  if (!["active", "draft", "final", "archived", "all"].includes(status)) {
    throw new ApiError(400, "INVALID_STATUS", "status must be active, draft, final, archived, or all.");
  }
  const from = validDate(args.date_from, "date_from");
  const to = validDate(args.date_to, "date_to");
  if (from && to && from > to) throw new ApiError(400, "INVALID_DATE_RANGE", "date_from must not be after date_to.");
  const limit = args.limit == null ? 10 : args.limit;
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new ApiError(400, "INVALID_LIMIT", "limit must be an integer from 1 to 20.");
  let meetings = await listMeetings();
  if (status !== "all") meetings = meetings.filter((meeting) => status === "active" ? meeting.status !== "archived" : meeting.status === status);
  if (from) meetings = meetings.filter((meeting) => meeting.date >= from);
  if (to) meetings = meetings.filter((meeting) => meeting.date <= to);
  meetings = status === "active" ? orderedMeetings(meetings) : meetings;
  return meetings.slice(0, limit).map(({ id: _id, ...meeting }) => meeting);
}

export async function callAgendaReadTool(name, rawArguments, baseUrl) {
  if (!READ_TOOL_NAMES.has(name)) return null;
  if (name === "vpe_list_meetings") {
    const meetings = await listMeetingTool(rawArguments);
    return { data: { meetings, count: meetings.length }, message: meetings.length ? `找到 ${meetings.length} 场会议。` : "没有符合条件的会议。" };
  }

  const allowed = name === "vpe_generate_signup_text"
    ? ["meeting_number", "meeting_reference", "language", "vacancy_emoji", "vacancy_emoji_count", "include_pending", "include_speech_details"]
    : name === "vpe_generate_vacancy_call_text"
      ? ["meeting_number", "meeting_reference", "language", "vacancy_emoji", "vacancy_emoji_count", "include_pending"]
      : ["vpe_list_role_vacancies", "vpe_check_meeting_readiness"].includes(name)
        ? ["meeting_number", "meeting_reference", "include_pending"]
        : ["meeting_number", "meeting_reference"];
  const { args, meeting } = await selectedMeeting(rawArguments, allowed);
  optionalBoolean(args, "include_pending");
  optionalBoolean(args, "include_speech_details");
  const includePending = args.include_pending !== false;
  if (args.vacancy_emoji != null && typeof args.vacancy_emoji !== "string") {
    throw new ApiError(400, "INVALID_VACANCY_EMOJI", "vacancy_emoji must be a string.");
  }
  const vacancyEmoji = args.vacancy_emoji == null ? (name === "vpe_generate_signup_text" ? SIGNUP_DEFAULT_VACANCY_MARKER : "🈳") : args.vacancy_emoji;
  const vacancyEmojiCount = args.vacancy_emoji_count == null ? 1 : args.vacancy_emoji_count;
  if (!Number.isInteger(vacancyEmojiCount) || vacancyEmojiCount < 1 || vacancyEmojiCount > 5) {
    throw new ApiError(400, "INVALID_VACANCY_EMOJI_COUNT", "vacancy_emoji_count must be an integer from 1 to 5.");
  }
  const emojiValidation = validateVacancyEmoji(vacancyEmoji.repeat(vacancyEmojiCount));
  if (!emojiValidation.valid) throw new ApiError(400, emojiValidation.code, emojiValidation.message);

  if (name === "vpe_get_meeting_overview") {
    const data = overview(meeting);
    const links = meetingLinks(baseUrl, meeting);
    const presentationLine = `\n在线投屏页：${links.presentationUrl}（Table Topics 抽题深链：${links.tableTopicsUrl}）`;
    const pptLine = data.presentations.length
      ? `\n演讲外链 PPT：${data.presentations.map((entry) => `${entry.label} ${entry.externalPresentationUrl}（投屏深链 ${links.presentationUrl}?jump=ps&order=${entry.slideOrder}）`).join("；")}`
      : "";
    return { data, message: `#${meeting.meetingNumber} · ${meeting.date || "日期未定"} · ${meeting.theme || "主题未定"} · ${data.assignmentCounts.vacant} 个空缺。${presentationLine}${pptLine}` };
  }
  if (name === "vpe_generate_signup_text") {
    const language = args.language || "bilingual";
    if (!["zh-CN", "en", "bilingual"].includes(language)) throw new ApiError(400, "INVALID_LANGUAGE", "language must be zh-CN, en, or bilingual.");
    const text = generateSignupText(meeting, {
      language,
      vacancyEmoji,
      vacancyEmojiCount,
      includePending,
      includeSpeechDetails: args.include_speech_details === true,
    });
    return { data: { meetingNumber: meeting.meetingNumber, text }, message: text };
  }
  if (name === "vpe_list_role_vacancies") {
    const vacancies = meetingVacancies(meeting, { includePending });
    return { data: { meetingNumber: meeting.meetingNumber, ...vacancies }, message: vacancies.total ? `#${meeting.meetingNumber} 还有 ${vacancies.total} 个空缺。` : `#${meeting.meetingNumber} 暂无空缺。` };
  }
  if (name === "vpe_generate_vacancy_call_text") {
    const language = args.language || "bilingual";
    if (!["zh-CN", "en", "bilingual"].includes(language)) throw new ApiError(400, "INVALID_LANGUAGE", "language must be zh-CN, en, or bilingual.");
    const copy = languageCopy(language);
    const vacancies = meetingVacancies(meeting, { includePending });
    const text = [
      `${copy.vacancies} · #${meeting.meetingNumber}`,
      `${meeting.date || "日期未定"} ${meeting.startTime || ""} · ${meeting.theme || "主题未定"}`.trim(),
      "",
      ...(vacancies.total ? [...vacancies.support, ...vacancies.roles, ...vacancies.speakers, ...vacancies.evaluators].slice(0, 100).map(({ label }) => `${vacancyMarker} ${label}`) : [copy.none]),
    ].join("\n");
    return { data: { meetingNumber: meeting.meetingNumber, vacancies, text }, message: text };
  }
  if (name === "vpe_check_meeting_readiness") {
    const poster = await getGlobalAssetImage("future-poster-1");
    const readiness = meetingReadiness(meeting, { posterPresent: poster.image.present, includePending });
    return { data: { meetingNumber: meeting.meetingNumber, ...readiness }, message: `#${meeting.meetingNumber} · ${readiness.status}。Next: ${readiness.next}` };
  }
  if (name === "vpe_get_agenda_image") {
    const { url: imageUrl, expiresAt } = signedAgendaExportUrl(baseUrl, meeting, "png");
    return {
      data: { meetingNumber: meeting.meetingNumber, imageUrl, expiresAt },
      message: `#${meeting.meetingNumber} 长图分享链接（24 小时内有效）：${imageUrl}`,
    };
  }
  if (name === "vpe_get_agenda_pdf") {
    const { url: pdfUrl, expiresAt } = signedAgendaExportUrl(baseUrl, meeting, "pdf");
    return {
      data: { meetingNumber: meeting.meetingNumber, pdfUrl, expiresAt },
      message: `#${meeting.meetingNumber} Agenda PDF 下载链接（24 小时内有效）：${pdfUrl}`,
    };
  }
  if (name === "vpe_get_evaluation_forms") {
    const catalog = await getPathwaysCatalog();
    const forms = evaluationForms(meeting, catalog);
    const lines = forms.map((entry) => {
      const people = `演讲人 ${entry.speaker || "未指定"} / 评估人 ${entry.evaluator || "未指定"}`;
      const objective = entry.pathwaysMode === "custom"
        ? `Custom：${entry.pathwaysObjective || "演讲人未填写具体目标"}`
        : entry.pathwaysMode === "pathways"
          ? entry.pathwaysObjective || "已选 Pathways 但未指定具体项目"
          : "未设置 Pathway 目标";
      return entry.available
        ? `${entry.label}（${people}）· ${objective} · PDF：${entry.pdfUrl}`
        : `${entry.label}（${people}）· ${objective} · 暂无 PDF（${entry.reason}）`;
    });
    return {
      data: { meetingNumber: meeting.meetingNumber, forms, count: forms.length, availableCount: forms.filter((entry) => entry.available).length },
      message: forms.length ? `#${meeting.meetingNumber} 备稿演讲评估表：\n${lines.join("\n")}` : `#${meeting.meetingNumber} 没有备稿演讲。`,
    };
  }
  const links = meetingLinks(baseUrl, meeting);
  return {
    data: { meetingNumber: meeting.meetingNumber, ...links },
    message: `#${meeting.meetingNumber} 分享链接已生成。\nPresentation: ${links.presentationUrl}\nAwards: ${links.awardsUrl}\nPosters: ${links.postersUrl}\nVoting: ${links.votingUrl || "尚未生成投票表"}\nTable Topics 抽题页: ${links.tableTopicsUrl}`,
  };
}

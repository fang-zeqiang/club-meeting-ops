import "./styles.css";
import "./meeting-presentation.css";
import "./meeting-presentation-themes.css";
import "./presentation-awards.css";
import QRCode from "qrcode";
import { CLUB_PROFILE } from "./club-profile.js";
import { appendVersion } from "./meeting-helpers.js";
import { derivePresentationSlides, findSlideJumpIndex, isWordReminderVisible, tableTopicsDrawPool, topicTokens } from "./meeting-presentation-model.js";
import { awardCeremonySlides, awardWaitingSlide, createAwardPoller, renderAwardCeremonySlide, replaceAwardCeremonySlides } from "./presentation-awards.js";
import { renderWordTrainingCard } from "./presentation-word-card.js";
import { isPresentationTheme, normalizePresentationTheme, PRESENTATION_THEMES } from "./presentation-themes.js";
import { DEFAULT_TIMER_STYLE, normalizeTimerStyle, TIMER_STYLES, timerSignalState } from "./presentation-timer-signals.js";
import { mountTemporaryTextEditor } from "./temporary-text-editor.js";
import { createLatestWinsSync } from "./table-topics-sync.js";
import { validateTableTopicsEntries } from "./table-topics-entries.js";
import { createPresentationRemote, createRemoteRoomId, createRemoteSession, isRemoteCommand, isRemoteSessionActive, normalizeRemoteCommand, REMOTE_TIMEOUT_MS, remotePresentationUrl } from "./presentation-remote.js";

const posterRoute = window.location.pathname.match(/^\/(?:m\/(\d+)\/)?posters\/?$/);
const route = window.location.pathname.match(/^\/meetings\/([^/]+)\/presentation\/?$/) || window.location.pathname.match(/^\/m\/(\d+)\/presentation\/?$/) || posterRoute;
const meetingId = decodeURIComponent(route?.[1] || "");
const app = document.querySelector("#app");
const clubBrandUrl = CLUB_PROFILE.logo;
const query = new URLSearchParams(window.location.search);
const posterPreviewMode = Boolean(posterRoute) || query.get("preview") === "future-posters";
const remoteConfigured = Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);
const REMOTE_SESSION_PREFIX = "presentation-remote:";
const TABLE_TOPICS_LIVE_POLL_MS = 3000;
const AWARD_POLL_MS = 5000;
let jumpConsumed = false;

function remoteSessionKey(roomId) { return `${REMOTE_SESSION_PREFIX}${roomId}`; }
function savedRemoteSession(roomId) {
  try {
    const session = JSON.parse(sessionStorage.getItem(remoteSessionKey(roomId)) || "null");
    return isRemoteSessionActive(session) ? session : null;
  } catch { return null; }
}
function saveRemoteSession(session) { sessionStorage.setItem(remoteSessionKey(session.roomId), JSON.stringify(session)); }
function clearRemoteSession(roomId) { if (roomId) sessionStorage.removeItem(remoteSessionKey(roomId)); }
function roomIdFromHash() { try { return decodeURIComponent(location.hash.slice(1)); } catch { return ""; } }

const THEME_SESSION_KEY = `presentation-theme:${meetingId || "posters"}`;
const TIMER_STYLE_SESSION_KEY = `presentation-timer-style:${meetingId || "posters"}`;

function presentationTimerStyle() {
  try { return normalizeTimerStyle(sessionStorage.getItem(TIMER_STYLE_SESSION_KEY)); }
  catch { return DEFAULT_TIMER_STYLE; }
}

// 投屏页右侧触发角切换的主题只活在当前标签页,不写回会议记录,会中乱按不会污染数据。
function sessionThemeOverride() {
  try { return sessionStorage.getItem(THEME_SESSION_KEY) || ""; } catch { return ""; }
}

// 优先级:本次投屏的临时切换 > ?theme= 预览覆盖 > 会议记录。
function presentationTheme(meeting) {
  const session = sessionThemeOverride();
  if (isPresentationTheme(session)) return normalizePresentationTheme(session);
  const override = query.get("theme");
  if (isPresentationTheme(override)) return normalizePresentationTheme(override);
  return normalizePresentationTheme(meeting?.presentationTheme);
}

function themeSwitcherMarkup(active, timerStyle) {
  return `<div class="theme-trigger" tabindex="0" role="button" aria-label="打开投屏与计时器主题设置"></div>
    <aside class="presentation-themes" aria-label="Presentation theme">
      <strong>投屏主题</strong>
      <div>${PRESENTATION_THEMES.map((theme) => `<button class="${theme.id === active ? "active" : ""}" type="button" data-theme-id="${escapeHtml(theme.id)}"><span class="theme-swatch theme-${escapeHtml(theme.id)}"></span><span>${escapeHtml(theme.label)}</span></button>`).join("")}</div>
      <strong>红黄绿计时器</strong>
      <div>${TIMER_STYLES.map((style) => `<button class="${style.id === timerStyle ? "active" : ""}" type="button" data-timer-style="${style.id}" aria-pressed="${style.id === timerStyle}" title="${style.description}"><span class="timer-style-swatch timer-style-swatch-${style.id}" aria-hidden="true">${style.short}</span><span>${style.label}</span></button>`).join("")}</div>
    </aside>`;
}

function applyPresentationTheme(themeId) {
  const main = document.querySelector(".meeting-presentation");
  PRESENTATION_THEMES.forEach((theme) => main.classList.toggle(`theme-${theme.id}`, theme.id === themeId));
  try { sessionStorage.setItem(THEME_SESSION_KEY, themeId); } catch { /* 隐私模式下写不进去,当次切换仍然生效 */ }
  document.querySelectorAll("[data-theme-id]").forEach((button) => button.classList.toggle("active", button.dataset.themeId === themeId));
}

function applyPresentationTimerStyle(styleId) {
  const main = document.querySelector(".meeting-presentation");
  const selected = normalizeTimerStyle(styleId);
  TIMER_STYLES.forEach((style) => main.classList.toggle(`timer-style-${style.id}`, style.id === selected));
  try { sessionStorage.setItem(TIMER_STYLE_SESSION_KEY, selected); } catch { /* 当前页面仍生效 */ }
  document.querySelectorAll("[data-timer-style]").forEach((button) => {
    const active = button.dataset.timerStyle === selected;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function field(value, className = "") {
  return value === "TBD"
    ? `<span class="tbd ${className}" data-editable-text>TBD</span>`
    : `<span class="${className}" data-editable-text>${escapeHtml(value)}</span>`;
}

function fitClass(value, mediumAt = 22, longAt = 30) {
  const length = String(value || "").length;
  return length > longAt ? "fit-long" : length > mediumAt ? "fit-medium" : "";
}

function englishList(names) {
  if (names.length < 2) return names[0] || "";
  return names.join(" & ");
}

function displayDate(value) {
  return String(value || "").replaceAll("-", ".");
}

function signatureName(value) {
  return String(value || "").split(" & ").map((name) => name.split(",")[0].trim()).join(" & ");
}

function formatSeconds(seconds) {
  const value = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(value / 60);
  const rest = value % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function isTableTopicsLiveSlide(slide) {
  return ["tabletopics-draw", "timer-report", "break"].includes(slide?.type);
}

const TIMER_RING_RADIUS = 46;
const TIMER_RING_CIRCUMFERENCE = 2 * Math.PI * TIMER_RING_RADIUS;

function controlIcon(content) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${content}</svg>`;
}

const CONTROL_ICONS = Object.freeze({
  menu: controlIcon('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  previous: controlIcon('<path d="m15 6-6 6 6 6"/>'),
  next: controlIcon('<path d="m9 6 6 6-6 6"/>'),
  refresh: controlIcon('<path d="M20 12a8 8 0 1 1-2.34-5.66L20 8"/><path d="M20 3v5h-5"/>'),
  open: controlIcon('<path d="M14 5h5v5M19 5l-8 8"/><path d="M19 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>'),
  fullscreen: controlIcon('<path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/>'),
  edit: controlIcon('<path d="m4 20 4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20Z"/><path d="m13.5 7.5 3 3"/>'),
  more: controlIcon('<circle cx="5" cy="12" r="1.25"/><circle cx="12" cy="12" r="1.25"/><circle cx="19" cy="12" r="1.25"/>'),
});

async function apiJson(url, options = {}) {
  const response = await fetch(url, { credentials: "same-origin", ...options, headers: { Accept: "application/json", "Content-Type": "application/json", ...(options.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.message || "Request failed.");
    error.status = response.status;
    error.code = body.code;
    error.details = body.details;
    throw error;
  }
  return body;
}

function activeVotingImage(meeting) {
  const system = meeting.qrSource !== "manual";
  const image = system ? meeting.systemVotingQr : meeting.votingQr;
  if (!image?.present) return "";
  const path = system
    ? `/api/meetings/${encodeURIComponent(meeting.id)}/voting?action=system-image&view=presentation`
    : `/api/meetings/${encodeURIComponent(meeting.id)}/images/voting?view=presentation`;
  return image.version ? appendVersion(path, image.version) : path;
}

async function presentationAssetUrl(kind) {
  const { image } = await apiJson(`/api/assets/${kind}?metadata=1&view=presentation`).catch(() => ({ image: null }));
  return image?.present ? appendVersion(`/api/assets/${kind}?view=presentation`, image.version) : "";
}

async function futurePosterUrls() {
  return (await Promise.all(["future-poster-1", "future-poster-2"].map(presentationAssetUrl))).filter(Boolean);
}

async function fetchSharingMasterAward() {
  try { return await apiJson(`/api/meetings/${encodeURIComponent(meetingId)}/awards?view=sharing-master`); }
  catch { return null; }
}

function shell(slide, content, className = "") {
  return `<article class="meeting-slide ${slide.type} ${className}" data-slide-key="${escapeHtml(slide.key || slide.type)}" data-slide-title="${escapeHtml(slide.title || slide.blockTitle || slide.type)}" aria-hidden="true">
    <div class="stage-card">
      <div class="stage-decor" aria-hidden="true"></div>
      <header class="slide-brand">
        <img src="${clubBrandUrl}" alt="${escapeHtml(CLUB_PROFILE.clubName)}">
      </header>
      ${content}
      ${slide.wordReminder ? `<aside class="word-reminder-card" data-word-reminder hidden aria-label="Word of the Day"><span>WORD OF THE DAY</span><strong>${escapeHtml(slide.wordReminder.word)}</strong>${slide.wordReminder.definition ? `<small>${escapeHtml(slide.wordReminder.definition)}</small>` : ""}</aside>` : ""}
      ${timerDock(slide)}
    </div>
  </article>`;
}

function timerDock(slide) {
  const seconds = Math.max(0, Math.round(Number(slide.duration || 0) * 60));
  const transitionSeconds = Math.max(0, Math.round(Number(slide.transitionSeconds || 0)));
  const signals = slide.timerSignals;
  if (!seconds) return "";
  return `<aside class="slide-timer ${signals ? "has-signals signal-waiting" : ""}" tabindex="0" data-slide-seconds="${seconds}" data-remaining="${seconds}" data-elapsed="0" ${signals ? `data-green="${signals.green}" data-yellow="${signals.yellow}" data-red="${signals.red}" data-bell="${signals.bell}"` : ""} data-transition-seconds="${transitionSeconds}" data-transition-remaining="${transitionSeconds}" data-phase="${transitionSeconds ? "transition" : "session"}" aria-label="${signals ? "Timer with timing cards" : "Session timer"}">
    <div class="slide-timer-ring">
      <svg viewBox="0 0 104 104" aria-hidden="true">
        <circle class="slide-timer-track" cx="52" cy="52" r="${TIMER_RING_RADIUS}"></circle>
        <circle class="slide-timer-progress" data-timer-progress cx="52" cy="52" r="${TIMER_RING_RADIUS}" stroke-dasharray="${TIMER_RING_CIRCUMFERENCE.toFixed(2)}" stroke-dashoffset="${signals && !transitionSeconds ? TIMER_RING_CIRCUMFERENCE.toFixed(2) : 0}"></circle>
      </svg>
      <div class="slide-timer-face">
        <span data-timer-label>${escapeHtml(slide.duration)} min</span>
        <strong data-timer-display>${signals && !transitionSeconds ? "0:00" : formatSeconds(transitionSeconds || seconds)}</strong>
      </div>
    </div>
    ${signals ? `<div class="timer-card" data-timer-card hidden aria-hidden="true"></div><div class="timer-card-stack" aria-hidden="true"><span data-stack-green>绿</span><span data-stack-yellow>黄</span><span data-stack-red>红</span></div><div class="timer-bell" data-timer-bell hidden>🛎️ 叮叮～</div>` : ""}
    <div class="slide-timer-actions">
      <button type="button" data-timer-start aria-label="Start timer" title="Start" style="--angle:-55deg">&#9658;</button>
      <button type="button" data-timer-pause aria-label="Pause timer" title="Pause" style="--angle:0deg">&#10073;&#10073;</button>
      <button type="button" data-timer-reset aria-label="Reset timer" title="Reset" style="--angle:55deg">&#8634;</button>
    </div>
  </aside>`;
}

function cover(slide) {
  return shell(slide, `<div class="cover-copy">
    <p data-editable-text>${escapeHtml(slide.subtitle)}</p>
    <h1 data-editable-text>${escapeHtml(slide.title)}</h1>
    ${slide.theme ? `<strong data-editable-text>${escapeHtml(slide.theme)}</strong>` : ""}
    ${slide.date ? `<time data-editable-text>${escapeHtml(slide.date)}</time>` : ""}
  </div>`, "cover-slide");
}

function practiceIntro(slide) {
  return shell(slide, `<div class="intro-grid">
    <div>
      <p class="section-kicker" data-editable-text>Why practice together</p>
      <h1 data-editable-text>Learn by doing</h1>
      <p data-editable-text>Meeting roles turn communication and leadership into repeatable practice, with immediate feedback from peers.</p>
    </div>
    <div class="intro-badge">
      <img src="${clubBrandUrl}" alt="">
      <span data-editable-text>Take a role</span>
      <span data-editable-text>Try a speech</span>
      <span data-editable-text>Give feedback</span>
    </div>
  </div>`);
}

function clubIntro(slide, photo) {
  return shell(slide, `<div class="club-intro-copy">
    <p class="section-kicker" data-editable-text>${escapeHtml(CLUB_PROFILE.intro.eyebrow)}</p>
    <h1 data-editable-text>${escapeHtml(CLUB_PROFILE.intro.title)}</h1>
    <div class="club-beliefs">
      ${CLUB_PROFILE.intro.beliefs.map((belief) => `<span data-editable-text>${escapeHtml(belief)}</span>`).join("")}
    </div>
  </div>${photo ? `<img class="club-intro-photo" src="${escapeHtml(photo)}" alt="${escapeHtml(CLUB_PROFILE.clubName)} members">` : ""}`, photo ? "club-intro-with-photo" : "");
}

function program(slide) {
  return shell(slide, `<div class="program-copy">
      <p class="section-kicker" data-editable-text>Today&apos;s Program</p>
    <div class="program-board">
      ${slide.blocks.map((block) => `<section>
        <h2 data-editable-text>${escapeHtml(block.title)}</h2>
        ${block.items.map((item) => `<div class="${item.kind === "break" ? "program-break" : ""}"><span data-editable-text>${escapeHtml(item.session)}</span>${item.member ? field(item.member) : ""}</div>`).join("")}
      </section>`).join("")}
    </div>
  </div>`);
}

function vote(slide, meeting) {
  const qr = activeVotingImage(meeting);
  return shell(slide, `<div class="vote-layout">
    <div>
      <p class="section-kicker" data-editable-text>${escapeHtml(slide.role)}</p>
      <h1 data-editable-text>${escapeHtml(slide.title)}</h1>
      <p class="host-line">${field(slide.member)}</p>
    </div>
    <div class="vote-qr ${qr ? "has-qr" : ""}">
      ${qr ? `<img src="${escapeHtml(qr)}" alt="Voting QR code">` : `<span>QR<br>not ready</span>`}
      <strong data-editable-text>Scan with WeChat</strong>
    </div>
  </div>`);
}

function futurePosters(slide) {
  return shell(slide, `<div class="future-posters-layout ${slide.images.length === 1 ? "single" : "double"}">
    ${slide.images.map((image, index) => `<div class="future-poster-frame"><img src="${escapeHtml(image)}" alt="Future meeting poster ${index + 1}"></div>`).join("")}
  </div>`, "future-posters-slide");
}

function speech(slide) {
  return shell(slide, `<div class="session-copy speech-copy">
    <p class="section-kicker" data-editable-text>${escapeHtml(slide.blockTitle)}</p>
    <div class="speech-main">
      <h1 class="${fitClass(slide.title)}" data-editable-text>${escapeHtml(slide.title)}</h1>
      <p class="speaker-line">${field(slide.member)}</p>
    </div>
    <div class="speech-meta">
      ${slide.hideEvaluator ? "" : `<p class="evaluator-line"><span data-editable-text>Evaluator</span>${field(slide.evaluator)}</p>`}
      ${slide.objective ? `<p class="objective-line" data-editable-text>${escapeHtml(slide.objective)}</p>` : ""}
    </div>
  </div>`);
}

function grammarianIntro(slide) {
  if (!slide.wordOfDay?.word) return item(slide);
  return shell(slide, `<div class="grammarian-intro-layout">
    <div class="session-copy grammarian-session-copy">
      <p class="section-kicker" data-editable-text>${escapeHtml(slide.blockTitle || slide.role)}</p>
      <h1 class="${fitClass(slide.title)}" data-editable-text>${escapeHtml(slide.title)}</h1>
      <p class="role-line" data-editable-text>${escapeHtml(slide.role)}</p>
      <p class="host-line">${field(slide.member)}</p>
    </div>
    ${renderWordTrainingCard(slide.wordOfDay)}
  </div>`, "grammarian-intro-slide");
}

function item(slide) {
  return shell(slide, `<div class="session-copy">
    <p class="section-kicker" data-editable-text>${escapeHtml(slide.blockTitle || slide.role)}</p>
    <h1 class="${fitClass(slide.title)}" data-editable-text>${escapeHtml(slide.title)}</h1>
    ${slide.role ? `<p class="role-line" data-editable-text>${escapeHtml(slide.role)}</p>` : ""}
    <p class="host-line">${field(slide.member)}</p>
    ${slide.type === "grammarian-report" && slide.wordOfDay?.word ? `<p class="role-line">Word of the Day · ${escapeHtml(slide.wordOfDay.word)}</p>` : ""}
  </div>`, slide.type === "awards" ? "awards-flow-slide" : "");
}

function currentTableTopicsSpeaker(context) {
  return (context.tableTopicsEntries || []).find((entry) => entry.id === context.currentTableTopicsEntryId) || null;
}

function tableTopicsPool(context) {
  return tableTopicsDrawPool({
    total: context.tableTopicsTotal,
    drawnKeys: [...drawnTopicKeys],
    heldKeys: [...drawnTopicsByEntry.values()].map((topic) => topic.key),
    ownKey: drawnTopicsByEntry.get(context.currentTableTopicsEntryId)?.key || "",
  });
}

function tableTopicsPoolStatus(pool) {
  if (pool.tier === "recycled") return `新题已抽完，已放回 ${pool.available} 道换掉的题`;
  if (pool.tier === "shared") return "话题已全部分出，可能与其他 Speaker 重复";
  return `剩 ${pool.available} 题`;
}

// 抽题区是一条线性流程：录入 Speaker → 抽取话题 → 主按钮“下一位 Speaker”；换题降为带名字的次要操作，避免与“给下一位抽题”混淆
function tableTopicsDrawArea(context) {
  if (context.tableTopicsTotal === 0) return `<p class="tabletopics-status" data-tabletopics-status role="status">TTM 尚未录入话题</p>`;
  const current = currentTableTopicsSpeaker(context);
  const speaker = awaitingNextSpeaker ? null : current;
  if (!speaker) {
    const back = current ? `<button type="button" class="tabletopics-secondary" data-cancel-next-speaker>返回 ${escapeHtml(current.name)} 的话题</button>` : "";
    return `<form class="tabletopics-next-form" data-tabletopics-entry-form><label>${(context.tableTopicsEntries || []).length ? "下一位 Speaker" : "第一位 Speaker"}<input name="name" maxlength="80" required autocomplete="off" placeholder="输入名字后按回车"></label><button type="submit">确定</button>${back}<small data-tabletopics-entry-status role="status"></small></form>`;
  }
  const topic = drawnTopicsByEntry.get(speaker.id);
  const pool = tableTopicsPool(context);
  const speakerLine = `<p class="tabletopics-speaker">${escapeHtml(speaker.name)}</p>`;
  if (!topic) {
    return pool.available
      ? `<div class="tabletopics-draw" data-tabletopics-draw>${speakerLine}<button type="button" data-draw-topic>抽取话题</button><small data-tabletopics-status role="status">${tableTopicsPoolStatus(pool)}</small></div>`
      : `<div class="tabletopics-draw" data-tabletopics-draw>${speakerLine}<p class="tabletopics-status" data-tabletopics-status role="status">话题已抽完</p></div>`;
  }
  const redraw = pool.available
    ? `<button type="button" class="tabletopics-secondary" data-draw-topic data-redraw data-speaker-name="${escapeHtml(speaker.name)}">给 ${escapeHtml(speaker.name)} 换一题</button>`
    : "";
  return `<div class="tabletopics-draw" data-tabletopics-draw>${speakerLine}<p class="tabletopics-topic ${fitClass(topic.text, 40, 70)}" data-tabletopics-topic role="status">${topicCharacters(topic.text)}</p><button type="button" data-next-tabletopics-speaker>下一位 Speaker →</button>${redraw}<small data-tabletopics-status role="status">${pool.available ? "" : "没有可换的题了"}</small></div>`;
}

function tableTopicsSyncStatus() {
  const { status, error } = tableTopicsSync.state();
  const content = status === "syncing" ? "同步中…"
    : status === "synced" ? "已同步"
      : status === "error" ? `未同步：${escapeHtml(error?.message || "请求失败")} <button type="button" data-tabletopics-sync-retry>重试</button>` : "";
  return `<small class="tabletopics-sync" data-tabletopics-sync data-status="${status}" role="status">${content}</small>`;
}

function tableTopicsLivePanel(context) {
  const entries = [...(context.tableTopicsEntries || [])].sort((a, b) => a.order - b.order);
  return `<aside class="tabletopics-live-panel" data-tabletopics-live-panel>
    <strong>Table Topics live</strong>${tableTopicsSyncStatus()}
    <ol>${entries.length ? entries.map((entry) => `<li><button type="button" data-current-tabletopics-entry="${escapeHtml(entry.id)}" aria-pressed="${entry.id === context.currentTableTopicsEntryId}">${escapeHtml(entry.name)}</button><input type="number" min="0" inputmode="numeric" data-tabletopics-duration="${escapeHtml(entry.id)}" value="${entry.durationSeconds ?? ""}" aria-label="${escapeHtml(entry.name)} actual seconds"></li>`).join("") : "<li>No speakers yet.</li>"}</ol>
  </aside>`;
}

function tableTopics(slide, context) {
  return shell(slide, `<div class="session-copy tabletopics-copy">
    <p class="section-kicker" data-editable-text>${escapeHtml(slide.blockTitle || slide.role)}</p>
    <h1 class="${fitClass(slide.title)}" data-editable-text>${escapeHtml(slide.title)}</h1>
    ${slide.role ? `<p class="role-line" data-editable-text>${escapeHtml(slide.role)}</p>` : ""}
    <p class="host-line">${field(slide.member)}</p>
  </div>`, "tabletopics-slide");
}

function tableTopicsDrawCopy(context) {
  return `<div class="tabletopics-draw-copy" data-tabletopics-draw-copy>
    <h1>Draw a topic</h1>
    ${tableTopicsDrawArea(context)}
  </div>`;
}

function tableTopicsDraw(slide, context) {
  return shell(slide, `${tableTopicsDrawCopy(context)}${tableTopicsLivePanel(context)}`, "tabletopics-draw-slide");
}

// Speaker 名单或话题变化时只局部替换抽题区与名单面板，避免整页 renderDeck 打断计时、WOD 提示与当前页状态
function renderTableTopicsDrawSlides({ panel = true } = {}) {
  document.querySelectorAll(".tabletopics-draw-slide").forEach((slideNode) => {
    slideNode.querySelector("[data-tabletopics-draw-copy]").outerHTML = tableTopicsDrawCopy(context);
    if (panel) slideNode.querySelector("[data-tabletopics-live-panel]").outerHTML = tableTopicsLivePanel(context);
  });
  requestAnimationFrame(() => document.querySelectorAll("[data-tabletopics-topic]").forEach((topic) => topic.classList.add("is-visible")));
}

function timerReport(slide, context) {
  const entries = [...(context.tableTopicsEntries || [])].sort((a, b) => a.order - b.order);
  const content = entries.length
    ? entries.map((entry) => `<li><span>${escapeHtml(entry.name)}</span><strong>${formatSeconds(entry.durationSeconds)}</strong></li>`).join("")
    : "<li class=\"tabletopics-empty\">No timing records are available yet.</li>";
  return shell(slide, `<div class="timer-report"><p class="section-kicker">${escapeHtml(slide.role || "Timer")}</p><h1>${escapeHtml(slide.title)}</h1><p class="host-line">${escapeHtml(slide.member)}</p><ol data-live-entry-list="timings">${content}</ol></div>`, "timer-report-slide");
}

function breakSlide(slide, context) {
  return shell(slide, `<div class="break-copy">
    <h1 class="${fitClass(slide.title)}" data-editable-text>${escapeHtml(slide.title)}</h1>
    <p data-editable-text>${escapeHtml(slide.duration)} min</p>
    <div class="break-voting-prompt"><strong>Add Table Topics speakers before voting.</strong><span>Use the Table Topics live panel to record speakers and update the voting form.</span></div>
  </div>`, "break-slide");
}

function externalContent(slide) {
  const url = escapeHtml(slide.url);
  return `<article class="meeting-slide external-content" data-slide-key="${escapeHtml(slide.key)}" data-slide-title="${escapeHtml(slide.title)}" data-external-url="${url}" aria-hidden="true">
    <div class="stage-card external-content-stage">
      <iframe data-external-frame data-src="${url}" title="${escapeHtml(slide.title)} external presentation" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-presentation" allow="clipboard-read; clipboard-write"></iframe>
      ${timerDock(slide)}
    </div>
  </article>`;
}

function sharingMasterAward(slide) {
  const winner = englishList(slide.winners.map((name) => signatureName(name)));
  const signatoryName = signatureName(slide.signatory?.name || "");
  const winnerClass = `winner ${fitClass(winner, 42, 62)}`.trim();
  const signatureClass = fitClass(signatoryName, 14, 18);
  return `<article class="meeting-slide sharing-master-slide" data-slide-key="${escapeHtml(slide.key)}" data-slide-title="Sharing Master" aria-hidden="true">
    <div class="certificate">
      <img class="certificate-logo" src="${clubBrandUrl}" alt="${escapeHtml(CLUB_PROFILE.clubName)}">
      <div class="award-content">
        <h1><span class="award-title" data-editable-text>SHARING MASTER</span><span class="award-word" data-editable-text>AWARD</span></h1>
        <p class="presented-to" data-editable-text>Presented to</p>
        <div class="award-recipient">
          <p class="${winnerClass}" data-editable-text>${escapeHtml(winner)}</p>
          <div class="certificate-divider" aria-hidden="true"></div>
        </div>
        <p class="club-name" data-editable-text>${escapeHtml(slide.clubName)}</p>
        <p class="meeting-number">Meeting No. <strong data-editable-text>${escapeHtml(slide.meetingNumber)}</strong></p>
        <div class="certificate-footer">
          <div class="certificate-date">
            <time datetime="${escapeHtml(slide.meetingDate)}" data-editable-text>${escapeHtml(displayDate(slide.meetingDate))}</time>
            <div class="certificate-divider" aria-hidden="true"></div>
            <span data-editable-text>Date</span>
          </div>
          <div class="certificate-signature">
            <strong class="${signatureClass}" data-editable-text>${escapeHtml(signatoryName)}</strong>
            <div class="certificate-divider" aria-hidden="true"></div>
            <span data-editable-text>Club President</span>
          </div>
        </div>
      </div>
    </div>
  </article>`;
}

function awardCertificate(slide) {
  return sharingMasterAward({
    ...slide,
    type: "award-certificate",
    winners: slide.award.winners.map((winner) => winner.name),
    clubName: slide.ceremony.clubName,
    meetingNumber: slide.ceremony.meetingNumber,
    meetingDate: slide.ceremony.meetingDate,
    signatory: slide.ceremony.signatory,
  }).replace("sharing-master-slide", "award-certificate-slide").replace("SHARING MASTER", escapeHtml(slide.award.title.toUpperCase()));
}

function awardSummary(slide) {
  return shell(slide, `<div class="session-copy"><p class="section-kicker">Awards</p><h1>FINISH</h1><p class="role-line">Award Summary</p>${slide.awards.map((award) => `<p>${escapeHtml(award.title)}</p>`).join("")}</div>`);
}

function thanks(slide) {
  return shell(slide, `<div class="thanks-copy">
    <h1 data-editable-text>Thanks!</h1>
    <p data-editable-text><strong>追求完美旅程，共建美好世界</strong></p>
    <p data-editable-text>To pursue the perfect trip for a better world</p>
  </div>`);
}

function renderSlide(slide, meeting, clubIntroPhoto, context) {
  if (["award-waiting", "award-certificate", "award-finish"].includes(slide.type)) {
    return `<article class="meeting-slide ${slide.type}" data-slide-key="${escapeHtml(slide.key)}" data-slide-title="${escapeHtml(slide.title)}" aria-hidden="true">${renderAwardCeremonySlide(slide)}</article>`;
  }
  if (slide.type === "cover") return cover(slide);
  if (slide.type === "practice-intro") return practiceIntro(slide);
  if (slide.type === "club-intro") return clubIntro(slide, clubIntroPhoto);
  if (slide.type === "program") return program(slide);
  if (slide.type === "vote") return vote(slide, meeting);
  if (slide.type === "future-posters") return futurePosters(slide);
  if (slide.type === "speech") return speech(slide);
  if (slide.type === "grammarian-intro") return grammarianIntro(slide);
  if (slide.type === "tabletopics") return tableTopics(slide, context);
  if (slide.type === "tabletopics-draw") return tableTopicsDraw(slide, context);
  if (slide.type === "timer-report") return timerReport(slide, context);
  if (slide.type === "break") return breakSlide(slide, context);
  if (slide.type === "external-content") return externalContent(slide);
  if (slide.type === "sharing-master-award") return sharingMasterAward(slide);
  if (slide.type === "thanks") return thanks(slide);
  return item(slide);
}

function renderError(message) {
  app.innerHTML = `<main class="presentation-error"><div><span>Meeting presentation</span><h1>${escapeHtml(message)}</h1><p>Open Agenda and check this meeting.</p><a href="/">Open Agenda</a></div></main>`;
}

let deck = null;
let timerInterval = null;
let activeAwardPoller = null;
let drawnTopicKeys = new Set();
// 每位 Speaker 最近一次抽到的话题 { key, text }，仅保存在本页内存；切换 Speaker 或重渲染时据此恢复话题展示
let drawnTopicsByEntry = new Map();
// 点了“下一位 Speaker”后、新名字录入前，抽题区显示录入框而不是上一位的话题
let awaitingNextSpeaker = false;
let context = {};
let activeRemote = null;
let tableTopicsLivePoll = null;
window.addEventListener("beforeunload", (event) => { if (tableTopicsSync.hasLocalChanges()) event.preventDefault(); });
// Speaker 名单先改本地再后台同步；同步跨 renderDeck 存活，所以放模块级
const tableTopicsSync = createLatestWinsSync({
  send: ({ entries, currentTableTopicsEntryId }) => apiJson(`/api/meetings/${encodeURIComponent(deck.meeting.id)}/voting?action=table-topics-entries`, {
    method: "PUT", body: JSON.stringify({ entries, currentTableTopicsEntryId }),
  }),
  onSynced(result) {
    context.tableTopicsEntries = result.tableTopicsEntries;
    context.currentTableTopicsEntryId = result.currentTableTopicsEntryId;
    deck = { ...deck, tableTopicsEntries: result.tableTopicsEntries, currentTableTopicsEntryId: result.currentTableTopicsEntryId };
  },
  onStateChange: () => document.querySelectorAll("[data-tabletopics-sync]").forEach((node) => { node.outerHTML = tableTopicsSyncStatus(); }),
});

async function loadDeckData() {
  if (posterPreviewMode) {
    const posters = await Promise.all(["future-poster-1", "future-poster-2"].map(presentationAssetUrl));
    return {
      meeting: {},
      clubIntroPhoto: "",
      authenticated: false,
      tableTopicsSpeakers: [],
      votingTableId: "",
      tableTopicsTotal: 0,
      slides: posters[0] ? [{ key: "future-posters", type: "future-posters", images: posters.filter(Boolean) }] : [],
    };
  }
  const session = await apiJson("/api/session").catch(() => ({ authenticated: false }));
  const [{ meeting }, posters, clubIntroPhoto, sharingMaster] = await Promise.all([
    apiJson(`/api/meetings/${encodeURIComponent(meetingId)}?view=presentation`),
    futurePosterUrls(),
    presentationAssetUrl("club-intro-photo"),
    fetchSharingMasterAward(),
  ]);
  const live = await apiJson(`/api/meetings/${encodeURIComponent(meeting.id)}?view=table-topics-live`).catch(() => ({ meeting: { tableTopicsEntries: [] } }));
  let tableTopicsSpeakers = [];
  let votingTableId = "";
  const tableTopicsTotal = (await apiJson(`/api/meetings/${encodeURIComponent(meeting.id)}?action=table-topics-remaining`).catch(() => ({ total: 0 }))).total;
  if (session.authenticated) {
    const editable = await apiJson(`/api/meetings/${encodeURIComponent(meeting.id)}`).catch(() => ({ meeting: null }));
    tableTopicsSpeakers = editable.meeting?.tableTopicsSpeakers || [];
    votingTableId = editable.meeting?.votingForm?.tableId || "";
  }
  drawnTopicKeys = new Set();
  drawnTopicsByEntry = new Map();
  awaitingNextSpeaker = false;
  return {
    meeting,
    clubIntroPhoto,
    authenticated: session.authenticated,
    tableTopicsSpeakers,
    tableTopicsEntries: tableTopicsSync.hasLocalChanges() ? context.tableTopicsEntries : live.meeting?.tableTopicsEntries || [],
    currentTableTopicsEntryId: tableTopicsSync.hasLocalChanges() ? context.currentTableTopicsEntryId : live.meeting?.currentTableTopicsEntryId || "",
    votingTableId,
    tableTopicsTotal,
    slides: derivePresentationSlides(meeting, { futurePosters: posters, tableTopicsTotal, sharingMasterAward: sharingMaster }),
  };
}

function currentDeckState() {
  const active = document.querySelector(".meeting-slide.active");
  const timer = active?.querySelector(".slide-timer");
  return {
    key: active?.dataset.slideKey || "",
    index: Math.max(0, [...document.querySelectorAll(".meeting-slide")].indexOf(active)),
    timerRemaining: Number(timer?.dataset.remaining || 0),
    timerElapsed: Number(timer?.dataset.elapsed || 0),
    transitionRemaining: Number(timer?.dataset.transitionRemaining || 0),
    timerPhase: timer?.dataset.phase || "session",
    timerRunning: Boolean(timer?.classList.contains("running")),
  };
}

function outlineMarkup(slides) {
  return slides.map((slide, index) => `<button type="button" data-outline-index="${index}"><span>${String(index + 1).padStart(2, "0")}</span><strong>${escapeHtml(slide.title || slide.blockTitle || slide.type.replaceAll("-", " "))}</strong></button>`).join("");
}

function renderDeck(data, resume = {}) {
  window.clearInterval(timerInterval);
  window.clearInterval(tableTopicsLivePoll);
  activeAwardPoller?.stop();
  activeRemote?.close();
  activeRemote = null;
  deck = data;
  context = { authenticated: data.authenticated, tableTopicsSpeakers: data.tableTopicsSpeakers, tableTopicsEntries: data.tableTopicsEntries, currentTableTopicsEntryId: data.currentTableTopicsEntryId, tableTopicsTotal: data.tableTopicsTotal };
  const activeTheme = presentationTheme(data.meeting);
  const timerStyle = presentationTimerStyle();
  app.innerHTML = `<main class="meeting-presentation theme-${activeTheme} timer-style-${timerStyle} ${posterPreviewMode ? "poster-preview" : ""}" aria-label="Meeting presentation">
    ${themeSwitcherMarkup(activeTheme, timerStyle)}
    <aside class="presentation-outline" aria-label="Slide outline"><header><strong>Run of show</strong><button type="button" data-close-outline aria-label="Close outline">×</button></header><div>${outlineMarkup(data.slides)}</div></aside>
    <div class="meeting-slides">${data.slides.map((slide) => renderSlide(slide, data.meeting, data.clubIntroPhoto, context)).join("")}</div>
    <div class="presentation-controls" aria-label="Presentation controls">
      <div class="control-group navigation-controls" aria-label="Slide navigation">
        <button class="icon-control" type="button" data-outline-toggle aria-label="Open slide outline" title="Slide outline">${CONTROL_ICONS.menu}</button>
        <button class="icon-control" type="button" data-previous aria-label="Previous slide">${CONTROL_ICONS.previous}</button>
        <label class="page-jump"><input data-page-jump type="number" min="1" max="${data.slides.length}" value="1" aria-label="Go to slide"> <span aria-hidden="true">/</span> <span data-total>${data.slides.length}</span></label>
        <button class="icon-control" type="button" data-next aria-label="Next slide">${CONTROL_ICONS.next}</button>
      </div>
      <div class="control-group deck-controls" aria-label="Presentation deck controls">
        <button class="labeled-control" type="button" data-refresh-agenda aria-label="Refresh deck" title="Reload meeting data and rebuild the presentation">${CONTROL_ICONS.refresh}<span>Refresh deck</span></button>
        <button class="labeled-control" type="button" data-edit-text aria-label="Edit slide text" aria-pressed="false" title="Edit text · Press E">${CONTROL_ICONS.edit}<span>Edit text</span></button>
      </div>
      <div class="control-group external-controls" data-external-controls aria-label="External deck controls" hidden>
        <span class="external-instructions"><strong>External deck</strong><span>Present inside · Esc to return</span></span>
        <button class="icon-control" type="button" data-refresh-external aria-label="Reload external link" title="Reload external link">${CONTROL_ICONS.refresh}</button>
        <a class="icon-control" data-open-external aria-label="Open external link" title="Open external link" target="_blank" rel="noopener">${CONTROL_ICONS.open}</a>
        <button class="labeled-control external-next" type="button" data-next-external aria-label="Next agenda item" title="Next agenda item">${CONTROL_ICONS.next}<span>Next agenda item</span></button>
      </div>
      <div class="control-group view-controls" aria-label="View controls">
        <button class="icon-control" type="button" data-fullscreen aria-label="Enter fullscreen" title="Fullscreen · Press F">${CONTROL_ICONS.fullscreen}</button>
      </div>
      <details class="mobile-more-controls">
        <summary class="icon-control" aria-label="More presentation controls" title="More presentation controls">${CONTROL_ICONS.more}</summary>
        <div>
          <button type="button" data-refresh-agenda-mobile>${CONTROL_ICONS.refresh}<span>Refresh deck</span></button>
          <button type="button" data-edit-text-mobile>${CONTROL_ICONS.edit}<span>Edit text</span></button>
          <button type="button" data-fullscreen-mobile>${CONTROL_ICONS.fullscreen}<span>Fullscreen</span></button>
        </div>
      </details>
      <span class="refresh-status" data-refresh-status aria-live="polite"></span>
    </div>
    ${remoteConfigured && !posterPreviewMode ? `<div class="remote-corner" data-remote-corner>
      <button type="button" class="remote-badge" data-remote-badge aria-label="手机遥控二维码" aria-expanded="false" title="手机遥控 · 扫码控制演示">
        <img data-remote-qr-mini alt="手机遥控二维码">
        <span class="remote-badge-label">扫码遥控投屏</span>
      </button>
      <div class="remote-panel" data-remote-panel hidden>
        <button type="button" class="remote-panel-close" data-remote-panel-close aria-label="关闭">×</button>
        <img data-remote-qr alt="扫码打开手机遥控器">
        <strong>手机遥控</strong>
        <p data-remote-hint>连接中…</p>
        <button type="button" data-remote-end>结束手机遥控</button>
      </div>
    </div>` : ""}
  </main>`;
  mountDeck(resume);
}

function mountDeck(resume) {
  // jump 只在首次挂载时生效，避免 refreshDeck() 重新挂载时覆盖 resume 定位、重复弹出 alert
  let jumpIndex = null;
  if (!jumpConsumed) {
    const jump = query.get("jump");
    jumpIndex = findSlideJumpIndex(deck.slides, jump, Number(query.get("order")));
    jumpConsumed = true;
  }
  let index;
  if (jumpIndex !== null) {
    index = jumpIndex >= 0 ? jumpIndex : 0;
  } else {
    index = resume.key ? deck.slides.findIndex((slide) => slide.key === resume.key) : Number(resume.index || 0);
    if (index < 0) index = Math.min(Number(resume.index || 0), deck.slides.length - 1);
  }
  let timerPanel = null;
  let remote = null;
  let remoteExpiryTimer = null;
  let remoteExpiresAt = 0;
  let nodes = [...document.querySelectorAll(".meeting-slide")];
  const controls = document.querySelector(".presentation-controls");
  const outline = document.querySelector(".presentation-outline");
  const textEditor = mountTemporaryTextEditor(document.querySelector(".meeting-presentation"));
  let awardTransitionPromise = null;
  const renderCeremonyInPlace = (replacements) => {
    deck = { ...deck, slides: replaceAwardCeremonySlides(deck.slides, replacements) };
    const slidesRoot = document.querySelector(".meeting-slides");
    slidesRoot.innerHTML = deck.slides.map((slide) => renderSlide(slide, deck.meeting, deck.clubIntroPhoto, context)).join("");
    nodes = [...slidesRoot.querySelectorAll(".meeting-slide")];
    outline.querySelector("div").innerHTML = outlineMarkup(deck.slides);
    document.querySelector("[data-total]").textContent = String(nodes.length);
    const pageJump = document.querySelector("[data-page-jump]");
    pageJump.max = String(nodes.length);
    outline.querySelectorAll("[data-outline-index]").forEach((button) => { button.onclick = () => { show(Number(button.dataset.outlineIndex)); outline.classList.remove("open"); }; });
  };
  const updateAwardWaitingStatus = (status) => {
    const waiting = deck.slides.find((slide) => slide.type === "award-waiting");
    if (!waiting) return;
    waiting.status = status;
    const node = document.querySelector(`[data-slide-key="${CSS.escape(waiting.key)}"]`);
    const heading = node?.querySelector("h1");
    if (heading) heading.textContent = status === "ready" ? "结果已就绪 · 按右键揭晓" : status === "error" ? "奖项读取失败 · 按右键重试" : "正在等待投票结果";
  };
  const awardPoller = createAwardPoller({
    load: () => apiJson(`/api/meetings/${encodeURIComponent(deck.meeting.id)}/awards?view=ceremony`),
    onData: (live) => { context.liveAwards = live; context.awardsError = ""; updateAwardWaitingStatus(live.ready ? "ready" : "waiting"); },
    onError: (error) => { context.awardsError = error.message; updateAwardWaitingStatus("error"); },
    intervalMs: AWARD_POLL_MS,
  });
  activeAwardPoller = awardPoller;
  const updateAwardPolling = () => {
    const type = deck.slides[index]?.type;
    if (type === "award-certificate" || type === "award-finish") awardPoller.stop();
    else if (type === "vote" || type === "awards" || type === "award-waiting") awardPoller.start().catch(() => {});
  };
  const enterAwardCeremony = () => {
    if (awardTransitionPromise) return awardTransitionPromise;
    // 后台轮询可能已经拿到就绪结果；复用它立刻跳转，避免再等一次网络往返导致首次按键"没反应"
    const cached = awardCeremonySlides(context.liveAwards || {});
    if (cached.length) {
      renderCeremonyInPlace(cached);
      awardPoller.stop();
      show(deck.slides.findIndex((slide) => slide.type === "award-certificate"));
      return Promise.resolve();
    }
    awardTransitionPromise = awardPoller.refreshOnce().then((live) => {
      context.liveAwards = live;
      const ceremony = awardCeremonySlides(live);
      if (!ceremony.length) { renderCeremonyInPlace([awardWaitingSlide(live.ready ? "ready" : "waiting")]); show(deck.slides.findIndex((slide) => slide.type === "award-waiting")); return; }
      renderCeremonyInPlace(ceremony);
      awardPoller.stop();
      show(deck.slides.findIndex((slide) => slide.type === "award-certificate"));
    }).catch(() => {
      renderCeremonyInPlace([awardWaitingSlide("error")]);
      show(deck.slides.findIndex((slide) => slide.type === "award-waiting"));
    }).finally(() => { awardTransitionPromise = null; });
    return awardTransitionPromise;
  };
  const refreshAwardsNow = async () => {
    const slot = deck.slides[index]?.awardSlot;
    const previousCeremonyIndex = deck.slides.slice(0, index).filter((slide) => slide.type === "award-certificate").length;
    const live = await awardPoller.refreshOnce().catch((error) => { document.querySelector("[data-refresh-status]").textContent = `奖项刷新失败 · ${error.message}`; return null; });
    if (!live) return;
    const ceremony = awardCeremonySlides(live);
    if (!ceremony.length) return;
    renderCeremonyInPlace(ceremony);
    const nextIndex = deck.slides.findIndex((slide) => slide.awardSlot === slot);
    const followingCertificate = deck.slides.filter((slide) => slide.type === "award-certificate")[previousCeremonyIndex];
    show(nextIndex >= 0 ? nextIndex : followingCertificate ? deck.slides.indexOf(followingCertificate) : deck.slides.findIndex((slide) => slide.type === "award-finish"));
  };
  const refreshTableTopicsLive = async () => {
    const live = await apiJson(`/api/meetings/${encodeURIComponent(deck.meeting.id)}?view=table-topics-live`).catch(() => null);
    if (!live?.meeting || tableTopicsSync.hasLocalChanges()) return;
    context.tableTopicsEntries = live.meeting.tableTopicsEntries || [];
    context.currentTableTopicsEntryId = live.meeting.currentTableTopicsEntryId || "";
    document.querySelectorAll("[data-live-entry-list]").forEach((list) => {
      const entries = context.tableTopicsEntries.slice(0, 20);
      list.innerHTML = entries.map((entry) => `<li><span>${escapeHtml(entry.name)}</span><strong>${formatSeconds(entry.durationSeconds)}</strong></li>`).join("") || "<li class=\"tabletopics-empty\">No timing records are available yet.</li>";
    });
  };
  const updateTableTopicsLivePolling = () => {
    window.clearInterval(tableTopicsLivePoll);
    tableTopicsLivePoll = isTableTopicsLiveSlide(deck.slides[index])
      ? window.setInterval(refreshTableTopicsLive, TABLE_TOPICS_LIVE_POLL_MS) : null;
  };
  const stopTimer = () => {
    window.clearInterval(timerInterval);
    timerInterval = null;
    timerPanel?.classList.remove("running");
    timerPanel = null;
  };
  // 圆环即是进度条本体：session 与 transition 共用同一个圆环，updateRing 只看当前 phase
  // 决定该用哪一组 total/remaining 计算 stroke-dashoffset，避免再维护一条独立的直线进度条。
  const updateRing = (panel) => {
    const inTransition = panel.dataset.phase === "transition";
    const ring = panel.querySelector("[data-timer-progress]");
    if (!ring) return;
    if (!inTransition && panel.classList.contains("has-signals")) {
      const red = Number(panel.dataset.red || 0);
      const elapsed = Number(panel.dataset.elapsed || 0);
      ring.style.strokeDashoffset = String(TIMER_RING_CIRCUMFERENCE * (1 - Math.min(1, elapsed / red)));
      return;
    }
    const total = Number(inTransition ? panel.dataset.transitionSeconds : panel.dataset.slideSeconds) || 0;
    const remaining = Number(inTransition ? panel.dataset.transitionRemaining : panel.dataset.remaining) || 0;
    const ratio = total ? Math.max(0, Math.min(1, remaining / total)) : 0;
    ring.style.strokeDashoffset = String(TIMER_RING_CIRCUMFERENCE * (1 - ratio));
  };
  const updateSignal = (panel) => {
    if (!panel.classList.contains("has-signals")) return;
    const rule = {
      green: Number(panel.dataset.green), yellow: Number(panel.dataset.yellow),
      red: Number(panel.dataset.red), bell: Number(panel.dataset.bell),
    };
    const state = timerSignalState(Number(panel.dataset.elapsed || 0), rule);
    for (const name of ["waiting", "green", "yellow", "red", "bell"]) panel.classList.toggle(`signal-${name}`, state === name);
    // 到绿牌节点前不亮任何牌，与现场举牌一致
    const card = panel.querySelector("[data-timer-card]");
    card.hidden = state === "waiting";
    card.textContent = state === "yellow" ? "黄牌" : state === "red" || state === "bell" ? "红牌" : state === "green" ? "绿牌" : "";
    panel.querySelector("[data-timer-bell]").hidden = state !== "bell";
    for (const color of ["green", "yellow", "red"]) {
      panel.querySelector(`[data-stack-${color}]`).classList.toggle("active", color === (state === "bell" ? "red" : state));
    }
    // 牌色已由外侧标签表达，圆环内只保留环节时限
    panel.querySelector("[data-timer-label]").textContent = panel.dataset.phase === "transition" ? "换场" : `${Number(panel.dataset.slideSeconds) / 60} min`;
  };
  const updateTimer = (panel, remaining) => {
    panel.dataset.remaining = String(remaining);
    if (panel.dataset.phase !== "transition") {
      panel.querySelector("[data-timer-display]").textContent = formatSeconds(panel.classList.contains("has-signals") ? panel.dataset.elapsed : remaining);
    }
    updateSignal(panel);
    updateRing(panel);
  };
  const updateTransition = (panel, remaining) => {
    panel.dataset.transitionRemaining = String(remaining);
    if (panel.dataset.phase === "transition") panel.querySelector("[data-timer-display]").textContent = formatSeconds(remaining);
    updateSignal(panel);
    updateRing(panel);
  };
  const resetTimer = (panel) => {
    const transitionSeconds = Number(panel.dataset.transitionSeconds || 0);
    panel.dataset.phase = transitionSeconds ? "transition" : "session";
    panel.dataset.elapsed = "0";
    updateTimer(panel, Number(panel.dataset.slideSeconds || 0));
    updateTransition(panel, transitionSeconds);
    panel.classList.remove("transition-complete");
  };
  const startTimer = (panel) => {
    stopTimer();
    timerPanel = panel;
    panel.classList.add("running");
    timerInterval = window.setInterval(() => {
      if (panel.dataset.phase === "transition") {
        const remaining = Math.max(0, Number(panel.dataset.transitionRemaining || 0) - 1);
        updateTransition(panel, remaining);
        if (!remaining) {
          panel.dataset.phase = "session";
          panel.classList.add("transition-complete");
          updateTimer(panel, Number(panel.dataset.remaining || 0));
        }
        return;
      }
      if (panel.classList.contains("has-signals")) {
        panel.dataset.elapsed = String(Number(panel.dataset.elapsed || 0) + 1);
        updateTimer(panel, Math.max(0, Number(panel.dataset.remaining || 0) - 1));
        return;
      }
      const remaining = Math.max(0, Number(panel.dataset.remaining || 0) - 1);
      updateTimer(panel, remaining);
      if (!remaining) stopTimer();
    }, 1000);
  };
  // 圆环计时器：hover 展开操作按钮加一段收起延迟，避免光标从圆环划向按钮时中途经过空隙被判定为离开；
  // 同时支持拖拽移动，让计时器可以挪开以免遮挡投屏内容。
  [...document.querySelectorAll(".slide-timer")].forEach((panel) => {
    let hideTimer = null;
    const showActions = () => { window.clearTimeout(hideTimer); panel.classList.add("actions-open"); };
    const scheduleHideActions = () => { window.clearTimeout(hideTimer); hideTimer = window.setTimeout(() => panel.classList.remove("actions-open"), 260); };
    panel.addEventListener("pointerenter", showActions);
    panel.addEventListener("pointerleave", scheduleHideActions);
    panel.addEventListener("focusin", showActions);
    panel.addEventListener("focusout", scheduleHideActions);

    let dragging = false;
    let dragMoved = false;
    let pointerOffsetX = 0;
    let pointerOffsetY = 0;
    panel.addEventListener("pointerdown", (event) => {
      if (event.target.closest("button")) return;
      dragging = true;
      dragMoved = false;
      panel.setPointerCapture(event.pointerId);
      const rect = panel.getBoundingClientRect();
      pointerOffsetX = event.clientX - rect.left;
      pointerOffsetY = event.clientY - rect.top;
    });
    panel.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      dragMoved = true;
      panel.classList.add("dragging");
      const stageRect = panel.closest(".stage-card").getBoundingClientRect();
      const left = Math.min(Math.max(event.clientX - pointerOffsetX - stageRect.left, 0), stageRect.width - panel.offsetWidth);
      const top = Math.min(Math.max(event.clientY - pointerOffsetY - stageRect.top, 0), stageRect.height - panel.offsetHeight);
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
      panel.style.right = "auto";
      panel.style.bottom = "auto";
    });
    const endDrag = (event) => {
      if (!dragging) return;
      dragging = false;
      panel.classList.remove("dragging");
      if (dragMoved) event.stopPropagation();
    };
    panel.addEventListener("pointerup", endDrag);
    panel.addEventListener("pointercancel", endDrag);
  });
  function canDrawTopicNow() {
    const slide = nodes[index];
    return Boolean(slide.classList.contains("tabletopics-draw-slide") && slide.querySelector("[data-draw-topic]:not(:disabled)"));
  }
  function timerStateNow() {
    if (!timerPanel) return "idle";
    if (timerPanel.classList.contains("running")) return "running";
    return Number(timerPanel.dataset.remaining || 0) ? "paused" : "idle";
  }
  let redrawConfirmTimer = null;
  // 换题必须 3 秒内再按一次确认（本机点击与手机遥控共用），防止把“给下一位抽题”误操作成给当前 Speaker 换题
  async function requestDrawTopic(slideNode) {
    const button = slideNode.querySelector("[data-draw-topic]");
    if (button?.hasAttribute("data-redraw") && !button.hasAttribute("data-confirming")) {
      const label = button.textContent;
      button.setAttribute("data-confirming", "");
      button.textContent = `再按一次，确认给 ${button.dataset.speakerName} 换题`;
      window.clearTimeout(redrawConfirmTimer);
      redrawConfirmTimer = window.setTimeout(() => {
        button.removeAttribute("data-confirming");
        button.textContent = label;
      }, 3000);
      return;
    }
    window.clearTimeout(redrawConfirmTimer);
    await drawTableTopic(slideNode);
    publishRemoteState();
  }
  function publishRemoteState() {
    if (!remote) return;
    const slide = deck.slides[index];
    const isExternal = Boolean(nodes[index].dataset.externalUrl);
    remote.publishState({
      surface: "presentation", index, total: nodes.length, canDrawTopic: canDrawTopicNow(), drawTopicMode: nodes[index].querySelector("[data-draw-topic][data-redraw]") ? "redraw" : "draw", timer: timerStateNow(),
      canRefreshDeck: true, canRefreshAwards: slide?.type === "award-certificate", canReloadExternal: isExternal, canFullscreenExternal: isExternal,
    });
  }
  function applyTimerCommand(command) {
    const panel = nodes[index].querySelector(".slide-timer");
    if (!panel) return;
    if (command === "timer-pause") { stopTimer(); publishRemoteState(); return; }
    if (command === "timer-reset") { stopTimer(); resetTimer(panel); publishRemoteState(); return; }
    if (command === "timer-start") {
      if (panel.dataset.phase === "transition") {
        panel.dataset.phase = "session";
        panel.classList.add("transition-complete");
        updateTimer(panel, Number(panel.dataset.remaining || 0));
      }
      startTimer(panel);
      publishRemoteState();
    }
  }
  async function dispatchRemoteCommand(value) {
    const remoteCommand = normalizeRemoteCommand(value);
    if (!remoteCommand || !isRemoteCommand(remoteCommand.command)) return;
    const { command, page } = remoteCommand;
    if (command === "previous") return previous();
    if (command === "next") return next();
    if (command === "go-to") {
      if (page < 1 || page > nodes.length) return;
      return show(page - 1);
    }
    if (command === "draw-topic") {
      const slide = nodes[index];
      if (canDrawTopicNow()) await requestDrawTopic(slide);
      return;
    }
    if (command === "refresh-deck") return refreshDeck();
    if (command === "refresh-awards") return refreshAwardsNow();
    if (command === "reload-external") {
      const frame = nodes[index].querySelector("[data-external-frame]");
      if (frame) frame.src = frame.dataset.src;
      return;
    }
    if (command === "fullscreen-external") {
      const stage = nodes[index].querySelector(".stage-card");
      stage?.requestFullscreen?.()?.catch((error) => console.warn("全屏请求被浏览器拒绝，可能需要先在展示端手动进入全屏", error));
      return;
    }
    applyTimerCommand(command);
  }
  const show = (next, { preserveTimer = false, autoStart = true } = {}) => {
    if (!preserveTimer) stopTimer();
    // 离开当前幻灯片前，如果它内部的元素仍处于全屏状态，先退出全屏，避免切页后全屏画面停留在已隐藏的旧 slide 上（黑屏无法恢复）
    if (document.fullscreenElement && nodes[index]?.contains(document.fullscreenElement)) document.exitFullscreen();
    index = Math.max(0, Math.min(nodes.length - 1, next));
    nodes.forEach((node, nodeIndex) => { node.classList.toggle("active", nodeIndex === index); node.setAttribute("aria-hidden", String(nodeIndex !== index)); });
    // 奖状用于合影，展示时隐藏 deck 控制栏/大纲/主题切换，保持纯黑背景居中无多余元素
    document.querySelector(".meeting-presentation").classList.toggle("award-photo-mode", deck.slides[index]?.type === "award-certificate");
    document.querySelectorAll("[data-outline-index]").forEach((button) => button.classList.toggle("active", Number(button.dataset.outlineIndex) === index));
    const externalUrl = nodes[index].dataset.externalUrl || "";
    const frame = nodes[index].querySelector("[data-external-frame]");
    if (frame && !frame.src) frame.src = frame.dataset.src;
    controls.classList.toggle("external-active", Boolean(externalUrl));
    document.querySelector("[data-external-controls]").hidden = !externalUrl;
    const openExternal = document.querySelector("[data-open-external]");
    openExternal.href = externalUrl || "#";
    document.querySelector("[data-page-jump]").value = String(index + 1);
    document.querySelector("[data-previous]").disabled = index === 0;
    document.querySelector("[data-next]").disabled = index === nodes.length - 1;
    nodes[index].querySelector("[data-word-reminder]")?.toggleAttribute("hidden", !isWordReminderVisible(deck.slides, index));
    const panel = nodes[index].querySelector(".slide-timer");
    if (autoStart && Number(panel?.dataset.transitionSeconds || 0)) startTimer(panel);
    updateTableTopicsLivePolling();
    updateAwardPolling();
    publishRemoteState();
  };
  const next = async () => {
    const slide = deck.slides[index];
    if (slide?.type === "awards" || slide?.type === "award-waiting") return enterAwardCeremony();
    show(index + 1);
  };
  const previous = () => {
    const slide = deck.slides[index];
    if (slide?.type === "award-certificate") {
      const first = deck.slides.findIndex((item) => item.type === "award-certificate");
      if (index === first) return show(deck.slides.findIndex((item) => item.type === "awards"));
    }
    show(index - 1);
  };
  document.querySelector("[data-next]").onclick = next;
  document.querySelector("[data-next-external]").onclick = next;
  document.querySelector("[data-previous]").onclick = previous;
  document.querySelector("[data-fullscreen]").onclick = () => document.documentElement.requestFullscreen?.();
  document.querySelector("[data-refresh-agenda]").onclick = () => refreshDeck();
  document.querySelector("[data-fullscreen-mobile]").onclick = () => document.querySelector("[data-fullscreen]").click();
  document.querySelector("[data-refresh-agenda-mobile]").onclick = () => document.querySelector("[data-refresh-agenda]").click();
  document.querySelector("[data-edit-text-mobile]").onclick = () => document.querySelector("[data-edit-text]").click();
  document.querySelector("[data-refresh-external]").onclick = () => { const frame = nodes[index].querySelector("[data-external-frame]"); if (frame) frame.src = frame.dataset.src; };
  document.querySelector("[data-outline-toggle]").onclick = () => outline.classList.toggle("open");
  document.querySelector("[data-close-outline]").onclick = () => outline.classList.remove("open");
  const themeSwitcher = document.querySelector(".presentation-themes");
  document.querySelector(".theme-trigger").onmouseenter = () => themeSwitcher.classList.add("open");
  document.querySelector(".theme-trigger").onfocus = () => themeSwitcher.classList.add("open");
  document.querySelector(".theme-trigger").onclick = () => themeSwitcher.classList.toggle("open");
  themeSwitcher.onmouseleave = () => themeSwitcher.classList.remove("open");
  themeSwitcher.onfocusout = (event) => { if (!themeSwitcher.contains(event.relatedTarget)) themeSwitcher.classList.remove("open"); };
  themeSwitcher.onclick = (event) => {
    const button = event.target.closest("[data-theme-id]");
    if (button) applyPresentationTheme(button.dataset.themeId);
    const timerButton = event.target.closest("[data-timer-style]");
    if (timerButton) applyPresentationTimerStyle(timerButton.dataset.timerStyle);
  };
  document.querySelector("[data-page-jump]").onchange = (event) => show(Number(event.target.value) - 1);
  document.querySelectorAll("[data-outline-index]").forEach((button) => { button.onclick = () => { show(Number(button.dataset.outlineIndex)); outline.classList.remove("open"); }; });
  document.querySelector(".meeting-slides").onclick = async (event) => {
    if (event.target.closest("[data-refresh-awards-live]")) { await refreshAwardsNow(); return; }
    const timerButton = event.target.closest("[data-timer-start], [data-timer-pause], [data-timer-reset]");
    if (timerButton) {
      event.stopPropagation();
      if (timerButton.matches("[data-timer-pause]")) applyTimerCommand("timer-pause");
      else if (timerButton.matches("[data-timer-reset]")) applyTimerCommand("timer-reset");
      else applyTimerCommand("timer-start");
      return;
    }
    if (event.target.closest("[data-draw-topic]")) { await requestDrawTopic(event.target.closest(".meeting-slide")); return; }
    if (event.target.closest("[data-next-tabletopics-speaker], [data-cancel-next-speaker]")) {
      awaitingNextSpeaker = Boolean(event.target.closest("[data-next-tabletopics-speaker]"));
      renderTableTopicsDrawSlides({ panel: false });
      document.querySelector(".meeting-slide.active .tabletopics-next-form input")?.focus();
      publishRemoteState();
      return;
    }
    if (event.target.closest("[data-tabletopics-sync-retry]")) { tableTopicsSync.retry(); return; }
    const currentEntry = event.target.closest("[data-current-tabletopics-entry]");
    if (currentEntry) {
      awaitingNextSpeaker = false;
      await saveTableTopicsEntries(context.tableTopicsEntries, currentEntry.dataset.currentTabletopicsEntry);
      return;
    }
    if (event.target.closest("input, select, textarea, label, button, a, [contenteditable], .external-content-stage, .slide-timer, .tabletopics-live-panel")) return;
    next();
  };
  document.querySelector(".meeting-slides").onsubmit = async (event) => {
    const form = event.target.closest("[data-tabletopics-entry-form]");
    if (!form) return;
    event.preventDefault();
    const status = form.querySelector("[data-tabletopics-entry-status]");
    const name = new FormData(form).get("name")?.trim();
    if (!name) return;
    const id = `tte_${crypto.randomUUID()}`;
    await saveTableTopicsEntries([...context.tableTopicsEntries, { id, name }], id, status);
  };
  document.querySelector(".meeting-slides").onchange = async (event) => {
    const duration = event.target.closest("[data-tabletopics-duration]");
    if (!duration) return;
    const entryId = duration.dataset.tabletopicsDuration;
    const entries = context.tableTopicsEntries.map((entry) => entry.id === entryId
      ? { ...entry, durationSeconds: duration.value === "" ? null : Number(duration.value) }
      : entry);
    await saveTableTopicsEntries(entries, context.currentTableTopicsEntryId, null, { panel: false });
  };

  // 乐观更新：本地校验通过即刷新台前，飞书写入交给 tableTopicsSync 在后台合并提交
  async function saveTableTopicsEntries(entries, currentTableTopicsEntryId, status = null, { panel = true } = {}) {
    let nextEntries;
    try {
      nextEntries = validateTableTopicsEntries(entries, currentTableTopicsEntryId);
    } catch (error) {
      if (status) status.textContent = error.code === "DUPLICATE_TABLE_TOPICS_SPEAKER" ? "这个名字已经录入过了" : error.message;
      return false;
    }
    // 只有录入框提交（带 status）才结束"等待下一位"；改时长等操作不能把录入框收起
    if (status) awaitingNextSpeaker = false;
    context.tableTopicsEntries = nextEntries;
    context.currentTableTopicsEntryId = currentTableTopicsEntryId;
    deck = { ...deck, tableTopicsEntries: nextEntries, currentTableTopicsEntryId };
    renderTableTopicsDrawSlides({ panel });
    publishRemoteState();
    tableTopicsSync.push({ entries: nextEntries, currentTableTopicsEntryId });
    return true;
  }
  const remoteCorner = document.querySelector("[data-remote-corner]");
  const remoteBadge = remoteCorner?.querySelector("[data-remote-badge]");
  const remotePanel = remoteCorner?.querySelector("[data-remote-panel]");
  const collapseRemotePanel = () => {
    if (!remotePanel) return;
    remotePanel.hidden = true;
    remoteBadge.setAttribute("aria-expanded", "false");
  };
  const closeRemote = () => {
    window.clearTimeout(remoteExpiryTimer);
    remoteExpiryTimer = null;
    remoteExpiresAt = 0;
    remote?.close();
    clearRemoteSession(remote?.roomId);
    remote = null;
    activeRemote = null;
  };
  // 角标二维码常驻展示，不依赖是否展开面板；savedSession 存在时沿用旧二维码内容，重连后生成新的
  const openRemote = async (savedSession = null) => {
    if (!remoteCorner || remote) return;
    const session = savedSession || createRemoteSession(createRemoteRoomId());
    const roomId = session.roomId;
    const url = `${window.location.origin}${remotePresentationUrl(meetingId, roomId)}`;
    const qrMini = remoteCorner.querySelector("[data-remote-qr-mini]");
    const qrImage = remoteCorner.querySelector("[data-remote-qr]");
    const hint = remoteCorner.querySelector("[data-remote-hint]");
    const dataUrl = await QRCode.toDataURL(url, { width: 320, margin: 1 });
    qrMini.src = dataUrl;
    qrImage.src = dataUrl;
    hint.textContent = "连接中…";
    remoteExpiresAt = session.expiresAt;
    saveRemoteSession(session);
    remoteExpiryTimer = window.setTimeout(closeRemote, Math.max(0, remoteExpiresAt - Date.now()));
    remote = createPresentationRemote({
      roomId,
      onCommand(command) {
        if (Date.now() >= remoteExpiresAt) {
          closeRemote();
          return;
        }
        dispatchRemoteCommand(command);
      },
      onRequestState() { publishRemoteState(); },
      onStatus(status) {
        if (status === "SUBSCRIBED") { hint.textContent = "已连接 · 手机可控制演示"; publishRemoteState(); }
        else if (status === "invalid-room" || status === "unavailable") hint.textContent = "遥控暂不可用";
        else if (status === "CLOSED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") hint.textContent = "已断开";
        else hint.textContent = "连接中…";
      },
    });
    activeRemote = remote;
  };
  if (remoteBadge && remotePanel) {
    remoteBadge.onclick = () => {
      const expanded = remoteBadge.getAttribute("aria-expanded") === "true";
      remotePanel.hidden = expanded;
      remoteBadge.setAttribute("aria-expanded", String(!expanded));
    };
    document.querySelector("[data-remote-panel-close]").onclick = collapseRemotePanel;
    document.querySelector("[data-remote-end]").onclick = () => { closeRemote(); collapseRemotePanel(); openRemote(); };
  }
  const restoredSession = savedRemoteSession(roomIdFromHash());
  if (remoteCorner) openRemote(restoredSession);
  document.onclick = (event) => {
    if (remotePanel && !remotePanel.hidden && !remoteCorner.contains(event.target)) collapseRemotePanel();
  };
  window.onkeydown = (event) => {
    if (event.key === "Escape" && remotePanel && !remotePanel.hidden) { collapseRemotePanel(); return; }
    if (textEditor.handleShortcut(event) || event.target.matches("input, textarea, [contenteditable]")) return;
    if (["ArrowRight", "ArrowDown", "PageDown", "Enter", " "].includes(event.key)) { event.preventDefault(); next(); }
    if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace"].includes(event.key)) { event.preventDefault(); previous(); }
    if (event.key.toLowerCase() === "f") document.documentElement.requestFullscreen?.();
  };
  const resuming = resume.key === deck.slides[index]?.key;
  if (jumpIndex === -1) window.alert("暂无内容，已定位到第一页");
  show(index, { autoStart: !resuming });
  const panel = nodes[index]?.querySelector(".slide-timer");
  if (panel && resuming) {
    panel.dataset.phase = resume.timerPhase;
    panel.dataset.elapsed = String(resume.timerElapsed || 0);
    updateTimer(panel, resume.timerRemaining);
    updateTransition(panel, resume.transitionRemaining);
    panel.classList.toggle("transition-complete", resume.timerPhase === "session" && Number(panel.dataset.transitionSeconds || 0) > 0);
    if (resume.timerRunning) startTimer(panel);
  }
}

async function drawTableTopic(slideNode) {
  const drawArea = slideNode.querySelector("[data-tabletopics-draw]");
  const button = drawArea.querySelector("[data-draw-topic]");
  const status = drawArea.querySelector("[data-tabletopics-status]");
  button.disabled = true;
  status.textContent = "抽取中…";
  try {
    const result = await apiJson(`/api/meetings/${encodeURIComponent(deck.meeting.id)}?action=draw-topic`, {
      method: "POST",
      body: JSON.stringify({ excludeKeys: tableTopicsPool(context).excludeKeys }),
    });
    drawnTopicKeys.add(result.key);
    drawnTopicsByEntry.set(context.currentTableTopicsEntryId, { key: result.key, text: result.topicText });
    renderTableTopicsDrawSlides();
  } catch (error) {
    button.disabled = false;
    status.textContent = error.code === "NO_TOPICS_LEFT" ? "话题已抽完" : error.message;
  }
}

function topicCharacters(text) {
  let characterIndex = 0;
  return topicTokens(text).map((token) => {
    if (/^\s$/.test(token)) return escapeHtml(token);
    const characters = [...token].map((character) => {
      const markup = `<span class="tabletopics-character" style="--character-index:${characterIndex}">${escapeHtml(character)}</span>`;
      characterIndex += 1;
      return markup;
    }).join("");
    return [...token].length > 1 ? `<span class="tabletopics-word">${characters}</span>` : characters;
  }).join("");
}

async function refreshDeck() {
  const resume = currentDeckState();
  const button = document.querySelector("[data-refresh-agenda]");
  const status = document.querySelector("[data-refresh-status]");
  button.disabled = true;
  status.textContent = "Refreshing…";
  try {
    renderDeck(await loadDeckData(), resume);
    document.querySelector("[data-refresh-status]").textContent = "Updated";
  } catch (error) {
    button.disabled = false;
    status.textContent = `Refresh failed · ${error.message}`;
  }
}

async function load() {
  try {
    const data = await loadDeckData();
    if (!data.slides.length) return renderError("Future meeting poster not uploaded");
    renderDeck(data);
  }
  catch { renderError("Presentation unavailable"); }
}

window.addEventListener("pagehide", () => { activeAwardPoller?.stop(); activeRemote?.close(); }, { once: true });

load();

import "./styles.css";
import "./meeting-presentation.css";
import { CLUB_PROFILE } from "./club-profile.js";
import { appendVersion } from "./meeting-helpers.js";
import { derivePresentationSlides } from "./meeting-presentation-model.js";

const posterRoute = window.location.pathname.match(/^\/(?:m\/(\d+)\/)?posters\/?$/);
const route = window.location.pathname.match(/^\/meetings\/([^/]+)\/presentation\/?$/) || window.location.pathname.match(/^\/m\/(\d+)\/presentation\/?$/) || posterRoute;
const meetingId = decodeURIComponent(route?.[1] || "");
const app = document.querySelector("#app");
const clubBrandUrl = CLUB_PROFILE.logo;
const THEMES = new Set(["current", "sky", "white"]);
const query = new URLSearchParams(window.location.search);
const posterPreviewMode = Boolean(posterRoute) || query.get("preview") === "future-posters";

function presentationTheme() {
  const theme = query.get("theme") || "sky";
  return THEMES.has(theme) ? theme : "sky";
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function field(value, className = "") {
  return value === "TBD"
    ? `<span class="tbd ${className}">TBD</span>`
    : `<span class="${className}">${escapeHtml(value)}</span>`;
}

function fitClass(value, mediumAt = 22, longAt = 30) {
  const length = String(value || "").length;
  return length > longAt ? "fit-long" : length > mediumAt ? "fit-medium" : "";
}

function formatSeconds(seconds) {
  const value = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(value / 60);
  const rest = value % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

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

async function awardState() {
  try {
    const data = await apiJson(`/api/meetings/${encodeURIComponent(meetingId)}/awards?view=confirmed`);
    if (data.confirmedAwards) return { ready: true, url: `/m/${encodeURIComponent(data.confirmedAwards.meetingNumber || meetingId)}/awards`, reason: "" };
    return { ready: false, url: "", reason: data.awardsStale ? "Awards changed. Reconfirm results in Agenda." : "Award results have not been confirmed." };
  } catch (error) {
    return { ready: false, url: "", reason: `Award status unavailable: ${error.message}` };
  }
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

function shell(slide, content, className = "") {
  return `<article class="meeting-slide ${slide.type} ${className}" data-slide-key="${escapeHtml(slide.key || slide.type)}" data-slide-title="${escapeHtml(slide.title || slide.blockTitle || slide.type)}" aria-hidden="true">
    <div class="stage-card">
      <header class="slide-brand">
        <img src="${clubBrandUrl}" alt="${escapeHtml(CLUB_PROFILE.clubName)}">
      </header>
      ${content}
      ${timerDock(slide)}
    </div>
  </article>`;
}

function timerDock(slide) {
  const seconds = Math.max(0, Math.round(Number(slide.duration || 0) * 60));
  if (!seconds) return "";
  return `<aside class="slide-timer" data-slide-seconds="${seconds}" data-remaining="${seconds}" aria-label="Session timer">
    <span>${escapeHtml(slide.duration)} min</span>
    <strong data-timer-display>${formatSeconds(seconds)}</strong>
    <div>
      <button type="button" data-timer-start aria-label="Start timer" title="Start">&#9658;</button>
      <button type="button" data-timer-pause aria-label="Pause timer" title="Pause">&#10073;&#10073;</button>
      <button type="button" data-timer-reset aria-label="Reset timer" title="Reset">&#8634;</button>
    </div>
  </aside>`;
}

function cover(slide) {
  return shell(slide, `<div class="cover-copy">
    <p>No.${escapeHtml(slide.subtitle.replace(/^No\./, "").replace(/ Regular Meeting$/, ""))} Regular Meeting</p>
    <h1>${escapeHtml(slide.title)}</h1>
    ${slide.theme ? `<strong>${escapeHtml(slide.theme)}</strong>` : ""}
    ${slide.date ? `<time>${escapeHtml(slide.date)}</time>` : ""}
  </div>`, "cover-slide");
}

function practiceIntro(slide) {
  return shell(slide, `<div class="intro-grid">
    <div>
      <p class="section-kicker">Why practice together</p>
      <h1>Learn by doing</h1>
      <p>Meeting roles turn communication and leadership into repeatable practice, with immediate feedback from peers.</p>
    </div>
    <div class="intro-badge">
      <img src="${clubBrandUrl}" alt="">
      <span>Take a role</span>
      <span>Try a speech</span>
      <span>Give feedback</span>
    </div>
  </div>`);
}

function clubIntro(slide, photo) {
  return shell(slide, `<div class="club-intro-copy">
    <p class="section-kicker">${escapeHtml(CLUB_PROFILE.intro.eyebrow)}</p>
    <h1>${escapeHtml(CLUB_PROFILE.intro.title)}</h1>
    <div class="club-beliefs">
      ${CLUB_PROFILE.intro.beliefs.map((belief) => `<span>${escapeHtml(belief)}</span>`).join("")}
    </div>
  </div>${photo ? `<img class="club-intro-photo" src="${escapeHtml(photo)}" alt="${escapeHtml(CLUB_PROFILE.clubName)} members">` : ""}`, photo ? "club-intro-with-photo" : "");
}

function program(slide) {
  return shell(slide, `<div class="program-copy">
    <p class="section-kicker">Today&apos;s Program</p>
    <div class="program-board">
      ${slide.blocks.map((block) => `<section>
        <h2>${escapeHtml(block.title)}</h2>
        ${block.items.map((item) => `<div class="${item.kind === "break" ? "program-break" : ""}"><span>${escapeHtml(item.session)}</span>${item.member ? field(item.member) : ""}</div>`).join("")}
      </section>`).join("")}
    </div>
  </div>`);
}

function vote(slide, meeting) {
  const qr = activeVotingImage(meeting);
  return shell(slide, `<div class="vote-layout">
    <div>
      <p class="section-kicker">${escapeHtml(slide.role)}</p>
      <h1>${escapeHtml(slide.title)}</h1>
      <p class="host-line">${field(slide.member)}</p>
    </div>
    <div class="vote-qr ${qr ? "has-qr" : ""}">
      ${qr ? `<img src="${escapeHtml(qr)}" alt="Voting QR code">` : `<span>QR<br>not ready</span>`}
      <strong>Scan with WeChat</strong>
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
    <p class="section-kicker">${escapeHtml(slide.blockTitle)}</p>
    <div class="speech-main">
      <h1 class="${fitClass(slide.title)}">${escapeHtml(slide.title)}</h1>
      <p class="speaker-line">${field(slide.member)}</p>
    </div>
    <div class="speech-meta">
      <p class="evaluator-line"><span>Evaluator</span>${field(slide.evaluator)}</p>
      ${slide.objective ? `<p class="objective-line">${escapeHtml(slide.objective)}</p>` : ""}
    </div>
  </div>`);
}

function item(slide) {
  const awardLink = slide.type === "awards" ? slide.awardState?.ready
    ? `<a class="award-page-link award-action" href="${escapeHtml(slide.awardState.url)}" target="_blank" rel="noopener">Open award page</a>`
    : `<button class="award-page-link award-action disabled" type="button" disabled title="${escapeHtml(slide.awardState?.reason || "Awards are not ready.")}">Open award page</button><small class="award-status">${escapeHtml(slide.awardState?.reason || "Awards are not ready.")}</small>` : "";
  return shell(slide, `<div class="session-copy">
    <p class="section-kicker">${escapeHtml(slide.blockTitle || slide.role)}</p>
    <h1 class="${fitClass(slide.title)}">${escapeHtml(slide.title)}</h1>
    ${slide.role ? `<p class="role-line">${escapeHtml(slide.role)}</p>` : ""}
    <p class="host-line">${field(slide.member)}</p>
    ${awardLink}
  </div>`, slide.type === "awards" ? "awards-flow-slide" : "");
}

function breakSlide(slide, context) {
  return shell(slide, `<div class="break-copy">
    <h1 class="${fitClass(slide.title)}">${escapeHtml(slide.title)}</h1>
    <p>${escapeHtml(slide.duration)} min</p>
    <div class="break-voting-prompt"><strong>Add Table Topics speakers before voting.</strong>${context.authenticated
      ? `<label><span>One speaker per line</span><textarea data-break-speakers>${escapeHtml(context.tableTopicsSpeakers.join("\n"))}</textarea></label><button type="button" data-save-break-speakers>Save speakers & update voting form</button><small data-break-status></small>`
      : "<span>Ask the meeting operator to update the voting form.</span>"}</div>
  </div>`, "break-slide");
}

function externalContent(slide) {
  const url = escapeHtml(slide.url);
  return `<article class="meeting-slide external-content" data-slide-key="${escapeHtml(slide.key)}" data-slide-title="${escapeHtml(slide.title)}" data-external-url="${url}" aria-hidden="true">
    <div class="stage-card external-content-stage">
      <iframe data-external-frame data-src="${url}" title="${escapeHtml(slide.title)} external presentation" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-presentation" allow="fullscreen; clipboard-read; clipboard-write" allowfullscreen></iframe>
      ${timerDock(slide)}
    </div>
  </article>`;
}

function thanks(slide) {
  return shell(slide, `<div class="thanks-copy">
    <h1>Thanks!</h1>
    <p><strong>追求完美旅程，共建美好世界</strong></p>
    <p>To pursue the perfect trip for a better world</p>
  </div>`);
}

function renderSlide(slide, meeting, clubIntroPhoto, context) {
  if (slide.type === "cover") return cover(slide);
  if (slide.type === "practice-intro") return practiceIntro(slide);
  if (slide.type === "club-intro") return clubIntro(slide, clubIntroPhoto);
  if (slide.type === "program") return program(slide);
  if (slide.type === "vote") return vote(slide, meeting);
  if (slide.type === "future-posters") return futurePosters(slide);
  if (slide.type === "speech") return speech(slide);
  if (slide.type === "break") return breakSlide(slide, context);
  if (slide.type === "external-content") return externalContent(slide);
  if (slide.type === "thanks") return thanks(slide);
  return item(slide);
}

function renderError(message) {
  app.innerHTML = `<main class="presentation-error"><div><span>Meeting presentation</span><h1>${escapeHtml(message)}</h1><p>Open Agenda and check this meeting.</p><a href="/">Open Agenda</a></div></main>`;
}

let deck = null;
let timerInterval = null;
let awardPoll = null;

async function loadDeckData() {
  if (posterPreviewMode) {
    const posters = await Promise.all(["future-poster-1", "future-poster-2"].map(presentationAssetUrl));
    return {
      meeting: {},
      clubIntroPhoto: "",
      authenticated: false,
      tableTopicsSpeakers: [],
      votingTableId: "",
      slides: posters[0] ? [{ key: "future-posters", type: "future-posters", images: posters.filter(Boolean) }] : [],
    };
  }
  const session = await apiJson("/api/session").catch(() => ({ authenticated: false }));
  const [{ meeting }, awards, posters, clubIntroPhoto] = await Promise.all([
    apiJson(`/api/meetings/${encodeURIComponent(meetingId)}?view=presentation`),
    awardState(),
    futurePosterUrls(),
    presentationAssetUrl("club-intro-photo"),
  ]);
  let tableTopicsSpeakers = [];
  let votingTableId = "";
  if (session.authenticated) {
    const editable = await apiJson(`/api/meetings/${encodeURIComponent(meeting.id)}`).catch(() => ({ meeting: null }));
    tableTopicsSpeakers = editable.meeting?.tableTopicsSpeakers || [];
    votingTableId = editable.meeting?.votingForm?.tableId || "";
  }
  return {
    meeting,
    clubIntroPhoto,
    authenticated: session.authenticated,
    tableTopicsSpeakers,
    votingTableId,
    slides: derivePresentationSlides(meeting, { awardState: awards, futurePosters: posters }),
  };
}

function currentDeckState() {
  const active = document.querySelector(".meeting-slide.active");
  const timer = active?.querySelector(".slide-timer");
  return {
    key: active?.dataset.slideKey || "",
    index: Math.max(0, [...document.querySelectorAll(".meeting-slide")].indexOf(active)),
    timerRemaining: Number(timer?.dataset.remaining || 0),
    timerRunning: Boolean(timer?.classList.contains("running")),
  };
}

function outlineMarkup(slides) {
  return slides.map((slide, index) => `<button type="button" data-outline-index="${index}"><span>${String(index + 1).padStart(2, "0")}</span><strong>${escapeHtml(slide.title || slide.blockTitle || slide.type.replaceAll("-", " "))}</strong></button>`).join("");
}

function renderDeck(data, resume = {}) {
  window.clearInterval(timerInterval);
  window.clearInterval(awardPoll);
  deck = data;
  const context = { authenticated: data.authenticated, tableTopicsSpeakers: data.tableTopicsSpeakers };
  app.innerHTML = `<main class="meeting-presentation theme-${presentationTheme()} ${posterPreviewMode ? "poster-preview" : ""}" aria-label="Meeting presentation">
    <div class="outline-trigger" aria-hidden="true"></div>
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
      </div>
      <div class="control-group external-controls" data-external-controls aria-label="External link controls" hidden>
        <span class="control-label">External link</span>
        <button class="icon-control" type="button" data-refresh-external aria-label="Reload external link" title="Reload external link">${CONTROL_ICONS.refresh}</button>
        <a class="icon-control" data-open-external aria-label="Open external link" title="Open external link" target="_blank" rel="noopener">${CONTROL_ICONS.open}</a>
      </div>
      <div class="control-group view-controls" aria-label="View controls">
        <button class="icon-control" type="button" data-fullscreen aria-label="Enter fullscreen" title="Fullscreen · Press F">${CONTROL_ICONS.fullscreen}</button>
      </div>
      <span class="refresh-status" data-refresh-status aria-live="polite"></span>
    </div>
  </main>`;
  mountDeck(resume);
}

function mountDeck(resume) {
  let index = resume.key ? deck.slides.findIndex((slide) => slide.key === resume.key) : Number(resume.index || 0);
  if (index < 0) index = Math.min(Number(resume.index || 0), deck.slides.length - 1);
  let timerPanel = null;
  const nodes = [...document.querySelectorAll(".meeting-slide")];
  const controls = document.querySelector(".presentation-controls");
  const outline = document.querySelector(".presentation-outline");
  const stopTimer = () => {
    window.clearInterval(timerInterval);
    timerInterval = null;
    timerPanel?.classList.remove("running");
    timerPanel = null;
  };
  const updateTimer = (panel, remaining) => {
    panel.dataset.remaining = String(remaining);
    panel.querySelector("[data-timer-display]").textContent = formatSeconds(remaining);
  };
  const startTimer = (panel) => {
    stopTimer();
    timerPanel = panel;
    panel.classList.add("running");
    timerInterval = window.setInterval(() => {
      const remaining = Math.max(0, Number(panel.dataset.remaining || 0) - 1);
      updateTimer(panel, remaining);
      if (!remaining) stopTimer();
    }, 1000);
  };
  const show = (next, { preserveTimer = false } = {}) => {
    if (!preserveTimer) stopTimer();
    index = Math.max(0, Math.min(nodes.length - 1, next));
    nodes.forEach((node, nodeIndex) => { node.classList.toggle("active", nodeIndex === index); node.setAttribute("aria-hidden", String(nodeIndex !== index)); });
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
  };
  const next = () => show(index + 1);
  const previous = () => show(index - 1);
  document.querySelector("[data-next]").onclick = next;
  document.querySelector("[data-previous]").onclick = previous;
  document.querySelector("[data-fullscreen]").onclick = () => document.documentElement.requestFullscreen?.();
  document.querySelector("[data-refresh-agenda]").onclick = () => refreshDeck();
  document.querySelector("[data-refresh-external]").onclick = () => { const frame = nodes[index].querySelector("[data-external-frame]"); if (frame) frame.src = frame.dataset.src; };
  document.querySelector("[data-outline-toggle]").onclick = () => outline.classList.toggle("open");
  document.querySelector("[data-close-outline]").onclick = () => outline.classList.remove("open");
  document.querySelector(".outline-trigger").onmouseenter = () => outline.classList.add("open");
  outline.onmouseleave = () => outline.classList.remove("open");
  document.querySelector("[data-page-jump]").onchange = (event) => show(Number(event.target.value) - 1);
  document.querySelectorAll("[data-outline-index]").forEach((button) => { button.onclick = () => { show(Number(button.dataset.outlineIndex)); outline.classList.remove("open"); }; });
  document.querySelector(".meeting-slides").onclick = async (event) => {
    const timerButton = event.target.closest("[data-timer-start], [data-timer-pause], [data-timer-reset]");
    if (timerButton) {
      event.stopPropagation();
      const panel = timerButton.closest(".slide-timer");
      if (timerButton.matches("[data-timer-pause]")) stopTimer();
      else if (timerButton.matches("[data-timer-reset]")) { stopTimer(); updateTimer(panel, Number(panel.dataset.slideSeconds || 0)); }
      else startTimer(panel);
      return;
    }
    if (event.target.closest("[data-save-break-speakers]")) { await saveBreakSpeakers(event.target.closest(".meeting-slide")); return; }
    if (event.target.closest("textarea, button, a, .external-content-stage")) return;
    next();
  };
  window.onkeydown = (event) => {
    if (event.target.matches("input, textarea")) return;
    if (["ArrowRight", "ArrowDown", "PageDown", "Enter", " "].includes(event.key)) { event.preventDefault(); next(); }
    if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace"].includes(event.key)) { event.preventDefault(); previous(); }
    if (event.key.toLowerCase() === "f") document.documentElement.requestFullscreen?.();
  };
  show(index);
  const panel = nodes[index]?.querySelector(".slide-timer");
  if (panel && resume.key === deck.slides[index]?.key && resume.timerRemaining) {
    updateTimer(panel, resume.timerRemaining);
    if (resume.timerRunning) startTimer(panel);
  }
  if (deck.slides.some((slide) => slide.type === "awards" && !slide.awardState?.ready)) awardPoll = window.setInterval(refreshAwardState, 10000);
}

async function refreshAwardState() {
  const awards = await awardState();
  const slide = deck?.slides.find((item) => item.type === "awards");
  if (!slide) return;
  slide.awardState = awards;
  const node = document.querySelector(`[data-slide-key="${CSS.escape(slide.key)}"]`);
  const old = node?.querySelector(".award-action");
  if (!old) return;
  const replacement = document.createElement(awards.ready ? "a" : "button");
  replacement.className = `award-page-link award-action${awards.ready ? "" : " disabled"}`;
  replacement.textContent = "Open award page";
  if (awards.ready) { replacement.href = awards.url; replacement.target = "_blank"; replacement.rel = "noopener"; window.clearInterval(awardPoll); }
  else { replacement.disabled = true; replacement.title = awards.reason; }
  old.replaceWith(replacement);
  node.querySelector(".award-status")?.replaceChildren(awards.reason);
}

async function saveBreakSpeakers(slideNode) {
  const status = slideNode.querySelector("[data-break-status]");
  const button = slideNode.querySelector("[data-save-break-speakers]");
  const speakers = [...new Set(slideNode.querySelector("[data-break-speakers]").value.split(/\r?\n/).map((name) => name.trim()).filter(Boolean))];
  const request = (confirmResponseReset = false) => apiJson(`/api/meetings/${encodeURIComponent(deck.meeting.id)}/voting?action=speakers`, { method: "PUT", body: JSON.stringify({ speakers, confirmResponseReset, tableId: deck.votingTableId }) });
  button.disabled = true;
  status.textContent = "Updating voting form…";
  try {
    let result;
    try { result = await request(); }
    catch (error) {
      if (error.code !== "VOTING_RESPONSE_RESET_REQUIRED" || !window.confirm(`Update speakers and delete ${error.details?.responseCount || 0} existing voting responses?`)) throw error;
      result = await request(true);
    }
    deck.tableTopicsSpeakers = result.tableTopicsSpeakers;
    document.querySelectorAll("[data-break-speakers]").forEach((input) => { input.value = result.tableTopicsSpeakers.join("\n"); });
    status.textContent = "Voting form updated.";
  } catch (error) { status.textContent = error.message; }
  finally { button.disabled = false; }
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

load();

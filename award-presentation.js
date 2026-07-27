import "./styles.css";
import "./award-presentation.css";
import { AWARD_DEFINITIONS, ceremonyAwards } from "./award-order.js";
import { CLUB_PROFILE } from "./club-profile.js";

const route = window.location.pathname.match(/^\/meetings\/([^/]+)\/awards\/present\/?$/) || window.location.pathname.match(/^\/m\/(\d+)\/awards\/?$/);
const meetingId = decodeURIComponent(route?.[1] || "");
const app = document.querySelector("#app");
const logoUrl = CLUB_PROFILE.logo;
const awardTitles = new Map([
  ...AWARD_DEFINITIONS.map(({ type, title }) => [type, title]),
  ["sharing_master", "SHARING MASTER"],
  ["speech_completion", "SPEECH COMPLETION"],
]);
const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
let waitingTimer = null;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function englishList(names) {
  if (names.length < 2) return names[0] || "";
  return names.join(" & ");
}

function displayDate(value) {
  return String(value || "").replaceAll("-", ".");
}

function fitClass(value, mediumAt, longAt) {
  const length = String(value || "").length;
  return length > longAt ? "fit-long" : length > mediumAt ? "fit-medium" : "";
}

function signatureName(value) {
  return String(value || "").split(" & ").map((name) => name.split(",")[0].trim()).join(" & ");
}

function certificateFrame(content, className = "") {
  return `<article class="award-slide ${className}" aria-hidden="true">
    <div class="certificate">
      <img class="certificate-logo" src="${logoUrl}" alt="${escapeHtml(CLUB_PROFILE.clubName)}">
      ${content}
    </div>
  </article>`;
}

function cover(snapshot, clubName) {
  return certificateFrame(`<div class="cover-content">
    <p class="cover-kicker">${escapeHtml(clubName)}</p>
    <h1>MEETING<br>AWARDS</h1>
    <div class="cover-rule"></div>
    <p>Meeting No. ${escapeHtml(snapshot.meetingNumber)}</p>
    <time datetime="${escapeHtml(snapshot.meetingDate)}">${escapeHtml(displayDate(snapshot.meetingDate))}</time>
  </div>`, "award-cover");
}

function certificate(snapshot, award, title, clubName) {
  const winner = englishList(award.winners.map(({ name }) => signatureName(name)));
  const signatoryName = signatureName(snapshot.signatory.name);
  const winnerClass = `winner ${fitClass(winner, 42, 62)}`.trim();
  const titleClass = `${award.type === "best_table_topics_speaker" ? "force-base-size" : fitClass(title, 24, 32)}`.trim();
  const signatureClass = fitClass(signatoryName, 14, 18);
  return certificateFrame(`<div class="award-content">
    <h1><span class="award-title ${titleClass}">${escapeHtml(title)}</span><span class="award-word">AWARD</span></h1>
    <p class="presented-to">Presented to</p>
    <div class="award-recipient">
      <p class="${winnerClass}">${escapeHtml(winner)}</p>
      <div class="certificate-divider" aria-hidden="true"></div>
    </div>
    <p class="club-name">${escapeHtml(clubName)}</p>
    <p class="meeting-number">Meeting No. <strong>${escapeHtml(snapshot.meetingNumber)}</strong></p>
    <div class="certificate-footer">
      <div class="certificate-date">
        <time datetime="${escapeHtml(snapshot.meetingDate)}">${escapeHtml(displayDate(snapshot.meetingDate))}</time>
        <div class="certificate-divider" aria-hidden="true"></div>
        <span>Date</span>
      </div>
      <div class="certificate-signature">
        <strong class="${signatureClass}">${escapeHtml(signatoryName)}</strong>
        <div class="certificate-divider" aria-hidden="true"></div>
        <span>Club President</span>
      </div>
    </div>
  </div>`);
}

function awardTitle(award) {
  return String(awardTitles.get(award.type) || award.title || "Meeting Award").replace(/\s+AWARD$/i, "").toUpperCase();
}

function renderError(message) {
  app.innerHTML = `<main class="presentation-error"><div><span>Meeting awards</span><h1>${escapeHtml(message)}</h1><p>Return to Agenda to confirm the voting results before presenting awards.</p><a href="/">Open Agenda</a></div></main>`;
}

function renderWaiting(message) {
  app.innerHTML = `<main class="presentation-waiting"><div><span class="waiting-live"><i></i> Live status</span><h1>${escapeHtml(message)}</h1><p>This page will open automatically when the Voting Host confirms the result.</p><small>Checking every 5 seconds</small></div></main>`;
}

function renderPresentation(data) {
  const snapshot = data.confirmedAwards;
  const awardPages = ceremonyAwards(snapshot.awards || []).map((award) => certificate(snapshot, award, awardTitle(award), data.clubName));
  app.innerHTML = `<main class="award-presentation" aria-label="Meeting award presentation">
      <div class="slides">${cover(snapshot, data.clubName)}${awardPages.join("")}</div>
      <div class="presentation-controls" aria-label="Presentation controls">
        <button type="button" data-previous aria-label="Previous slide">←</button>
        <span><b data-current>1</b> / <span data-total>${awardPages.length + 1}</span></span>
        <button type="button" data-next aria-label="Next slide">→</button>
        <button type="button" data-fullscreen aria-label="Enter fullscreen">⛶</button>
        <span class="fullscreen-hint">Press F</span>
      </div>
    </main>`;

  const slides = [...document.querySelectorAll(".award-slide")];
  let index = 0;
  const show = (next, options = {}) => {
    const previousIndex = index;
    index = Math.max(0, Math.min(slides.length - 1, next));
    slides.forEach((slide, slideIndex) => {
      slide.classList.toggle("active", slideIndex === index);
      slide.setAttribute("aria-hidden", String(slideIndex !== index));
    });
    document.querySelector("[data-current]").textContent = String(index + 1);
    document.querySelector("[data-previous]").disabled = index === 0;
    document.querySelector("[data-next]").disabled = index === slides.length - 1;
    if (options.celebrate && index > 0 && index !== previousIndex) celebrate();
  };
  const next = () => show(index + 1, { celebrate: true });
  const previous = () => show(index - 1);
  document.querySelector("[data-next]").addEventListener("click", next);
  document.querySelector("[data-previous]").addEventListener("click", previous);
  document.querySelector("[data-fullscreen]").addEventListener("click", () => document.documentElement.requestFullscreen?.());
  document.querySelector(".slides").addEventListener("click", next);
  window.addEventListener("keydown", (event) => {
    if (["ArrowRight", "ArrowDown", "PageDown", "Enter", " "].includes(event.key)) { event.preventDefault(); next(); }
    if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace"].includes(event.key)) { event.preventDefault(); previous(); }
    if (event.key.toLowerCase() === "f") document.documentElement.requestFullscreen?.();
  });
  show(0);
}

function celebrate() {
  if (reducedMotion?.matches) return;
  const burst = document.createElement("div");
  burst.className = "confetti-burst";
  for (let index = 0; index < 38; index += 1) {
    const piece = document.createElement("span");
    piece.textContent = "🎉";
    piece.style.setProperty("--start-x", `${Math.round(4 + Math.random() * 92)}vw`);
    piece.style.setProperty("--drift", `${Math.round((Math.random() - 0.5) * 34)}vw`);
    piece.style.setProperty("--rise", `${Math.round(60 + Math.random() * 34)}vh`);
    piece.style.setProperty("--r", `${Math.round((Math.random() - 0.5) * 420)}deg`);
    piece.style.setProperty("--d", `${Math.round(Math.random() * 360)}ms`);
    burst.append(piece);
  }
  document.body.append(burst);
  window.setTimeout(() => burst.remove(), 2200);
}

async function load() {
  window.clearTimeout(waitingTimer);
  try {
    const response = await fetch(`/api/meetings/${encodeURIComponent(meetingId)}/awards?view=confirmed`, { headers: { Accept: "application/json" } });
    const data = await response.json();
    if (!response.ok) return renderError(data.message || "Award presentation unavailable");
    if (!data.confirmedAwards) {
      renderWaiting(data.awardsStale || data.resultsChanged ? "Waiting for updated results" : "Waiting for result confirmation");
      waitingTimer = window.setTimeout(load, 5000);
      return;
    }
    renderPresentation(data);
  } catch {
    renderError("Award presentation could not be loaded");
  }
}

load();

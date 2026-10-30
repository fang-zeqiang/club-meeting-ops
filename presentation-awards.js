import { AWARD_DEFINITIONS, ceremonyAwards } from "./award-order.js";
import { CLUB_PROFILE } from "./club-profile.js";

const logoUrl = CLUB_PROFILE.logo;
const order = new Map(AWARD_DEFINITIONS.map((award, index) => [award.type, index]));

function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]); }
function names(winners = []) { return winners.map(({ name }) => String(name || "").split(",")[0].trim()).filter(Boolean).join(" & "); }
function displayDate(value) { return String(value || "").replaceAll("-", "."); }
function fitClass(value, mediumAt, longAt) { const length = String(value || "").length; return length > longAt ? "fit-long" : length > mediumAt ? "fit-medium" : ""; }
function frame(content, className) { return `<div class="award-certificate-slide ${className}"><div class="certificate"><img class="certificate-logo" src="${logoUrl}" alt="${escapeHtml(CLUB_PROFILE.clubName)}">${content}</div></div>`; }

export function awardWaitingSlide(status = "waiting") { return { key: "award:waiting", type: "award-waiting", status, title: status === "ready" ? "结果已就绪" : "等待投票结果" }; }

export function awardCeremonySlides(ceremony = {}) {
  const occurrences = new Map();
  const awards = ceremonyAwards((ceremony.awards || []).filter((award) => award.winners?.length).sort((left, right) => (order.get(left.type) ?? -1) - (order.get(right.type) ?? -1)));
  const certificates = awards.map((award) => {
    const occurrence = (occurrences.get(award.type) || 0) + 1;
    occurrences.set(award.type, occurrence);
    return { key: `award:${award.type}:${occurrence}`, awardSlot: `${award.type}:${occurrence}`, type: "award-certificate", title: award.title, award, ceremony };
  });
  return certificates.length ? [...certificates, { key: "award:finish", type: "award-finish", title: "Award Summary", awards, ceremony }] : [];
}

export function replaceAwardCeremonySlides(slides, replacements) {
  const withoutCeremony = slides.filter((slide) => !["award-waiting", "award-certificate", "award-finish", "award-summary"].includes(slide.type));
  const awardsIndex = withoutCeremony.findIndex((slide) => slide.type === "awards");
  return awardsIndex === -1 ? withoutCeremony : [...withoutCeremony.slice(0, awardsIndex + 1), ...replacements, ...withoutCeremony.slice(awardsIndex + 1)];
}

export function createAwardPoller({ load, onData, onError, intervalMs, schedule = setTimeout, cancel = clearTimeout }) {
  let running = false; let timer = null; let inFlight = null; let generation = 0;
  const refresh = (automatic) => {
    if (inFlight) return inFlight;
    const requestGeneration = generation;
    try { inFlight = Promise.resolve(load()); } catch (error) { inFlight = Promise.reject(error); }
    inFlight = inFlight.then((data) => { if (!automatic || (running && requestGeneration === generation)) onData(data); return data; }).catch((error) => { if (!automatic || (running && requestGeneration === generation)) onError(error); throw error; }).finally(() => { inFlight = null; if (automatic && running && requestGeneration === generation) timer = schedule(() => { refresh(true).catch(() => {}); }, intervalMs); });
    return inFlight;
  };
  return { start() { if (running) return inFlight || Promise.resolve(); running = true; return refresh(true); }, stop() { running = false; generation += 1; if (timer !== null) cancel(timer); timer = null; }, refreshOnce() { return refresh(false); }, isRunning() { return running; } };
}

export function renderAwardCeremonySlide(slide) {
  if (slide.type === "award-waiting") return `<div class="award-waiting-slide"><p>LIVE AWARDS</p><h1>${slide.status === "ready" ? "结果已就绪 · 按右键揭晓" : "正在等待投票结果"}</h1></div>`;
  if (slide.type === "award-finish") {
    const rows = slide.awards.map((award) => `<li><span>${escapeHtml(award.title)}</span><strong>${escapeHtml(names(award.winners))}</strong></li>`).join("");
    return frame(`<div class="award-finish-content"><p>${escapeHtml(slide.ceremony.clubName)}</p><h1>FINISH</h1><h2>Meeting No. ${escapeHtml(slide.ceremony.meetingNumber)} Award Summary</h2><ul>${rows}</ul></div>`, "award-finish-slide");
  }
  const award = slide.award;
  const winner = names(award.winners);
  const signatoryName = names([slide.ceremony.signatory || {}]);
  const winnerClass = `winner ${fitClass(winner, 42, 62)}`.trim();
  const titleClass = award.type === "best_table_topics_speaker" ? "force-base-size" : fitClass(award.title, 24, 32);
  const signatureClass = fitClass(signatoryName, 14, 18);
  return `<div class="certificate">
    <img class="certificate-logo" src="${logoUrl}" alt="${escapeHtml(CLUB_PROFILE.clubName)}">
    <div class="award-content">
      <h1><span class="award-title ${titleClass}">${escapeHtml(award.title)}</span><span class="award-word">AWARD</span></h1>
      <p class="presented-to">Presented to</p>
      <div class="award-recipient">
        <p class="${winnerClass}">${escapeHtml(winner)}</p>
        <div class="certificate-divider" aria-hidden="true"></div>
      </div>
      <p class="club-name">${escapeHtml(slide.ceremony.clubName)}</p>
      <p class="meeting-number">Meeting No. <strong>${escapeHtml(slide.ceremony.meetingNumber)}</strong></p>
      <div class="certificate-footer">
        <div class="certificate-date">
          <time datetime="${escapeHtml(slide.ceremony.meetingDate)}">${escapeHtml(displayDate(slide.ceremony.meetingDate))}</time>
          <div class="certificate-divider" aria-hidden="true"></div>
          <span>Date</span>
        </div>
        <div class="certificate-signature">
          <strong class="${signatureClass}">${escapeHtml(signatoryName)}</strong>
          <div class="certificate-divider" aria-hidden="true"></div>
          <span>Club President</span>
        </div>
      </div>
    </div>
  </div>
  <button type="button" class="award-live-refresh" data-refresh-awards-live aria-label="刷新奖项结果" title="刷新奖项结果">↻</button>`;
}

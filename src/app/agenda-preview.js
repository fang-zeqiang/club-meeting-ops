import { getPreparedSpeeches, getSpeechObjectiveDensityClass } from "../../meeting-helpers.js";
import { OFFICER_ROLES } from "../../officer-roles.js";
import { esc } from "../shared/html.js";
import { CLUB_PROFILE } from "../../club-profile.js";
import { CLUB_LOGO_URL, DEMO_MODE } from "./contract.js";
import { activeVotingImage, getTimeline, imageUrl, isFuturePostersTask, memberDisplayNameById, officerAssignmentsFromMembers, renderQrFrame, supportRoleEntries } from "./derivations.js";
import { runtime, state } from "./state.js";

function renderAgendaRows() {
  const timeline = getTimeline();
  return state.meeting.blocks
    .map((block) => {
      const rows = timeline
        .filter((row) => row.blockId === block.id)
        .map(
          (item) => item.kind === "break" ? `
          <tr class="break-row" data-preview-block="${esc(block.id)}" data-preview-item="${esc(item.id)}" tabindex="0" title="Edit ${esc(item.session)}">
            <td><strong>${item.start}</strong></td>
            <td>0:${String(item.duration).padStart(2, "0")}</td>
            <td colspan="3">${esc(item.session)}</td>
          </tr>` : `
          <tr class="${item.status}" data-preview-block="${esc(block.id)}" data-preview-item="${esc(item.id)}" tabindex="0" title="Edit ${esc(item.session)}">
            <td><strong>${item.start}</strong></td>
            <td>0:${String(item.duration).padStart(2, "0")}</td>
            <td>${esc(item.session)}</td>
            <td>${esc(item.role)}</td>
            <td>${esc(item.member || "Vacant")}</td>
          </tr>`,
        )
        .join("");
      return `<tr class="section-row ${block.id === state.selectedBlockId ? "selected" : ""}" data-preview-block="${esc(block.id)}" tabindex="0" title="Edit ${esc(block.title)}"><td colspan="5">${esc(block.title)}</td></tr>${rows}`;
    })
    .join("");
}

function renderFrontPage() {
  const m = state.meeting;
  const contest = m.meetingType === "contest";
  const officerAssignments = officerAssignmentsFromMembers();
  const officerLines = OFFICER_ROLES.map((role) => ({ role, name: memberDisplayNameById(officerAssignments[role], "Unassigned") }));
  const supportLines = supportRoleEntries();
  return `
    <section class="agenda-page front-page" aria-label="Agenda print preview front page">
      <header class="agenda-header">
        <h1>${esc(CLUB_PROFILE.clubName)} · Meeting ${esc(m.meetingNumber)}</h1>
        <p>${esc(CLUB_PROFILE.tagline)} · CLUB ${esc(CLUB_PROFILE.clubNumber)} · ${esc(CLUB_PROFILE.district)}</p>
      </header>
      <div class="agenda-meta-line">${esc(m.startTime)}, ${esc(m.date)} · Meeting Theme: ${esc(m.theme)}</div>
      <div class="agenda-layout">
        <aside class="agenda-sidebar">
          ${contest ? "" : `<h3>WORD OF THE DAY</h3><p class="word-of-day-copy"><strong>${esc(m.wordOfDay.word)}</strong> ${esc(m.wordOfDay.pronunciation)}<br />${esc(m.wordOfDay.example)}</p>`}
          <h3>MEETING VENUE</h3>
          <p>${esc(m.venue)}</p>
          <h3>OFFICER TEAM</h3>
          ${officerLines.map((entry) => `<div class="officer-line"><b>${esc(entry.role)}</b> ${esc(entry.name)}</div>`).join("")}
          <h3>SUPPORT ROLES</h3>
          ${supportLines.map((entry) => `<div class="officer-line"><b>${esc(entry.label)}</b> ${esc(entry.name || "Unassigned")}</div>`).join("")}
          <h3>4 TABOOS</h3>
          <p class="taboos-copy">Politics · Religion<br />Sex · Low Taste</p>
          <img class="club-logo" src="${CLUB_LOGO_URL}" alt="${esc(CLUB_PROFILE.clubName)} logo" />
        </aside>
        <table class="agenda-table">
          <thead><tr><th>From</th><th>Duration</th><th>Session</th><th>Role Title</th><th>Role Name</th></tr></thead>
          <tbody>${renderAgendaRows()}</tbody>
        </table>
      </div>
      ${contest ? `<div class="print-note contest-note"><strong>Speech slots: up to 7 min speech + 1 min judges’ scoring + 1 min introduction/transition.</strong><span>Judges are arranged separately; identities remain confidential. No public voting session.</span></div>` : `<div class="print-note">
        <div class="front-qr-row">
          <div class="front-qr-item">${renderQrFrame(m.qrSource === "system" ? "voting-system" : "voting", activeVotingImage(), "print-qr")}</div>
          <div class="front-qr-item">${renderQrFrame("wechat-payment-qr", state.paymentQr, "print-qr payment-qr")}<small>Member ¥20 | Guest ¥30</small></div>
        </div>
        <strong>Voting Code: ${esc(m.votingCode)}</strong>
        <span>Scan or enter the code after the meeting to vote.</span>
      </div>`}
    </section>`;
}

function renderPathwaysOverview() {
  const pathways = state.pathwaysCatalog?.paths || [];
  if (!pathways.length) return "";
  return `<article class="back-card pathways-overview"><h2>LEARNING PATHS</h2><div class="pathways-grid">${pathways.map(
    (name) => `<div class="pathway-item"><strong>${esc(name)}</strong></div>`,
  ).join("")}</div></article>`;
}

function renderBackPage() {
  const contest = state.meeting.meetingType === "contest";
  const preparedSpeeches = getPreparedSpeeches(state.meeting);
  const objectiveCount = preparedSpeeches.length;
  const densityClass = getSpeechObjectiveDensityClass(objectiveCount);
  const objectiveDensity = densityClass ? ` ${densityClass}` : "";
  return `
    <section class="agenda-page back-page${objectiveDensity}" aria-label="Agenda print preview back page">
      <header class="agenda-header">
        <h1>${esc(CLUB_PROFILE.clubName)}</h1>
        <p>${esc(CLUB_PROFILE.tagline)}</p>
      </header>
      <div class="back-page-grid">
        <div class="back-page-column">
          <article class="back-card">
            <h2>HOW TO JOIN US</h2>
            <div class="back-card-content">
              <strong>${contest ? "Take a meeting role and support the speakers." : "Take a meeting role or attend Table Topics."}</strong><br />
              Meet our officers, choose a learning path, and join a supportive practice community.
              ${renderQrFrame("group", state.groupQr, "back-qr")}
            </div>
          </article>
          ${contest ? `<article class="back-card"><h2>CONTEST OPERATIONS</h2><div class="back-card-content"><strong>TME</strong> briefs the rules and interviews contestants.<br /><strong>Timer</strong> provides live timing only.<br /><strong>Ballot Counter</strong> tallies and checks judges’ scores during interviews.</div></article>` : `<article class="back-card">
            <h2>VOTING CODE</h2>
            <div class="back-card-content">
              ${renderQrFrame(state.meeting.qrSource === "system" ? "voting-system" : "voting", activeVotingImage(), "back-qr")}
              <p class="voting-code-fallback"><strong>${esc(state.meeting.votingCode)}</strong></p>
              <p style="text-align:center">Vote for the best speaker, evaluator and Table Topics speaker.</p>
            </div>
          </article>`}
        </div>
        <div class="back-page-column back-page-column-main">
          <article class="back-card">
            <h2>${contest ? "CONTESTANTS" : "SPEECH OBJECTIVE"}</h2>
            <div class="back-card-content speech-objectives">
              ${
                preparedSpeeches.length
                  ? preparedSpeeches
                      .map(
                        (speech, index) => `<section class="speech-objective-item">
                          <div class="speech-objective-heading">
                            <span>Speech ${index + 1}</span>
                            <strong>${esc(speech.session || `Prepared Speech ${index + 1}`)}</strong>
                          </div>
                          <p class="speech-objective-speaker">${esc(speech.member || "Speaker to be confirmed")}</p>
                          ${contest ? "" : `<p class="speech-objective-copy ${speech.speechObjective?.trim() ? "" : "is-empty"}">${esc(speech.speechObjective?.trim() || "Objective to be confirmed")}</p>`}
                        </section>`,
                      )
                      .join("")
                  : '<p class="speech-objectives-empty">No prepared speeches scheduled.</p>'
              }
            </div>
          </article>
          ${contest ? "" : renderPathwaysOverview()}
          <article class="back-card">
            <h2>OFFICER TEAM</h2>
            <div class="back-card-content">
              ${state.officerTeamPhoto.present
                ? `<div class="photo-frame officer-team-photo"><img src="${esc(imageUrl("officer-team", state.officerTeamPhoto))}" alt="Officer team photo" /></div>`
                : '<p class="speech-objectives-empty">Officer team photo not uploaded.</p>'}
              <p>Our officers are here to help you choose a role, prepare a speech, and make your next small step.</p>
            </div>
          </article>
        </div>
      </div>
      <article class="back-card" style="margin-top:18px">
        <h2>ABOUT THIS CLUB</h2>
        <div class="back-card-content">
          ${esc(CLUB_PROFILE.agendaFooter)}
        </div>
      </article>
    </section>`;
}

export function renderPreviewToolbar() {
  if (!isFuturePostersTask()) return `<div><span class="eyebrow">Print proof · A4</span><strong>Live output</strong></div><span class="preview-page-count">2 pages</span>`;
  const presentationUrl = `/m/${encodeURIComponent(state.meeting.meetingNumber)}/presentation`;
  return `<div><span class="eyebrow">Presentation · 16:9</span><strong>Poster slide</strong></div>${DEMO_MODE ? '<button class="preview-open-link" disabled title="Unavailable in demo">Open full presentation ↗</button>' : `<a class="preview-open-link" href="${esc(presentationUrl)}" target="_blank" rel="noopener">Open full presentation ↗</a>`}`;
}

export function renderPreviewOutput() {
  if (!isFuturePostersTask()) return `${renderFrontPage()}${renderBackPage()}`;
  if (!state.futurePosters[0]?.present) return `<div class="poster-preview-empty"><span>Presentation · Future posters</span><strong>Poster slide not generated</strong><p>Upload required Poster 1 to preview it.</p></div>`;
  const versions = state.futurePosters.map((image) => image?.version || "missing").join("-");
  const url = `/m/${encodeURIComponent(state.meeting.meetingNumber)}/presentation?preview=future-posters&version=${encodeURIComponent(versions)}`;
  return `<div class="poster-stage-preview"><iframe src="${esc(url)}" title="Future meeting posters presentation preview" loading="eager"></iframe></div>`;
}

function updateAgendaPreviewScale(preview) {
  const styles = getComputedStyle(preview);
  const availableWidth = preview.clientWidth - Number.parseFloat(styles.paddingLeft) - Number.parseFloat(styles.paddingRight);
  const scale = Math.min(1, Math.max(0.2, availableWidth / (210 * 96 / 25.4)));
  preview.style.setProperty("--agenda-preview-scale", scale.toFixed(4));
}

export function bindAgendaPreviewSizing() {
  runtime.agendaPreviewResizeObserver?.disconnect();
  const preview = document.querySelector(".preview-scroll");
  if (!preview || isFuturePostersTask()) return;
  updateAgendaPreviewScale(preview);
  runtime.agendaPreviewResizeObserver = new ResizeObserver(() => updateAgendaPreviewScale(preview));
  runtime.agendaPreviewResizeObserver.observe(preview);
}

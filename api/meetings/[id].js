import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

import { signAgendaImageLink, verifyAgendaImageLink } from "../../server/agenda-image-link.js";
import { requireSession } from "../../server/auth.js";
import { configuredAppOrigin, handleApiError, methodNotAllowed, readJson, requestOrigin, sendJson, verifySameOrigin } from "../../server/http.js";
import { getGlobalAssetImage, getSystemVotingImage, getVotingImage, readStoredImage } from "../../server/media-repository.js";
import { getMeeting, getMembers, resolveMeetingId, updateMeeting, updateMeetingReview } from "../../server/meetings-repository.js";
import { getPathwaysCatalog, publicPathwaysCatalog } from "../../server/pathways-repository.js";
import { getGuestMeeting, getPresentationMeeting, getTableTopicsLiveMeeting } from "../../server/presentation-repository.js";
import { autofillWod } from "../../server/mcp-wod.js";
import { analyzeSignup, buildValidatedSignupMeeting } from "../../server/signup-import.js";
import { generateSignupText } from "../../server/mcp-agenda-read.js";
import { agendaEditService } from "../../server/mcp-agenda-edit.js";
import { SIGNUP_DEFAULT_VACANCY_MARKER, validateVacancyEmoji } from "../../vacancy-emoji.js";
import {
  getRoleRecommendations,
  markRoleOutreachBooked,
  polishOutreachDraft,
  restoreDismissedCandidate,
  restoreRecommendationExclusion,
  updateRecommendationExclusion,
  updateRoleOutreach,
} from "../../server/role-recommendations-repository.js";
import { createTopic, deleteTopic, drawTopic, listTopics, topicsRemainingCount } from "../../server/table-topics-repository.js";

export const maxDuration = 60;

let pdfBrowser;
let pdfBrowserLaunch;

async function getPdfBrowser() {
  if (pdfBrowser?.connected) {
    try {
      await pdfBrowser.version();
      return pdfBrowser;
    } catch {
      pdfBrowser = null;
    }
  }
  pdfBrowserLaunch ||= chromium.executablePath()
    .then((executablePath) => puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath,
      headless: chromium.headless,
    }))
    .then((browser) => {
      pdfBrowser = browser;
      return browser;
    })
    .finally(() => {
      pdfBrowserLaunch = null;
    });
  return pdfBrowserLaunch;
}

export { requestOrigin };

function snapshotHtml(html, snapshot) {
  const payload = JSON.stringify(snapshot).replace(/</g, "\\u003c");
  const marker = `<script>window.__AGENDA_PDF_SNAPSHOT__=${payload};</script>`;
  return html.includes("</head>") ? html.replace("</head>", `${marker}</head>`) : `${marker}${html}`;
}

async function fetchAppHtml(origin) {
  const response = await fetch(`${origin}/`);
  if (!response.ok) throw new Error("Could not load the Agenda app shell.");
  return response.text();
}

async function loadLatestPdfSnapshot(meetingId) {
  const [meeting, members, catalog] = await Promise.all([getMeeting(meetingId), getMembers(), getPathwaysCatalog()]);
  return { meeting, members, pathwaysCatalog: publicPathwaysCatalog(catalog) };
}

async function inlinePdfImage(image, loadStored) {
  if (image?.url) return image;
  const stored = await loadStored();
  if (!stored.attachment) return image || stored.image;
  const media = await readStoredImage(stored.attachment);
  return { ...(image || stored.image), url: `data:${media.type};base64,${media.body.toString("base64")}` };
}

async function inlinePdfImages(snapshot) {
  const votingImageKey = snapshot.meeting.qrSource === "manual" ? "votingQr" : "systemVotingQr";
  const [votingImage, groupQr, paymentQr, officerTeamPhoto] = await Promise.all([
    inlinePdfImage(snapshot.meeting[votingImageKey], () => snapshot.meeting.qrSource === "manual"
      ? getVotingImage(snapshot.meeting.id)
      : getSystemVotingImage(snapshot.meeting.id)),
    inlinePdfImage(snapshot.groupQr, () => getGlobalAssetImage("group-qr")),
    inlinePdfImage(snapshot.paymentQr, () => getGlobalAssetImage("wechat-payment-qr")),
    inlinePdfImage(snapshot.officerTeamPhoto, () => getGlobalAssetImage("officer-team-photo")),
  ]);
  return {
    ...snapshot,
    meeting: { ...snapshot.meeting, [votingImageKey]: votingImage },
    groupQr,
    paymentQr,
    officerTeamPhoto,
  };
}

async function renderMeetingPage(request, snapshot) {
  const origin = configuredAppOrigin();
  const browserPromise = getPdfBrowser();
  const [browser, html, readySnapshot] = await Promise.all([browserPromise, fetchAppHtml(origin), inlinePdfImages(snapshot)]);
  const { meeting } = readySnapshot;
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on("request", (browserRequest) => {
    const url = new URL(browserRequest.url());
    const path = url.pathname;
    if (browserRequest.isNavigationRequest() && path === "/" && url.searchParams.has("pdfSnapshot")) {
      return browserRequest.respond({ contentType: "text/html; charset=utf-8", body: snapshotHtml(html, readySnapshot) });
    }
    if (path === "/api/session") return browserRequest.respond({ contentType: "application/json", body: JSON.stringify({ authenticated: true }) });
    if (path === `/api/meetings/${encodeURIComponent(meeting.id)}`) return browserRequest.respond({ contentType: "application/json", body: JSON.stringify({ meeting }) });
    if (path === `/api/meetings/${encodeURIComponent(meeting.id)}/awards`) return browserRequest.respond({ contentType: "application/json", body: "{}" });
    return browserRequest.continue();
  });
  await page.goto(`${origin}/?pdfSnapshot=1`, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForFunction(
    () => document.querySelectorAll(".agenda-page").length === 2
      && document.fonts.status === "loaded"
      && [...document.images].every((image) => image.complete),
    { timeout: 45_000 },
  );
  await page.emulateMediaType("print");
  return { page, meeting };
}

async function sendMeetingPdf(request, response, snapshot) {
  let page;
  try {
    const rendered = await renderMeetingPage(request, snapshot);
    page = rendered.page;
    const { meeting } = rendered;
    const pdf = Buffer.from(await page.pdf({ format: "A4", printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } }));
    response.status(200).setHeader("Content-Type", "application/pdf");
    response.setHeader("Content-Disposition", `attachment; filename="Agenda-${meeting.meetingNumber}.pdf"`);
    response.setHeader("Content-Length", String(pdf.length));
    response.end(pdf);
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

async function sendMeetingImage(request, response, snapshot) {
  let page;
  try {
    const rendered = await renderMeetingPage(request, snapshot);
    page = rendered.page;
    const { meeting } = rendered;
    await page.setViewport({ ...page.viewport(), deviceScaleFactor: 2 });
    const front = await page.$(".agenda-page.front-page");
    if (!front) throw new Error("Could not find the agenda front page to capture.");
    const png = await front.screenshot({ type: "png" });
    response.status(200).setHeader("Content-Type", "image/png");
    response.setHeader("Content-Disposition", `inline; filename="Agenda-${meeting.meetingNumber}.png"`);
    response.setHeader("Content-Length", String(png.length));
    response.setHeader("Cache-Control", "private, max-age=300");
    response.end(png);
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

export default async function handler(request, response) {
  try {
    if (!["GET", "POST", "PUT"].includes(request.method)) return methodNotAllowed(response, ["GET", "POST", "PUT"]);
    const identifier = Array.isArray(request.query.id) ? request.query.id[0] : request.query.id;
    if (request.method === "GET" && request.query.view === "presentation") {
      return sendJson(response, 200, { meeting: await getPresentationMeeting(identifier) });
    }
    if (request.method === "GET" && request.query.view === "table-topics-live") {
      return sendJson(response, 200, { meeting: await getTableTopicsLiveMeeting(identifier) });
    }
    if (request.method === "GET" && request.query.view === "guest") {
      return sendJson(response, 200, { meeting: await getGuestMeeting(identifier) });
    }
    if (request.method === "GET" && request.query.action === "png" && request.query.sig) {
      const signedId = await resolveMeetingId(identifier);
      if (!verifyAgendaImageLink(signedId, request.query.sig, request.query.exp)) {
        return sendJson(response, 401, { code: "INVALID_IMAGE_LINK", message: "Image link is invalid or expired." });
      }
      const [meeting, members] = await Promise.all([getMeeting(signedId), getMembers()]);
      return sendMeetingImage(request, response, { meeting, members });
    }
    if (request.method === "GET" && request.query.action === "pdf" && request.query.sig) {
      const signedId = await resolveMeetingId(identifier);
      if (!verifyAgendaImageLink(signedId, request.query.sig, request.query.exp)) {
        return sendJson(response, 401, { code: "INVALID_IMAGE_LINK", message: "PDF link is invalid or expired." });
      }
      return sendMeetingPdf(request, response, await loadLatestPdfSnapshot(signedId));
    }
    const id = await resolveMeetingId(identifier);
    if (request.method === "GET") {
      if (request.query.action === "table-topics-remaining") {
        return sendJson(response, 200, { total: await topicsRemainingCount(id) });
      }
      if (!requireSession(request, response)) return;
      if (request.query.action === "recommendations") {
        return sendJson(response, 200, { recommendations: await getRoleRecommendations(id) });
      }
      if (request.query.action === "mcp-audit") {
        return sendJson(response, 200, { audits: await agendaEditService.listAudits(id) });
      }
      if (request.query.action === "pdf") {
        return sendMeetingPdf(request, response, await loadLatestPdfSnapshot(id));
      }
      if (request.query.action === "png") {
        const [meeting, members] = await Promise.all([getMeeting(id), getMembers()]);
        return sendMeetingImage(request, response, { meeting, members });
      }
      if (request.query.view === "table-topics") {
        return sendJson(response, 200, { topics: await listTopics(id) });
      }
      const meeting = await getMeeting(id);
      return sendJson(response, 200, { meeting });
    }
    if (request.method === "POST" && request.query.action === "draw-topic") {
      if (!verifySameOrigin(request)) return sendJson(response, 403, { code: "INVALID_ORIGIN", message: "Request origin is not allowed." });
      const body = await readJson(request);
      return sendJson(response, 200, await drawTopic(id, Array.isArray(body.excludeKeys) ? body.excludeKeys : []));
    }
    if (!requireSession(request, response)) return;
    if (!verifySameOrigin(request)) return sendJson(response, 403, { code: "INVALID_ORIGIN", message: "Request origin is not allowed." });
    const body = await readJson(request);
    if (request.method === "PUT" && request.query.action === "review") {
      return sendJson(response, 200, await updateMeetingReview(id, body));
    }
    if (request.method === "POST" && request.query.action === "mcp-recover") {
      return sendJson(response, 200, {
        recovery: await agendaEditService.recover(String(body.operationId || ""), requestOrigin(request), id),
      });
    }
    if (request.method === "POST" && request.query.action === "recommendation-exclusion") {
      if (body.restoreExclusionId) return sendJson(response, 200, await restoreRecommendationExclusion(body.restoreExclusionId));
      return sendJson(response, 200, await updateRecommendationExclusion(id, body));
    }
    if (request.method === "POST" && request.query.action === "role-outreach") {
      if (body.restoreDismissed) return sendJson(response, 200, await restoreDismissedCandidate(id, body.assignmentId, body.memberId));
      if (body.status === "booked") return sendJson(response, 200, await markRoleOutreachBooked(id, body));
      return sendJson(response, 200, await updateRoleOutreach(id, body));
    }
    if (request.method === "POST" && request.query.action === "polish-outreach") {
      return sendJson(response, 200, await polishOutreachDraft(body));
    }
    if (request.method === "POST" && request.query.action === "wod-autofill") {
      return sendJson(response, 200, await autofillWod(body.word));
    }
    if (request.method === "POST" && request.query.action === "table-topics-add") {
      return sendJson(response, 200, { topic: await createTopic(id, body.topicText, "admin") });
    }
    if (request.method === "POST" && request.query.action === "table-topics-delete") {
      await deleteTopic(id, String(body.key || ""));
      return sendJson(response, 200, { deleted: true });
    }
    if (request.method === "POST" && request.query.action === "pdf") {
      const snapshot = body.snapshot;
      if (snapshot?.meeting?.id !== id || !Array.isArray(snapshot.members)) {
        return sendJson(response, 400, { code: "INVALID_PDF_SNAPSHOT", message: "PDF snapshot must match the current meeting and include members." });
      }
      return sendMeetingPdf(request, response, await loadLatestPdfSnapshot(id));
    }
    if (request.method === "POST" && request.query.action === "generate-signup") {
      const language = body.language || "bilingual";
      const vacancyEmoji = body.vacancyEmoji == null ? SIGNUP_DEFAULT_VACANCY_MARKER : String(body.vacancyEmoji);
      if (!["bilingual", "zh-CN", "en"].includes(language)) return sendJson(response, 400, { code: "INVALID_LANGUAGE", message: "language must be bilingual, zh-CN, or en." });
      const emojiValidation = validateVacancyEmoji(vacancyEmoji);
      if (!emojiValidation.valid) return sendJson(response, 400, { code: emojiValidation.code, message: emojiValidation.message });
      if (body.includeSpeechDetails != null && typeof body.includeSpeechDetails !== "boolean") return sendJson(response, 400, { code: "INVALID_SPEECH_DETAILS", message: "includeSpeechDetails must be a boolean." });
      const meeting = await getMeeting(id);
      return sendJson(response, 200, {
        text: generateSignupText(meeting, {
          language,
          vacancyEmoji,
          includeSpeechDetails: body.includeSpeechDetails === true,
        }),
      });
    }
    if (request.method === "POST") {
      if (request.query.action !== "analyze-signup") return sendJson(response, 400, { code: "INVALID_ACTION", message: "Unsupported meeting action." });
      const [meeting, members] = await Promise.all([getMeeting(id), getMembers()]);
      return sendJson(response, 200, { analysis: await analyzeSignup({ signupText: body.signupText, expectedRevision: body.expectedRevision, meeting, members }) });
    }
    if (body.signupImport) {
      const [meeting, members] = await Promise.all([getMeeting(id), getMembers()]);
      const next = buildValidatedSignupMeeting({ meeting, members, changes: body.signupImport.changes, expectedRevision: body.expectedRevision });
      return sendJson(response, 200, { meeting: await updateMeeting(id, next, body.expectedRevision) });
    }
    return sendJson(response, 200, { meeting: await updateMeeting(id, body.meeting, body.expectedRevision) });
  } catch (error) {
    return handleApiError(response, error);
  }
}

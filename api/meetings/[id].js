import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

import { requireSession } from "../../server/auth.js";
import { handleApiError, methodNotAllowed, readJson, requestProtocol, sendJson, verifySameOrigin } from "../../server/http.js";
import { getMeeting, getMembers, resolveMeetingId, updateMeeting } from "../../server/meetings-repository.js";
import { getGuestMeeting, getPresentationMeeting } from "../../server/presentation-repository.js";
import { analyzeSignup, buildValidatedSignupMeeting } from "../../server/signup-import.js";
import { generateSignupText } from "../../server/mcp-agenda-read.js";

export const maxDuration = 60;

export function requestOrigin(request) {
  const host = String(request.headers["x-forwarded-host"] || request.headers.host || "");
  if (host) return `${requestProtocol(request)}://${host}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  throw new Error("Could not resolve the Agenda app origin.");
}

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

async function sendMeetingPdf(request, response, meeting) {
  const origin = requestOrigin(request);
  const html = await fetchAppHtml(origin);
  const browser = await puppeteer.launch({ args: chromium.args, defaultViewport: chromium.defaultViewport, executablePath: await chromium.executablePath(), headless: chromium.headless });
  try {
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on("request", (browserRequest) => {
      const url = new URL(browserRequest.url());
      const path = url.pathname;
      if (browserRequest.isNavigationRequest() && path === "/" && url.searchParams.has("pdfSnapshot")) {
        return browserRequest.respond({ contentType: "text/html; charset=utf-8", body: snapshotHtml(html, request.body.snapshot) });
      }
      if (path === "/api/session") return browserRequest.respond({ contentType: "application/json", body: JSON.stringify({ authenticated: true }) });
      if (path === `/api/meetings/${encodeURIComponent(meeting.id)}`) return browserRequest.respond({ contentType: "application/json", body: JSON.stringify({ meeting }) });
      if (path === `/api/meetings/${encodeURIComponent(meeting.id)}/awards`) return browserRequest.respond({ contentType: "application/json", body: "{}" });
      return browserRequest.continue();
    });
    await page.goto(`${origin}/?pdfSnapshot=1`, { waitUntil: "networkidle2", timeout: 45_000 });
    await page.waitForFunction(() => document.querySelectorAll(".agenda-page").length === 2, { timeout: 45_000 });
    await page.emulateMediaType("print");
    const pdf = Buffer.from(await page.pdf({ format: "A4", printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } }));
    response.status(200).setHeader("Content-Type", "application/pdf");
    response.setHeader("Content-Disposition", `attachment; filename="Agenda-${meeting.meetingNumber}.pdf"`);
    response.setHeader("Content-Length", String(pdf.length));
    response.end(pdf);
  } finally {
    await browser.close();
  }
}

export default async function handler(request, response) {
  try {
    if (!["GET", "POST", "PUT"].includes(request.method)) return methodNotAllowed(response, ["GET", "POST", "PUT"]);
    const identifier = Array.isArray(request.query.id) ? request.query.id[0] : request.query.id;
    if (request.method === "GET" && request.query.view === "presentation") {
      return sendJson(response, 200, { meeting: await getPresentationMeeting(identifier) });
    }
    if (request.method === "GET" && request.query.view === "guest") {
      return sendJson(response, 200, { meeting: await getGuestMeeting(identifier) });
    }
    if (!requireSession(request, response)) return;
    const id = await resolveMeetingId(identifier);
    if (request.method === "GET") {
      const meeting = await getMeeting(id);
      if (request.query.action === "pdf") return sendMeetingPdf(request, response, meeting);
      return sendJson(response, 200, { meeting });
    }
    if (!verifySameOrigin(request)) return sendJson(response, 403, { code: "INVALID_ORIGIN", message: "Request origin is not allowed." });
    const body = await readJson(request);
    if (request.method === "POST" && request.query.action === "pdf") {
      const meeting = await getMeeting(id);
      request.body = body;
      return sendMeetingPdf(request, response, meeting);
    }
    if (request.method === "POST" && request.query.action === "generate-signup") {
      const language = body.language || "bilingual";
      const vacancyEmoji = body.vacancyEmoji == null ? "🈳" : String(body.vacancyEmoji).trim();
      if (!["bilingual", "zh-CN", "en"].includes(language)) return sendJson(response, 400, { code: "INVALID_LANGUAGE", message: "language must be bilingual, zh-CN, or en." });
      if (!vacancyEmoji || [...vacancyEmoji].length > 8) return sendJson(response, 400, { code: "INVALID_VACANCY_EMOJI", message: "vacancyEmoji must contain 1 to 8 characters." });
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

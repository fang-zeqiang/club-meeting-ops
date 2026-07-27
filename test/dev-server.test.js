import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

import assetHandler from "../api/assets/[kind].js";
import { requestOrigin } from "../api/meetings/[id].js";
import mcpHandler from "../server/mcp.js";
import templateHandler from "../api/templates/[id].js";
import { matchApiRoute } from "../server/dev.js";
import { configuredAppOrigin, readJson } from "../server/http.js";

const meetingApiSource = await readFile(new URL("../api/meetings/[id].js", import.meta.url), "utf8");
const awardsApiSource = await readFile(new URL("../api/meetings/[id]/awards.js", import.meta.url), "utf8");
const httpSource = await readFile(new URL("../server/http.js", import.meta.url), "utf8");
const repositorySource = await readFile(new URL("../server/meetings-repository.js", import.meta.url), "utf8");

async function apiFiles(directory = new URL("../api/", import.meta.url)) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const url = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
    return entry.isDirectory() ? apiFiles(url) : [url.pathname];
  }));
  return nested.flat().filter((file) => file.endsWith(".js"));
}

test("local dev server exposes static and dynamic API routes", () => {
  assert.ok(matchApiRoute("/api/session"));
  assert.ok(matchApiRoute("/api/templates"));
  assert.ok(matchApiRoute("/api/pathways-catalog"));
  assert.ok(matchApiRoute("/api/roles"));
  assert.equal(matchApiRoute("/api/mcp").handler, mcpHandler);
  assert.equal(matchApiRoute("/.well-known/oauth-protected-resource/api/mcp").params.oauth, "resource-metadata");
  assert.equal(matchApiRoute("/.well-known/oauth-authorization-server").params.oauth, "server-metadata");
  assert.equal(matchApiRoute("/oauth/register").params.oauth, "register");
  assert.equal(matchApiRoute("/oauth/authorize").params.oauth, "authorize");
  assert.equal(matchApiRoute("/oauth/token").params.oauth, "token");
  for (const kind of ["group-qr", "officer-team-photo", "future-poster-1"]) {
    const route = matchApiRoute(`/api/assets/${kind}`);
    assert.equal(route.handler, assetHandler);
    assert.equal(route.params.kind, kind);
  }
  assert.equal(matchApiRoute("/api/meetings/meeting%201").params.id, "meeting 1");
  assert.equal(matchApiRoute("/api/meetings/meeting-1/images/voting").params.id, "meeting-1");
  assert.equal(matchApiRoute("/api/meetings/meeting-1/voting").params.id, "meeting-1");
  assert.equal(matchApiRoute("/api/meetings/meeting-1/awards").params.id, "meeting-1");
  assert.equal(matchApiRoute("/api/unknown"), null);
});

test("JSON reads enforce an actual byte limit without Content-Length", async () => {
  await assert.rejects(readJson({ body: "x".repeat(17) }, 16), /too large/i);
  await assert.rejects(readJson({ body: { value: "x".repeat(17) } }, 16), /too large/i);
});

test("local preview PDF route uses Chrome and forces the A4 preview view", async () => {
  const devServerSource = await readFile(new URL("../server/dev.js", import.meta.url), "utf8");
  const appSource = await readFile(new URL("../app.js", import.meta.url), "utf8");
  assert.match(devServerSource, /\/api\/preview-agenda\.pdf/);
  assert.match(devServerSource, /puppeteer\.launch\([\s\S]*executablePath: CHROME/);
  assert.match(devServerSource, /page\.pdf\(\{ format: "A4", printBackground: true/);
  assert.match(devServerSource, /finally \{[\s\S]*browser\.close\(\)/);
  assert.match(devServerSource, /\?pdfSnapshot=1/);
  assert.match(devServerSource, /window\.__AGENDA_PDF_SNAPSHOT__/);
  assert.match(appSource, /const pdfSnapshot = window\.__AGENDA_PDF_SNAPSHOT__/);
  assert.match(appSource, /if \(pdfSnapshot\?\.meeting\)[\s\S]*loadPdfSnapshotWorkspace\(pdfSnapshot\)/);
});

test("deployment stays within the 15-function Serverless limit", async () => {
  assert.ok((await apiFiles()).length <= 15);
});

test("meeting PDF route is authenticated and renders the existing A4 view", async () => {
  assert.match(meetingApiSource, /requireSession\(request, response\)/);
  assert.match(meetingApiSource, /request\.query\.action === "pdf"/);
  assert.match(meetingApiSource, /import \{[\s\S]*requestOrigin[\s\S]*\} from "\.\.\/\.\.\/server\/http\.js"/);
  assert.match(httpSource, /process\.env\.PUBLIC_APP_ORIGIN/);
  assert.match(meetingApiSource, /chromium\.executablePath\(\)/);
  assert.match(meetingApiSource, /page\.setRequestInterception\(true\)/);
  assert.match(meetingApiSource, /window\.__AGENDA_PDF_SNAPSHOT__/);
  assert.match(meetingApiSource, /snapshotHtml\(html, request\.body\.snapshot\)/);
  assert.match(meetingApiSource, /\?pdfSnapshot=1/);
  assert.match(meetingApiSource, /document\.querySelectorAll\("\.agenda-page"\)\.length === 2/);
  assert.match(meetingApiSource, /Content-Disposition/);
  assert.match(meetingApiSource, /Content-Length/);
});

test("meeting PDF accepts the configured public origin and rejects forged hosts", () => {
  const previous = process.env.VERCEL_URL;
  const previousPublic = process.env.PUBLIC_APP_ORIGIN;
  process.env.VERCEL_URL = "protected-deployment.vercel.app";
  process.env.PUBLIC_APP_ORIGIN = "https://preview.example.com";
  try {
    assert.equal(requestOrigin({
      headers: {
        host: "internal.vercel.app",
        "x-forwarded-host": "preview.example.com",
        "x-forwarded-proto": "https",
      },
    }), "https://preview.example.com");
    assert.equal(configuredAppOrigin(), "https://preview.example.com");
    assert.throws(() => requestOrigin({
      headers: {
        host: "internal.vercel.app",
        "x-forwarded-host": "169.254.169.254",
        "x-forwarded-proto": "http",
      },
    }), /approved application origin/);
  } finally {
    if (previous == null) delete process.env.VERCEL_URL;
    else process.env.VERCEL_URL = previous;
    if (previousPublic == null) delete process.env.PUBLIC_APP_ORIGIN;
    else process.env.PUBLIC_APP_ORIGIN = previousPublic;
  }
});

test("public short meeting numbers resolve before presentation APIs read data", () => {
  assert.match(meetingApiSource, /await resolveMeetingId/);
  assert.match(awardsApiSource, /await resolveMeetingId/);
  assert.match(repositorySource, /export async function resolveMeetingId/);
  assert.match(repositorySource, /meeting_number/);
  assert.match(repositorySource, /status\) !== "archived"/);
});

test("meeting API reuses POST for same-origin signup analysis", () => {
  assert.match(meetingApiSource, /\["GET", "POST", "PUT"\]/);
  assert.match(meetingApiSource, /verifySameOrigin/);
  assert.match(meetingApiSource, /request\.query\.action !== "analyze-signup"/);
  assert.match(meetingApiSource, /analyzeSignup\(\{ signupText: body\.signupText, expectedRevision: body\.expectedRevision, meeting, members \}\)/);
  assert.match(meetingApiSource, /buildValidatedSignupMeeting\(\{ meeting, members, changes: body\.signupImport\.changes, expectedRevision: body\.expectedRevision \}\)/);
  assert.match(meetingApiSource, /request\.query\.action === "generate-signup"[\s\S]*generateSignupText\(meeting/);
  assert.match(meetingApiSource, /vacancyEmoji must contain 1 to 8 characters/);
});

test("voting API accepts live speaker saves over PUT", async () => {
  const source = await readFile(new URL("../api/meetings/[id]/voting.js", import.meta.url), "utf8");
  assert.match(source, /request\.method === "PUT" && action === "speakers"/);
  assert.match(source, /saveTableTopicsSpeakers\(meetingId, body\.speakers/);
  assert.match(source, /tableIdHint: String\(body\.tableId/);
});

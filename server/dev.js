import http from "node:http";
import os from "node:os";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import puppeteer from "puppeteer-core";
import { createServer as createViteServer } from "vite";

import assetHandler from "../api/assets/[kind].js";
import healthHandler from "../api/health.js";
import meetingHandler from "../api/meetings/[id].js";
import votingQrHandler from "../api/meetings/[id]/images/voting.js";
import votingHandler from "../api/meetings/[id]/voting.js";
import awardsHandler from "../api/meetings/[id]/awards.js";
import meetingsHandler from "../api/meetings/index.js";
import membersHandler from "../api/members.js";
import mcpHandler from "./mcp.js";
import sessionHandler from "../api/session.js";
import templatesHandler from "../api/templates/index.js";
import templateHandler from "../api/templates/[id].js";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const STATIC_ROUTES = new Map([
  ["/api/health", healthHandler],
  ["/api/session", sessionHandler],
  ["/api/members", membersHandler],
  ["/api/mcp", mcpHandler],
  ["/api/roles", membersHandler],
  ["/api/meetings", meetingsHandler],
  ["/api/pathways-catalog", meetingsHandler],
  ["/api/templates", templatesHandler],
]);

const MCP_OAUTH_ROUTES = new Map([
  ["/.well-known/oauth-protected-resource", "resource-metadata"],
  ["/.well-known/oauth-protected-resource/api/mcp", "resource-metadata"],
  ["/.well-known/oauth-authorization-server", "server-metadata"],
  ["/oauth/register", "register"],
  ["/oauth/authorize", "authorize"],
  ["/oauth/token", "token"],
]);

export function matchApiRoute(pathname) {
  const oauth = MCP_OAUTH_ROUTES.get(pathname);
  if (oauth) return { handler: mcpHandler, params: { oauth } };
  const staticHandler = STATIC_ROUTES.get(pathname);
  if (staticHandler) return { handler: staticHandler, params: {} };

  const assetMatch = pathname.match(/^\/api\/assets\/([^/]+)$/);
  if (assetMatch) return { handler: assetHandler, params: { kind: decodeURIComponent(assetMatch[1]) } };

  const votingApiMatch = pathname.match(/^\/api\/meetings\/([^/]+)\/voting$/);
  if (votingApiMatch) return { handler: votingHandler, params: { id: decodeURIComponent(votingApiMatch[1]) } };
  const votingMatch = pathname.match(/^\/api\/meetings\/([^/]+)\/images\/voting$/);
  if (votingMatch) return { handler: votingQrHandler, params: { id: decodeURIComponent(votingMatch[1]) } };

  const awardsMatch = pathname.match(/^\/api\/meetings\/([^/]+)\/awards$/);
  if (awardsMatch) return { handler: awardsHandler, params: { id: decodeURIComponent(awardsMatch[1]) } };
  const meetingMatch = pathname.match(/^\/api\/meetings\/([^/]+)$/);
  if (meetingMatch) return { handler: meetingHandler, params: { id: decodeURIComponent(meetingMatch[1]) } };

  const templateMatch = pathname.match(/^\/api\/templates\/([^/]+)$/);
  if (templateMatch) return { handler: templateHandler, params: { id: decodeURIComponent(templateMatch[1]) } };

  return null;
}

function attachVercelResponseHelpers(response) {
  response.status = (statusCode) => {
    response.statusCode = statusCode;
    return response;
  };
  response.json = (body) => {
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.end(JSON.stringify(body));
  };
}

async function createPreviewPdf(port) {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
  try {
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on("request", (browserRequest) => {
      const url = new URL(browserRequest.url());
      if (browserRequest.isNavigationRequest() && url.pathname === "/" && url.searchParams.has("pdfSnapshot")) {
        const payload = JSON.stringify(globalThis.__AGENDA_PDF_SNAPSHOT__ || {}).replace(/</g, "\\u003c");
        const body = html.includes("</head>")
          ? html.replace("</head>", `<script>window.__AGENDA_PDF_SNAPSHOT__=${payload};</script></head>`)
          : `<script>window.__AGENDA_PDF_SNAPSHOT__=${payload};</script>${html}`;
        return browserRequest.respond({ contentType: "text/html; charset=utf-8", body });
      }
      return browserRequest.continue();
    });
    await page.goto(`http://127.0.0.1:${port}/?pdfSnapshot=1`, { waitUntil: "networkidle2", timeout: 45_000 });
    await page.waitForFunction(() => document.querySelectorAll(".agenda-page").length === 2, { timeout: 45_000 });
    await page.emulateMediaType("print");
    return Buffer.from(await page.pdf({ format: "A4", printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } }));
  } finally {
    await browser.close();
  }
}

export async function startDevServer({ port = Number(process.env.PORT || 5173) } = {}) {
  if (!process.env.AGENDA_SESSION_SECRET) process.env.AGENDA_SESSION_SECRET = crypto.randomBytes(32).toString("hex");
  const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    if (url.pathname === "/api/preview-agenda.pdf") {
      try {
        if (request.method === "POST") globalThis.__AGENDA_PDF_SNAPSHOT__ = await new Promise((resolve, reject) => {
          let raw = "";
          request.on("data", (chunk) => { raw += chunk; });
          request.on("end", () => {
            try { resolve(JSON.parse(raw || "{}").snapshot || {}); } catch (error) { reject(error); }
          });
          request.on("error", reject);
        });
        const address = server.address();
        const pdf = await createPreviewPdf(typeof address === "object" && address ? address.port : port);
        response.statusCode = 200;
        response.setHeader("Content-Type", "application/pdf");
        response.setHeader("Content-Disposition", 'attachment; filename="Agenda-preview.pdf"');
        response.setHeader("Content-Length", String(pdf.length));
        response.end(pdf);
      } catch {
        response.statusCode = 500;
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        response.end(JSON.stringify({ code: "PDF_FAILED", message: "Could not create preview PDF." }));
      } finally {
        globalThis.__AGENDA_PDF_SNAPSHOT__ = null;
      }
      return;
    }
    const route = matchApiRoute(url.pathname);

    if (!route) {
      if (!url.pathname.startsWith("/api/")) return vite.middlewares(request, response);
      response.statusCode = 404;
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response.end(JSON.stringify({ code: "NOT_FOUND", message: "API route not found." }));
      return;
    }

    request.query = { ...Object.fromEntries(url.searchParams), ...(url.pathname === "/api/pathways-catalog" ? { view: "pathways-catalog" } : url.pathname === "/api/roles" ? { view: "roles" } : {}), ...route.params };
    attachVercelResponseHelpers(response);
    try {
      await route.handler(request, response);
    } catch (error) {
      vite.ssrFixStacktrace(error);
      console.error(error);
      if (!response.headersSent) response.statusCode = 500;
      if (!response.writableEnded) response.end("Internal server error");
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "0.0.0.0", resolve);
  });

  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  const lanIps = Object.values(os.networkInterfaces())
    .flat()
    .filter((iface) => iface && !iface.internal && iface.family === "IPv4")
    .map((iface) => iface.address);
  console.log(`Agenda Maker ready at http://localhost:${actualPort}/`);
  for (const ip of lanIps) console.log(`  LAN access:   http://${ip}:${actualPort}/`);
  return { server, vite, port: actualPort };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await startDevServer();
}

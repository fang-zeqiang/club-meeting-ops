import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("/about presents public product structure with live routes", async () => {
  const [entry, vercel, page, styles, workspace] = await Promise.all([
    readFile(new URL("../entry.js", import.meta.url), "utf8"),
    readFile(new URL("../vercel.json", import.meta.url), "utf8"),
    readFile(new URL("../about-page.js", import.meta.url), "utf8"),
    readFile(new URL("../about.css", import.meta.url), "utf8"),
    readFile(new URL("../app.js", import.meta.url), "utf8"),
  ]);

  assert.match(entry, /aboutRoute/);
  assert.ok(vercel.includes('"source": "/about"'));
  assert.match(page, /Update the Agenda once/);
  assert.match(page, /改一次 Agenda/);
  assert.match(page, /Role Book, Meeting Workspace, and MCP/);
  assert.match(page, /href="\/book"/);
  assert.match(page, /href="\/mcp"/);
  assert.doesNotMatch(page, /href="\/demo"/);
  assert.match(page, /document\.documentElement\.lang = text\.lang/);
  assert.match(styles, /@media \(max-width: 640px\)/);
  assert.match(workspace, /href="\/about">Product overview/);
});

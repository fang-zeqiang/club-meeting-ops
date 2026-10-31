import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  DEMO_SCHEMA_VERSION,
  DEMO_STORAGE_KEY,
  createDemoWorkspace,
  loadDemoWorkspace,
  resetDemoWorkspace,
  saveDemoWorkspace,
} from "../demo-state.js";

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, value); }
  removeItem(key) { this.values.delete(key); }
}

const contractSource = await readFile(new URL("../src/app/contract.js", import.meta.url), "utf8");
const entrySource = await readFile(new URL("../entry.js", import.meta.url), "utf8");
const lifecycleSyncSource = await readFile(new URL("../src/app/lifecycle-sync.js", import.meta.url), "utf8");
const printExportSource = await readFile(new URL("../src/app/print-export.js", import.meta.url), "utf8");
const apiSource = await readFile(new URL("../src/app/api.js", import.meta.url), "utf8");
const derivationsSource = await readFile(new URL("../src/app/derivations.js", import.meta.url), "utf8");
const vercelConfig = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));

test("demo uses fictional meetings in the production workspace schema", () => {
  const workspace = createDemoWorkspace();
  assert.equal(workspace.schemaVersion, DEMO_SCHEMA_VERSION);
  assert.equal(workspace.meetings.length, 3);
  assert.ok(workspace.meetings.every((meeting) => meeting.blocks.length && meeting.blocks.every((block) => block.items.length)));
  assert.ok(workspace.members.some((member) => member.memberType === "guest_placeholder"));
  assert.doesNotMatch(JSON.stringify(workspace), /Trip\.com|Feishu/i);
});

test("demo workspace persists locally and resets stale or edited state", () => {
  const storage = new MemoryStorage();
  const workspace = createDemoWorkspace();
  workspace.meetings[0].theme = "Saved locally";
  assert.equal(saveDemoWorkspace(workspace, storage), true);
  assert.equal(loadDemoWorkspace(storage).meetings[0].theme, "Saved locally");

  storage.setItem(DEMO_STORAGE_KEY, JSON.stringify({ schemaVersion: DEMO_SCHEMA_VERSION - 1, meetings: [] }));
  assert.equal(loadDemoWorkspace(storage).meetings.length, 3);
  saveDemoWorkspace(workspace, storage);
  assert.equal(resetDemoWorkspace(storage).meetings[0].theme, "Small steps, clear signals");
  assert.equal(storage.getItem(DEMO_STORAGE_KEY), null);
});

test("demo route loads the real app with a fail-closed network boundary", () => {
  assert.match(entrySource, /if \(demoRoute\) \{\s+import\("\.\/app\.js"\)/);
  assert.match(contractSource, /export const DEMO_MODE = .*window\.location\.pathname/);
  // demo 下 apiJson 走 demoHandler 分支,createApiJson 在 demoHandler 存在时完全不 fetch(见 test/api-client.test.js)
  assert.match(apiSource, /createApiJson\(DEMO_MODE \?/);
  const pdfStart = printExportSource.indexOf("async function downloadAgendaPdf");
  assert.ok(pdfStart < printExportSource.indexOf("if (DEMO_MODE)", pdfStart) && printExportSource.indexOf("if (DEMO_MODE)", pdfStart) < printExportSource.indexOf("const response = await fetch(url", pdfStart), "demo guard must run before PDF fetch");
  assert.match(derivationsSource, /Demo data · saved in this browser/);
  assert.doesNotMatch(entrySource, /demo\.js/);
  assert.deepEqual(
    vercelConfig.rewrites.filter(({ source }) => source === "/demo" || source === "/demo/"),
    [
      { source: "/demo", destination: "/index.html" },
      { source: "/demo/", destination: "/index.html" },
    ],
  );
});

test("public demo entry leads with product parity and browser-only safety", () => {
  assert.match(lifecycleSyncSource, /class="auth-demo-entry"/);
  assert.match(contractSource, /workspace-demo-admin\.png/);
  assert.match(lifecycleSyncSource, /real workflows with fictional data stored only in this browser/i);
  assert.match(lifecycleSyncSource, /href="\/demo"><strong>Open interactive demo/);
  assert.match(lifecycleSyncSource, /Browse as guest: finalized meetings/);
});

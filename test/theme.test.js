import assert from "node:assert/strict";
import test from "node:test";

import { applyTheme, loadTheme, renderThemeSwitcher } from "../theme.js";

function fakeStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
  };
}

test("theme preference loads only supported values", () => {
  assert.equal(loadTheme(fakeStorage({ "club-meeting-ops.theme": "spring" })), "spring");
  assert.equal(loadTheme(fakeStorage({ "club-meeting-ops.theme": "sepia" })), "blue");
});

test("applying a theme updates the document and persists the choice", () => {
  const root = { dataset: {} };
  const storage = fakeStorage();

  assert.equal(applyTheme("dark", { root, storage }), "dark");
  assert.equal(root.dataset.theme, "dark");
  assert.equal(loadTheme(storage), "dark");
});

test("theme switcher is color-only, accessible, and ordered blue green dark", () => {
  const markup = renderThemeSwitcher("spring");
  const values = [...markup.matchAll(/data-theme-value="([^"]+)"/g)].map((match) => match[1]);

  assert.deepEqual(values, ["blue", "spring", "dark"]);
  assert.doesNotMatch(markup, />\s*(?:经典蓝|春野绿|暗夜)\s*</);
  assert.match(markup, /aria-label="Classic blue theme"/);
  assert.match(markup, /aria-label="Spring green theme"[^>]+aria-pressed="true"/);
  assert.match(markup, /aria-label="Dark theme"/);
});

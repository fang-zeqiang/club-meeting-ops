import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PRESENTATION_THEME, PRESENTATION_THEMES, isPresentationTheme, normalizePresentationTheme } from "../presentation-themes.js";

test("normalizePresentationTheme keeps registered ids", () => {
  PRESENTATION_THEMES.forEach((theme) => {
    assert.equal(normalizePresentationTheme(theme.id), theme.id);
  });
});

test("normalizePresentationTheme falls back for empty or unknown values", () => {
  ["", null, undefined, "   ", "christmas", "Sky"].forEach((value) => {
    assert.equal(normalizePresentationTheme(value), DEFAULT_PRESENTATION_THEME);
  });
});

test("normalizePresentationTheme trims surrounding whitespace", () => {
  assert.equal(normalizePresentationTheme("  midautumn  "), "midautumn");
});

test("default theme is registered and ids are unique", () => {
  assert.ok(isPresentationTheme(DEFAULT_PRESENTATION_THEME));
  const ids = PRESENTATION_THEMES.map((theme) => theme.id);
  assert.equal(new Set(ids).size, ids.length);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PRESENTATION_THEMES } from "../presentation-themes.js";

const base = readFileSync(new URL("../meeting-presentation.css", import.meta.url), "utf8");
const themes = readFileSync(new URL("../meeting-presentation-themes.css", import.meta.url), "utf8");

const declared = (css) => new Set([...css.matchAll(/(--pres-[a-z0-9-]+)\s*:/g)].map((match) => match[1]));
const referenced = (css) => new Set([...css.matchAll(/var\((--pres-[a-z0-9-]+)/g)].map((match) => match[1]));

const baseTokens = declared(base);

test("every --pres-* token used in the base stylesheet has a default value", () => {
  [...referenced(base)].forEach((token) => {
    assert.ok(baseTokens.has(token), `${token} is used but never given a default`);
  });
});

// 主题文件里写错 token 名不会报错,只会静默回落到默认值,所以在这里守住拼写。
test("theme overrides only touch tokens that the base stylesheet defines", () => {
  [...declared(themes)].forEach((token) => {
    assert.ok(baseTokens.has(token), `${token} is overridden by a theme but not defined in the base stylesheet`);
  });
});

test("theme stylesheet carries no hardcoded overrides beyond token blocks and decorations", () => {
  const selectors = themes
    .replaceAll("\r\n", "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("}")
    .flatMap((chunk) => chunk.split("{")[0].split(",\n"))
    .map((selector) => selector.trim())
    .filter(Boolean);
  selectors.forEach((selector) => {
    assert.match(selector, /^\.meeting-presentation[.:].*$|^\.theme-swatch[.:].*$|^\.theme-[a-z0-9-]+ \.stage-decor(::(before|after))?$/, `unexpected selector in theme stylesheet: ${selector}`);
  });
});

test("every registered theme except the default has a stylesheet block", () => {
  PRESENTATION_THEMES.filter((theme) => theme.id !== "current").forEach((theme) => {
    assert.match(themes, new RegExp(`\\.theme-${theme.id}\\b`), `theme ${theme.id} has no CSS block`);
  });
});

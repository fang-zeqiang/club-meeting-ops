import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("meeting details offer one-click WOD autofill that only fills the unsaved form", () => {
  const editor = read("src/app/agenda-editor.js");
  assert.match(editor, /<button type="button" class="button" data-autofill-wod/);
  assert.match(editor, /button\.matches\("\[data-autofill-wod\]"\)/);
  assert.match(editor, /\?action=wod-autofill`/);
  assert.match(editor, /window\.confirm\("自动补全会覆盖/);
  assert.doesNotMatch(editor.slice(editor.indexOf("async function autofillWordOfDay")), /^\s*flushSave\(/m);
  assert.match(read("src/app/contract.js"), /"data-autofill-wod"/);
});

test("meeting API routes WOD autofill behind the editor session", () => {
  const api = read("api/meetings/[id].js");
  const sessionGate = api.indexOf("if (!requireSession(request, response)) return;\n    if (!verifySameOrigin");
  const route = api.indexOf('request.query.action === "wod-autofill"');
  assert.ok(sessionGate > 0 && route > sessionGate);
  assert.match(api, /autofillWod\(body\.word\)/);
});

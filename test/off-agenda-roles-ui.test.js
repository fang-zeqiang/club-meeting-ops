import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("meeting-level roles feed the editor and Agenda sidebar", async () => {
  const editor = await readFile(new URL("../src/app/agenda-editor.js", import.meta.url), "utf8");
  const derivations = await readFile(new URL("../src/app/derivations.js", import.meta.url), "utf8");
  const preview = await readFile(new URL("../src/app/agenda-preview.js", import.meta.url), "utf8");
  assert.match(editor, /state\.meeting\.offAgendaRoles[\s\S]*data-off-agenda-role-index/);
  assert.match(derivations, /supportRoleEntries\(\)[\s\S]*state\.meeting\.offAgendaRoles/);
  assert.match(preview, /const supportLines = supportRoleEntries\(\)/);
  assert.match(preview, /SUPPORT ROLES[\s\S]*supportLines\.map/);
});

test("contest print variant removes ordinary voting and Table Topics copy", async () => {
  const preview = await readFile(new URL("../src/app/agenda-preview.js", import.meta.url), "utf8");
  assert.match(preview, /meetingType === "contest"/);
  assert.match(preview, /contest \? .*CONTEST OPERATIONS/);
  assert.match(preview, /contest \? "CONTESTANTS" : "SPEECH OBJECTIVE"/);
  assert.match(preview, /contest \? "" : renderPathwaysOverview\(\)/);
});

test("contest workspace records places in Awards and never prepares a voting form", async () => {
  const votingAwards = await readFile(new URL("../src/app/voting-awards.js", import.meta.url), "utf8");
  const votingActions = await readFile(new URL("../src/app/voting-actions.js", import.meta.url), "utf8");
  const render = await readFile(new URL("../src/app/render.js", import.meta.url), "utf8");
  const loader = await readFile(new URL("../src/app/workspace-loader.js", import.meta.url), "utf8");
  assert.match(votingAwards, /meetingType === "contest" \? renderContestPlaces\(\) : ""/);
  assert.match(votingAwards, /input\.matches\("\[data-contest-place\]"\)[\s\S]*setContestPlace[\s\S]*markDirty\(\)/);
  assert.match(votingActions, /async function prewarmVotingForm\(\) \{\n[^\n]*meetingType === "contest"\) return;/);
  assert.match(render, /function renderVotingTask[^\n]*\n\s*if \(state\.meeting\.meetingType === "contest"\)[^\n]*data-task="awards"/);
  assert.match(loader, /function cloneMeetingStructure[\s\S]*meeting\.contestResults = \{\};/);
});

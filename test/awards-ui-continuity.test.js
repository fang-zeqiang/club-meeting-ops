import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const renderSource = await readFile(new URL("../src/app/render.js", import.meta.url), "utf8");
const renderEngineSource = await readFile(new URL("../src/app/render-engine.js", import.meta.url), "utf8");
const votingAwardsSource = await readFile(new URL("../src/app/voting-awards.js", import.meta.url), "utf8");
const votingActionsSource = await readFile(new URL("../src/app/voting-actions.js", import.meta.url), "utf8");
const awardRepositorySource = await readFile(new URL("../server/award-repository.js", import.meta.url), "utf8");
const stylesSource = await readFile(new URL("../styles.css", import.meta.url), "utf8");

function functionBody(name) {
  const start = votingActionsSource.indexOf(`async function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist`);
  const nextFunction = votingActionsSource.slice(start + 1).search(/\n(?:export )?(?:async )?function /);
  return votingActionsSource.slice(start, nextFunction === -1 ? undefined : start + 1 + nextFunction);
}

test("award refresh preserves scroll and focus through the awards region", () => {
  assert.match(renderEngineSource, /function renderAwardsRegion\(preferredFocusKey = ""\)/);
  assert.match(renderEngineSource, /withUiContinuity\(\(\) => replaceRegion\("awards", hooks\.regions\.awards\(\)\), preferredFocusKey\)/);

  for (const [name, focusKey] of [["loadAwards", "awards-refresh"]]) {
    const body = functionBody(name);
    assert.doesNotMatch(body, /\brender\(\)/, `${name} must not trigger a full render`);
    assert.equal((body.match(new RegExp(`renderAwardsRegion\\(\"${focusKey}\"\\)`, "g")) || []).length, 2);
  }
});

test("live voting refresh preserves the mounted console", () => {
  const body = functionBody("refreshVotingConsole");
  assert.doesNotMatch(body, /renderOverlayRegion\(\)/, "polling must not rebuild the voting console");
  assert.equal((body.match(/updateVotingConsoleRegion\(\)/g) || []).length, 2);
  assert.match(body, /state\.votingConsole !== consoleState/, "stale requests must not update a reopened console");
});

test("voting results and live footer keep their grid rows when the error is hidden", () => {
  assert.match(stylesSource, /\.voting-console-results\s*\{[^}]*grid-row:\s*3/s);
  assert.match(stylesSource, /\.voting-console-modal > main > footer\s*\{[^}]*grid-row:\s*4/s);
});

test("every award action exposes a stable focus key", () => {
  assert.match(votingAwardsSource, /data-refresh-awards data-focus-key="awards-refresh"/);
  assert.match(votingAwardsSource, /Open presentation/);
  assert.match(votingAwardsSource, /presentation\?jump=awards/);
  assert.doesNotMatch(votingAwardsSource, /data-confirm-awards/);
  assert.doesNotMatch(votingAwardsSource, /Confirm & Freeze|Reconfirm results|Confirm results/);
  assert.doesNotMatch(votingAwardsSource, /data-copy-award-link/);
});

test("Awards workspace opens the unified presentation", () => {
  assert.match(renderSource, /Edit voting table ↗/);
  assert.match(votingAwardsSource, /Open voting form ↗/);
  assert.match(votingAwardsSource, /\/m\/\$\{encodeURIComponent\(state\.meeting\.meetingNumber\)\}\/presentation\?jump=awards/);
  assert.match(votingActionsSource, /VOTING_RESPONSE_RESET_REQUIRED/);
  assert.match(votingActionsSource, /permanently delete all .* existing responses/);
  assert.doesNotMatch(votingAwardsSource, /Reconfirm awards/);
});

test("live award UI does not depend on removed confirmation metadata", () => {
  for (const source of [renderSource, votingActionsSource]) {
    assert.doesNotMatch(source, /awardsNeedReconfirmation|confirmedAwards|awardsStale|resultsChanged/);
    assert.doesNotMatch(source, /[Cc]onfirm [Rr]esults|Reconfirm|freeze the result/);
  }
  assert.match(renderSource, /presentation\?jump=awards/);
  assert.doesNotMatch(renderSource, /Available after results are confirmed/);
});

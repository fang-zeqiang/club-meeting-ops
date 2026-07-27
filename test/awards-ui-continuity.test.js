import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appSource = await readFile(new URL("../app.js", import.meta.url), "utf8");
const awardRepositorySource = await readFile(new URL("../server/award-repository.js", import.meta.url), "utf8");

function functionBody(name) {
  const start = appSource.indexOf(`async function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist`);
  const nextFunction = appSource.indexOf("\nasync function ", start + 1);
  return appSource.slice(start, nextFunction === -1 ? undefined : nextFunction);
}

test("award async actions preserve scroll and focus through the awards region", () => {
  assert.match(appSource, /function renderAwardsRegion\(preferredFocusKey = ""\)/);
  assert.match(appSource, /withUiContinuity\(\(\) => replaceRegion\("awards", renderAwardsEditor\(\)\), preferredFocusKey\)/);

  for (const [name, focusKey] of [
    ["loadAwards", "awards-refresh"],
    ["confirmAwardResults", "awards-confirm"],
  ]) {
    const body = functionBody(name);
    assert.doesNotMatch(body, /\brender\(\)/, `${name} must not trigger a full render`);
    assert.equal((body.match(new RegExp(`renderAwardsRegion\\(\"${focusKey}\"\\)`, "g")) || []).length, 2);
  }
});

test("every award action exposes a stable focus key", () => {
  assert.match(appSource, /data-refresh-awards data-focus-key="awards-refresh"/);
  assert.match(appSource, /data-confirm-awards data-focus-key="awards-confirm"/);
});

test("HTML presentation and Feishu template fallback links are rendered", () => {
  assert.match(appSource, /Edit voting table ↗/);
  assert.match(appSource, /Open voting form ↗/);
  assert.match(appSource, /Open award presentation ↗/);
  assert.match(appSource, /\/m\/\$\{encodeURIComponent\(state\.meeting\.meetingNumber\)\}\/awards/);
  assert.match(awardRepositorySource, /\/m\/\$\{encodeURIComponent\(data\.meeting\.meetingNumber\)\}\/awards/);
  assert.doesNotMatch(appSource, /Use Feishu template to customize ↗/);
  assert.doesNotMatch(appSource, /my\.feishu\.cn\/slides\//);
  assert.match(appSource, /VOTING_RESPONSE_RESET_REQUIRED/);
  assert.match(appSource, /permanently delete all .* existing responses/);
  assert.match(appSource, /Reconfirm awards to enable presentation/);
  assert.match(appSource, /Reconfirm results/);
});

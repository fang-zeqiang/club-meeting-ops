import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ceremonyAwards } from "../award-order.js";

const source = await readFile(new URL("../presentation-awards.js", import.meta.url), "utf8");
const styles = await readFile(new URL("../presentation-awards.css", import.meta.url), "utf8");
const presentationStyles = await readFile(new URL("../meeting-presentation.css", import.meta.url), "utf8");
const entry = await readFile(new URL("../entry.js", import.meta.url), "utf8");

test("legacy award routes redirect into unified Presentation without loading a second player", () => {
  assert.match(entry, /meetings.*awards.*present/);
  assert.match(entry, /shortAwardRoute/);
  assert.match(entry, /presentation\?jump=awards/);
  assert.match(entry, /location\.hash/);
  assert.doesNotMatch(entry, /import\("\.\/award-presentation/);
});

test("unified ceremony keeps official certificate assets and finish summary", () => {
  assert.match(source, /CLUB_PROFILE\.logo/);
  assert.match(source, /award-live-refresh/);
  assert.match(source, /FINISH/);
  assert.match(presentationStyles, /aspect-ratio: 13 \/ 9/);
  assert.doesNotMatch(styles, /var\(--pres-/);
});

test("ceremony order still places prepared speaker after speech completions", () => {
  const awards = [
    { type: "sharing_master" }, { type: "speech_completion", winner: "A" }, { type: "speech_completion", winner: "B" },
    { type: "best_role_taker" }, { type: "best_prepared_speaker" }, { type: "best_individual_evaluator" },
  ];
  assert.deepEqual(ceremonyAwards(awards).map(({ type }) => type), ["sharing_master", "speech_completion", "speech_completion", "best_prepared_speaker", "best_role_taker", "best_individual_evaluator"]);
});

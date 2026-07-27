import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ceremonyAwards } from "../award-order.js";

const source = await readFile(new URL("../award-presentation.js", import.meta.url), "utf8");
const awardOrder = await readFile(new URL("../award-order.js", import.meta.url), "utf8");
const styles = await readFile(new URL("../award-presentation.css", import.meta.url), "utf8");
const entry = await readFile(new URL("../entry.js", import.meta.url), "utf8");

test("award route loads the dedicated public presentation", () => {
  assert.match(entry, /meetings.*awards.*present/);
  assert.match(entry, /shortAwardRoute/);
  assert.match(entry, /award-presentation\.css/);
  assert.match(source, /awards\?view=confirmed/);
  assert.match(source, /Waiting for result confirmation/);
  assert.match(source, /setTimeout\(load, 5000\)/);
  assert.doesNotMatch(source, /Sign in to Agenda/);
});

test("presentation includes a private cover and all voting awards", () => {
  assert.match(source, /MEETING<br>AWARDS/);
  assert.match(source, /sharing_master/);
  assert.match(source, /speech_completion/);
  assert.match(awardOrder, /best_role_taker/);
  assert.match(awardOrder, /best_functional_role/);
  assert.match(awardOrder, /best_table_topics_speaker/);
  assert.match(awardOrder, /best_prepared_speaker/);
  assert.match(awardOrder, /best_individual_evaluator/);
  assert.match(awardOrder, /best_facilitator/);
  assert.match(source, /replaceAll\("-", "\."\)/);
});

test("presentation places best prepared speaker after every speech completion", () => {
  const awards = [
    { type: "sharing_master" },
    { type: "speech_completion", winner: "A" },
    { type: "speech_completion", winner: "B" },
    { type: "best_role_taker" },
    { type: "best_prepared_speaker" },
    { type: "best_individual_evaluator" },
  ];
  assert.deepEqual(ceremonyAwards(awards).map(({ type }) => type), [
    "sharing_master",
    "speech_completion",
    "speech_completion",
    "best_prepared_speaker",
    "best_role_taker",
    "best_individual_evaluator",
  ]);
});

test("presentation supports stable signature typography and stage controls", () => {
  assert.match(source, /ArrowRight/);
  assert.match(source, /ArrowDown/);
  assert.match(source, /ArrowUp/);
  assert.match(source, /requestFullscreen/);
  assert.match(source, /Press F/);
  assert.match(source, /data-fullscreen aria-label="Enter fullscreen">⛶/);
  assert.match(source, /ceremonyAwards\(snapshot\.awards \|\| \[\]\)\.map/);
  assert.match(source, /celebrate/);
  assert.match(source, /prefers-reduced-motion: reduce/);
  assert.match(source, /--start-x/);
  assert.match(source, /names\.join\(" & "\)/);
  assert.match(source, /function signatureName/);
  assert.match(source, /replace\(\/\\s\+AWARD\$\/i, ""\)\.toUpperCase\(\)/);
  assert.match(source, /certificate-divider/);
  assert.match(source, /force-base-size/);
  assert.match(styles, /aspect-ratio: 13 \/ 9/);
  assert.match(styles, /font-family: Georgia, serif/);
  assert.doesNotMatch(styles, /url\("\.\/assets\/fonts\//);
  assert.match(styles, /white-space: nowrap/);
  assert.match(styles, /--line-scale: \.85/);
  assert.match(styles, /height: 1px/);
  assert.match(styles, /top: 100%/);
  assert.match(styles, /confetti-rise 1800ms/);
  assert.match(styles, /prefers-reduced-motion/);
  assert.match(styles, /@media \(hover: none\)[\s\S]*\.presentation-controls[\s\S]*opacity: \.88/);
});

test("presentation removes member titles from certificate names", () => {
  assert.match(source, /award\.winners\.map\(\(\{ name \}\) => signatureName\(name\)\)/);
  assert.match(source, /split\(" & "\)\.map\(\(name\) => name\.split\(","\)\[0\]\.trim\(\)\)\.join\(" & "\)/);
});

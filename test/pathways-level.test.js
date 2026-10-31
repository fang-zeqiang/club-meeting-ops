import assert from "node:assert/strict";
import test from "node:test";

import { parsePathwaysLevel, pathCode, pathForCode } from "../pathways-level.js";

const PATHS = ["Dynamic Leadership", "Engaging Humor", "Presentation Mastery"];

test("parses roster abbreviations into path codes and completed levels", () => {
  assert.deepEqual(parsePathwaysLevel("PI5"), [{ code: "PI", level: 5 }]);
  assert.deepEqual(parsePathwaysLevel("PM5/EH1"), [{ code: "PM", level: 5 }, { code: "EH", level: 1 }]);
  assert.deepEqual(parsePathwaysLevel(" pm2 / DTM "), [{ code: "PM", level: 2 }]);
  assert.deepEqual(parsePathwaysLevel(""), []);
  assert.deepEqual(parsePathwaysLevel(null), []);
  assert.deepEqual(parsePathwaysLevel("Level 3"), []);
});

test("maps path codes to catalog path names by initials", () => {
  assert.equal(pathCode("Presentation Mastery"), "PM");
  assert.equal(pathForCode("EH", PATHS), "Engaging Humor");
  assert.equal(pathForCode("LD", PATHS), "");
});

import assert from "node:assert/strict";
import test from "node:test";
import { presentationPreviewUrl } from "../book-helpers.js";

test("presentationPreviewUrl builds a jump link for table topics", () => {
  assert.equal(presentationPreviewUrl(108, "tabletopics"), "/m/108/presentation?jump=tabletopics");
});

test("presentationPreviewUrl includes order for prepared speech", () => {
  assert.equal(presentationPreviewUrl(108, "ps", 2), "/m/108/presentation?jump=ps&order=2");
});

test("presentationPreviewUrl returns empty string without a meeting number", () => {
  assert.equal(presentationPreviewUrl(null, "tabletopics"), "");
  assert.equal(presentationPreviewUrl(undefined, "ps", 1), "");
});

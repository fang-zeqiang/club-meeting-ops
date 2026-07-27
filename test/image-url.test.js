import assert from "node:assert/strict";
import test from "node:test";
import { appendVersion } from "../meeting-helpers.js";

test("appends image version without corrupting existing query parameters", () => {
  assert.equal(appendVersion("/image", "abc"), "/image?v=abc");
  assert.equal(appendVersion("/voting?action=system-image", "abc"), "/voting?action=system-image&v=abc");
});

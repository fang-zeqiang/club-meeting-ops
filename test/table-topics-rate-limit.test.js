import assert from "node:assert/strict";
import test from "node:test";

import { takeTableTopicsWriteToken } from "../table-topics-rate-limit.js";

test("allows a burst of ten Table Topics writes then refills at five per second", () => {
  const buckets = new Map();
  const startedAt = 1_000;

  for (let index = 0; index < 10; index += 1) {
    assert.equal(takeTableTopicsWriteToken(buckets, "meeting_101", startedAt), true);
  }
  assert.equal(takeTableTopicsWriteToken(buckets, "meeting_101", startedAt), false);
  assert.equal(takeTableTopicsWriteToken(buckets, "meeting_101", startedAt + 199), false);
  assert.equal(takeTableTopicsWriteToken(buckets, "meeting_101", startedAt + 200), true);
});

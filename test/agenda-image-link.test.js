import assert from "node:assert/strict";
import test from "node:test";

import { signAgendaImageLink, verifyAgendaImageLink } from "../server/agenda-image-link.js";

const ENV_KEY = "AGENDA_SESSION_SECRET";

test("signed agenda image link verifies for the same meeting before expiry", { concurrency: false }, () => {
  const original = process.env[ENV_KEY];
  process.env[ENV_KEY] = "test-secret";
  try {
    const now = Date.parse("2026-01-01T00:00:00Z");
    const { sig, exp } = signAgendaImageLink("meeting_1", 3600, now);
    assert.equal(verifyAgendaImageLink("meeting_1", sig, exp, now + 1000), true);
  } finally {
    process.env[ENV_KEY] = original;
  }
});

test("signed agenda image link rejects expiry, tampering, and meeting mismatch", { concurrency: false }, () => {
  const original = process.env[ENV_KEY];
  process.env[ENV_KEY] = "test-secret";
  try {
    const now = Date.parse("2026-01-01T00:00:00Z");
    const { sig, exp } = signAgendaImageLink("meeting_1", 3600, now);
    assert.equal(verifyAgendaImageLink("meeting_1", sig, exp, now + 3600_001), false, "expired");
    assert.equal(verifyAgendaImageLink("meeting_1", `${sig}x`, exp, now), false, "tampered signature");
    assert.equal(verifyAgendaImageLink("meeting_2", sig, exp, now), false, "wrong meeting");
    assert.equal(verifyAgendaImageLink("meeting_1", sig, "not-a-number", now), false, "malformed exp");
  } finally {
    process.env[ENV_KEY] = original;
  }
});

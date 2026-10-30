import assert from "node:assert/strict";
import test from "node:test";

import { digestToolArgs, extractMeetingId, logToolCall, validateIntentSummary } from "../server/mcp-call-log.js";

test("digestToolArgs serializes and truncates to 500 chars", () => {
  assert.equal(digestToolArgs(null), "");
  assert.equal(digestToolArgs({ a: 1 }), '{"a":1}');
  assert.equal(digestToolArgs({ text: "x".repeat(600) }).length, 500);
});

test("extractMeetingId prefers meeting_id, falls back to meeting_number, else empty", () => {
  assert.equal(extractMeetingId({}), "");
  assert.equal(extractMeetingId({ meeting_number: 107 }), "107");
  assert.equal(extractMeetingId({ meeting_id: "meeting_1", meeting_number: 107 }), "meeting_1");
});

test("validateIntentSummary rejects empty, multiline, and oversized text", () => {
  assert.equal(validateIntentSummary("", "intent_summary").valid, false);
  assert.equal(validateIntentSummary("line one\nline two", "intent_summary").valid, false);
  assert.equal(validateIntentSummary("x".repeat(201), "intent_summary").valid, false);
  const ok = validateIntentSummary("  查了下周会议空缺  ", "intent_summary");
  assert.equal(ok.valid, true);
  assert.equal(ok.text, "查了下周会议空缺");
});

test("logToolCall is a silent no-op when the table is not configured", { concurrency: false }, async () => {
  const original = process.env.BITABLE_MCP_TOOL_CALLS_TABLE_ID;
  delete process.env.BITABLE_MCP_TOOL_CALLS_TABLE_ID;
  const originalFetch = global.fetch;
  let called = false;
  global.fetch = async () => {
    called = true;
    throw new Error("should not be called");
  };
  try {
    await assert.doesNotReject(logToolCall({ toolName: "vpe_random_wod", status: "ok" }));
    assert.equal(called, false);
  } finally {
    global.fetch = originalFetch;
    if (original !== undefined) process.env.BITABLE_MCP_TOOL_CALLS_TABLE_ID = original;
  }
});

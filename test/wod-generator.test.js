import assert from "node:assert/strict";
import test from "node:test";

import { generateWod, parseGeneratedWod } from "../server/wod-generator.js";

const CARD = {
  pronunciation: "/rɪˈzɪliənt/",
  partOfSpeech: "adjective",
  definition: "Able to recover quickly from difficulties.",
  usage: "Describe people, teams or plans that bounce back.",
  example: "Our club stayed resilient after losing the venue.",
};

const deepseekResponse = (content, status = 200) => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status });

test("parses a generated WOD card and keeps the requested word", () => {
  assert.deepEqual(parseGeneratedWod("resilient", JSON.stringify({ ...CARD, word: "ignored" })), { word: "resilient", ...CARD });
});

test("rejects generated cards that are incomplete, malformed or too long for the slide", () => {
  const invalid = (error) => error.code === "WOD_GENERATION_INVALID";
  assert.throws(() => parseGeneratedWod("resilient", "not json"), invalid);
  assert.throws(() => parseGeneratedWod("resilient", JSON.stringify({ ...CARD, definition: "" })), invalid);
  assert.throws(() => parseGeneratedWod("resilient", JSON.stringify({ ...CARD, example: "x".repeat(181) })), invalid);
});

test("generateWod asks DeepSeek for JSON and returns a normalized card", async () => {
  let request;
  const card = await generateWod(" resilient ", {
    apiKey: "key",
    fetchImpl: async (url, options) => {
      request = { url, body: JSON.parse(options.body) };
      return deepseekResponse(JSON.stringify(CARD));
    },
  });
  assert.equal(card.word, "resilient");
  assert.equal(card.definition, CARD.definition);
  assert.equal(request.body.response_format.type, "json_object");
  assert.match(request.body.messages.at(-1).content, /resilient/);
});

test("generateWod validates input and configuration before calling DeepSeek", async () => {
  const fetchImpl = async () => assert.fail("DeepSeek must not be called");
  await assert.rejects(() => generateWod("resilient", { apiKey: "", fetchImpl }), (error) => error.code === "DEEPSEEK_NOT_CONFIGURED");
  await assert.rejects(() => generateWod("", { apiKey: "key", fetchImpl }), (error) => error.code === "INVALID_WOD_WORD");
  await assert.rejects(() => generateWod("a\nb", { apiKey: "key", fetchImpl }), (error) => error.code === "INVALID_WOD_WORD");
});

test("generateWod surfaces DeepSeek failures as a generation error", async () => {
  await assert.rejects(
    () => generateWod("resilient", { apiKey: "key", fetchImpl: async () => deepseekResponse("", 500) }),
    (error) => error.code === "WOD_GENERATION_INVALID",
  );
});

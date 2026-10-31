import assert from "node:assert/strict";
import test from "node:test";
import { splitEmojiGraphemes, validateVacancyEmoji } from "../vacancy-emoji.js";

test("validates complete repeated and composed Emoji graphemes", () => {
  for (const value of ["🈳", "🙋🙋🙋", "🟡🟡", "👩🏽‍💻", "🇨🇳", "1️⃣"]) {
    assert.equal(validateVacancyEmoji(value).valid, true, value);
  }
  assert.deepEqual(splitEmojiGraphemes("👩🏽‍💻🙋"), ["👩🏽‍💻", "🙋"]);
});

test("rejects empty, text, mixed, and more than eight Emoji", () => {
  assert.equal(validateVacancyEmoji("").message, "请选择至少一个 Emoji。");
  assert.equal(validateVacancyEmoji("abc").message, "空缺标记仅支持 Emoji。");
  assert.equal(validateVacancyEmoji("🈳abc").message, "空缺标记仅支持 Emoji。");
  assert.equal(validateVacancyEmoji("🙋".repeat(9)).message, "空缺标记最多支持 8 个 Emoji。");
});

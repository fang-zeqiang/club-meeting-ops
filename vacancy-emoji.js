const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const emojiPart = /^[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}\p{Variation_Selector}\u200d\u20e3\u{e0020}-\u{e007f}#*0-9]+$/u;
const emojiSignal = /[\p{Extended_Pictographic}\p{Regional_Indicator}\u20e3]/u;

export function splitEmojiGraphemes(value) {
  return [...segmenter.segment(String(value || ""))].map(({ segment }) => segment);
}

export function validateVacancyEmoji(value) {
  const graphemes = splitEmojiGraphemes(value);
  if (!graphemes.length) return { valid: false, code: "EMPTY_VACANCY_EMOJI", message: "请选择至少一个 Emoji。", graphemes };
  if (graphemes.length > 8) return { valid: false, code: "VACANCY_EMOJI_TOO_LONG", message: "空缺标记最多支持 8 个 Emoji。", graphemes };
  if (graphemes.some((grapheme) => !emojiSignal.test(grapheme) || !emojiPart.test(grapheme))) {
    return { valid: false, code: "INVALID_VACANCY_EMOJI", message: "空缺标记仅支持 Emoji。", graphemes };
  }
  return { valid: true, code: "", message: "", graphemes };
}

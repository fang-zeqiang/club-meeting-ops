import { esc } from "./src/shared/html.js";

const text = (value) => String(value || "").trim();
export const WORD_CARD_LIMITS = Object.freeze({ definition: 160, usage: 140, example: 180 });
const limits = WORD_CARD_LIMITS;

export function wordTrainingTooLong(word = {}) {
  return Object.entries(limits).some(([key, limit]) => text(word[key]).length > limit);
}

export function renderWordTrainingCard(word = {}) {
  if (!text(word.word)) return "";
  const detail = (label, key) => {
    const value = text(word[key]);
    if (!value) return "";
    const preview = value.length > limits[key] ? `${value.slice(0, limits[key] - 1)}…` : value;
    const size = value.length > 90 ? "compact" : value.length > 50 ? "medium" : "";
    return `<div class="word-detail ${size}"><span>${label}</span><p>${esc(preview)}</p></div>`;
  };
  const phonetics = text(word.pronunciation) || text(word.partOfSpeech)
    ? `<div class="word-phonetics">${word.pronunciation ? `<span>${esc(word.pronunciation)}</span>` : ""}${word.partOfSpeech ? `<span class="word-part-of-speech">${esc(word.partOfSpeech)}</span>` : ""}</div>` : "";
  return `<section class="word-training-card" aria-label="Word of the Day">
    <p class="word-label">WORD OF THE DAY</p>
    <h2 class="${text(word.word).length > 18 ? "fit-long" : ""}">${esc(word.word)}</h2>
    ${phonetics}${detail("Meaning", "definition")}${detail("Usage", "usage")}${detail("Example", "example")}
  </section>`;
}

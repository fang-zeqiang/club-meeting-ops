import { ApiError } from "./bitable.js";
import { WORD_CARD_LIMITS, wordTrainingTooLong } from "../presentation-word-card.js";

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const CARD_FIELDS = ["pronunciation", "partOfSpeech", "definition", "usage", "example"];
const REQUIRED_FIELDS = ["pronunciation", "partOfSpeech", "definition", "example"];
const SYSTEM_PROMPT = [
  "You write Word of the Day cards for a speaking club meeting.",
  "Return only a JSON object with keys pronunciation, partOfSpeech, definition, usage, example. All values in English.",
  "pronunciation: IPA wrapped in slashes. partOfSpeech: e.g. adjective, verb, noun.",
  `definition: plain learner-friendly meaning, at most ${WORD_CARD_LIMITS.definition - 30} characters.`,
  `usage: one short tip on how to use the word in a speech, at most ${WORD_CARD_LIMITS.usage - 30} characters.`,
  `example: one natural sentence that a club member could say on stage, at most ${WORD_CARD_LIMITS.example - 30} characters.`,
].join("\n");

const invalid = () => new ApiError(502, "WOD_GENERATION_INVALID", "AI 生成的单词卡不完整，请重试或手动填写。");

export function parseGeneratedWod(word, content) {
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw invalid();
  }
  const card = { word, ...Object.fromEntries(CARD_FIELDS.map((key) => [key, String(parsed?.[key] ?? "").trim()])) };
  if (REQUIRED_FIELDS.some((key) => !card[key]) || wordTrainingTooLong(card)) throw invalid();
  return card;
}

export async function generateWod(rawWord, { apiKey = process.env.DEEPSEEK_API_KEY, fetchImpl = fetch, timeoutMs = 20_000 } = {}) {
  if (!apiKey) throw new ApiError(503, "DEEPSEEK_NOT_CONFIGURED", "DeepSeek 尚未配置。");
  const word = String(rawWord || "").trim();
  if (!word || word.length > 60 || /[\r\n]/.test(word)) throw new ApiError(400, "INVALID_WOD_WORD", "请输入一个单词或短语（60 字符以内）。");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(DEEPSEEK_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: "deepseek-chat",
        response_format: { type: "json_object" },
        temperature: 0.3,
        messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: `Word: ${word}` }],
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw invalid();
    return parseGeneratedWod(word, String(body?.choices?.[0]?.message?.content || ""));
  } catch (error) {
    if (error?.name === "AbortError") throw new ApiError(504, "DEEPSEEK_TIMEOUT", "AI 生成单词卡超时，请重试或手动填写。");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

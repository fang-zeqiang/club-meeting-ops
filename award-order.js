export const AWARD_DEFINITIONS = Object.freeze([
  { key: "roleTaker", type: "best_role_taker", field: "Best Role Taker", title: "BEST ROLE TAKER" },
  { key: "functionalRole", type: "best_functional_role", field: "Best Functional Role", title: "BEST FUNCTIONAL ROLE" },
  { key: "tableTopicsSpeaker", type: "best_table_topics_speaker", field: "Best Table Topics Speaker", title: "BEST TABLE TOPICS SPEAKER" },
  { key: "preparedSpeaker", type: "best_prepared_speaker", field: "Best Prepared Speaker", title: "BEST PREPARED SPEAKER" },
  { key: "evaluator", type: "best_individual_evaluator", field: "Best Individual Evaluator", title: "BEST INDIVIDUAL EVALUATOR" },
  { key: "facilitator", type: "best_facilitator", field: "Best Facilitator", title: "BEST FACILITATOR" },
]);

export function ceremonyAwards(awards = []) {
  const preparedIndex = awards.findIndex((award) => award.type === "best_prepared_speaker");
  const completionIndex = awards.findLastIndex((award) => award.type === "speech_completion");
  if (preparedIndex < 0 || completionIndex < 0 || preparedIndex === completionIndex + 1) return [...awards];
  const ordered = [...awards];
  const [prepared] = ordered.splice(preparedIndex, 1);
  ordered.splice(ordered.findLastIndex((award) => award.type === "speech_completion") + 1, 0, prepared);
  return ordered;
}

const METRIC_KEYS = Object.freeze(["readiness", "roleCoverage", "speakerSupply", "runCompletion", "audienceFeedback"]);

function metric(score, status, evidence = [], confidence = 1) {
  return {
    score: Math.max(0, Math.min(20, Math.round(Number(score) || 0))),
    status,
    evidence,
    confidence: Math.max(0, Math.min(1, Number(confidence) || 0)),
  };
}

function statusForScore(score) {
  if (score >= 16) return "good";
  if (score >= 10) return "warning";
  return "risk";
}

function roleItems(meeting) {
  return (meeting.blocks || []).flatMap((block) => block.items || []).filter((item) => item.kind !== "break");
}

function speechItems(meeting) {
  return (meeting.blocks || []).flatMap((block) => block.items || []).filter((item) => item.kind === "speech");
}

function readinessMetric(meeting) {
  const blockers = [
    ...(!String(meeting.theme || "").trim() ? ["theme missing"] : []),
    ...(!(meeting.blocks || []).length ? ["agenda empty"] : []),
    ...roleItems(meeting).filter((item) => Number(item.duration) <= 0).map((item) => `${item.session} duration invalid`),
  ];
  if (blockers.length) return metric(6, "risk", blockers, 1);
  const warnings = [
    ...(!meeting.votingForm?.formId && meeting.qrSource !== "manual" ? ["voting form not prepared"] : []),
    ...(!String(meeting.wordOfDay?.word || "").trim() ? ["word of the day missing"] : []),
  ];
  const score = warnings.length ? 14 : 20;
  return metric(score, statusForScore(score), warnings.length ? warnings : ["meeting basics ready"], 1);
}

function roleCoverageMetric(meeting) {
  const items = roleItems(meeting);
  if (!items.length) return metric(0, "unknown", ["no agenda roles"], 0);
  const assigned = items.filter((item) => item.status === "confirmed" && String(item.member || "").trim()).length;
  const score = (assigned / items.length) * 20;
  return metric(score, statusForScore(score), [`${assigned}/${items.length} roles confirmed`], 1);
}

function speakerSupplyMetric(meeting) {
  const prepared = speechItems(meeting).filter((item) => item.status === "confirmed" && String(item.member || "").trim()).length;
  const tableTopics = Array.isArray(meeting.tableTopicsSpeakers) ? meeting.tableTopicsSpeakers.length : 0;
  const score = Math.min(20, (prepared ? 10 : 0) + Math.min(10, tableTopics * 3));
  return metric(score, statusForScore(score), [`${prepared} prepared speakers`, `${tableTopics} Table Topics speakers`], prepared || tableTopics ? 1 : 0.7);
}

function runCompletionMetric(meeting, context = {}) {
  const awardsConfirmed = Boolean(context.awardsConfirmed || meeting.confirmedAwards);
  const responses = Number(context.responseCount || 0);
  const formReady = Boolean(meeting.votingForm?.formId || meeting.qrSource === "manual");
  const score = awardsConfirmed ? 20 : responses ? 14 : formReady ? 10 : 4;
  return metric(score, statusForScore(score), [
    awardsConfirmed ? "awards confirmed" : responses ? `${responses} voting responses` : formReady ? "voting entry ready" : "voting not ready",
  ], 1);
}

function audienceFeedbackMetric(_meeting, context = {}) {
  const feedback = context.feedback || {};
  if (feedback.averageRating == null) return metric(0, "unknown", ["no audience rating"], 0);
  const rating = Number(feedback.averageRating);
  const score = (rating / 5) * 20;
  const comments = Array.isArray(feedback.comments) ? feedback.comments.length : 0;
  return metric(score, statusForScore(score), [`${rating.toFixed(1)}/5 average rating`, `${comments} comments`], 1);
}

export function buildQualityMetrics(meeting, context = {}) {
  const metrics = {
    readiness: readinessMetric(meeting),
    roleCoverage: roleCoverageMetric(meeting),
    speakerSupply: speakerSupplyMetric(meeting),
    runCompletion: runCompletionMetric(meeting, context),
    audienceFeedback: audienceFeedbackMetric(meeting, context),
  };
  return Object.fromEntries(METRIC_KEYS.map((key) => [key, metrics[key]]));
}

export function qualityScore(metrics = {}) {
  const values = METRIC_KEYS.map((key) => metrics[key]).filter(Boolean);
  return values.reduce((sum, item) => sum + (Number(item.score) || 0), 0);
}

export function qualityConfidence(metrics = {}) {
  const values = METRIC_KEYS.map((key) => metrics[key]).filter(Boolean);
  if (!values.length) return 0;
  return Number((values.reduce((sum, item) => sum + (Number(item.confidence) || 0), 0) / values.length).toFixed(2));
}

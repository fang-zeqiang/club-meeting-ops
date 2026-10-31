import { ApiError } from "./bitable.js";
import { asText } from "./meeting-schema.js";
import { AWARD_DEFINITIONS, ceremonyAwards } from "../award-order.js";
import { CLUB_PROFILE } from "../club-profile.js";

export const AWARD_TYPES = AWARD_DEFINITIONS;

export function englishList(names) {
  if (names.length < 2) return names[0] || "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

export function aggregateAwardResults(records) {
  return AWARD_TYPES.map((award) => {
    const counts = new Map();
    for (const record of records) {
      const name = asText(record?.[award.field]).trim();
      if (name) counts.set(name, (counts.get(name) || 0) + 1);
    }
    const candidates = [...counts].map(([name, votes]) => ({ name, votes })).sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name));
    const max = candidates[0]?.votes || 0;
    return {
      type: award.type,
      title: award.field,
      totalVotes: candidates.reduce((sum, candidate) => sum + candidate.votes, 0),
      candidates,
      winners: max > 0 ? candidates.filter((candidate) => candidate.votes === max).map(({ name }) => ({ name })) : [],
    };
  });
}

function preparedSpeeches(meeting) {
  return (meeting.blocks || []).flatMap((block) => block.type === "prepared_speeches"
    ? (block.items || []).filter((item) => item.kind === "speech" && item.status === "confirmed" && item.member)
    : []);
}

export function recognitionAwardResults(meeting) {
  const sharingNames = [...new Set((meeting.blocks || [])
    .flatMap((block) => block.items || [])
    .filter((item) => item.kind === "role" && item.status === "confirmed" && item.member)
    .filter((item) => String(item.role || "").trim().toLocaleLowerCase() === "sharing master")
    .map((item) => String(item.member || "").trim())
    .filter(Boolean))];
  return [
    ...(sharingNames.length ? [{
      type: "sharing_master",
      title: "Sharing Master",
      totalVotes: 0,
      candidates: sharingNames.map((name) => ({ name, votes: 0 })),
      winners: [{ name: sharingNames.join(" & ") }],
    }] : []),
    ...preparedSpeeches(meeting).map((speech) => ({
      type: "speech_completion",
      title: "Speech Completion",
      totalVotes: 0,
      candidates: [],
      winners: [{ memberId: speech.memberId || "", name: speech.member, context: speech.session }],
    })),
  ];
}

const CONTEST_PLACES = [
  { key: "third", type: "contest_third", title: "Third Place" },
  { key: "second", type: "contest_second", title: "Second Place" },
  { key: "first", type: "contest_first", title: "First Place" },
];

// 模拟赛：名次由 Ballot Counter 汇总后录入；未录入任何名次前不开放颁奖，避免只揭晓参赛证书
export function contestAwardResults(meeting) {
  const places = CONTEST_PLACES
    .map(({ key, type, title }) => {
      const winner = meeting.contestResults?.[key];
      const name = String(winner?.name || "").trim();
      return name ? { type, title, totalVotes: 0, candidates: [], winners: [{ memberId: winner.memberId || "", name }] } : null;
    })
    .filter(Boolean);
  if (!places.length) return [];
  const participation = recognitionAwardResults(meeting)
    .filter((result) => result.type === "speech_completion")
    .map((result) => ({ ...result, title: "Contest Participation" }));
  return [...participation, ...places];
}

export function buildLiveAwardCeremony({
  meeting,
  results = [],
  president = null,
  responseCount = 0,
  resultsVersion = "",
  clubName = CLUB_PROFILE.awardClubName,
}) {
  const awards = ceremonyAwards(results
    .filter((result) => result.winners?.length)
    .map((result) => ({
      type: result.type,
      title: result.title,
      winners: result.winners.map((winner) => ({
        memberId: winner.memberId || "",
        name: winner.name,
        context: winner.context || "",
      })),
    })));
  const signatory = { memberId: president?.memberId || "", name: president?.name || "" };
  return {
    meetingNumber: meeting.meetingNumber,
    meetingDate: meeting.date,
    clubName,
    signatory,
    responseCount,
    resultsVersion,
    results,
    awards,
    availableAwardCount: awards.length,
    ready: awards.length > 0,
    warnings: signatory.name ? [] : ["President 未配置 · 奖状签名将留空"],
  };
}

export function assertWinnerNamesFit(awards) {
  for (const award of awards) {
    const label = englishList(award.winners.map((winner) => winner.name));
    if (label.length > 110 || award.winners.some((winner) => winner.name.length > 65)) {
      throw new ApiError(422, "AWARD_NAME_TOO_LONG", `${award.title} winner names are too long for the certificate. Please check them manually.`);
    }
  }
}

export function createConfirmedSnapshot({ meeting, results, president, operator, responseCount = 0, resultsVersion = "", now = new Date() }) {
  const awards = results.filter((result) => result.winners.length).map((result) => ({
    type: result.type,
    title: result.title,
    winners: [...result.winners.reduce((grouped, winner) => {
      const current = grouped.get(winner.name) || { memberId: winner.memberId || "", name: winner.name, contexts: [] };
      if (winner.context && !current.contexts.includes(winner.context)) current.contexts.push(winner.context);
      grouped.set(winner.name, current);
      return grouped;
    }, new Map()).values()].map(({ contexts, ...winner }) => ({ ...winner, context: contexts.join(" / ") })),
  }));
  if (!awards.length) throw new ApiError(409, "NO_VALID_AWARD_RESULTS", "No award has a valid vote result yet.");
  if (!president?.name) throw new ApiError(409, "PRESIDENT_NOT_CONFIGURED", "Assign a club President before generating awards.");
  assertWinnerNamesFit(results);
  return {
    confirmedAt: now.toISOString(),
    confirmedBy: { userId: String(operator?.userId || "shared-agenda-session"), name: String(operator?.name || "Agenda operator") },
    meetingDate: meeting.date,
    meetingNumber: meeting.meetingNumber,
    responseCount,
    resultsVersion,
    signatory: { memberId: president.memberId || "", name: president.name },
    awards,
  };
}

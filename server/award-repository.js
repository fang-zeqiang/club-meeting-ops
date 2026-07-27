import { ApiError, fieldEquals, getBitableConfig, listRecords, updateRecord } from "./bitable.js";
import { createConfirmedSnapshot, recognitionAwardResults } from "./award-core.js";
import { asText, splitStartsAt } from "./meeting-schema.js";
import { getMeeting } from "./meetings-repository.js";
import { getVotingResults } from "./voting-repository.js";
import { AWARD_DEFINITIONS } from "../award-order.js";
import { CLUB_PROFILE } from "../club-profile.js";

const locks = new Map();
const parseJson = (value, fallback) => {
  try { return JSON.parse(asText(value) || JSON.stringify(fallback)); } catch { return fallback; }
};

export function awardSnapshotIsStale(confirmedAwards, votingForm) {
  return Boolean(confirmedAwards && votingForm?.awardsNeedReconfirmation);
}

export function awardResultsChanged(confirmedAwards, resultsVersion) {
  return Boolean(confirmedAwards?.resultsVersion && confirmedAwards.resultsVersion !== resultsVersion);
}

async function context(meetingId, { includePresident = true } = {}) {
  const config = getBitableConfig();
  const [meetings, members] = await Promise.all([
    listRecords(config.meetingsTableId, { filter: fieldEquals("meeting_id", meetingId) }),
    includePresident ? listRecords(config.membersTableId) : Promise.resolve([]),
  ]);
  const record = meetings[0];
  if (!record) throw new ApiError(404, "MEETING_NOT_FOUND", "Meeting not found.");
  const presidentRecord = members.find((candidate) => (candidate.fields.officer_roles || []).includes("President"));
  const startsAt = splitStartsAt(record.fields.starts_at);
  return {
    config,
    record,
    meeting: {
      id: meetingId,
      meetingNumber: Number(record.fields.meeting_number),
      date: startsAt.date,
      theme: asText(record.fields.theme),
      revision: Number(record.fields.revision || 0),
    },
    president: presidentRecord ? { memberId: asText(presidentRecord.fields.member_id), name: asText(presidentRecord.fields.display_name) } : null,
    confirmedAwards: parseJson(record.fields.confirmed_awards_json, null),
    audit: parseJson(record.fields.award_audit_json, []),
    votingForm: parseJson(record.fields.voting_form_json, null),
  };
}

export async function getLiveAwardResults(meetingId) {
  const data = await context(meetingId);
  const [meeting, voting] = await Promise.all([getMeeting(meetingId), getVotingResults(meetingId)]);
  const results = [
    ...recognitionAwardResults(meeting),
    ...AWARD_DEFINITIONS.map(({ key, type }) => ({ type, ...voting.awards[key] })),
  ]
    .map((award) => ({ ...award, totalVotes: award.candidates.reduce((sum, candidate) => sum + candidate.votes, 0), winners: award.winners }));
  const awardsStale = awardSnapshotIsStale(data.confirmedAwards, data.votingForm);
  const hasResults = results.some((award) => award.winners.length);
  const votingResults = AWARD_DEFINITIONS.map(({ type }) => results.find((result) => result.type === type));
  const missingVoteResults = votingResults.filter((award) => award.candidates.length && award.totalVotes === 0);
  const requiresVotes = votingResults.some((award) => award.candidates.length);
  const resultsChanged = awardResultsChanged(data.confirmedAwards, voting.resultsVersion);
  return {
    results,
    responseCount: voting.responseCount,
    resultsVersion: voting.resultsVersion,
    resultsChanged,
    newResponseCount: Math.max(0, voting.responseCount - Number(data.confirmedAwards?.responseCount || 0)),
    clubName: process.env.AWARD_CLUB_NAME || CLUB_PROFILE.awardClubName,
    president: data.president,
    confirmedAwards: data.confirmedAwards,
    awardsStale,
    awardPage: data.confirmedAwards && !awardsStale && !resultsChanged ? { url: `/m/${encodeURIComponent(data.meeting.meetingNumber)}/awards` } : null,
    ready: Boolean(hasResults && data.president && !missingVoteResults.length && (!requiresVotes || voting.responseCount > 0) && (!awardsStale || voting.responseCount > 0)),
    blockers: [
      ...(!hasResults ? ["No valid award result was found."] : []),
      ...(requiresVotes && voting.responseCount < 1 ? ["Collect at least one voting response before confirming awards."] : []),
      ...missingVoteResults.map((award) => `${award.title} has candidates but no valid vote.`),
      ...(!data.president ? ["Club President is not configured."] : []),
      ...(awardsStale && voting.responseCount < 1 ? ["Collect at least one new response before reconfirming awards."] : []),
    ],
  };
}

export async function getConfirmedAwardPage(meetingId) {
  const data = await context(meetingId, { includePresident: false });
  const awardsStale = awardSnapshotIsStale(data.confirmedAwards, data.votingForm);
  const voting = data.confirmedAwards && !awardsStale ? await getVotingResults(meetingId) : null;
  const resultsChanged = Boolean(voting && awardResultsChanged(data.confirmedAwards, voting.resultsVersion));
  return {
    confirmedAwards: awardsStale || resultsChanged ? null : data.confirmedAwards,
    awardsStale,
    resultsChanged,
    clubName: process.env.AWARD_CLUB_NAME || CLUB_PROFILE.awardClubName,
  };
}

async function confirmInternal(meetingId, input) {
  const data = await context(meetingId);
  if (Number(input.expectedRevision) !== data.meeting.revision) throw new ApiError(409, "REVISION_CONFLICT", "Save or reload the meeting before confirming awards.", { currentRevision: data.meeting.revision });
  const live = await getLiveAwardResults(meetingId);
  if (!input.expectedResultsVersion || input.expectedResultsVersion !== live.resultsVersion) {
    throw new ApiError(409, "VOTING_RESULTS_CHANGED", "Voting results changed. Review the latest totals before confirming.", { resultsVersion: live.resultsVersion });
  }
  if (live.awardsStale && live.responseCount < 1) {
    throw new ApiError(409, "AWARD_RECONFIRMATION_WAITING_FOR_VOTES", "Collect at least one new response before reconfirming awards.");
  }
  const snapshot = createConfirmedSnapshot({
    meeting: data.meeting,
    results: live.results,
    president: data.confirmedAwards?.signatory || data.president,
    operator: input.operator,
    responseCount: live.responseCount,
    resultsVersion: live.resultsVersion,
  });
  snapshot.theme = data.meeting.theme;
  const auditEntry = { at: snapshot.confirmedAt, by: snapshot.confirmedBy, before: data.confirmedAwards, after: snapshot };
  await updateRecord(data.config.meetingsTableId, data.record.record_id, {
    confirmed_awards_json: JSON.stringify(snapshot),
    award_audit_json: JSON.stringify([...data.audit, auditEntry]),
    voting_form_json: JSON.stringify({ ...(data.votingForm || {}), awardsNeedReconfirmation: false }),
  });
  return {
    confirmedAwards: snapshot,
    awardPage: { url: `/m/${encodeURIComponent(data.meeting.meetingNumber)}/awards` },
    awardsStale: false,
    awardsNeedReconfirmation: false,
    responseCount: live.responseCount,
    resultsVersion: live.resultsVersion,
  };
}

function withMeetingLock(meetingId, task) {
  const previous = locks.get(meetingId) || Promise.resolve();
  const operation = previous.catch(() => {}).then(task);
  locks.set(meetingId, operation);
  return operation.finally(() => { if (locks.get(meetingId) === operation) locks.delete(meetingId); });
}

export function confirmAwards(meetingId, input) {
  return withMeetingLock(meetingId, () => confirmInternal(meetingId, input));
}

import { ApiError, fieldEquals, getBitableConfig, listRecords } from "./bitable.js";
import { buildLiveAwardCeremony, contestAwardResults, recognitionAwardResults } from "./award-core.js";
import { asText, splitStartsAt } from "./meeting-schema.js";
import { getMeeting } from "./meetings-repository.js";
import { getVotingResults } from "./voting-repository.js";
import { AWARD_DEFINITIONS } from "../award-order.js";
import { CLUB_PROFILE } from "../club-profile.js";

async function liveContext(meetingId) {
  const config = getBitableConfig();
  const [meetings, members, meeting, voting] = await Promise.all([
    listRecords(config.meetingsTableId, { filter: fieldEquals("meeting_id", meetingId) }),
    listRecords(config.membersTableId),
    getMeeting(meetingId),
    // 模拟赛不准备投票表单，读票会 409；先并行请求保持常规会议延迟不变，再按会议类型取舍
    getVotingResults(meetingId).catch((error) => ({ error })),
  ]);
  if (voting.error && meeting.meetingType !== "contest") throw voting.error;
  const record = meetings[0];
  if (!record) throw new ApiError(404, "MEETING_NOT_FOUND", "Meeting not found.");
  const presidentRecord = members.find((candidate) => (candidate.fields.officer_roles || []).includes("President"));
  const startsAt = splitStartsAt(record.fields.starts_at);
  return {
    meeting: { ...meeting, meetingNumber: Number(record.fields.meeting_number), date: startsAt.date },
    voting,
    president: presidentRecord ? { memberId: asText(presidentRecord.fields.member_id), name: asText(presidentRecord.fields.display_name) } : null,
  };
}

export async function getLiveAwardResults(meetingId, { includeResults = true } = {}) {
  const { meeting, voting, president } = await liveContext(meetingId);
  const contest = meeting.meetingType === "contest";
  const results = (contest ? contestAwardResults(meeting) : [
    ...recognitionAwardResults(meeting),
    ...AWARD_DEFINITIONS.map(({ key, type }) => ({ type, ...voting.awards[key] })),
  ]).map((award) => ({ ...award, totalVotes: award.candidates.reduce((sum, candidate) => sum + candidate.votes, 0), winners: award.winners }));
  const ceremony = buildLiveAwardCeremony({
    meeting,
    results,
    president,
    responseCount: contest ? 0 : voting.responseCount,
    resultsVersion: contest ? "" : voting.resultsVersion,
    clubName: process.env.AWARD_CLUB_NAME || CLUB_PROFILE.awardClubName,
  });
  if (!includeResults) delete ceremony.results;
  return ceremony;
}

export async function getSharingMasterAward(meetingId) {
  const ceremony = await getLiveAwardResults(meetingId, { includeResults: false });
  const award = ceremony.awards.find((item) => item.type === "sharing_master");
  return { ...ceremony, award: award ? { winners: award.winners } : null };
}

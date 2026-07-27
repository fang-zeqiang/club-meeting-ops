import { getMeeting, resolveMeetingId } from "./meetings-repository.js";
import { ApiError } from "./bitable.js";
import crypto from "node:crypto";

const publicKey = (value) => crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 16);

export function toPresentationMeeting(meeting) {
  return {
    id: meeting.id,
    meetingNumber: meeting.meetingNumber,
    date: meeting.date,
    theme: meeting.theme,
    qrSource: meeting.qrSource,
    votingQr: meeting.votingQr,
    systemVotingQr: meeting.systemVotingQr,
    blocks: (meeting.blocks || []).map((block) => ({
      title: block.title,
      items: (block.items || []).map((item) => ({
        key: publicKey(item.id),
        kind: item.kind,
        session: item.session,
        role: item.role,
        duration: item.duration,
        member: item.member,
        evaluator: item.evaluator,
        speechObjective: item.speechObjective,
        externalPresentationUrl: item.externalPresentationUrl,
      })),
    })),
  };
}

export async function getPresentationMeeting(identifier) {
  const id = await resolveMeetingId(identifier);
  return toPresentationMeeting(await getMeeting(id));
}

export function toGuestMeeting(meeting) {
  return {
    meetingNumber: meeting.meetingNumber,
    date: meeting.date,
    startTime: meeting.startTime,
    theme: meeting.theme,
    venue: meeting.venue,
    enableTransitionTime: meeting.enableTransitionTime,
    photographer: meeting.photographer,
    meetingManager: meeting.meetingManager,
    wordOfDay: meeting.wordOfDay,
    blocks: (meeting.blocks || []).map((block) => ({
      title: block.title,
      items: (block.items || []).map((item) => ({
        kind: item.kind,
        session: item.session,
        role: item.role,
        duration: item.duration,
        member: item.member,
      })),
    })),
  };
}

export async function getGuestMeeting(identifier) {
  const id = await resolveMeetingId(identifier);
  const meeting = await getMeeting(id);
  if (meeting.status !== "final") throw new ApiError(404, "MEETING_NOT_FOUND", "Final meeting not found.");
  return toGuestMeeting(meeting);
}

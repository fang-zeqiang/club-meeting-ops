import { getMeeting, resolveMeetingId } from "./meetings-repository.js";
import { ApiError } from "./bitable.js";
import crypto from "node:crypto";
import { presentationPhaseForItem } from "../presentation-phases.js";

const publicKey = (value) => crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 16);

export function toPresentationMeeting(meeting) {
  return {
    id: meeting.id,
    meetingNumber: meeting.meetingNumber,
    date: meeting.date,
    theme: meeting.theme,
    presentationTheme: meeting.presentationTheme,
    enableTransitionTime: meeting.enableTransitionTime,
    meetingType: meeting.meetingType,
    qrSource: meeting.qrSource,
    votingQr: meeting.votingQr,
    systemVotingQr: meeting.systemVotingQr,
    wordOfDay: meeting.wordOfDay,
    blocks: (meeting.blocks || []).map((block) => ({
      title: block.title,
      items: (block.items || []).map((item) => ({
        key: publicKey(item.id),
        kind: item.kind,
        session: item.session,
        role: item.role,
        duration: item.duration,
        pathwaysProjectId: item.pathwaysProjectId,
        timerGreenSec: item.timerGreenSec,
        timerYellowSec: item.timerYellowSec,
        timerRedSec: item.timerRedSec,
        timerBellSec: item.timerBellSec,
        member: item.member,
        evaluator: item.evaluator,
        speechObjective: item.speechObjective,
        externalPresentationUrl: item.externalPresentationUrl,
        presentationPhase: presentationPhaseForItem(block, item),
      })),
    })),
  };
}

export function toTableTopicsLiveMeeting(meeting) {
  return {
    id: meeting.id,
    meetingNumber: meeting.meetingNumber,
    revision: meeting.revision,
    currentTableTopicsEntryId: meeting.currentTableTopicsEntryId || "",
    tableTopicsEntries: (meeting.tableTopicsEntries || []).map(({ id, name, order, durationSeconds, placeholder }) => ({
      id,
      name,
      order,
      durationSeconds,
      placeholder: Boolean(placeholder),
    })),
  };
}

export async function getPresentationMeeting(identifier) {
  const id = await resolveMeetingId(identifier);
  return toPresentationMeeting(await getMeeting(id));
}

export async function getTableTopicsLiveMeeting(identifier) {
  const id = await resolveMeetingId(identifier);
  return toTableTopicsLiveMeeting(await getMeeting(id));
}

export function toGuestMeeting(meeting) {
  return {
    meetingNumber: meeting.meetingNumber,
    date: meeting.date,
    startTime: meeting.startTime,
    theme: meeting.theme,
    venue: meeting.venue,
    enableTransitionTime: meeting.enableTransitionTime,
    meetingType: meeting.meetingType,
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

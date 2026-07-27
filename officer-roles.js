import { isAwardsItem } from "./meeting-presentation-model.js";

export const OFFICER_ROLES = Object.freeze([
  "President",
  "VPE",
  "VPM",
  "VPPR",
  "SAA",
  "Secretary",
  "Treasurer",
]);

export function normalizeOfficerAssignments(input = {}) {
  return Object.fromEntries(
    OFFICER_ROLES.map((role) => [role, String(input?.[role] || "").trim()]),
  );
}

export function assignMeetingPresident(meeting, members = []) {
  const president = members.find((member) => member.officerRoles?.includes("President"));
  if (!president) return meeting;
  meeting.blocks.flatMap((block) => block.items || []).forEach((item) => {
    if (item.role !== "President" && !isAwardsItem(item)) return;
    item.role = "President";
    item.memberId = president.id;
    item.member = president.displayName;
    item.status = "confirmed";
  });
  return meeting;
}

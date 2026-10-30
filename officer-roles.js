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

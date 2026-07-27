export const ROLE_DEFINITIONS = Object.freeze([
  { id: "tme", label: "Toastmaster of the Evening", aliases: ["TME", "Toastmaster of the Evening"] },
  { id: "ttm", label: "Table Topics Master", aliases: ["TTM", "Table Topics Master"] },
  { id: "tte", label: "Table Topics Evaluator", aliases: ["TTE", "Table Topics Evaluator"] },
  { id: "ge", label: "General Evaluator", aliases: ["GE", "General Evaluator"] },
  { id: "timer", label: "Timer", aliases: ["Timer"] },
  { id: "grammarian", label: "Grammarian", aliases: ["Grammarian"] },
  { id: "ah_counter", label: "Ah-Counter", aliases: ["Ah-Counter", "Ah-counter", "Ah Counter"] },
  { id: "warmup_host", label: "Warm-up Host", aliases: ["Warm-up Host", "Warmup Host"] },
  { id: "guest_talk_host", label: "Guest Talk Host", aliases: ["Guest Talk Host"] },
  { id: "voting_announcement_host", label: "Voting & Announcement Host", aliases: ["Voting & Announcement Host", "Voting Host"] },
]);

export const ROLE_AWARD_POOLS = Object.freeze({
  roleTaker: Object.freeze(["tme", "tte", "ge"]),
  facilitator: Object.freeze(["warmup_host", "ttm", "guest_talk_host", "voting_announcement_host"]),
  functionalRole: Object.freeze(["timer", "grammarian", "ah_counter"]),
});

const byId = new Map(ROLE_DEFINITIONS.map((role) => [role.id, role]));
const normalize = (value) => String(value || "").trim().toLocaleLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
const byAlias = new Map(ROLE_DEFINITIONS.flatMap((role) => role.aliases.map((alias) => [normalize(alias), role])));

function customId(title) {
  const slug = normalize(title).replaceAll(" ", "_");
  return slug ? `custom:${slug}` : "";
}

export function roleIdentity(title, explicitId = "") {
  const existing = byId.get(explicitId);
  if (existing) return { id: existing.id, label: existing.label, standard: true };
  const role = byAlias.get(normalize(title));
  if (role) return { id: role.id, label: role.label, standard: true };
  const id = customId(title);
  return { id, label: String(title || "").trim(), standard: false };
}

export function roleLabel(roleId, fallback = "") {
  return byId.get(roleId)?.label || String(fallback || roleId).replace(/^custom:/, "").replaceAll("_", " ");
}

export function roleAwardConfig(votingForm = {}) {
  const raw = votingForm?.roleAwardConfig?.roleTakerRoleIds || votingForm?.roleTakerRoleIds || [];
  return { roleTakerRoleIds: [...new Set((Array.isArray(raw) ? raw : []).map(String).filter(Boolean))] };
}

export function recognitionAwardConfig(votingForm = {}) {
  const source = votingForm?.recognitionAwardConfig || {};
  const clean = (values) => [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || "").trim()).filter(Boolean))];
  return {
    sharingMasterRoleIds: clean(source.sharingMasterRoleIds),
    sharingMasterNames: clean(source.sharingMasterNames),
  };
}

export function roleEntries(meeting) {
  const seen = new Map();
  for (const item of (meeting.blocks || []).flatMap((block) => block.items || [])) {
    if (item.kind !== "role" || !item.role) continue;
    const identity = roleIdentity(item.role, item.roleId);
    if (identity.id && !seen.has(identity.id)) seen.set(identity.id, identity);
  }
  return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label));
}

export function roleAwardIssues(meeting) {
  const entries = roleEntries(meeting);
  const available = new Set(entries.map((role) => role.id));
  const configured = roleAwardConfig(meeting.votingForm).roleTakerRoleIds;
  const fixed = new Map([
    ...ROLE_AWARD_POOLS.roleTaker.map((id) => [id, "Best Role Taker"]),
    ...ROLE_AWARD_POOLS.facilitator.map((id) => [id, "Best Facilitator"]),
    ...ROLE_AWARD_POOLS.functionalRole.map((id) => [id, "Best Functional Role"]),
  ]);
  const blockers = [];
  const warnings = [];
  if (configured.length !== (meeting.votingForm?.roleAwardConfig?.roleTakerRoleIds || configured).length) {
    blockers.push("Best Role Taker extension has duplicate roles.");
  }
  for (const roleId of configured) {
    if (!available.has(roleId)) blockers.push(`${roleLabel(roleId)} is not in this meeting agenda.`);
    else if (fixed.has(roleId)) blockers.push(`${roleLabel(roleId)} already belongs to ${fixed.get(roleId)}.`);
  }
  return { blockers: [...new Set(blockers)], warnings: [...new Set(warnings)] };
}

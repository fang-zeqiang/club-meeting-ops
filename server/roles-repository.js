import { ApiError, createRecord, getBitableConfig, listRecords } from "./bitable.js";
import { asText } from "./meeting-schema.js";

const clean = (value) => String(value || "").trim();
const key = (value) => clean(value).toLocaleLowerCase();

function safeUrl(value) {
  const raw = (value && typeof value === "object" ? clean(value.link) : "") || asText(value);
  if (!raw) return "";
  try {
    const url = new URL(raw.match(/^\[[^\]]*\]\((https:\/\/.+)\)$/)?.[1] || raw);
    return url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

function roleFromRecord(record) {
  const list = (value) => Array.isArray(value)
    ? value.map(clean).filter(Boolean)
    : asText(value).split(/[\n,]/).map(clean).filter(Boolean);
  return {
    name: asText(record.fields.role_name),
    aliases: asText(record.fields.aliases).split(/[\n,]/).map(clean).filter(Boolean),
    description: asText(record.fields.description),
    roleUrl: safeUrl(record.fields.role_url),
    sopUrl: safeUrl(record.fields.sop_url),
    bookingPublic: record.fields.booking_public === true,
    guestBookingPublic: record.fields.guest_booking_public === true,
    group: asText(record.fields.booking_group),
    advanced: record.fields.booking_advanced === true,
    active: record.fields.active === true,
    sortOrder: Number(record.fields.sort_order) || 0,
    recommendationEnabled: record.fields.recommendation_enabled === true,
    growthSkills: list(record.fields.growth_skills).slice(0, 3),
    recommendedAfterRoles: list(record.fields.recommended_after_roles),
    firstTimeSupport: list(record.fields.first_time_support),
  };
}

export function roleCatalogFromRecords(records, { includeInactive = false } = {}) {
  const roles = records.map(roleFromRecord).filter((role) => role.name && (includeInactive || role.active))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  const byAlias = new Map();
  for (const role of roles) {
    for (const alias of [role.name, ...role.aliases]) {
      const existing = byAlias.get(key(alias));
      if (existing && existing !== role.name) {
        throw new ApiError(503, "ROLE_CATALOG_INVALID", `角色别名 ${alias} 同时指向多个角色。`);
      }
      byAlias.set(key(alias), role.name);
    }
  }
  const publicNames = new Set(roles.filter((role) => role.bookingPublic).map((role) => role.name));
  const guestPublicNames = new Set(roles.filter((role) => role.bookingPublic && role.guestBookingPublic).map((role) => role.name));
  const recommendationNames = new Set(roles.filter((role) => role.recommendationEnabled).map((role) => role.name));
  return {
    roles,
    bookingRoles: roles.filter((role) => role.bookingPublic),
    recommendationRoles: roles.filter((role) => role.recommendationEnabled),
    canonicalize(value) {
      const role = clean(value).replace(/\s+\d+$/, "");
      return byAlias.get(key(role)) || role;
    },
    isPublic(value) {
      return publicNames.has(this.canonicalize(value));
    },
    isGuestPublic(value) {
      return guestPublicNames.has(this.canonicalize(value));
    },
    isRecommendationEnabled(value) {
      return recommendationNames.has(this.canonicalize(value));
    },
  };
}

function agendaRole(role) {
  return { name: role.name, aliases: role.aliases, sortOrder: role.sortOrder };
}

export function planRoleCreation(records, value) {
  if (typeof value !== "string") throw new ApiError(400, "INVALID_ROLE_NAME", "Role name must be text.");
  const raw = String(value || "");
  if (/[\u0000-\u001f\u007f\u2028\u2029]/u.test(raw)) {
    throw new ApiError(400, "INVALID_ROLE_NAME", "Role name cannot contain line breaks or control characters.");
  }
  const name = raw.trim().replace(/ {2,}/g, " ");
  if (!name || [...name].length > 80) throw new ApiError(400, "INVALID_ROLE_NAME", "Role name must contain 1 to 80 characters.");
  if (/\s\d+$/u.test(name)) throw new ApiError(400, "INVALID_ROLE_NAME", "Role name cannot end with a slot number.");

  const catalog = roleCatalogFromRecords(records, { includeInactive: true });
  const canonical = catalog.canonicalize(name);
  const existing = catalog.roles.find((role) => key(role.name) === key(canonical));
  if (existing) {
    if (!existing.active) throw new ApiError(409, "ROLE_INACTIVE", `${existing.name} already exists but is inactive. Reactivate it in Base.`);
    return { created: false, role: agendaRole(existing) };
  }
  const sortOrder = Math.max(0, ...catalog.roles.map((role) => role.sortOrder)) + 10;
  return { created: true, role: { name, aliases: [], sortOrder }, fields: { role_name: name, booking_public: false, guest_booking_public: false, active: true, sort_order: sortOrder } };
}

export async function getAgendaRoles() {
  const catalog = await getRoleCatalog();
  return catalog.roles.map(agendaRole);
}

export async function planAgendaRole(value) {
  const { rolesTableId } = getBitableConfig();
  if (!rolesTableId) throw new ApiError(503, "ROLE_CATALOG_NOT_CONFIGURED", "角色目录尚未配置。");
  return planRoleCreation(await listRecords(rolesTableId), value);
}

export async function createAgendaRole(value) {
  const { rolesTableId } = getBitableConfig();
  if (!rolesTableId) throw new ApiError(503, "ROLE_CATALOG_NOT_CONFIGURED", "角色目录尚未配置。");
  const plan = planRoleCreation(await listRecords(rolesTableId), value);
  if (!plan.created) return plan;
  await createRecord(rolesTableId, plan.fields, { entity: "role", roleName: plan.role.name });
  return { created: true, role: plan.role };
}

export async function getRoleCatalog() {
  const { rolesTableId } = getBitableConfig();
  if (!rolesTableId) throw new ApiError(503, "ROLE_CATALOG_NOT_CONFIGURED", "角色目录尚未配置。");
  const catalog = roleCatalogFromRecords(await listRecords(rolesTableId));
  if (!catalog.roles.length) throw new ApiError(503, "ROLE_CATALOG_EMPTY", "角色目录没有启用中的角色。");
  return catalog;
}

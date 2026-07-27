import assert from "node:assert/strict";
import test from "node:test";

import { planRoleCreation, roleCatalogFromRecords } from "../server/roles-repository.js";

function record(fields) {
  return { record_id: fields.role_name, fields };
}

test("role catalog canonicalizes aliases and controls booking visibility", () => {
  const catalog = roleCatalogFromRecords([
    record({
      role_name: "Guest Talk Host",
      aliases: "Guest Introduction Host",
      description: "Introduce the guest speaker.",
      role_url: { link: "https://example.com/role" },
      sop_url: { link: "javascript:alert(1)" },
      booking_public: true,
      booking_group: ["主持相关"],
      booking_advanced: true,
      active: true,
      sort_order: 10,
    }),
    record({ role_name: "President", booking_public: false, active: true, sort_order: 20 }),
  ]);

  assert.equal(catalog.canonicalize("Guest Introduction Host"), "Guest Talk Host");
  assert.equal(catalog.canonicalize("Guest Talk Host 2"), "Guest Talk Host");
  assert.equal(catalog.isPublic("Guest Introduction Host"), true);
  assert.equal(catalog.isPublic("President"), false);
  assert.deepEqual(catalog.bookingRoles.map((role) => role.name), ["Guest Talk Host"]);
  assert.equal(catalog.bookingRoles[0].roleUrl, "https://example.com/role");
  assert.equal(catalog.bookingRoles[0].sopUrl, "");
  assert.equal(catalog.bookingRoles[0].group, "主持相关");
  assert.equal(catalog.bookingRoles[0].advanced, true);
});

test("role catalog reads Base URL fields returned as markdown links", () => {
  const catalog = roleCatalogFromRecords([
    record({
      role_name: "Timer",
      sop_url: "[Role SOP](https://example.com/timer-sop)",
      booking_public: true,
      active: true,
    }),
  ]);

  assert.equal(catalog.bookingRoles[0].sopUrl, "https://example.com/timer-sop");
});

test("role catalog rejects aliases mapped to multiple roles", () => {
  assert.throws(() => roleCatalogFromRecords([
    record({ role_name: "TME", aliases: "Toastmaster", booking_public: true, active: true }),
    record({ role_name: "Meeting Host", aliases: "Toastmaster", booking_public: true, active: true }),
  ]), { code: "ROLE_CATALOG_INVALID" });
});

test("role creation reuses active names and aliases before planning a Base row", () => {
  const records = [
    record({ role_name: "TME", aliases: "Toastmaster", booking_public: true, active: true, sort_order: 20 }),
    record({ role_name: "Retired Host", active: false, sort_order: 90 }),
  ];

  assert.deepEqual(planRoleCreation(records, " toastmaster "), {
    created: false,
    role: { name: "TME", aliases: ["Toastmaster"], sortOrder: 20 },
  });
  assert.deepEqual(planRoleCreation(records, "Workshop   Host"), {
    created: true,
    role: { name: "Workshop Host", aliases: [], sortOrder: 100 },
    fields: { role_name: "Workshop Host", booking_public: false, active: true, sort_order: 100 },
  });
  assert.throws(() => planRoleCreation(records, "Retired Host"), { code: "ROLE_INACTIVE" });
});

test("role creation rejects unsafe or numbered global names", () => {
  for (const name of ["", "Host\nInjected", "Workshop Host 1", "x".repeat(81)]) {
    assert.throws(() => planRoleCreation([], name), { code: "INVALID_ROLE_NAME" });
  }
});

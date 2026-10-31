import assert from "node:assert/strict";
import test from "node:test";

import { normalizeOfficerAssignments } from "../officer-roles.js";

test("club officer settings remain separate from agenda role assignments", () => {
  assert.deepEqual(normalizeOfficerAssignments({ President: "member-1" }), {
    President: "member-1", VPE: "", VPM: "", VPPR: "", SAA: "", Secretary: "", Treasurer: "",
  });
});

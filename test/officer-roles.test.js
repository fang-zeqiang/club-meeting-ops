import assert from "node:assert/strict";
import test from "node:test";

import { assignMeetingPresident } from "../officer-roles.js";

test("new meetings bind President to the configured club officer", () => {
  const meeting = { blocks: [{ items: [
    { session: "Presidential Opening", role: "President", member: "", status: "vacant" },
    { session: "Meeting Awards", role: "Awards Host", member: "Override", status: "pending" },
    { role: "Timer", member: "" },
  ] }] };
  assignMeetingPresident(meeting, [{ id: "member-1", displayName: "Alex Chen", officerRoles: ["President"] }]);
  assert.deepEqual(meeting.blocks[0].items, [
    { session: "Presidential Opening", role: "President", memberId: "member-1", member: "Alex Chen", status: "confirmed" },
    { session: "Meeting Awards", role: "President", memberId: "member-1", member: "Alex Chen", status: "confirmed" },
    { role: "Timer", member: "" },
  ]);
});

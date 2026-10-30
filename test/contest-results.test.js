import assert from "node:assert/strict";
import test from "node:test";
import { contestants, setContestPlace } from "../contest-results.js";

test("contestants come from assigned speech rows once each", () => {
  const meeting = { blocks: [
    { items: [{ kind: "speech", memberId: "m1", member: "Ada" }, { kind: "speech", member: "" }, { kind: "role", member: "Host" }] },
    { items: [{ kind: "speech", memberId: "m1", member: "Ada" }, { kind: "speech", memberId: "", member: "Guest Bo" }] },
  ] };
  assert.deepEqual(contestants(meeting), [{ memberId: "m1", name: "Ada" }, { memberId: "", name: "Guest Bo" }]);
});

test("placing a contestant moves them out of any previous place", () => {
  const ada = { memberId: "m1", name: "Ada" };
  const bo = { memberId: "m2", name: "Bo" };
  const placed = setContestPlace(setContestPlace({}, "first", ada), "second", bo);
  assert.deepEqual(placed, { first: ada, second: bo });
  assert.deepEqual(setContestPlace(placed, "third", ada), { second: bo, third: ada });
  assert.deepEqual(setContestPlace(placed, "first", null), { second: bo });
});

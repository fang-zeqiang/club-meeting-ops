import assert from "node:assert/strict";
import test from "node:test";
import { awardResultsChanged, awardSnapshotIsStale } from "../server/award-repository.js";

test("award snapshot is stale only while candidate changes await reconfirmation", () => {
  assert.equal(awardSnapshotIsStale(null, { awardsNeedReconfirmation: true }), false);
  assert.equal(awardSnapshotIsStale({ confirmedAt: "2026-07-14T10:00:00Z" }, null), false);
  assert.equal(awardSnapshotIsStale({ confirmedAt: "2026-07-14T10:00:00Z" }, { awardsNeedReconfirmation: false }), false);
  assert.equal(awardSnapshotIsStale({ confirmedAt: "2026-07-14T10:00:00Z" }, { awardsNeedReconfirmation: true }), true);
});

test("result versions ignore legacy snapshots and detect new snapshot changes", () => {
  assert.equal(awardResultsChanged({ confirmedAt: "2026-07-14T10:00:00Z" }, "current"), false);
  assert.equal(awardResultsChanged({ resultsVersion: "current" }, "current"), false);
  assert.equal(awardResultsChanged({ resultsVersion: "previous" }, "current"), true);
});

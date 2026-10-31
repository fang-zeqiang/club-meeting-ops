import assert from "node:assert/strict";
import test from "node:test";
import { createLatestWinsSync } from "../table-topics-sync.js";

function deferredSender() {
  const calls = [];
  const send = (snapshot) => new Promise((resolve, reject) => calls.push({ snapshot, resolve, reject }));
  return { calls, send };
}

test("snapshots pushed while a request is in flight collapse into one request with the latest list", async () => {
  const { calls, send } = deferredSender();
  const synced = [];
  const sync = createLatestWinsSync({ send, onSynced: (result) => synced.push(result) });

  sync.push({ entries: ["A"] });
  sync.push({ entries: ["A", "B"] });
  sync.push({ entries: ["A", "B", "C"] });
  sync.push({ entries: ["A", "B", "C", "D"] });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].snapshot, { entries: ["A"] });
  assert.equal(sync.state().status, "syncing");
  assert.equal(sync.hasLocalChanges(), true);

  calls[0].resolve({ entries: ["A"] });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 2, "中间的 B、C 快照被最新的 D 快照覆盖，只再发一次");
  assert.deepEqual(calls[1].snapshot, { entries: ["A", "B", "C", "D"] });
  assert.deepEqual(synced, [], "后面还有新快照时，旧请求的响应不能回写覆盖本地");

  calls[1].resolve({ entries: ["A", "B", "C", "D"] });
  await sync.whenIdle();
  assert.deepEqual(synced, [{ entries: ["A", "B", "C", "D"] }]);
  assert.equal(sync.state().status, "synced");
  assert.equal(sync.hasLocalChanges(), false);
});

test("a failed snapshot is kept for retry and replaced by any newer push", async () => {
  const { calls, send } = deferredSender();
  const sync = createLatestWinsSync({ send });

  sync.push({ entries: ["A", "B"] });
  calls[0].reject(new Error("Feishu Bitable rejected the request."));
  await sync.whenIdle();
  assert.equal(sync.state().status, "error");
  assert.equal(sync.state().error.message, "Feishu Bitable rejected the request.");
  assert.equal(sync.hasLocalChanges(), true);

  sync.retry();
  assert.deepEqual(calls[1].snapshot, { entries: ["A", "B"] });
  calls[1].reject(new Error("timeout"));
  await sync.whenIdle();

  sync.push({ entries: ["A", "B", "C"] });
  assert.deepEqual(calls[2].snapshot, { entries: ["A", "B", "C"] }, "新快照包含失败的那份，直接整体提交");
  calls[2].resolve({ entries: ["A", "B", "C"] });
  await sync.whenIdle();
  assert.equal(sync.state().status, "synced");
  assert.equal(sync.hasLocalChanges(), false);
});

test("a failure followed by a queued snapshot keeps syncing the newer one", async () => {
  const { calls, send } = deferredSender();
  const sync = createLatestWinsSync({ send });
  sync.push({ entries: ["A"] });
  sync.push({ entries: ["A", "B"] });
  calls[0].reject(new Error("boom"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls[1].snapshot, { entries: ["A", "B"] });
  assert.equal(sync.state().status, "syncing");
  calls[1].resolve({ entries: ["A", "B"] });
  await sync.whenIdle();
  assert.equal(sync.state().status, "synced");
});

test("state changes are reported to the listener", async () => {
  const statuses = [];
  const sync = createLatestWinsSync({ send: async () => ({}), onStateChange: (state) => statuses.push(state.status) });
  assert.equal(sync.state().status, "idle");
  sync.push({ entries: [] });
  await sync.whenIdle();
  assert.deepEqual(statuses, ["syncing", "synced"]);
});

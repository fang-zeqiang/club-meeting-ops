import assert from "node:assert/strict";
import test from "node:test";
import {
  currentAuthorization, ensureResourceEditors, resourceEditorOpenIds, votingBaseEditUrl,
} from "../server/resource-access.js";

test("parses, trims, and deduplicates resource editor open IDs", () => {
  assert.deepEqual(resourceEditorOpenIds(" ou_a,ou_b, ou_a ,,"), ["ou_a", "ou_b"]);
});

test("builds a voting Base edit URL for the meeting table", () => {
  assert.equal(votingBaseEditUrl("base token", "tbl/1"), "https://my.feishu.cn/base/base%20token?table=tbl%2F1");
});

test("marks authorization pending when the configured list expands", () => {
  const previous = process.env.FEISHU_RESOURCE_EDITOR_OPEN_IDS;
  process.env.FEISHU_RESOURCE_EDITOR_OPEN_IDS = "ou_a,ou_b";
  try {
    assert.equal(currentAuthorization({ status: "ready", editorOpenIds: ["ou_a"] }).status, "pending");
  } finally {
    if (previous == null) delete process.env.FEISHU_RESOURCE_EDITOR_OPEN_IDS;
    else process.env.FEISHU_RESOURCE_EDITOR_OPEN_IDS = previous;
  }
});

test("ensures missing editors and upgrades viewers without touching editors", async () => {
  const previous = process.env.FEISHU_RESOURCE_EDITOR_OPEN_IDS;
  process.env.FEISHU_RESOURCE_EDITOR_OPEN_IDS = "ou_editor,ou_viewer,ou_missing";
  const writes = [];
  const request = async (path, options = {}) => {
    if (!options.method) return { members: [
      { member_id: "ou_editor", perm: "edit" },
      { member_id: "ou_viewer", perm: "view" },
    ] };
    writes.push({ path, ...options });
    return {};
  };
  try {
    const result = await ensureResourceEditors("token", "slides", {
      request, now: () => new Date("2026-07-02T10:00:00Z"),
    });
    assert.equal(result.status, "ready");
    assert.deepEqual(result.editorOpenIds, ["ou_editor", "ou_viewer", "ou_missing"]);
    assert.equal(writes.length, 2);
    assert.equal(writes[0].method, "PUT");
    assert.equal(writes[1].method, "POST");
    assert.match(writes[1].body, /"perm":"edit"/);
  } finally {
    if (previous == null) delete process.env.FEISHU_RESOURCE_EDITOR_OPEN_IDS;
    else process.env.FEISHU_RESOURCE_EDITOR_OPEN_IDS = previous;
  }
});

test("reports a partial authorization failure without throwing", async () => {
  const previous = process.env.FEISHU_RESOURCE_EDITOR_OPEN_IDS;
  process.env.FEISHU_RESOURCE_EDITOR_OPEN_IDS = "ou_ok,ou_bad";
  const request = async (path, options = {}) => {
    if (!options.method) return { members: [] };
    if (options.body.includes("ou_bad")) throw new Error("denied");
    return {};
  };
  try {
    const result = await ensureResourceEditors("token", "bitable", { request });
    assert.equal(result.status, "failed");
    assert.deepEqual(result.editorOpenIds, ["ou_ok"]);
    assert.equal(result.failures.length, 1);
  } finally {
    if (previous == null) delete process.env.FEISHU_RESOURCE_EDITOR_OPEN_IDS;
    else process.env.FEISHU_RESOURCE_EDITOR_OPEN_IDS = previous;
  }
});

import assert from "node:assert/strict";
import test from "node:test";

const ids = {
  meetingsTable: "tbl_meetings",
  blocksTable: "tbl_blocks",
  itemsTable: "tbl_items",
  membersTable: "tbl_members",
  templatesTable: "tbl_templates",
  assetsTable: "tbl_assets",
};

function listResponse(records) {
  const fields = [...new Set(records.flatMap((record) => Object.keys(record.fields)))];
  return {
    code: 0,
    data: {
      fields,
      record_id_list: records.map((record) => record.record_id),
      data: records.map((record) => fields.map((field) => record.fields[field])),
      has_more: false,
    },
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "x-tt-logid": "test-request-id" },
  });
}

test("updating meeting metadata does not rewrite unchanged blocks or items", { concurrency: false }, async () => {
  Object.assign(process.env, {
    FEISHU_APP_ID: "test-app-id",
    FEISHU_APP_SECRET: "test-app-secret",
    BITABLE_APP_TOKEN: "test-base",
    BITABLE_MEETINGS_TABLE_ID: ids.meetingsTable,
    BITABLE_BLOCKS_TABLE_ID: ids.blocksTable,
    BITABLE_ITEMS_TABLE_ID: ids.itemsTable,
    BITABLE_MEMBERS_TABLE_ID: ids.membersTable,
    BITABLE_TEMPLATES_TABLE_ID: ids.templatesTable,
    BITABLE_ASSETS_TABLE_ID: ids.assetsTable,
  });

  const meetingRecord = {
    record_id: "rec_meeting",
    fields: {
      meeting_id: "meeting_101",
      meeting_number: 101,
      starts_at: Date.parse("2026-06-27T18:40:00+08:00"),
      theme: "Original theme",
      meeting_type: ["regular_meeting"],
      status: "draft",
      venue: "Room 14",
      voting_code: "DEMO-101",
      enable_transition_time: false,
      photographer_member_id: "",
      photographer_name: "",
      meeting_manager_member_id: "",
      meeting_manager_name: "",
      wod_word: "Momentum",
      wod_pronunciation: "/m/",
      wod_example: "Keep moving.",
      revision: 49,
    },
  };
  const blockRecord = {
    record_id: "rec_block",
    fields: {
      block_id: "block_1",
      meeting: [{ id: meetingRecord.record_id }],
      order_index: 0,
      block_type: ["custom"],
      title: "Opening",
      notes: "",
    },
  };
  const itemRecord = {
    record_id: "rec_item",
    fields: {
      item_id: "item_1",
      block: [{ id: blockRecord.record_id }],
      order_index: 0,
      item_kind: ["role"],
      session_title: "Welcome",
      role_title: "Host",
      duration_min: 3,
      member: [],
      member_name_snapshot: "",
      evaluator: [],
      evaluator_name_snapshot: "",
      speech_objective: "",
      status: "confirmed",
    },
  };
  const recordsByTable = new Map([
    [ids.meetingsTable, [meetingRecord]],
    [ids.blocksTable, [blockRecord]],
    [ids.itemsTable, [itemRecord]],
    [ids.membersTable, []],
  ]);
  const childPatches = [];
  let meetingPatches = 0;
  const originalFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    const path = new URL(url).pathname;
    if (path.endsWith("/tenant_access_token/internal")) {
      return jsonResponse({ code: 0, tenant_access_token: "test-token", expire: 7200 });
    }
    const tableId = [...recordsByTable.keys()].find((candidate) => path.includes(`/tables/${candidate}/records`));
    if ((options.method || "GET") === "GET" && tableId) return jsonResponse(listResponse(recordsByTable.get(tableId)));
    if (options.method === "PATCH" && [ids.blocksTable, ids.itemsTable].includes(tableId)) {
      childPatches.push({ tableId, path });
      return jsonResponse({ code: 800030201, msg: "not_found: not_found" }, 404);
    }
    if (options.method === "PATCH" && tableId === ids.meetingsTable) {
      meetingPatches += 1;
      return jsonResponse({ code: 0, data: { record_id: meetingRecord.record_id } });
    }
    throw new Error(`Unexpected request: ${options.method || "GET"} ${path}`);
  };

  try {
    const { updateMeeting } = await import(`../server/meetings-repository.js?meeting-update=${Date.now()}`);
    const payload = {
      id: "meeting_101",
      meetingNumber: 101,
      date: "2026-06-27",
      startTime: "18:40",
      theme: "Updated theme",
      meetingType: "regular_meeting",
      status: "draft",
      venue: "Room 14",
      votingCode: "DEMO-101",
      enableTransitionTime: false,
      photographerMemberId: "",
      photographer: "",
      meetingManagerMemberId: "",
      meetingManager: "",
      votingQr: { present: false },
      wordOfDay: { word: "Momentum", pronunciation: "/m/", example: "Keep moving." },
      revision: 49,
      blocks: [{
        id: "block_1",
        type: "custom",
        title: "Opening",
        notes: "",
        items: [{
          id: "item_1",
          kind: "role",
          session: "Welcome",
          role: "Host",
          duration: 3,
          memberId: "",
          member: "",
          evaluatorId: "",
          evaluator: "",
          speechObjective: "",
          status: "confirmed",
        }],
      }],
    };
    const updated = await updateMeeting("meeting_101", payload, 49);

    assert.equal(updated.theme, "Updated theme");
    assert.equal(updated.revision, 50);
    assert.deepEqual(childPatches, []);
    assert.equal(meetingPatches, 1);

    const unchangedPayload = structuredClone(payload);
    unchangedPayload.theme = "Original theme";
    const unchanged = await updateMeeting("meeting_101", unchangedPayload, 49);
    assert.equal(unchanged.revision, 49);
    assert.equal(meetingPatches, 1);

    const changedItemPayload = structuredClone(payload);
    changedItemPayload.theme = "Original theme";
    changedItemPayload.blocks[0].items[0].status = "vacant";
    await assert.rejects(
      () => updateMeeting("meeting_101", changedItemPayload, 49),
      (error) => error.statusCode === 409
        && error.code === "REVISION_CONFLICT"
        && error.details?.reason === "BITABLE_RECORD_NOT_FOUND"
        && error.details?.itemId === "item_1",
    );
    assert.equal(childPatches.length, 1);

    const changedObjectivePayload = structuredClone(payload);
    changedObjectivePayload.theme = "Original theme";
    changedObjectivePayload.blocks[0].items[0].kind = "speech";
    changedObjectivePayload.blocks[0].items[0].speechObjective = "Improve vocal variety.";
    await assert.rejects(
      () => updateMeeting("meeting_101", changedObjectivePayload, 49),
      (error) => error.statusCode === 409
        && error.code === "REVISION_CONFLICT"
        && error.details?.reason === "BITABLE_RECORD_NOT_FOUND"
        && error.details?.itemId === "item_1",
    );
    assert.equal(childPatches.length, 2);
  } finally {
    global.fetch = originalFetch;
  }
});

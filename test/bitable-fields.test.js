import assert from "node:assert/strict";
import test from "node:test";

function jsonResponse(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

test("listRecords restores full field names from field IDs", { concurrency: false }, async () => {
  Object.assign(process.env, {
    FEISHU_APP_ID: "test-app-id",
    FEISHU_APP_SECRET: "test-app-secret",
    BITABLE_APP_TOKEN: "test-base",
    BITABLE_MEETINGS_TABLE_ID: "tbl_meetings",
    BITABLE_BLOCKS_TABLE_ID: "tbl_blocks",
    BITABLE_ITEMS_TABLE_ID: "tbl_items",
    BITABLE_MEMBERS_TABLE_ID: "tbl_members",
    BITABLE_TEMPLATES_TABLE_ID: "tbl_templates",
    BITABLE_ASSETS_TABLE_ID: "tbl_assets",
  });

  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    const path = new URL(url).pathname;
    if (path.endsWith("/tenant_access_token/internal")) {
      return jsonResponse({ code: 0, tenant_access_token: "test-token", expire: 7200 });
    }
    if (path.endsWith("/tables/tbl_meetings/fields")) {
      return jsonResponse({
        code: 0,
        data: {
          fields: [
            { id: "fld_meeting_number", name: "meeting_number" },
            { id: "fld_transition", name: "enable_transition_time" },
            { id: "fld_photographer", name: "photographer_member_id" },
          ],
        },
      });
    }
    if (path.endsWith("/tables/tbl_meetings/records")) {
      return jsonResponse({
        code: 0,
        data: {
          fields: ["meeting_number", "enable_transition_ti...", "photographer_member_..."],
          field_id_list: ["fld_meeting_number", "fld_transition", "fld_photographer"],
          record_id_list: ["rec_meeting"],
          data: [[101, true, "member_photo"]],
          has_more: false,
        },
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    const { listRecords } = await import(`../server/bitable.js?field-names=${Date.now()}`);
    const records = await listRecords("tbl_meetings");
    assert.deepEqual(records[0].fields, {
      meeting_number: 101,
      enable_transition_time: true,
      photographer_member_id: "member_photo",
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test("listRecords can filter through Feishu search", { concurrency: false }, async () => {
  Object.assign(process.env, {
    FEISHU_APP_ID: "test-app-id",
    FEISHU_APP_SECRET: "test-app-secret",
    BITABLE_APP_TOKEN: "test-base",
    BITABLE_MEETINGS_TABLE_ID: "tbl_meetings",
    BITABLE_BLOCKS_TABLE_ID: "tbl_blocks",
    BITABLE_ITEMS_TABLE_ID: "tbl_items",
    BITABLE_MEMBERS_TABLE_ID: "tbl_members",
    BITABLE_TEMPLATES_TABLE_ID: "tbl_templates",
    BITABLE_ASSETS_TABLE_ID: "tbl_assets",
  });

  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async (url, options = {}) => {
    const path = new URL(url).pathname;
    if (path.endsWith("/tenant_access_token/internal")) {
      return jsonResponse({ code: 0, tenant_access_token: "test-token", expire: 7200 });
    }
    if (path.endsWith("/tables/tbl_meetings/records/search")) {
      requests.push(JSON.parse(options.body));
      return jsonResponse({
        code: 0,
        data: {
          items: [{ record_id: "rec_meeting", fields: { meeting_id: "meeting_101", theme: "Fast path" } }],
          has_more: false,
        },
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    const { fieldEquals, listRecords } = await import(`../server/bitable.js?filter=${Date.now()}`);
    const records = await listRecords("tbl_meetings", { filter: fieldEquals("meeting_id", "meeting_101") });
    assert.deepEqual(records, [{ record_id: "rec_meeting", fields: { meeting_id: "meeting_101", theme: "Fast path" } }]);
    assert.deepEqual(requests[0], {
      filter: { conjunction: "and", conditions: [{ field_name: "meeting_id", operator: "is", value: ["meeting_101"] }] },
    });
  } finally {
    global.fetch = originalFetch;
  }
});

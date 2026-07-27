#!/usr/bin/env python3
"""
Create missing Bitable tables and required fields, then print table_ids.
Requires FEISHU_APP_ID, FEISHU_APP_SECRET, BITABLE_APP_TOKEN env vars.
"""

import json
import os
import sys
import urllib.request

API_ROOT = "https://open.feishu.cn/open-apis"

def api_call(path, method="GET", body=None, headers=None):
    url = f"{API_ROOT}{path}"
    req_headers = {"Content-Type": "application/json; charset=utf-8"}
    if headers:
        req_headers.update(headers)
    data = json.dumps(body).encode("utf-8") if body else None
    req = urllib.request.Request(url, method=method, data=data, headers=req_headers)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))

def get_tenant_token():
    app_id = os.environ["FEISHU_APP_ID"]
    app_secret = os.environ["FEISHU_APP_SECRET"]
    result = api_call("/auth/v3/tenant_access_token/internal", method="POST", body={"app_id": app_id, "app_secret": app_secret})
    if result.get("code") != 0:
        print(f"ERROR: Failed to get token: {result}", file=sys.stderr)
        sys.exit(1)
    return result["tenant_access_token"]

def list_tables(app_token, token):
    result = api_call(f"/base/v3/bases/{app_token}/tables", headers={"Authorization": f"Bearer {token}"})
    if result.get("code") != 0:
        print(f"ERROR: Failed to list tables: {result}", file=sys.stderr)
        sys.exit(1)
    tables = {}
    data = result.get("data", {})
    for table in data.get("tables", data.get("items", [])):
        name = table.get("name") or table.get("table_name") or table.get("table", {}).get("name")
        table_id = table.get("table_id") or table.get("id")
        if name and table_id:
            tables[name] = table_id
    return tables

def create_table(app_token, token, name):
    result = api_call(
        f"/base/v3/bases/{app_token}/tables",
        method="POST",
        headers={"Authorization": f"Bearer {token}"},
        body={"name": name},
    )
    if result.get("code") != 0:
        print(f"ERROR: Failed to create table '{name}': {result}", file=sys.stderr)
        sys.exit(1)
    data = result.get("data", {})
    return data.get("table_id") or data.get("table", {}).get("table_id") or data.get("table", {}).get("id")

def list_fields(app_token, table_id, token):
    result = api_call(
        f"/base/v3/bases/{app_token}/tables/{table_id}/fields?limit=100",
        headers={"Authorization": f"Bearer {token}"},
    )
    if result.get("code") != 0:
        print(f"ERROR: Failed to list fields for table '{table_id}': {result}", file=sys.stderr)
        sys.exit(1)
    return {(field.get("name") or field.get("field_name")): field for field in result.get("data", {}).get("fields", result.get("data", {}).get("items", []))}

def ensure_field(app_token, table_id, token, field_name, field_type="text"):
    fields = list_fields(app_token, table_id, token)
    if field_name in fields:
        print(f"Field already exists: {field_name}")
        return
    result = api_call(
        f"/base/v3/bases/{app_token}/tables/{table_id}/fields",
        method="POST",
        headers={"Authorization": f"Bearer {token}"},
        body={"name": field_name, "type": field_type},
    )
    if result.get("code") != 0:
        print(f"ERROR: Failed to create field '{field_name}': {result}", file=sys.stderr)
        sys.exit(1)
    print(f"Created field: {field_name}")

def list_records(app_token, table_id, token):
    records = []
    page_token = ""
    while True:
        suffix = f"&page_token={page_token}" if page_token else ""
        result = api_call(
            f"/bitable/v1/apps/{app_token}/tables/{table_id}/records?page_size=500{suffix}",
            headers={"Authorization": f"Bearer {token}"},
        )
        if result.get("code") != 0:
            print(f"ERROR: Failed to list records for table '{table_id}': {result}", file=sys.stderr)
            sys.exit(1)
        data = result.get("data", {})
        records.extend(data.get("items", []))
        if not data.get("has_more"):
            return records
        page_token = data.get("page_token", "")

def linked_ids(value):
    if isinstance(value, list):
        ids = []
        for item in value:
            if not isinstance(item, dict):
                continue
            ids.extend(item.get("record_ids") or [])
            ids.append(item.get("id") or item.get("record_id"))
        return [item for item in ids if item]
    if isinstance(value, dict):
        return value.get("link_record_ids") or value.get("record_ids") or []
    return []

def update_record(app_token, table_id, record_id, token, fields):
    result = api_call(
        f"/base/v3/bases/{app_token}/tables/{table_id}/records/{record_id}",
        method="PATCH",
        headers={"Authorization": f"Bearer {token}"},
        body=fields,
    )
    if result.get("code") != 0:
        print(f"ERROR: Failed to update record '{record_id}': {result}", file=sys.stderr)
        sys.exit(1)

def backfill_lookup_fields(app_token, token, meetings_id, blocks_id, items_id):
    meetings = list_records(app_token, meetings_id, token)
    blocks = list_records(app_token, blocks_id, token)
    items = list_records(app_token, items_id, token)
    meeting_by_record = {record.get("record_id"): record.get("fields", {}).get("meeting_id", "") for record in meetings}
    block_info_by_record = {}
    block_updates = 0
    for record in blocks:
        fields = record.get("fields", {})
        meeting_id = fields.get("meeting_id") or meeting_by_record.get((linked_ids(fields.get("meeting")) or [""])[0], "")
        block_id = fields.get("block_id", "")
        block_info_by_record[record.get("record_id")] = {"meeting_id": meeting_id, "block_id": block_id}
        if meeting_id and fields.get("meeting_id") != meeting_id:
            update_record(app_token, blocks_id, record["record_id"], token, {"meeting_id": meeting_id})
            block_updates += 1

    item_updates = 0
    for record in items:
        fields = record.get("fields", {})
        block_info = block_info_by_record.get((linked_ids(fields.get("block")) or [""])[0], {})
        desired = {key: value for key, value in {
            "meeting_id": block_info.get("meeting_id", ""),
            "block_id": block_info.get("block_id", ""),
        }.items() if value and fields.get(key) != value}
        if desired:
            update_record(app_token, items_id, record["record_id"], token, desired)
            item_updates += 1
    print(f"Backfilled lookup fields: Blocks={block_updates}, Items={item_updates}")

def main():
    if "--apply" not in sys.argv[1:]:
        print("Dry run: inspect or create support fields and tables.")
        print("No remote changes made. Re-run with --apply after reviewing docs/BASE_SCHEMA.md.")
        return
    app_token = os.environ["BITABLE_APP_TOKEN"]
    token = get_tenant_token()
    items_only = "--items-only" in sys.argv[1:]
    optimize_lookups = "--optimize-lookups" in sys.argv[1:]

    if items_only:
        items_id = os.environ.get("BITABLE_ITEMS_TABLE_ID")
        if not items_id:
            print("ERROR: --items-only requires BITABLE_ITEMS_TABLE_ID.", file=sys.stderr)
            sys.exit(1)
        for field_name in ("speech_objective", "evaluator_status", "role_assignment_id", "linked_speech_id", "pathways_mode", "pathways_path", "pathways_level", "pathways_project_id", "pathways_form_id", "external_presentation_url", "meeting_id", "block_id"):
            ensure_field(app_token, items_id, token, field_name)
        return

    tables = list_tables(app_token, token)
    print("Existing table names:", ", ".join(sorted(tables)))

    items_id = os.environ.get("BITABLE_ITEMS_TABLE_ID") or tables.get("Items")
    if not items_id:
        print("ERROR: Items table not found; set BITABLE_ITEMS_TABLE_ID.", file=sys.stderr)
        sys.exit(1)
    for field_name in ("speech_objective", "evaluator_status", "role_assignment_id", "linked_speech_id", "pathways_mode", "pathways_path", "pathways_level", "pathways_project_id", "pathways_form_id", "external_presentation_url", "meeting_id", "block_id"):
        ensure_field(app_token, items_id, token, field_name)

    meetings_id = os.environ.get("BITABLE_MEETINGS_TABLE_ID") or tables.get("Meetings")
    if not meetings_id:
        print("ERROR: Meetings table not found; set BITABLE_MEETINGS_TABLE_ID.", file=sys.stderr)
        sys.exit(1)
    ensure_field(app_token, meetings_id, token, "table_topics_speakers_json")
    ensure_field(app_token, meetings_id, token, "voting_qr_source")
    ensure_field(app_token, meetings_id, token, "voting_form_json")
    ensure_field(app_token, meetings_id, token, "system_voting_qr_image", "attachment")
    for field_name in ("confirmed_awards_json", "award_presentation_json", "award_audit_json"):
        ensure_field(app_token, meetings_id, token, field_name)
    for field_name in ("review_json", "review_status", "quality_metrics_json", "review_completed_at"):
        ensure_field(app_token, meetings_id, token, field_name)
    ensure_field(app_token, meetings_id, token, "quality_score", "number")

    blocks_id = os.environ.get("BITABLE_BLOCKS_TABLE_ID") or tables.get("Blocks")
    if not blocks_id:
        print("ERROR: Blocks table not found; set BITABLE_BLOCKS_TABLE_ID.", file=sys.stderr)
        sys.exit(1)
    ensure_field(app_token, blocks_id, token, "meeting_id")
    if optimize_lookups:
        backfill_lookup_fields(app_token, token, meetings_id, blocks_id, items_id)

    # Assets table
    if "Assets" not in tables:
        print("Creating Assets table...")
        assets_id = create_table(app_token, token, "Assets")
        ensure_field(app_token, assets_id, token, "asset_key")
        ensure_field(app_token, assets_id, token, "image", "attachment")
        print(f"Assets table_id: {assets_id}")
    else:
        print(f"Assets already exists, table_id: {tables['Assets']}")

    # Templates table
    if "Templates" not in tables:
        print("Creating Templates table...")
        templates_id = create_table(app_token, token, "Templates")
        for field_name in ("template_id", "name", "meeting_type", "source_meeting_id", "structure_json"):
            ensure_field(app_token, templates_id, token, field_name)
        ensure_field(app_token, templates_id, token, "created_at", "datetime")
        print(f"Templates table_id: {templates_id}")
    else:
        print(f"Templates already exists, table_id: {tables['Templates']}")

    # Division template versions table
    if "DivisionTemplateVersions" not in tables:
        print("Creating DivisionTemplateVersions table...")
        versions_id = create_table(app_token, token, "DivisionTemplateVersions")
        for field_name in ("version_id", "template_key", "name", "note", "snapshot_json", "created_by"):
            ensure_field(app_token, versions_id, token, field_name)
        ensure_field(app_token, versions_id, token, "version_number", "number")
        ensure_field(app_token, versions_id, token, "created_at", "datetime")
        ensure_field(app_token, versions_id, token, "is_current", "checkbox")
        print(f"DivisionTemplateVersions table_id: {versions_id}")
    else:
        print(f"DivisionTemplateVersions already exists, table_id: {tables['DivisionTemplateVersions']}")

if __name__ == "__main__":
    main()

#!/usr/bin/env python3
import json
import os
import sys
import urllib.request

required = ["FEISHU_APP_ID", "FEISHU_APP_SECRET", "BITABLE_APP_TOKEN"]
missing = [name for name in required if not os.environ.get(name)]
for name in required:
    print(f"{name}: {'present' if os.environ.get(name) else 'missing'}")
if missing:
    print("Missing required variables: " + ", ".join(missing), file=sys.stderr)
    sys.exit(1)

body = json.dumps({
    "app_id": os.environ["FEISHU_APP_ID"],
    "app_secret": os.environ["FEISHU_APP_SECRET"],
}).encode("utf-8")
request = urllib.request.Request(
    "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
    method="POST",
    data=body,
    headers={"Content-Type": "application/json; charset=utf-8"},
)
with urllib.request.urlopen(request, timeout=30) as response:
    result = json.loads(response.read().decode("utf-8"))
if result.get("code") != 0:
    print(f"Authentication failed with provider code {result.get('code')}.", file=sys.stderr)
    sys.exit(1)
print("Authentication check passed.")

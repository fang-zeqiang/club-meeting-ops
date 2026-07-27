import { feishuJson } from "./bitable.js";

export function resourceEditorOpenIds(value = process.env.FEISHU_RESOURCE_EDITOR_OPEN_IDS || "") {
  return [...new Set(String(value).split(",").map((item) => item.trim()).filter(Boolean))];
}

export function votingBaseEditUrl(appToken, tableId) {
  if (!appToken || !tableId) return "";
  return `https://my.feishu.cn/base/${encodeURIComponent(appToken)}?table=${encodeURIComponent(tableId)}`;
}

export function currentAuthorization(saved) {
  const expected = resourceEditorOpenIds();
  if (!expected.length) return {
    status: "not_configured",
    editorOpenIds: [],
    message: "FEISHU_RESOURCE_EDITOR_OPEN_IDS is not configured.",
  };
  const granted = new Set(saved?.editorOpenIds || []);
  if (saved?.status === "ready" && expected.every((id) => granted.has(id))) return saved;
  return {
    ...(saved || {}),
    status: saved?.status === "failed" ? "failed" : "pending",
    editorOpenIds: [...granted],
    message: saved?.message || "Editor authorization has not been applied to every configured user.",
  };
}

async function listPermissionMembers(token, type, request) {
  const members = [];
  let pageToken = "";
  do {
    const params = new URLSearchParams({ type, page_size: "100" });
    if (pageToken) params.set("page_token", pageToken);
    const data = await request(`/drive/v1/permissions/${encodeURIComponent(token)}/members?${params}`);
    members.push(...(data.items || data.members || []));
    pageToken = data.has_more ? data.page_token : "";
  } while (pageToken);
  return members;
}

function safeError(error) {
  return {
    code: error.code || "RESOURCE_AUTHORIZATION_FAILED",
    message: error.details?.feishuMessage || error.message || "Feishu editor authorization failed.",
  };
}

export async function ensureResourceEditors(token, type, { request = feishuJson, now = () => new Date() } = {}) {
  const editorOpenIds = resourceEditorOpenIds();
  const attemptedAt = now().toISOString();
  if (!editorOpenIds.length) return currentAuthorization(null);
  try {
    const existing = await listPermissionMembers(token, type, request);
    const byId = new Map(existing.map((member) => [member.member_id, member]));
    const failures = [];
    const granted = [];
    for (const openId of editorOpenIds) {
      const member = byId.get(openId);
      try {
        if (!member) {
          await request(`/drive/v1/permissions/${encodeURIComponent(token)}/members?type=${encodeURIComponent(type)}&need_notification=false`, {
            method: "POST",
            body: JSON.stringify({ member_type: "openid", member_id: openId, perm: "edit", type: "user" }),
          });
        } else if (member.perm !== "edit" && member.perm !== "full_access") {
          await request(`/drive/v1/permissions/${encodeURIComponent(token)}/members/${encodeURIComponent(openId)}?type=${encodeURIComponent(type)}&need_notification=false`, {
            method: "PUT",
            body: JSON.stringify({ member_type: "openid", perm: "edit", type: "user" }),
          });
        }
        granted.push(openId);
      } catch (error) {
        failures.push({ openId, ...safeError(error) });
      }
    }
    if (failures.length) return {
      status: "failed", editorOpenIds: granted, attemptedAt, failures,
      message: "Resource created, but editor authorization failed.",
    };
    return { status: "ready", editorOpenIds, attemptedAt };
  } catch (error) {
    return {
      status: "failed", editorOpenIds: [], attemptedAt, failures: [safeError(error)],
      message: "Resource created, but editor authorization failed.",
    };
  }
}

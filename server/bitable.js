const API_ROOT = "https://open.feishu.cn/open-apis";
let tokenCache = null;

export class ApiError extends Error {
  constructor(statusCode, code, message, details) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

function withErrorDetails(error, details) {
  if (!(error instanceof ApiError) || !details) return error;
  error.details = { ...(error.details || {}), ...details };
  return error;
}

export function getBitableConfig() {
  const config = {
    appId: process.env.FEISHU_APP_ID,
    appSecret: process.env.FEISHU_APP_SECRET,
    appToken: process.env.BITABLE_APP_TOKEN,
    meetingsTableId: process.env.BITABLE_MEETINGS_TABLE_ID,
    templatesTableId: process.env.BITABLE_TEMPLATES_TABLE_ID,
    blocksTableId: process.env.BITABLE_BLOCKS_TABLE_ID,
    itemsTableId: process.env.BITABLE_ITEMS_TABLE_ID,
    membersTableId: process.env.BITABLE_MEMBERS_TABLE_ID,
    rolesTableId: process.env.BITABLE_ROLES_TABLE_ID,
    pathwaysProjectsTableId: process.env.BITABLE_PATHWAYS_PROJECTS_TABLE_ID,
    pathwaysEvaluationFormsTableId: process.env.BITABLE_PATHWAYS_EVALUATION_FORMS_TABLE_ID,
    assetsTableId: process.env.BITABLE_ASSETS_TABLE_ID,
    mcpTokensTableId: process.env.BITABLE_MCP_TOKENS_TABLE_ID,
  };
  const optional = new Set(["rolesTableId", "pathwaysProjectsTableId", "pathwaysEvaluationFormsTableId", "mcpTokensTableId"]);
  const missing = Object.entries(config).filter(([key, value]) => !optional.has(key) && !value).map(([key]) => key);
  if (missing.length) throw new ApiError(503, "BITABLE_NOT_CONFIGURED", "Bitable persistence is not configured.", { missing });
  return config;
}

async function tenantToken(forceRefresh = false) {
  if (!forceRefresh && tokenCache && tokenCache.expiresAt > Date.now() + 5 * 60 * 1000) return tokenCache.value;
  const { appId, appSecret } = getBitableConfig();
  const response = await fetch(`${API_ROOT}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  const body = await response.json();
  if (!response.ok || body.code !== 0) {
    throw new ApiError(502, "FEISHU_AUTH_FAILED", "Could not authenticate with Feishu.", { feishuCode: body.code, feishuMessage: body.msg });
  }
  tokenCache = { value: body.tenant_access_token, expiresAt: Date.now() + Number(body.expire || 7200) * 1000 };
  return tokenCache.value;
}

async function authorizedFetch(path, options = {}, retry = true) {
  const token = await tenantToken();
  const response = await fetch(`${API_ROOT}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) },
  });
  if (retry && response.status === 401) {
    await tenantToken(true);
    return authorizedFetch(path, options, false);
  }
  return response;
}

export async function bitableRequest(path, options = {}, retry = true) {
  const response = await authorizedFetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...(options.headers || {}),
    },
  }, retry);
  const body = await response.json().catch(() => ({}));
  if (retry && [99991661, 99991663, 99991668].includes(body.code)) {
    await tenantToken(true);
    return bitableRequest(path, options, false);
  }
  if (!response.ok || body.code !== 0) {
    throw new ApiError(502, "BITABLE_REQUEST_FAILED", "Feishu Bitable rejected the request.", {
      path,
      method: options.method || "GET",
      feishuCode: body.code,
      feishuMessage: body.msg,
      requestId: response.headers.get("x-tt-logid") || undefined,
    });
  }
  return body.data;
}

export async function feishuJson(path, options = {}, retry = true) {
  return bitableRequest(path, options, retry);
}

export async function uploadSlidesImage(presentationId, buffer, fileName, type = "image/png") {
  const form = new FormData();
  form.append("file_name", fileName);
  form.append("parent_type", "slide_file");
  form.append("parent_node", presentationId);
  form.append("size", String(buffer.length));
  form.append("file", new Blob([buffer], { type }), fileName);
  const response = await authorizedFetch("/drive/v1/medias/upload_all", { method: "POST", body: form });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.code !== 0 || !body.data?.file_token) throw feishuError(response, body, "SLIDES_MEDIA_UPLOAD_FAILED");
  return body.data.file_token;
}

const appPath = (appToken, suffix) => `/bitable/v1/apps/${encodeURIComponent(appToken)}${suffix}`;

export async function listBitableTables(appToken) {
  const data = await bitableRequest(appPath(appToken, "/tables?page_size=100"));
  return data.items || [];
}

export async function createBitableTable(appToken, name, fields = []) {
  const data = await bitableRequest(appPath(appToken, "/tables"), { method: "POST", body: JSON.stringify({ table: { name, default_view_name: "Grid", ...(fields.length ? { fields } : {}) } }) });
  return data.table || data;
}

export async function listBitableFields(appToken, tableId) {
  const data = await bitableRequest(appPath(appToken, `/tables/${encodeURIComponent(tableId)}/fields?page_size=100`));
  return data.items || [];
}

export async function createBitableField(appToken, tableId, field) {
  return bitableRequest(appPath(appToken, `/tables/${encodeURIComponent(tableId)}/fields`), { method: "POST", body: JSON.stringify(field) });
}

export async function updateBitableField(appToken, tableId, fieldId, field) {
  try {
    return await bitableRequest(appPath(appToken, `/tables/${encodeURIComponent(tableId)}/fields/${encodeURIComponent(fieldId)}`), { method: "PUT", body: JSON.stringify(field) });
  } catch (error) {
    if (error instanceof ApiError && Number(error.details?.feishuCode) === 1254606) return { field };
    throw error;
  }
}

export async function listBitableViews(appToken, tableId) {
  const data = await bitableRequest(appPath(appToken, `/tables/${encodeURIComponent(tableId)}/views?page_size=100`));
  return data.items || [];
}

export async function createBitableView(appToken, tableId, name, viewType = "form") {
  const data = await bitableRequest(appPath(appToken, `/tables/${encodeURIComponent(tableId)}/views`), { method: "POST", body: JSON.stringify({ view_name: name, view_type: viewType }) });
  return data.view || data;
}

export async function getBitableForm(appToken, tableId, formId) {
  return bitableRequest(appPath(appToken, `/tables/${encodeURIComponent(tableId)}/forms/${encodeURIComponent(formId)}`));
}

export async function updateBitableForm(appToken, tableId, formId, config) {
  return bitableRequest(appPath(appToken, `/tables/${encodeURIComponent(tableId)}/forms/${encodeURIComponent(formId)}`), { method: "PATCH", body: JSON.stringify(config) });
}

export async function updateBitableFormField(appToken, tableId, formId, fieldId, config) {
  return bitableRequest(appPath(appToken, `/tables/${encodeURIComponent(tableId)}/forms/${encodeURIComponent(formId)}/fields/${encodeURIComponent(fieldId)}`), { method: "PATCH", body: JSON.stringify(config) });
}

function feishuError(response, body, fallbackCode = "BITABLE_REQUEST_FAILED") {
  return new ApiError(502, fallbackCode, "Feishu rejected the media request.", {
    feishuCode: body?.code,
    feishuMessage: body?.msg,
    requestId: response.headers.get("x-tt-logid") || undefined,
  });
}

export async function uploadBitableImage(buffer, { fileName, type }, retry = true) {
  const { appToken } = getBitableConfig();
  const form = new FormData();
  form.append("file_name", fileName);
  form.append("parent_type", "bitable_image");
  form.append("parent_node", appToken);
  form.append("size", String(buffer.length));
  form.append("file", new Blob([buffer], { type }), fileName);

  const response = await authorizedFetch("/drive/v1/medias/upload_all", { method: "POST", body: form });
  const body = await response.json().catch(() => ({}));
  if (retry && [99991661, 99991663, 99991668].includes(body.code)) {
    await tenantToken(true);
    return uploadBitableImage(buffer, { fileName, type }, false);
  }
  if (!response.ok || body.code !== 0 || !body.data?.file_token) throw feishuError(response, body, "MEDIA_UPLOAD_FAILED");
  return body.data.file_token;
}

export async function downloadBitableImage(attachment) {
  const fallbackPath = `/drive/v1/medias/${encodeURIComponent(attachment.file_token)}/download`;
  let path = fallbackPath;
  if (attachment.url) {
    const url = new URL(attachment.url);
    if (url.origin !== "https://open.feishu.cn" || !url.pathname.startsWith("/open-apis/drive/v1/medias/")) {
      throw new ApiError(502, "INVALID_MEDIA_URL", "Feishu returned an invalid media URL.");
    }
    path = `${url.pathname.replace(/^\/open-apis/, "")}${url.search}`;
  }

  const response = await authorizedFetch(path, { headers: { Accept: attachment.type || "image/*" } });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw feishuError(response, body, "MEDIA_DOWNLOAD_FAILED");
  }
  return {
    body: Buffer.from(await response.arrayBuffer()),
    type: response.headers.get("content-type") || attachment.type || "application/octet-stream",
  };
}

function recordsPath(tableId, suffix = "") {
  const { appToken } = getBitableConfig();
  return `/base/v3/bases/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/records${suffix}`;
}

function fieldsPath(tableId) {
  const { appToken } = getBitableConfig();
  return `/base/v3/bases/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/fields`;
}

export function fieldEquals(fieldName, value) {
  return { conjunction: "and", conditions: [{ field_name: fieldName, operator: "is", value: [String(value)] }] };
}

async function listFieldNamesById(tableId) {
  const data = await bitableRequest(`${fieldsPath(tableId)}?limit=200&offset=0`);
  const fields = data.fields || data.items || [];
  return new Map(fields.map((field) => [field.id || field.field_id, field.name || field.field_name]));
}

function matchesFilter(record, filter) {
  if (!filter?.conditions?.length) return true;
  return filter.conditions.every((condition) => {
    if (condition.operator !== "is") return true;
    return condition.value.map(String).includes(String(record.fields?.[condition.field_name] ?? ""));
  });
}

async function listFilteredRecords(tableId, filter) {
  const { appToken } = getBitableConfig();
  const records = [];
  let pageToken = "";
  do {
    const params = new URLSearchParams({ page_size: "500" });
    if (pageToken) params.set("page_token", pageToken);
    const data = await bitableRequest(`/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/records/search?${params}`, {
      method: "POST",
      body: JSON.stringify({ filter }),
    });
    records.push(...(data.items || []).map((record) => ({ record_id: record.record_id, fields: record.fields || {} })));
    pageToken = data.has_more ? data.page_token : "";
  } while (pageToken);
  return records;
}

export async function listRecords(tableId, options = {}) {
  if (options.filter) {
    try {
      return await listFilteredRecords(tableId, options.filter);
    } catch (error) {
      // ponytail: fallback keeps old Bases alive; remove after Feishu search is verified everywhere.
      return (await listRecords(tableId)).filter((record) => matchesFilter(record, options.filter));
    }
  }
  const records = [];
  let offset = 0;
  let hasMore = false;
  let fieldNamesById;
  do {
    const params = new URLSearchParams({ limit: "200", offset: String(offset) });
    const data = await bitableRequest(`${recordsPath(tableId)}?${params}`);
    const responseFieldNames = data.fields || [];
    const fieldIds = data.field_id_list || [];
    if (!fieldNamesById && responseFieldNames.some((fieldName) => fieldName.endsWith("...")) && fieldIds.length) {
      fieldNamesById = await listFieldNamesById(tableId);
    }
    const fieldNames = responseFieldNames.map((fieldName, index) => fieldNamesById?.get(fieldIds[index]) || fieldName);
    const recordIds = data.record_id_list || [];
    (data.data || []).forEach((row, index) => {
      records.push({
        record_id: recordIds[index],
        fields: Object.fromEntries(fieldNames.map((field, fieldIndex) => [field, row[fieldIndex]])),
      });
    });
    hasMore = Boolean(data.has_more);
    offset += (data.data || []).length;
  } while (hasMore);
  return records;
}

export async function createRecord(tableId, fields, context = {}) {
  try {
    const data = await bitableRequest(recordsPath(tableId), { method: "POST", body: JSON.stringify(fields) });
    const fieldNames = data.fields || Object.keys(fields);
    const row = data.data?.[0];
    return {
      record_id: data.record_id || data.record_id_list?.[0],
      fields: row ? Object.fromEntries(fieldNames.map((field, index) => [field, row[index]])) : fields,
    };
  } catch (error) {
    throw withErrorDetails(error, { tableId, operation: "createRecord", ...context });
  }
}

export async function updateRecord(tableId, recordId, fields, context = {}) {
  try {
    const data = await bitableRequest(recordsPath(tableId, `/${encodeURIComponent(recordId)}`), {
      method: "PATCH",
      body: JSON.stringify(fields),
    });
    const fieldNames = data.fields || Object.keys(fields);
    const row = data.data?.[0];
    return {
      record_id: data.record_id || data.record_id_list?.[0] || recordId,
      fields: row ? Object.fromEntries(fieldNames.map((field, index) => [field, row[index]])) : fields,
    };
  } catch (error) {
    throw withErrorDetails(error, { tableId, recordId, operation: "updateRecord", ...context });
  }
}

export async function batchCreateRecords(tableId, fieldRows, contextForRow = () => ({})) {
  if (!fieldRows.length) return [];
  const created = [];
  // Base v3 rejects batch creation for rows containing several link fields.
  for (let index = 0; index < fieldRows.length; index += 1) {
    const fields = fieldRows[index];
    created.push(await createRecord(tableId, fields, { rowIndex: index, ...contextForRow(fields, index) }));
  }
  return created;
}

export async function batchUpdateRecords(tableId, records, contextForRow = () => ({})) {
  if (!records.length) return [];
  const updated = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    updated.push(await updateRecord(tableId, record.record_id, record.fields, { rowIndex: index, ...contextForRow(record, index) }));
  }
  return updated;
}

export async function batchDeleteRecords(tableId, recordIds, context = {}) {
  if (!recordIds.length) return;
  for (let index = 0; index < recordIds.length; index += 200) {
    const batch = recordIds.slice(index, index + 200);
    try {
      await bitableRequest(recordsPath(tableId, "/batch_delete"), {
        method: "POST",
        body: JSON.stringify({ record_id_list: batch }),
      });
    } catch (error) {
      throw withErrorDetails(error, { tableId, operation: "batchDeleteRecords", recordIds: batch, ...context });
    }
  }
}

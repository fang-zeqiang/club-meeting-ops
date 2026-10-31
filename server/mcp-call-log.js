import { createRecord, getBitableConfig } from "./bitable.js";

const ARGS_DIGEST_MAX = 500;
const INTENT_SUMMARY_MAX = 200;

// 观测数据不能反噬主流程：表未配置、参数异常、写入失败都静默跳过，绝不抛出或拖慢工具调用。
function tableId() {
  try {
    return getBitableConfig().mcpToolCallsTableId || "";
  } catch {
    return "";
  }
}

export function digestToolArgs(args) {
  if (args == null || typeof args !== "object") return "";
  try {
    return JSON.stringify(args).slice(0, ARGS_DIGEST_MAX);
  } catch {
    return "";
  }
}

export function extractMeetingId(args) {
  if (args == null || typeof args !== "object") return "";
  const value = args.meeting_id ?? args.meeting_number ?? "";
  return value === "" ? "" : String(value);
}

export async function logToolCall(entry) {
  const id = tableId();
  if (!id) return;
  try {
    await createRecord(id, {
      tool_name: entry.toolName || "",
      principal_id: entry.principalId || "",
      principal_name: entry.principalName || "",
      args_digest: entry.argsDigest || "",
      duration_ms: entry.durationMs || 0,
      status: entry.status || "ok",
      error_code: entry.errorCode || "",
      meeting_id: entry.meetingId || "",
      client_info: entry.clientInfo || "",
      created_at: new Date().toISOString(),
    }, { entity: "mcp-call-log" });
  } catch {
    // 写入失败不得反噬工具调用结果。
  }
}

// 意图上报是唯一存全文的字段，且已限长；粗筛拦住疑似大段对话或多行文本。
export function validateIntentSummary(value, label) {
  const text = String(value ?? "").trim();
  if (!text) return { valid: false, message: `${label} is required.` };
  if (text.length > INTENT_SUMMARY_MAX) return { valid: false, message: `${label} must be ${INTENT_SUMMARY_MAX} characters or fewer.` };
  if (text.includes("\n")) return { valid: false, message: `${label} must be a single line, not a conversation transcript.` };
  return { valid: true, text };
}

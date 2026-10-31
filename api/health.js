import mcpHandler from "../server/mcp.js";

export const maxDuration = 60;

export default async function handler(_request, response) {
  if (_request.query?.view === "mcp") return mcpHandler(_request, response);
  const requiredBitableVariables = [
    "FEISHU_APP_ID",
    "FEISHU_APP_SECRET",
    "BITABLE_APP_TOKEN",
    "BITABLE_MEETINGS_TABLE_ID",
    "BITABLE_TEMPLATES_TABLE_ID",
    "BITABLE_BLOCKS_TABLE_ID",
    "BITABLE_ITEMS_TABLE_ID",
    "BITABLE_MEMBERS_TABLE_ID",
    "BITABLE_ASSETS_TABLE_ID",
    "BITABLE_MCP_TOKENS_TABLE_ID",
    "BITABLE_ROLES_TABLE_ID",
    "AGENDA_EDIT_PASSCODE_HASH",
    "AGENDA_SESSION_SECRET",
  ];

  const configured = requiredBitableVariables.every((name) => Boolean(process.env[name]));

  response.status(200).json({
    status: "ok",
    persistence: configured ? "bitable-ready" : "local-only",
    booking: process.env.BOOKING_PASSCODE_HASH ? "ready" : "not-configured",
    mcp: process.env.BITABLE_MCP_TOKENS_TABLE_ID && process.env.AGENDA_SESSION_SECRET ? "ready" : "not-configured",
    mcpAgendaWrite: process.env.BITABLE_MCP_AGENDA_CHANGES_TABLE_ID && process.env.MCP_AGENDA_WRITE_ENABLED === "true" ? "enabled" : "disabled",
    mcpBookingWrite: process.env.BITABLE_MCP_AGENDA_CHANGES_TABLE_ID && process.env.MCP_BOOKING_WRITE_ENABLED === "true" ? "enabled" : "disabled",
    configuredAt: new Date().toISOString(),
  });
}

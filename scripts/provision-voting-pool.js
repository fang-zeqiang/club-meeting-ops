import { getBitableConfig, listBitableTables, listRecords } from "../server/bitable.js";
import { asText } from "../server/meeting-schema.js";
import { provisionVotingPoolTable, VOTING_POOL_PREFIX } from "../server/voting-repository.js";

const target = Math.max(1, Number(process.env.VOTING_POOL_SIZE || 3));
if (!process.argv.includes("--apply")) {
  console.log(JSON.stringify({ status: "dry-run", target, message: "No remote changes made. Re-run with --apply." }));
  process.exit(0);
}
const appToken = process.env.BITABLE_VOTING_APP_TOKEN;
if (!appToken) throw new Error("BITABLE_VOTING_APP_TOKEN is not configured.");

const { meetingsTableId } = getBitableConfig();
const [tables, meetings] = await Promise.all([listBitableTables(appToken), listRecords(meetingsTableId)]);
const used = new Set(meetings.flatMap((record) => {
  try { return [JSON.parse(asText(record.fields.voting_form_json) || "null")?.tableId].filter(Boolean); }
  catch { return []; }
}));
const ready = tables.filter((table) => String(table.name || "").startsWith(VOTING_POOL_PREFIX) && !used.has(table.table_id));
const created = [];
for (let index = ready.length; index < target; index += 1) created.push(await provisionVotingPoolTable());
console.log(JSON.stringify({ status: "ok", target, readyBefore: ready.length, created: created.length, readyAfter: ready.length + created.length }));

import {
  batchDeleteRecords,
  getBitableConfig,
  listRecords,
} from "../server/bitable.js";
import { asText } from "../server/meeting-schema.js";
import { createMeeting, updateMeeting } from "../server/meetings-repository.js";
import { getPathwaysCatalog, publicPathwaysCatalog } from "../server/pathways-repository.js";

const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const ids = {
  meeting: `smoke_meeting_${suffix}`,
  block: `smoke_block_${suffix}`,
  item: `smoke_item_${suffix}`,
};
const config = getBitableConfig();
const pathwaysCatalog = publicPathwaysCatalog(await getPathwaysCatalog());
const pathwaysProject = pathwaysCatalog.projects.find((project) => pathwaysCatalog.forms.some((form) => form.projectId === project.projectId));
const pathwaysForm = pathwaysCatalog.forms.find((form) => form.projectId === pathwaysProject?.projectId);
const pathwaysPath = [...(pathwaysProject?.requiredPaths || []), ...(pathwaysProject?.electivePaths || [])][0];
if (!pathwaysProject || !pathwaysForm || !pathwaysPath) throw new Error("Learning catalog has no bookable project.");

const fixture = {
  id: ids.meeting,
  meetingNumber: 999999,
  date: "",
  startTime: "18:40",
  theme: "",
  meetingType: "regular_meeting",
  status: "draft",
  venue: "Temporary",
  votingCode: "SMOKE",
  wordOfDay: { word: "Verify", pronunciation: "", example: "Trust, then verify." },
  revision: 0,
  blocks: [
    {
      id: ids.block,
      type: "opening",
      title: "Opening",
      items: [
        {
          id: ids.item,
          kind: "speech",
          session: "",
          role: "Prepared Speaker",
          duration: 7,
          memberId: "",
          member: "",
          evaluatorId: "",
          evaluator: "",
          evaluatorStatus: "vacant",
          pathwaysMode: "pathways",
          pathwaysPath,
          pathwaysLevel: "forged",
          pathwaysProjectId: pathwaysProject.projectId,
          pathwaysFormId: pathwaysForm.formId,
          speechObjective: "forged",
          status: "vacant",
        },
      ],
    },
  ],
};

async function cleanup() {
  const [meetings, blocks, items] = await Promise.all([
    listRecords(config.meetingsTableId),
    listRecords(config.blocksTableId),
    listRecords(config.itemsTableId),
  ]);
  await batchDeleteRecords(config.itemsTableId, items.filter((record) => asText(record.fields.item_id) === ids.item).map((record) => record.record_id));
  await batchDeleteRecords(config.blocksTableId, blocks.filter((record) => asText(record.fields.block_id) === ids.block).map((record) => record.record_id));
  await batchDeleteRecords(config.meetingsTableId, meetings.filter((record) => asText(record.fields.meeting_id) === ids.meeting).map((record) => record.record_id));
}

try {
  const created = await createMeeting(fixture);
  const createdSpeech = created.blocks[0]?.items[0];
  if (created.revision !== 1 || createdSpeech?.session !== "" || createdSpeech?.pathwaysLevel !== pathwaysProject.level || createdSpeech?.speechObjective !== pathwaysForm.speechPurpose) {
    const storedItems = await listRecords(config.itemsTableId);
    const storedBlocks = await listRecords(config.blocksTableId);
    const storedItem = storedItems.find((record) => asText(record.fields.item_id) === ids.item);
    const storedBlock = storedBlocks.find((record) => asText(record.fields.block_id) === ids.block);
    throw new Error(`Created meeting did not round trip through Base: ${JSON.stringify({ revision: created.revision, blocks: created.blocks.map((block) => ({ id: block.id, items: block.items.length })), session: created.blocks[0]?.items[0]?.session, storedBlockLink: storedItem?.fields.block, storedBlockRecord: storedBlock?.record_id, storedItemRecord: storedItem?.record_id })}`);
  }
  const updated = await updateMeeting(ids.meeting, { ...created, date: "2026-06-27", theme: "Persistence smoke test updated" }, 1);
  if (updated.revision !== 2 || updated.date !== "2026-06-27" || updated.theme !== "Persistence smoke test updated") {
    throw new Error("Updated meeting did not round trip through Base.");
  }
  console.log(JSON.stringify({ status: "ok", createdRevision: created.revision, updatedRevision: updated.revision }));
} finally {
  await cleanup();
}

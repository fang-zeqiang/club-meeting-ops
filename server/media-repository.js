import {
  ApiError,
  createRecord,
  downloadBitableImage,
  fieldEquals,
  getBitableConfig,
  listRecords,
  updateRecord,
  uploadBitableImage,
} from "./bitable.js";
import { asText } from "./meeting-schema.js";
import { firstAttachment, imageDescriptor } from "./qr-image.js";

const VOTING_FIELD = "voting_qr_image";
const SYSTEM_VOTING_FIELD = "system_voting_qr_image";
const ASSET_KEY_FIELD = "asset_key";
const ASSET_IMAGE_FIELD = "image";
const GLOBAL_ASSET_KEYS = Object.freeze({
  "group-qr": "group_qr",
  "wechat-payment-qr": "wechat_payment_qr",
  "officer-team-photo": "officer_team_photo",
  "future-poster-1": "future_poster_1",
  "future-poster-2": "future_poster_2",
  "club-intro-photo": "club_intro_photo",
});

function uploadedAttachment(fileToken, image) {
  return {
    file_token: fileToken,
    name: image.fileName,
    size: image.size,
    type: image.type,
  };
}

async function meetingRecord(meetingId) {
  const { meetingsTableId } = getBitableConfig();
  const record = (await listRecords(meetingsTableId, { filter: fieldEquals("meeting_id", meetingId) }))[0];
  if (!record) throw new ApiError(404, "MEETING_NOT_FOUND", "Meeting not found.");
  return record;
}

export function nextMediaRevision(currentValue, expectedRevision) {
  const currentRevision = Number(currentValue || 0);
  if (!Number.isInteger(Number(expectedRevision)) || Number(expectedRevision) !== currentRevision) {
    throw new ApiError(409, "REVISION_CONFLICT", "This meeting was changed in another session.", { currentRevision });
  }
  return currentRevision + 1;
}

function assertRevision(record, expectedRevision) {
  const currentRevision = Number(record.fields.revision || 0);
  return { currentRevision, nextRevision: nextMediaRevision(currentRevision, expectedRevision) };
}

async function assetRecord(assetKey) {
  const { assetsTableId } = getBitableConfig();
  return (await listRecords(assetsTableId))
    .find((candidate) => asText(candidate.fields[ASSET_KEY_FIELD]) === assetKey) || null;
}

function globalAssetKey(kind) {
  const assetKey = GLOBAL_ASSET_KEYS[kind];
  if (!assetKey) throw new ApiError(400, "INVALID_ASSET_KIND", "Unknown image asset type.");
  return assetKey;
}

export async function getVotingImage(meetingId) {
  const record = await meetingRecord(meetingId);
  const attachment = firstAttachment(record.fields[VOTING_FIELD]);
  return {
    attachment,
    image: imageDescriptor(record.fields[VOTING_FIELD]),
    revision: Number(record.fields.revision || 0),
  };
}

export async function getSystemVotingImage(meetingId) {
  const record = await meetingRecord(meetingId);
  const attachment = firstAttachment(record.fields[SYSTEM_VOTING_FIELD]);
  return { attachment, image: imageDescriptor(record.fields[SYSTEM_VOTING_FIELD]), revision: Number(record.fields.revision || 0) };
}

export async function uploadVotingImage(meetingId, expectedRevision, buffer, image) {
  const config = getBitableConfig();
  const record = await meetingRecord(meetingId);
  const { nextRevision } = assertRevision(record, expectedRevision);
  const fileToken = await uploadBitableImage(buffer, image);
  const attachment = uploadedAttachment(fileToken, image);
  await updateRecord(config.meetingsTableId, record.record_id, {
    [VOTING_FIELD]: [{ file_token: fileToken }],
    revision: nextRevision,
  });
  return { image: imageDescriptor([attachment]), revision: nextRevision };
}

export async function removeVotingImage(meetingId, expectedRevision) {
  const config = getBitableConfig();
  const record = await meetingRecord(meetingId);
  const { nextRevision } = assertRevision(record, expectedRevision);
  await updateRecord(config.meetingsTableId, record.record_id, {
    [VOTING_FIELD]: [],
    revision: nextRevision,
  });
  return { image: imageDescriptor(null), revision: nextRevision };
}

export async function getGlobalAssetImage(kind) {
  const record = await assetRecord(globalAssetKey(kind));
  const value = record?.fields[ASSET_IMAGE_FIELD];
  return { attachment: firstAttachment(value), image: imageDescriptor(value) };
}

export async function uploadGlobalAssetImage(kind, buffer, image, { expectedVersion } = {}) {
  const assetKey = globalAssetKey(kind);
  const config = getBitableConfig();
  const existing = await assetRecord(assetKey);
  const currentVersion = imageDescriptor(existing?.fields[ASSET_IMAGE_FIELD]).version;
  if (expectedVersion !== undefined && expectedVersion !== currentVersion) {
    throw new ApiError(409, "VERSION_CONFLICT", "The image changed after it was read.", { currentVersion });
  }
  // ponytail: Feishu asset rows have no atomic CAS; add an asset revision field if concurrent writers become common.
  const fileToken = await uploadBitableImage(buffer, image);
  const fields = {
    [ASSET_KEY_FIELD]: assetKey,
    [ASSET_IMAGE_FIELD]: [{ file_token: fileToken }],
  };
  if (existing) await updateRecord(config.assetsTableId, existing.record_id, fields);
  else await createRecord(config.assetsTableId, fields);
  return { image: imageDescriptor([uploadedAttachment(fileToken, image)]) };
}

export async function removeGlobalAssetImage(kind) {
  const config = getBitableConfig();
  const existing = await assetRecord(globalAssetKey(kind));
  if (existing) await updateRecord(config.assetsTableId, existing.record_id, { [ASSET_IMAGE_FIELD]: [] });
  return { image: imageDescriptor(null) };
}

export async function readStoredImage(attachment) {
  if (!attachment) throw new ApiError(404, "IMAGE_NOT_FOUND", "This QR code image has not been uploaded.");
  return downloadBitableImage(attachment);
}

export async function findMeetingForSeed(meetingNumber, status) {
  const { meetingsTableId } = getBitableConfig();
  const matches = (await listRecords(meetingsTableId)).filter(
    (record) => Number(record.fields.meeting_number) === Number(meetingNumber) && asText(record.fields.status) === status,
  );
  if (matches.length !== 1) {
    throw new ApiError(409, "SEED_MEETING_AMBIGUOUS", `Expected exactly one ${status} meeting #${meetingNumber}, found ${matches.length}.`);
  }
  return {
    id: asText(matches[0].fields.meeting_id),
    revision: Number(matches[0].fields.revision || 0),
  };
}

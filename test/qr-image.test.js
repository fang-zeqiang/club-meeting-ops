import assert from "node:assert/strict";
import test from "node:test";
import { imageDescriptor, MAX_GENERAL_IMAGE_BYTES, MAX_QR_IMAGE_BYTES, validateClubIntroImage, validateFuturePosterImage, validateOfficerTeamImage, validatePaymentImage, validateQrImage } from "../server/qr-image.js";
import { nextMediaRevision } from "../server/media-repository.js";

function png(width, height) {
  const buffer = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer);
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

function jpeg(width, height) {
  const buffer = Buffer.alloc(21);
  buffer.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08]);
  buffer.writeUInt16BE(height, 7);
  buffer.writeUInt16BE(width, 9);
  return buffer;
}

test("accepts square and near-square JPEG and PNG images", () => {
  assert.deepEqual(validateQrImage(png(500, 500), "image/png", "vote"), {
    type: "image/png",
    width: 500,
    height: 500,
    fileName: "vote.png",
    size: 24,
  });
  assert.equal(validateQrImage(jpeg(484, 491), "image/jpeg", "group.jpeg").fileName, "group.jpeg");
});

test("rejects mismatched content, non-square images, and oversized payloads", () => {
  assert.throws(() => validateQrImage(png(500, 500), "image/jpeg", "wrong.jpg"), { code: "INVALID_IMAGE_CONTENT" });
  assert.throws(() => validateQrImage(png(500, 400), "image/png", "wide.png"), { code: "IMAGE_NOT_SQUARE" });
  assert.throws(
    () => validateQrImage(Buffer.alloc(MAX_QR_IMAGE_BYTES + 1), "image/jpeg", "large.jpg"),
    { code: "IMAGE_TOO_LARGE" },
  );
});

test("accepts non-square officer team images within the larger size budget", () => {
  assert.equal(validateOfficerTeamImage(png(1600, 900), "image/png", "officers").fileName, "officers.png");
  assert.throws(
    () => validateOfficerTeamImage(Buffer.alloc(MAX_GENERAL_IMAGE_BYTES + 1), "image/png", "large.png"),
    { code: "IMAGE_TOO_LARGE" },
  );
});

test("future meeting posters accept arbitrary JPEG and PNG aspect ratios", () => {
  assert.equal(validateFuturePosterImage(png(300, 1200), "image/png", "portrait").fileName, "portrait.png");
  assert.equal(validateFuturePosterImage(png(1600, 400), "image/png", "wide.png").width, 1600);
});

test("WeChat payment images keep arbitrary aspect ratios", () => {
  const image = validatePaymentImage(png(939, 1280), "image/png", "payment");
  assert.deepEqual([image.width, image.height, image.fileName], [939, 1280, "payment.png"]);
});

test("club introduction photos accept a full landscape image", () => {
  const image = validateClubIntroImage(png(1920, 1280), "image/png", "club-photo");
  assert.deepEqual([image.width, image.height, image.fileName], [1920, 1280, "club-photo.png"]);
});

test("maps attachment values to browser-safe image descriptors", () => {
  const absent = imageDescriptor([]);
  assert.equal(absent.present, false);
  const present = imageDescriptor([{ file_token: "box_secretish", name: "vote.jpg", type: "image/jpeg", size: 1234 }]);
  assert.deepEqual({ ...present, version: "opaque" }, {
    present: true,
    name: "vote.jpg",
    type: "image/jpeg",
    size: 1234,
    version: "opaque",
  });
  assert.equal(present.version.includes("box_secretish"), false);
});

test("increments matching media revisions and rejects stale writes", () => {
  assert.equal(nextMediaRevision(4, 4), 5);
  assert.throws(() => nextMediaRevision(4, 3), { code: "REVISION_CONFLICT", details: { currentRevision: 4 } });
});

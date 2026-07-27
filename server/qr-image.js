import crypto from "node:crypto";
import path from "node:path";
import { ApiError } from "./bitable.js";

export const MAX_QR_IMAGE_BYTES = 2 * 1024 * 1024;
export const MAX_QR_ASPECT_DEVIATION = 0.05;
export const MAX_GENERAL_IMAGE_BYTES = 5 * 1024 * 1024;
const POSTER_ASPECT_TOLERANCE = 0.14;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png"]);

function pngDimensions(buffer) {
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  return { type: "image/png", width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function jpegDimensions(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 3 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (buffer[offset] === 0xff) offset += 1;
    const marker = buffer[offset++];
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (offset + 2 > buffer.length) break;
    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length) break;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      if (length < 7) break;
      return { type: "image/jpeg", height: buffer.readUInt16BE(offset + 3), width: buffer.readUInt16BE(offset + 5) };
    }
    offset += length;
  }
  return null;
}

function validateImage(buffer, declaredType, suppliedName, {
  maxBytes,
  emptyMessage,
  tooLargeCode,
  tooLargeMessage,
  unsupportedMessage,
  invalidDimensionsMessage,
  aspectRatio,
  aspectTolerance,
  aspectCode,
  aspectMessage,
  fallbackName,
} = {}) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    throw new ApiError(400, "EMPTY_IMAGE", emptyMessage);
  }
  if (buffer.length > maxBytes) {
    throw new ApiError(413, tooLargeCode, tooLargeMessage);
  }
  if (!ALLOWED_TYPES.has(declaredType)) {
    throw new ApiError(415, "UNSUPPORTED_IMAGE_TYPE", unsupportedMessage);
  }

  const detected = pngDimensions(buffer) || jpegDimensions(buffer);
  if (!detected || detected.type !== declaredType) {
    throw new ApiError(415, "INVALID_IMAGE_CONTENT", "The file contents do not match a supported JPEG or PNG image.");
  }
  if (!detected.width || !detected.height) {
    throw new ApiError(400, "INVALID_IMAGE_DIMENSIONS", invalidDimensionsMessage);
  }

  if (aspectRatio && aspectTolerance != null) {
    const actualRatio = detected.width / detected.height;
    if (Math.abs(actualRatio - aspectRatio) > aspectTolerance) {
      throw new ApiError(400, aspectCode, aspectMessage, {
        width: detected.width,
        height: detected.height,
      });
    }
  }

  const rawName = path.basename(String(suppliedName || fallbackName)).slice(0, 180);
  const extension = detected.type === "image/png" ? ".png" : ".jpg";
  const fileName = rawName.toLocaleLowerCase().endsWith(extension)
    || (detected.type === "image/jpeg" && rawName.toLocaleLowerCase().endsWith(".jpeg"))
    ? rawName
    : `${rawName.replace(/\.[^.]*$/, "") || fallbackName}${extension}`;

  return { ...detected, fileName, size: buffer.length };
}

export function validateQrImage(buffer, declaredType, suppliedName = "qr-code") {
  return validateImage(buffer, declaredType, suppliedName, {
    maxBytes: MAX_QR_IMAGE_BYTES,
    emptyMessage: "Choose a non-empty QR code image.",
    tooLargeCode: "IMAGE_TOO_LARGE",
    tooLargeMessage: "QR code images must be 2 MB or smaller.",
    unsupportedMessage: "QR code images must be JPEG or PNG files.",
    invalidDimensionsMessage: "The QR code image dimensions are invalid.",
    aspectRatio: 1,
    aspectTolerance: MAX_QR_ASPECT_DEVIATION,
    aspectCode: "IMAGE_NOT_SQUARE",
    aspectMessage: "QR code images must be square or within 5% of a 1:1 ratio.",
    fallbackName: "qr-code",
  });
}

export function validatePaymentImage(buffer, declaredType, suppliedName = "wechat-payment-qr") {
  return validateImage(buffer, declaredType, suppliedName, {
    maxBytes: MAX_GENERAL_IMAGE_BYTES,
    emptyMessage: "Choose a non-empty WeChat payment image.",
    tooLargeCode: "IMAGE_TOO_LARGE",
    tooLargeMessage: "WeChat payment images must be 5 MB or smaller.",
    unsupportedMessage: "WeChat payment images must be JPEG or PNG files.",
    invalidDimensionsMessage: "The WeChat payment image dimensions are invalid.",
    fallbackName: "wechat-payment-qr",
  });
}

export function validateOfficerTeamImage(buffer, declaredType, suppliedName = "officer-team-photo") {
  return validateImage(buffer, declaredType, suppliedName, {
    maxBytes: MAX_GENERAL_IMAGE_BYTES,
    emptyMessage: "Choose a non-empty officer team image.",
    tooLargeCode: "IMAGE_TOO_LARGE",
    tooLargeMessage: "Officer team images must be 5 MB or smaller.",
    unsupportedMessage: "Officer team images must be JPEG or PNG files.",
    invalidDimensionsMessage: "The officer team image dimensions are invalid.",
    fallbackName: "officer-team-photo",
  });
}

export function validateFuturePosterImage(buffer, declaredType, suppliedName = "future-poster") {
  return validateImage(buffer, declaredType, suppliedName, {
    maxBytes: MAX_GENERAL_IMAGE_BYTES,
    emptyMessage: "Choose a non-empty future meeting poster.",
    tooLargeCode: "IMAGE_TOO_LARGE",
    tooLargeMessage: "Future meeting posters must be 5 MB or smaller.",
    unsupportedMessage: "Future meeting posters must be JPEG or PNG files.",
    invalidDimensionsMessage: "The future meeting poster dimensions are invalid.",
    fallbackName: "future-poster",
  });
}

export function validateClubIntroImage(buffer, declaredType, suppliedName = "club-intro-photo") {
  return validateImage(buffer, declaredType, suppliedName, {
    maxBytes: MAX_GENERAL_IMAGE_BYTES,
    emptyMessage: "Choose a non-empty club introduction photo.",
    tooLargeCode: "IMAGE_TOO_LARGE",
    tooLargeMessage: "Club introduction photos must be 5 MB or smaller.",
    unsupportedMessage: "Club introduction photos must be JPEG or PNG files.",
    invalidDimensionsMessage: "The club introduction photo dimensions are invalid.",
    fallbackName: "club-intro-photo",
  });
}

export function firstAttachment(value) {
  const attachments = Array.isArray(value) ? value : Array.isArray(value?.value) ? value.value : [];
  return attachments.find((attachment) => attachment?.file_token) || null;
}

export function imageDescriptor(value) {
  const attachment = firstAttachment(value);
  if (!attachment) return { present: false, name: "", type: "", size: 0, version: "" };
  return {
    present: true,
    name: String(attachment.name || "QR code"),
    type: String(attachment.type || "image/jpeg"),
    size: Number(attachment.size || 0),
    version: crypto.createHash("sha256").update(String(attachment.file_token)).digest("hex").slice(0, 16),
  };
}

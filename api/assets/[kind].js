import { ApiError } from "../../server/bitable.js";
import { requireSession } from "../../server/auth.js";
import { handleApiError, methodNotAllowed, readBuffer, sendJson, verifySameOrigin } from "../../server/http.js";
import { getGlobalAssetImage, readStoredImage, removeGlobalAssetImage, uploadGlobalAssetImage } from "../../server/media-repository.js";
import { MAX_GENERAL_IMAGE_BYTES, MAX_QR_IMAGE_BYTES, validateClubIntroImage, validateFuturePosterImage, validateOfficerTeamImage, validatePaymentImage, validateQrImage } from "../../server/qr-image.js";

const ASSET_REGISTRY = Object.freeze({
  "group-qr": {
    fallbackName: "group-qr",
    maxBytes: MAX_QR_IMAGE_BYTES,
    missingMessage: "The group QR code has not been uploaded.",
    validate: (buffer, type, name) => validateQrImage(buffer, type, name),
  },
  "wechat-payment-qr": {
    fallbackName: "wechat-payment-qr",
    maxBytes: MAX_GENERAL_IMAGE_BYTES,
    missingMessage: "The WeChat payment image has not been uploaded.",
    validate: validatePaymentImage,
  },
  "officer-team-photo": {
    fallbackName: "officer-team-photo",
    maxBytes: MAX_GENERAL_IMAGE_BYTES,
    missingMessage: "The officer team image has not been uploaded.",
    validate: (buffer, type, name) => validateOfficerTeamImage(buffer, type, name),
  },
  "future-poster-1": {
    fallbackName: "future-poster-1",
    maxBytes: MAX_GENERAL_IMAGE_BYTES,
    missingMessage: "Future meeting poster 1 has not been uploaded.",
    validate: validateFuturePosterImage,
  },
  "future-poster-2": {
    fallbackName: "future-poster-2",
    maxBytes: MAX_GENERAL_IMAGE_BYTES,
    missingMessage: "Future meeting poster 2 has not been uploaded.",
    validate: validateFuturePosterImage,
  },
  "club-intro-photo": {
    fallbackName: "club-intro-photo",
    maxBytes: MAX_GENERAL_IMAGE_BYTES,
    missingMessage: "The club introduction photo has not been uploaded.",
    validate: validateClubIntroImage,
  },
});

function queryValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

function assetConfig(request) {
  const kind = queryValue(request.query.kind);
  const config = ASSET_REGISTRY[kind];
  if (!config) throw new ApiError(400, "INVALID_ASSET_KIND", "Unknown image asset type.");
  return { kind, ...config };
}

function fileName(request, fallbackName) {
  const encoded = queryValue(request.headers["x-file-name"]) || fallbackName;
  try {
    return decodeURIComponent(encoded);
  } catch {
    return fallbackName;
  }
}

async function sendImage(request, response, stored, config) {
  if (!stored.attachment) return sendJson(response, 404, { code: "IMAGE_NOT_FOUND", message: config.missingMessage });
  const etag = `"${stored.image.version}"`;
  if (request.headers["if-none-match"] === etag) {
    response.status(304).end();
    return;
  }
  const media = await readStoredImage(stored.attachment);
  response.status(200);
  response.setHeader("Content-Type", media.type);
  response.setHeader("Content-Length", String(media.body.length));
  response.setHeader("Cache-Control", "private, max-age=300");
  response.setHeader("ETag", etag);
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.end(media.body);
}

export default async function handler(request, response) {
  try {
    if (!["GET", "POST", "DELETE"].includes(request.method)) return methodNotAllowed(response, ["GET", "POST", "DELETE"]);
    const config = assetConfig(request);
    const publicPosterRead = request.method === "GET"
      && queryValue(request.query.view) === "presentation"
      && (config.kind.startsWith("future-poster-") || config.kind === "club-intro-photo");
    if (!publicPosterRead && !requireSession(request, response)) return;

    if (request.method === "GET") {
      const stored = await getGlobalAssetImage(config.kind);
      if (queryValue(request.query.metadata) === "1") return sendJson(response, 200, { image: stored.image });
      return sendImage(request, response, stored, config);
    }

    if (!verifySameOrigin(request)) return sendJson(response, 403, { code: "INVALID_ORIGIN", message: "Request origin is not allowed." });
    if (request.method === "DELETE") return sendJson(response, 200, await removeGlobalAssetImage(config.kind));

    const type = String(request.headers["content-type"] || "").split(";", 1)[0].trim().toLocaleLowerCase();
    const buffer = await readBuffer(request, config.maxBytes);
    const image = config.validate(buffer, type, fileName(request, config.fallbackName));
    return sendJson(response, 200, await uploadGlobalAssetImage(config.kind, buffer, image));
  } catch (error) {
    return handleApiError(response, error);
  }
}

import { requireSession } from "../../../../server/auth.js";
import { handleApiError, methodNotAllowed, readBuffer, sendJson, verifySameOrigin } from "../../../../server/http.js";
import { getVotingImage, readStoredImage, removeVotingImage, uploadVotingImage } from "../../../../server/media-repository.js";
import { MAX_QR_IMAGE_BYTES, validateQrImage } from "../../../../server/qr-image.js";

function queryValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

function fileName(request) {
  const encoded = queryValue(request.headers["x-file-name"]) || "qr-code";
  try {
    return decodeURIComponent(encoded);
  } catch {
    return "qr-code";
  }
}

async function sendImage(request, response, stored) {
  if (!stored.attachment) return sendJson(response, 404, { code: "IMAGE_NOT_FOUND", message: "This QR code image has not been uploaded." });
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
    const publicPresentationImage = request.method === "GET" && queryValue(request.query.view) === "presentation";
    if (!publicPresentationImage && !requireSession(request, response)) return;
    const meetingId = queryValue(request.query.id);

    if (request.method === "GET") {
      const stored = await getVotingImage(meetingId);
      if (queryValue(request.query.metadata) === "1") return sendJson(response, 200, { image: stored.image, revision: stored.revision });
      return await sendImage(request, response, stored);
    }

    if (!verifySameOrigin(request)) return sendJson(response, 403, { code: "INVALID_ORIGIN", message: "Request origin is not allowed." });
    const expectedRevision = Number(queryValue(request.headers["x-expected-revision"]));
    if (request.method === "DELETE") {
      return sendJson(response, 200, await removeVotingImage(meetingId, expectedRevision));
    }

    const type = String(request.headers["content-type"] || "").split(";", 1)[0].trim().toLocaleLowerCase();
    const buffer = await readBuffer(request, MAX_QR_IMAGE_BYTES);
    const image = validateQrImage(buffer, type, fileName(request));
    return sendJson(response, 200, await uploadVotingImage(meetingId, expectedRevision, buffer, image));
  } catch (error) {
    return handleApiError(response, error);
  }
}

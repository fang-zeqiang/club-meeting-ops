import { requireSession } from "../../../server/auth.js";
import { handleApiError, methodNotAllowed, readJson, sendJson, verifySameOrigin } from "../../../server/http.js";
import { getSystemVotingImage, readStoredImage } from "../../../server/media-repository.js";
import {
  authorizeVotingEditors, clearVotingResponses, getVotingFormStatus, getVotingResults, prepareVotingForm,
  saveTableTopicsSpeakers, setVotingQrSource, syncVotingForm,
} from "../../../server/voting-repository.js";

const value = (input) => Array.isArray(input) ? input[0] : input;

export default async function handler(request, response) {
  try {
    const meetingId = value(request.query.id);
    const action = value(request.query.action) || "status";
    const publicPresentationImage = request.method === "GET" && action === "system-image" && value(request.query.view) === "presentation";
    if (!publicPresentationImage && !requireSession(request, response)) return;
    if (["POST", "PUT", "DELETE"].includes(request.method) && !verifySameOrigin(request)) {
      return sendJson(response, 403, { code: "INVALID_ORIGIN", message: "Request origin is not allowed." });
    }
    if (request.method === "GET" && action === "status") return sendJson(response, 200, await getVotingFormStatus(meetingId));
    if (request.method === "GET" && action === "results") return sendJson(response, 200, await getVotingResults(meetingId));
    if (request.method === "GET" && action === "system-image") {
      const stored = await getSystemVotingImage(meetingId);
      if (!stored.attachment) return sendJson(response, 404, { code: "IMAGE_NOT_FOUND", message: "System voting QR is not ready." });
      const media = await readStoredImage(stored.attachment);
      response.status(200).setHeader("Content-Type", media.type);
      response.setHeader("Cache-Control", "private, max-age=300");
      return response.end(media.body);
    }
    if (request.method === "POST" && action === "prepare") return sendJson(response, 200, await prepareVotingForm(meetingId));
    if (request.method === "POST" && action === "authorize") return sendJson(response, 200, await authorizeVotingEditors(meetingId));
    if (request.method === "POST" && action === "sync") {
      const body = await readJson(request);
      return sendJson(response, 200, await syncVotingForm(meetingId, { confirmResponseReset: body.confirmResponseReset === true }));
    }
    if (request.method === "PUT" && action === "speakers") {
      const body = await readJson(request);
      return sendJson(response, 200, await saveTableTopicsSpeakers(meetingId, body.speakers, {
        confirmResponseReset: body.confirmResponseReset === true,
        tableIdHint: String(body.tableId || ""),
      }));
    }
    if (request.method === "DELETE" && action === "responses") return sendJson(response, 200, await clearVotingResponses(meetingId));
    if (request.method === "PUT" && action === "qr-source") {
      const body = await readJson(request);
      return sendJson(response, 200, await setVotingQrSource(meetingId, body.qrSource));
    }
    return methodNotAllowed(response, ["GET", "POST", "PUT", "DELETE"]);
  } catch (error) { return handleApiError(response, error); }
}

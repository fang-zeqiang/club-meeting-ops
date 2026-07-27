import { requireSession } from "../../../server/auth.js";
import { handleApiError, methodNotAllowed, readJson, sendJson, verifySameOrigin } from "../../../server/http.js";
import { updateMeetingReview } from "../../../server/meetings-repository.js";

export default async function handler(request, response) {
  try {
    if (request.method !== "PUT") return methodNotAllowed(response, ["PUT"]);
    if (!requireSession(request, response)) return;
    if (!verifySameOrigin(request)) return sendJson(response, 403, { code: "INVALID_ORIGIN", message: "Request origin is not allowed." });
    const id = Array.isArray(request.query.id) ? request.query.id[0] : request.query.id;
    const body = await readJson(request);
    return sendJson(response, 200, await updateMeetingReview(id, body));
  } catch (error) {
    return handleApiError(response, error);
  }
}

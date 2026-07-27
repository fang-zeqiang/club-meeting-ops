import { requireSession } from "../../../server/auth.js";
import { confirmAwards, getConfirmedAwardPage, getLiveAwardResults } from "../../../server/award-repository.js";
import { handleApiError, methodNotAllowed, readJson, sendJson, verifySameOrigin } from "../../../server/http.js";
import { resolveMeetingId } from "../../../server/meetings-repository.js";

export default async function handler(request, response) {
  try {
    if (!["GET", "POST"].includes(request.method)) return methodNotAllowed(response, ["GET", "POST"]);
    const id = await resolveMeetingId(Array.isArray(request.query.id) ? request.query.id[0] : request.query.id);
    if (request.method === "GET" && request.query.view === "confirmed") return sendJson(response, 200, await getConfirmedAwardPage(id));
    if (!requireSession(request, response)) return;
    if (request.method === "GET") return sendJson(response, 200, await getLiveAwardResults(id));
    if (!verifySameOrigin(request)) return sendJson(response, 403, { code: "INVALID_ORIGIN", message: "Request origin is not allowed." });
    const body = await readJson(request);
    return sendJson(response, 200, await confirmAwards(id, body));
  } catch (error) {
    return handleApiError(response, error);
  }
}

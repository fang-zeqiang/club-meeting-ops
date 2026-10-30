import { requireSession } from "../../../server/auth.js";
import { getLiveAwardResults, getSharingMasterAward } from "../../../server/award-repository.js";
import { handleApiError, methodNotAllowed, sendJson } from "../../../server/http.js";
import { resolveMeetingId } from "../../../server/meetings-repository.js";

export default async function handler(request, response) {
  try {
    if (request.method !== "GET") return methodNotAllowed(response, ["GET"]);
    const id = await resolveMeetingId(Array.isArray(request.query.id) ? request.query.id[0] : request.query.id);
    if (request.query.view === "sharing-master") return sendJson(response, 200, await getSharingMasterAward(id));
    if (request.query.view === "ceremony") return sendJson(response, 200, await getLiveAwardResults(id, { includeResults: false }));
    if (!requireSession(request, response)) return;
    if (request.query.view === "live") return sendJson(response, 200, await getLiveAwardResults(id));
    return sendJson(response, 200, await getLiveAwardResults(id));
  } catch (error) {
    return handleApiError(response, error);
  }
}

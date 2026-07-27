import { requireSession } from "../../server/auth.js";
import { handleApiError, methodNotAllowed, readJson, sendJson, verifySameOrigin } from "../../server/http.js";
import { createTemplateFromMeeting, listTemplates } from "../../server/templates-repository.js";

export default async function handler(request, response) {
  try {
    if (!["GET", "POST"].includes(request.method)) return methodNotAllowed(response, ["GET", "POST"]);
    if (!requireSession(request, response)) return;
    if (request.method === "GET") {
      return sendJson(response, 200, { templates: await listTemplates() });
    }
    if (!verifySameOrigin(request)) return sendJson(response, 403, { code: "INVALID_ORIGIN", message: "Request origin is not allowed." });
    const body = await readJson(request);
    return sendJson(response, 201, { template: await createTemplateFromMeeting(body.meeting, body.name) });
  } catch (error) {
    return handleApiError(response, error);
  }
}

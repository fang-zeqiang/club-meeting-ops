import { requireSession } from "../../server/auth.js";
import { handleApiError, methodNotAllowed, readJson, sendJson, verifySameOrigin } from "../../server/http.js";
import { getTemplate, renameTemplate } from "../../server/templates-repository.js";

export default async function handler(request, response) {
  try {
    if (!["GET", "PUT"].includes(request.method)) return methodNotAllowed(response, ["GET", "PUT"]);
    if (!requireSession(request, response)) return;
    const id = Array.isArray(request.query?.id) ? request.query.id[0] : request.query?.id;
    if (request.method === "PUT") {
      if (!verifySameOrigin(request)) return sendJson(response, 403, { code: "INVALID_ORIGIN", message: "Request origin is not allowed." });
      const body = await readJson(request);
      return sendJson(response, 200, { template: await renameTemplate(id, body.name) });
    }
    return sendJson(response, 200, { template: await getTemplate(id) });
  } catch (error) {
    return handleApiError(response, error);
  }
}

import { requireBookingSession, requireSession } from "../server/auth.js";
import { handleApiError, methodNotAllowed, readJson, sendJson, verifySameOrigin } from "../server/http.js";
import { listBookingMembers } from "../server/booking-repository.js";
import { createGuestMember, getMembers, updateOfficerAssignments } from "../server/meetings-repository.js";
import { createAgendaRole, getAgendaRoles } from "../server/roles-repository.js";

export default async function handler(request, response) {
  try {
    if (request.query?.view === "roles") {
      if (!["GET", "POST"].includes(request.method)) return methodNotAllowed(response, ["GET", "POST"]);
      if (!requireSession(request, response)) return;
      if (request.method === "GET") return sendJson(response, 200, { roles: await getAgendaRoles() });
      if (!verifySameOrigin(request)) return sendJson(response, 403, { code: "INVALID_ORIGIN", message: "Request origin is not allowed." });
      const result = await createAgendaRole((await readJson(request)).name);
      return sendJson(response, result.created ? 201 : 200, result);
    }
    if (request.query?.view === "book") {
      if (request.method !== "GET") return methodNotAllowed(response, ["GET"]);
      if (!requireBookingSession(request, response)) return;
      return sendJson(response, 200, { members: await listBookingMembers() });
    }
    if (!["GET", "POST", "PUT"].includes(request.method)) return methodNotAllowed(response, ["GET", "POST", "PUT"]);
    if (!requireSession(request, response)) return;
    if (request.method === "GET") return sendJson(response, 200, { members: await getMembers() });
    if (!verifySameOrigin(request)) return sendJson(response, 403, { code: "INVALID_ORIGIN", message: "Request origin is not allowed." });
    const body = await readJson(request);
    if (request.method === "PUT") return sendJson(response, 200, { members: await updateOfficerAssignments(body.officers) });
    return sendJson(response, 201, { member: await createGuestMember(body) });
  } catch (error) {
    return handleApiError(response, error);
  }
}

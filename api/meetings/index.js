import { requireBookingSession, requireSession } from "../../server/auth.js";
import { handleApiError, methodNotAllowed, readJson, sendJson, verifySameOrigin } from "../../server/http.js";
import { changeBooking, deleteGoal, getBookingDashboard, restoreGoal, saveGoal } from "../../server/booking-repository.js";
import { createMeeting, listMeetings } from "../../server/meetings-repository.js";
import { getPathwaysCatalog, publicPathwaysCatalog } from "../../server/pathways-repository.js";

export default async function handler(request, response) {
  try {
    if (request.query?.view === "pathways-catalog") {
      if (request.method !== "GET") return methodNotAllowed(response, ["GET"]);
      const booking = request.query.audience === "book";
      if (!(booking ? requireBookingSession(request, response) : requireSession(request, response))) return;
      const catalog = await getPathwaysCatalog();
      return sendJson(response, 200, { catalog: publicPathwaysCatalog(catalog, { includeInactive: !booking && request.query.includeInactive === "1" }) });
    }
    if (request.query?.view === "book") {
      if (!["GET", "POST"].includes(request.method)) return methodNotAllowed(response, ["GET", "POST"]);
      if (!requireBookingSession(request, response)) return;
      if (request.method === "GET") {
        const memberId = Array.isArray(request.query.memberId) ? request.query.memberId[0] : request.query.memberId;
        return sendJson(response, 200, { dashboard: await getBookingDashboard(String(memberId || "")) });
      }
      if (!verifySameOrigin(request)) return sendJson(response, 403, { code: "INVALID_ORIGIN", message: "Request origin is not allowed." });
      const body = await readJson(request);
      const action = String(request.query.action || "");
      if (action === "save-goal") return sendJson(response, 200, { goal: await saveGoal(body.memberId, body.goal) });
      if (action === "delete-goal") return sendJson(response, 200, { deleted: await deleteGoal(body.memberId, body.goalId) });
      if (action === "restore-goal") return sendJson(response, 200, { goal: await restoreGoal(body.memberId, body.goal) });
      if (["book", "cancel", "transfer", "update-speech"].includes(action)) {
        return sendJson(response, 200, { meeting: await changeBooking(action, body) });
      }
      return sendJson(response, 400, { code: "INVALID_ACTION", message: "不支持该预约操作。" });
    }
    if (!["GET", "POST"].includes(request.method)) return methodNotAllowed(response, ["GET", "POST"]);
    if (request.method === "GET" && request.query.view === "guest") {
      const meetings = (await listMeetings()).filter((meeting) => meeting.status === "final").map(({ meetingNumber, date, startTime, theme }) => ({ meetingNumber, date, startTime, theme }));
      return sendJson(response, 200, { meetings });
    }
    if (!requireSession(request, response)) return;
    if (request.method === "GET") return sendJson(response, 200, { meetings: await listMeetings() });
    if (!verifySameOrigin(request)) return sendJson(response, 403, { code: "INVALID_ORIGIN", message: "Request origin is not allowed." });
    const body = await readJson(request);
    return sendJson(response, 201, { meeting: await createMeeting(body.meeting) });
  } catch (error) {
    return handleApiError(response, error);
  }
}

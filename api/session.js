import {
  bookingSessionCookie,
  clearBookingSessionCookie,
  clearSessionCookie,
  createBookingSessionToken,
  createSessionToken,
  getBookingSession,
  getSession,
  sessionCookie,
  verifyBookingPasscode,
  verifyPasscode,
} from "../server/auth.js";
import { handleApiError, methodNotAllowed, readJson, requestProtocol, sendJson, verifySameOrigin } from "../server/http.js";

export default async function handler(request, response) {
  try {
    if (request.query?.view === "book") {
      if (request.method === "GET") return sendJson(response, 200, { authenticated: getBookingSession(request) });
      if (!["POST", "DELETE"].includes(request.method)) return methodNotAllowed(response, ["GET", "POST", "DELETE"]);
      if (!verifySameOrigin(request)) return sendJson(response, 403, { code: "INVALID_ORIGIN", message: "Request origin is not allowed." });
      if (request.method === "DELETE") {
        response.setHeader("Set-Cookie", clearBookingSessionCookie({ secure: requestProtocol(request) === "https" }));
        return sendJson(response, 200, { authenticated: false });
      }
      const body = await readJson(request);
      if (!verifyBookingPasscode(body.passcode)) return sendJson(response, 401, { code: "INVALID_PASSCODE", message: "会员 PIN 不正确。" });
      response.setHeader("Set-Cookie", bookingSessionCookie(createBookingSessionToken(), { secure: requestProtocol(request) === "https" }));
      return sendJson(response, 200, { authenticated: true });
    }
    if (request.method === "GET") return sendJson(response, 200, { authenticated: getSession(request) });
    if (!["POST", "DELETE"].includes(request.method)) return methodNotAllowed(response, ["GET", "POST", "DELETE"]);
    if (!verifySameOrigin(request)) return sendJson(response, 403, { code: "INVALID_ORIGIN", message: "Request origin is not allowed." });

    if (request.method === "DELETE") {
      response.setHeader("Set-Cookie", clearSessionCookie({ secure: requestProtocol(request) === "https" }));
      return sendJson(response, 200, { authenticated: false });
    }

    const body = await readJson(request);
    if (!verifyPasscode(body.passcode)) return sendJson(response, 401, { code: "INVALID_PASSCODE", message: "The edit passcode is incorrect." });
    response.setHeader("Set-Cookie", sessionCookie(createSessionToken(), { secure: requestProtocol(request) === "https" }));
    return sendJson(response, 200, { authenticated: true });
  } catch (error) {
    return handleApiError(response, error);
  }
}

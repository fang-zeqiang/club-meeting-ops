export function sendJson(response, status, body) {
  response.status(status).setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

export async function readJson(request) {
  if (request.body && typeof request.body === "object") return request.body;
  if (typeof request.body === "string") return JSON.parse(request.body || "{}");

  let raw = "";
  for await (const chunk of request) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

export async function readBuffer(request, maxBytes) {
  const declaredLength = Number(request.headers["content-length"] || 0);
  if (declaredLength > maxBytes) {
    const error = new Error("Request body is too large.");
    error.statusCode = 413;
    error.code = "IMAGE_TOO_LARGE";
    throw error;
  }

  if (Buffer.isBuffer(request.body)) {
    if (request.body.length > maxBytes) {
      const error = new Error("Request body is too large.");
      error.statusCode = 413;
      error.code = "IMAGE_TOO_LARGE";
      throw error;
    }
    return request.body;
  }
  if (request.body instanceof Uint8Array || request.body instanceof ArrayBuffer) {
    const body = Buffer.from(request.body);
    if (body.length > maxBytes) {
      const error = new Error("Request body is too large.");
      error.statusCode = 413;
      error.code = "IMAGE_TOO_LARGE";
      throw error;
    }
    return body;
  }
  if (typeof request.body === "string") {
    const body = Buffer.from(request.body);
    if (body.length > maxBytes) {
      const error = new Error("Request body is too large.");
      error.statusCode = 413;
      error.code = "IMAGE_TOO_LARGE";
      throw error;
    }
    return body;
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > maxBytes) {
      const error = new Error("Request body is too large.");
      error.statusCode = 413;
      error.code = "IMAGE_TOO_LARGE";
      throw error;
    }
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

export function methodNotAllowed(response, allowed) {
  response.setHeader("Allow", allowed.join(", "));
  return sendJson(response, 405, { code: "METHOD_NOT_ALLOWED", message: "Method not allowed." });
}

export function verifySameOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return false;
  const forwardedHost = request.headers["x-forwarded-host"] || request.headers.host;
  const forwardedProto = requestProtocol(request);
  return origin === `${forwardedProto}://${forwardedHost}`;
}

export function requestProtocol(request) {
  const forwardedProto = String(request.headers["x-forwarded-proto"] || "").split(",", 1)[0].trim();
  if (forwardedProto) return forwardedProto;
  const host = String(request.headers["x-forwarded-host"] || request.headers.host || "").toLowerCase();
  return /^(localhost|127\.0\.0\.1|\[::1\])(?::|$)/.test(host) ? "http" : "https";
}

export function handleApiError(response, error) {
  if (error?.statusCode) {
    return sendJson(response, error.statusCode, {
      code: error.code || "REQUEST_FAILED",
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    });
  }

  console.error(error);
  return sendJson(response, 500, {
    code: "INTERNAL_ERROR",
    message: "The server could not complete this request.",
  });
}

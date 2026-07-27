export function sendJson(response, status, body) {
  response.status(status).setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.end(JSON.stringify(body));
}

function requestTooLarge() {
  const error = new Error("Request body is too large.");
  error.statusCode = 413;
  error.code = "REQUEST_TOO_LARGE";
  return error;
}

export async function readJson(request, maxBytes = 1024 * 1024) {
  if (request.body && typeof request.body === "object") {
    if (Buffer.byteLength(JSON.stringify(request.body)) > maxBytes) throw requestTooLarge();
    return request.body;
  }
  if (typeof request.body === "string") {
    if (Buffer.byteLength(request.body) > maxBytes) throw requestTooLarge();
    return JSON.parse(request.body || "{}");
  }

  let raw = "";
  let size = 0;
  for await (const chunk of request) {
    size += Buffer.byteLength(chunk);
    if (size > maxBytes) throw requestTooLarge();
    raw += chunk;
  }
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
  if (["http", "https"].includes(forwardedProto)) return forwardedProto;
  const host = String(request.headers["x-forwarded-host"] || request.headers.host || "").toLowerCase();
  return /^(localhost|127\.0\.0\.1|\[::1\])(?::|$)/.test(host) ? "http" : "https";
}

function configuredOrigin(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return "";
    if (url.protocol !== "https:" && !(url.protocol === "http:" && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(url.hostname))) return "";
    return url.origin;
  } catch {
    return "";
  }
}

export function requestOrigin(request) {
  const host = String(request.headers["x-forwarded-host"] || request.headers.host || "").split(",", 1)[0].trim();
  let requested;
  try {
    requested = new URL(`${requestProtocol(request)}://${host}`);
  } catch {
    requested = null;
  }
  if (requested && process.env.NODE_ENV !== "production" && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(requested.hostname)) {
    const hostname = requested.hostname === "localhost" ? "localhost" : requested.hostname === "127.0.0.1" ? "127.0.0.1" : "[::1]";
    return `http://${hostname}${requested.port ? `:${Number(requested.port)}` : ""}`;
  }

  const allowed = [
    process.env.PUBLIC_APP_ORIGIN,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
    process.env.VERCEL_URL,
  ].map(configuredOrigin).filter(Boolean);
  const approved = requested ? allowed.find((origin) => origin === requested.origin) : "";
  if (approved) return approved;

  const error = new Error("Request host is not an approved application origin.");
  error.statusCode = 400;
  error.code = "INVALID_HOST";
  throw error;
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

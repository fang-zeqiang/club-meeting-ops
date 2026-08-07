export const EXTERNAL_PRESENTATION_URL_TOO_LONG = "External presentation URL is too long.";
export const EXTERNAL_PRESENTATION_URL_INVALID = "External presentation URL must be a valid HTTPS URL. Use one URL only; remove spaces, notes, credentials, or extra links.";

export function externalPresentationUrlError(value) {
  const raw = String(value || "");
  if (!raw.trim()) return "";
  if (raw.length > 2048) return EXTERNAL_PRESENTATION_URL_TOO_LONG;
  if (raw !== raw.trim() || !/^[\x21-\x7e]+$/.test(raw) || !raw.startsWith("https://") || (raw.match(/https:\/\//g) || []).length !== 1) {
    return EXTERNAL_PRESENTATION_URL_INVALID;
  }
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && url.hostname && !url.username && !url.password ? "" : EXTERNAL_PRESENTATION_URL_INVALID;
  } catch {
    return EXTERNAL_PRESENTATION_URL_INVALID;
  }
}

export function normalizeExternalPresentationUrl(value) {
  const raw = String(value || "").trim();
  return raw ? new URL(raw).href : "";
}

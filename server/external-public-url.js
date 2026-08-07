import dns from "node:dns/promises";
import https from "node:https";
import net from "node:net";
import { Readable } from "node:stream";

import { ApiError } from "./bitable.js";
import { externalPresentationUrlError } from "../external-presentation-url.js";

const MAX_REDIRECTS = 3;
const MAX_BODY_BYTES = 64 * 1024;
const TIMEOUT_MS = 8_000;
const PROVIDERS = Object.freeze([
  { name: "tencent-docs", hosts: ["docs.qq.com"] },
  { name: "feishu", hosts: ["feishu.cn", "larksuite.com"] },
]);

function providerFor(hostname) {
  return PROVIDERS.find(({ hosts }) => hosts.some((host) => hostname === host || hostname.endsWith(`.${host}`)))?.name || "other";
}

function providerRequestUrl(url, provider) {
  const origin = provider === "tencent-docs" ? "https://docs.qq.com"
    : provider === "feishu" ? "https://feishu.cn"
      : null;
  if (!origin) throw new ApiError(400, "EXTERNAL_URL_SSRF_BLOCKED", "External URL provider is not approved for server-side checks.");
  return new URL(`${url.pathname}${url.search}`, origin);
}

function ipv4Number(address) {
  return address.split(".").reduce((value, part) => (value << 8) + Number(part), 0) >>> 0;
}

function inIpv4Range(address, base, bits) {
  const mask = bits ? (0xffffffff << (32 - bits)) >>> 0 : 0;
  return (ipv4Number(address) & mask) === (ipv4Number(base) & mask);
}

export function isPublicIp(address) {
  if (net.isIP(address) === 4) {
    return ![
      ["0.0.0.0", 8],
      ["10.0.0.0", 8],
      ["100.64.0.0", 10],
      ["127.0.0.0", 8],
      ["169.254.0.0", 16],
      ["172.16.0.0", 12],
      ["192.0.0.0", 24],
      ["192.0.2.0", 24],
      ["192.168.0.0", 16],
      ["198.18.0.0", 15],
      ["198.51.100.0", 24],
      ["203.0.113.0", 24],
      ["224.0.0.0", 4],
      ["240.0.0.0", 4],
    ].some(([base, bits]) => inIpv4Range(address, base, bits));
  }
  if (net.isIP(address) === 6) {
    const normalized = address.toLocaleLowerCase();
    if (normalized.startsWith("::ffff:")) {
      const mapped = normalized.slice("::ffff:".length);
      return net.isIP(mapped) === 4 && isPublicIp(mapped);
    }
    return normalized !== "::" && normalized !== "::1"
      && !normalized.startsWith("fc") && !normalized.startsWith("fd")
      && !normalized.startsWith("fe")
      && !normalized.startsWith("ff")
      && !normalized.startsWith("2001:db8:");
  }
  return false;
}

export function parseExternalUrl(value) {
  if (!String(value || "").trim()) throw new ApiError(400, "INVALID_EXTERNAL_URL", "External URL is required.");
  const error = externalPresentationUrlError(value);
  if (error) throw new ApiError(400, "INVALID_EXTERNAL_URL", error);
  return new URL(String(value));
}

async function assertPublicDestination(url, lookup = dns.lookup) {
  if (url.hostname === "localhost" || net.isIP(url.hostname) && !isPublicIp(url.hostname)) {
    throw new ApiError(400, "EXTERNAL_URL_SSRF_BLOCKED", "External URL resolves to a non-public address.");
  }
  let addresses;
  try {
    addresses = net.isIP(url.hostname) ? [{ address: url.hostname }] : await lookup(url.hostname, { all: true, verbatim: true });
  } catch {
    throw new ApiError(400, "EXTERNAL_URL_UNREACHABLE", "External URL hostname could not be resolved.");
  }
  if (!addresses.length || addresses.some(({ address }) => !isPublicIp(address))) {
    throw new ApiError(400, "EXTERNAL_URL_SSRF_BLOCKED", "External URL resolves to a non-public address.");
  }
  return addresses[0];
}

async function boundedText(response) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      chunks.push(Buffer.from(value.subarray(0, value.byteLength - (size - MAX_BODY_BYTES))));
      await reader.cancel();
      break;
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function frameBlocked(headers) {
  const xfo = String(headers.get("x-frame-options") || "").toLocaleLowerCase();
  const csp = String(headers.get("content-security-policy") || "").toLocaleLowerCase();
  return /\b(deny|sameorigin)\b/.test(xfo)
    || /frame-ancestors\s+(?:'none'|'self')(?:\s|;|$)/.test(csp);
}

function classify(provider, response, body, finalUrl) {
  const text = `${finalUrl}\n${body}`.toLocaleLowerCase();
  if (frameBlocked(response.headers)) return { status: "private", reason: "The provider blocks iframe embedding." };
  if (/(login|sign[ -]?in|扫码登录|登录后|申请权限|request access|permission denied|仅本人|无权限)/i.test(text)) {
    return { status: "private", reason: "A login or permission wall was detected." };
  }
  if (provider === "other") return { status: "unknown", reason: "Only URL safety was checked. Verify anonymous access in a private window." };
  const providerMarker = provider === "tencent-docs"
    ? /(腾讯文档|tencent\s+docs|docs\.qq\.com)/i
    : /(飞书|feishu|lark(?:suite)?)/i;
  if (response.ok && providerMarker.test(text)) return { status: "public", reason: "Anonymous provider content loaded without a login or iframe block." };
  return { status: "unknown", reason: "Anonymous public access could not be determined reliably." };
}

function pinnedFetch(url, address, { headers = {}, timeoutMs = TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const request = https.request(url, {
      method: "GET",
      headers,
      servername: url.hostname,
      lookup: (_hostname, _options, callback) => callback(null, address.address, address.family),
    }, (response) => {
      resolve(new Response(Readable.toWeb(response), { status: response.statusCode, headers: response.headers }));
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error("timeout")));
    request.on("error", reject);
    request.end();
  });
}

export async function checkExternalPublicUrl(value, {
  fetchImpl = null,
  lookup = dns.lookup,
  timeoutMs = TIMEOUT_MS,
  now = new Date(),
} = {}) {
  const deadline = Date.now() + timeoutMs;
  let url = parseExternalUrl(value);
  const provider = providerFor(url.hostname);
  if (provider === "other") await assertPublicDestination(url, lookup);
  if (provider === "other") {
    return {
      url: url.href,
      finalUrl: url.href,
      provider,
      status: "unknown",
      reason: "Only URL safety was checked. Verify anonymous access in a private window.",
      checkedAt: now.toISOString(),
    };
  }
  url = providerRequestUrl(url, provider);
  let address = await assertPublicDestination(url, lookup);

  try {
    for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) throw new Error("timeout");
      const headers = { Accept: "text/html,application/xhtml+xml", Range: `bytes=0-${MAX_BODY_BYTES - 1}`, "User-Agent": "VPE-Agenda-Public-Link-Check/1.0" };
      const response = fetchImpl
        ? await fetchImpl(url, { method: "GET", redirect: "manual", headers, signal: AbortSignal.timeout(remainingMs) })
        : await pinnedFetch(url, address, { headers, timeoutMs: remainingMs });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location || redirect === MAX_REDIRECTS) throw new Error("redirect");
        const redirected = parseExternalUrl(new URL(location, url).href);
        if (providerFor(redirected.hostname) !== provider) throw new Error("redirect");
        url = providerRequestUrl(redirected, provider);
        address = await assertPublicDestination(url, lookup);
        continue;
      }
      if (!response.ok) {
        return { url: parseExternalUrl(value).href, finalUrl: url.href, provider, status: "unreachable", reason: `Provider returned HTTP ${response.status}.`, checkedAt: now.toISOString() };
      }
      const body = await boundedText(response);
      return { url: parseExternalUrl(value).href, finalUrl: url.href, provider, ...classify(provider, response, body, url.href), checkedAt: now.toISOString() };
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    return { url: parseExternalUrl(value).href, finalUrl: url.href, provider, status: "unreachable", reason: "The URL timed out or could not be loaded.", checkedAt: now.toISOString() };
  }
  throw new ApiError(400, "EXTERNAL_URL_UNREACHABLE", "External URL could not be checked.");
}

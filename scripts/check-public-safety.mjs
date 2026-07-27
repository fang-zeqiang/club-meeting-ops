import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ignored = new Set([".git", "node_modules", "dist", "output", "tmp"]);
const failures = [];
const mediaExtensions = new Set([".png", ".jpg", ".jpeg", ".gif", ".pdf", ".xlsx", ".ttf", ".woff", ".woff2", ".svg"]);

function walk(directory, prefix = "") {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (ignored.has(entry.name)) return [];
    const relative = path.posix.join(prefix, entry.name);
    return entry.isDirectory() ? walk(path.join(directory, entry.name), relative) : [relative];
  });
}

const files = walk(root);
const tracked = (() => {
  try {
    return new Set(execFileSync("git", ["ls-files", "-z"], { cwd: root, stdio: ["ignore", "pipe", "ignore"] }).toString().split("\0").filter(Boolean));
  } catch {
    return new Set(files);
  }
})();

const forbiddenPaths = [
  /^\.env(?:\.|$)/,
  /(^|\/)(?:private|artifacts|output|tmp|\.vercel)(?:\/|$)/,
  /(?:backup|dump|export|credential|secret)/i,
  /(^|\/)\.DS_Store$/,
  /(?:~|\.swp|\.swo)$/,
];

for (const file of tracked) {
  if (file === ".env.example") continue;
  if (forbiddenPaths.some((rule) => rule.test(file))) failures.push(`forbidden-path: ${file}`);
}

const rules = [
  ["personal-path", /\/Users\/[^/\s]+|[A-Za-z]:\\Users\\/],
  ["private-key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["github-token", /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/],
  ["generic-api-key", /\bsk-[A-Za-z0-9]{20,}\b/],
  ["cloud-key", /\bAKIA[A-Z0-9]{16}\b/],
  ["email", /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i],
  ["phone", /(?:^|[^\d])(?:\+?86[- ]?)?1[3-9]\d{9}(?:[^\d]|$)/],
  ["open-id", /\bou_[A-Za-z0-9]{8,}\b/],
  ["base-id", /\b(?:bascn|tbl)[A-Za-z0-9]{10,}\b/],
  ["private-domain", new RegExp(["ze", "qiang[.]fun"].join(""))],
  ["private-owner", new RegExp(["fang", "-zeqiang"].join(""), "i")],
  ["private-name", new RegExp(["frank", "lin"].join(""), "i")],
  ["restricted-brand-a", new RegExp(["trip", "[.]com"].join(""), "i")],
  ["restricted-brand-b", new RegExp(["toast", "masters"].join(""), "i")],
  ["restricted-brand-c", new RegExp(["携", "程"].join(""))],
  ["restricted-brand-d", new RegExp(["头", "马"].join(""))],
];

for (const file of files) {
  const absolute = path.join(root, file);
  if (statSync(absolute).size > 2_000_000 || mediaExtensions.has(path.extname(file).toLowerCase())) continue;
  const source = readFileSync(absolute, "utf8");
  for (const [name, rule] of rules) {
    if (rule.test(source)) failures.push(`${name}: ${file}`);
  }
}

const env = readFileSync(path.join(root, ".env.example"), "utf8");
for (const [index, line] of env.split("\n").entries()) {
  const match = /^\s*([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
  if (match?.[2].trim()) failures.push(`env-example-value: .env.example:${index + 1}`);
}

const manifest = JSON.parse(readFileSync(path.join(root, "docs/public-assets.json"), "utf8"));
const approved = new Map(manifest.assets.map((asset) => [asset.path, asset.sha256]));
for (const file of files.filter((entry) => mediaExtensions.has(path.extname(entry).toLowerCase()))) {
  const expected = approved.get(file);
  if (!expected) {
    failures.push(`unapproved-asset: ${file}`);
    continue;
  }
  const actual = createHash("sha256").update(readFileSync(path.join(root, file))).digest("hex");
  if (actual !== expected) failures.push(`asset-hash-mismatch: ${file}`);
}
for (const file of approved.keys()) {
  if (!files.includes(file)) failures.push(`missing-approved-asset: ${file}`);
}

if (failures.length) {
  console.error(failures.sort().join("\n"));
  process.exit(1);
}
console.log(`Public safety passed: ${files.length} files, ${approved.size} approved asset.`);

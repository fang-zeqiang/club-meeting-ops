import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("production build emits the app", async () => {
  const outDir = await mkdtemp(path.join(tmpdir(), "vpe-agenda-build-"));
  try {
    await build({ root, logLevel: "silent", build: { outDir, emptyOutDir: true } });
    await access(path.join(outDir, "index.html"));
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

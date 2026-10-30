import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const APP_DIR = new URL("../src/app/", import.meta.url);
const BOOK_DIR = new URL("../src/book/", import.meta.url);
const INFRA = new Set(["state.js", "contract.js", "render-engine.js", "derivations.js", "api.js", "render.js", "events.js", "orchestration.js"]);
const COMPOSITION = ["render.js", "events.js", "orchestration.js"];
// voting-awards.js/voting-actions.js 与 lifecycle-sync.js/workspace-loader.js 各是同一个 feature 拆成的两半(600 行上限所迫),只允许这两条 sibling 依赖,且方向固定
const SIBLING_ALLOW = { "voting-awards.js": ["./voting-actions.js"], "lifecycle-sync.js": ["./workspace-loader.js"] };

async function sources(dir) {
  const files = await readdir(dir).catch(() => []);
  return Promise.all(files.filter((f) => f.endsWith(".js")).map(async (f) => [f, await readFile(new URL(f, dir), "utf8")]));
}

function importPaths(source) {
  return [...source.matchAll(/^import\s[^;]*?from\s+"([^"]+)"|^import\s+"([^"]+)"/gm)].map((m) => m[1] || m[2]);
}

test("no src/app module imports app.js", async () => {
  for (const [file, source] of await sources(APP_DIR)) {
    for (const path of importPaths(source)) {
      assert.doesNotMatch(path, /^\.\.\/\.\.\/app\.js$/, `${file} must not import app.js`);
    }
  }
});

test("src/app feature modules only depend on state/contract/render-engine/derivations/shared/root helpers", async () => {
  for (const [file, source] of await sources(APP_DIR)) {
    if (INFRA.has(file)) continue;
    for (const path of importPaths(source)) {
      assert.doesNotMatch(path, /^\.\/(render|events|orchestration)\.js$/, `${file} must not import ${path}`);
      if (path.startsWith("./") && !(SIBLING_ALLOW[file] || []).includes(path)) {
        assert.match(path, /^\.\/(state|contract|render-engine|derivations|api)\.js$/, `${file} imports sibling feature ${path}`);
      }
    }
  }
});

test("render-engine.js, state.js and contract.js import no feature module", async () => {
  for (const name of ["render-engine.js", "state.js", "contract.js"]) {
    const source = await readFile(new URL(name, APP_DIR), "utf8");
    for (const path of importPaths(source)) {
      assert.ok(!path.startsWith("./") || /^\.\/(state|contract)\.js$/.test(path), `${name} must not import ${path}`);
    }
  }
});

test("derivations.js only depends on state/contract/render-engine", async () => {
  const source = await readFile(new URL("derivations.js", APP_DIR), "utf8");
  for (const path of importPaths(source)) {
    assert.ok(!path.startsWith("./") || /^\.\/(state|contract|render-engine)\.js$/.test(path), `derivations.js must not import ${path}`);
  }
});

test("render/events/orchestration are only imported by composition modules and app.js", async () => {
  for (const [file, source] of await sources(APP_DIR)) {
    if (COMPOSITION.includes(file)) continue;
    for (const path of importPaths(source)) {
      assert.ok(!COMPOSITION.includes(path.replace("./", "")), `${file} must not import ${path}`);
    }
  }
  // orchestration.js 是纯生命周期编排,只能通过 render-engine 的钩子委托回渲染,不得反向依赖 render/events
  const orchestrationSource = await readFile(new URL("orchestration.js", APP_DIR), "utf8");
  for (const path of importPaths(orchestrationSource)) {
    assert.doesNotMatch(path, /^\.\/(render|events)\.js$/, `orchestration.js must not import ${path}`);
  }
});

test("src/book keeps the one-way chain state ← render ← sheets ← actions ← member-switch ← events", async () => {
  const chain = ["state.js", "render.js", "sheets.js", "actions.js", "member-switch.js", "events.js"];
  for (const [file, source] of await sources(BOOK_DIR)) {
    assert.ok(chain.includes(file), `unexpected src/book module ${file}: add it to the chain order`);
    for (const path of importPaths(source)) {
      if (!path.startsWith("./")) continue;
      const target = path.slice(2);
      assert.ok(chain.includes(target), `${file} imports unknown sibling ${path}`);
      assert.ok(
        chain.indexOf(target) < chain.indexOf(file),
        `${file} must not import ${path}: src/book only flows ${chain.join(" ← ")}`,
      );
    }
  }
});

test("src/app and src/book files stay under 600 lines", async () => {
  for (const dir of [APP_DIR, BOOK_DIR]) {
    for (const [file, source] of await sources(dir)) {
      assert.ok(source.split("\n").length <= 600, `${file} exceeds 600 lines`);
    }
  }
});

test("app.js and book.js do not define esc or apiJson locally", async () => {
  for (const name of ["app.js", "book.js"]) {
    const source = await readFile(new URL(`../${name}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /^function esc\(/m, `${name} must use src/shared/html.js`);
    assert.doesNotMatch(source, /^async function apiJson\(/m, `${name} must use src/shared/api-client.js`);
  }
});

test("app.js registers render hooks and dirty handler before binding events and bootstrapping", async () => {
  const source = await readFile(new URL("../app.js", import.meta.url), "utf8");
  const order = ["setDirtyHandler(applyDirty)", "registerRenderHooks({", "\nbindEvents();", "\nbootstrap();"].map((needle) => source.indexOf(needle));
  assert.ok(order.every((index) => index >= 0), `missing entry statement: ${order}`);
  assert.deepEqual([...order].sort((a, b) => a - b), order, "entry statements out of order");
});

import assert from "node:assert/strict";
import test from "node:test";

import { esc } from "../src/shared/html.js";

// app.js / book.js 合并到同一个 esc 后,null/undefined 渲染成空串、单引号被转义是唯一一处有意的行为变化
test("esc renders nullish values as an empty string", () => {
  assert.equal(esc(null), "");
  assert.equal(esc(undefined), "");
});

test("esc escapes the five HTML-significant characters", () => {
  assert.equal(esc("&<>\"'"), "&amp;&lt;&gt;&quot;&#039;");
});

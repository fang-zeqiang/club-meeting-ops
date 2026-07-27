import assert from "node:assert/strict";
import test from "node:test";

import { bindEditorEvents } from "../editor-events.js";

test("prepared speech objectives update from input events without waiting for change", () => {
  const root = new EventTarget();
  const events = [];

  bindEditorEvents(root, {
    onEdit: (event) => events.push(event.type),
    onClick: () => {},
    onSubmit: () => {},
  });

  root.dispatchEvent(new Event("input"));
  assert.deepEqual(events, ["input"]);
});

test("select and checkbox edits remain covered by change events", () => {
  const root = new EventTarget();
  const events = [];

  bindEditorEvents(root, {
    onEdit: (event) => events.push(event.type),
    onClick: () => {},
    onSubmit: () => {},
  });

  root.dispatchEvent(new Event("change"));
  assert.deepEqual(events, ["change"]);
});

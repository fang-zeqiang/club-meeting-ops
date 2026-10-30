import assert from "node:assert/strict";
import test from "node:test";
import { createPresentationRemote, createRemoteRoomId, createRemoteSession, isRemoteCommand, isRemoteSessionActive, normalizeRemoteCommand, normalizeRemoteState, remotePresentationUrl } from "../presentation-remote.js";

test("remote protocol accepts only presentation commands", () => {
  assert.equal(isRemoteCommand("next"), true);
  assert.equal(isRemoteCommand("draw-topic"), true);
  assert.equal(isRemoteCommand("go-to"), true);
  assert.equal(isRemoteCommand("refresh-awards"), true);
  assert.equal(isRemoteCommand("open-award"), false);
  assert.equal(isRemoteCommand("refresh-deck"), true);
  assert.equal(isRemoteCommand("open-window"), false);
});

test("remote protocol accepts the external fullscreen command", () => {
  assert.equal(isRemoteCommand("fullscreen-external"), true);
});

test("remote protocol bounds page jumps and three-hour sessions", () => {
  assert.deepEqual(normalizeRemoteCommand({ command: "go-to", page: 3 }), { command: "go-to", page: 3 });
  assert.equal(normalizeRemoteCommand({ command: "go-to", page: 0 }), null);
  assert.equal(normalizeRemoteCommand({ command: "go-to", page: 1.5 }), null);
  assert.deepEqual(normalizeRemoteCommand({ command: "refresh-deck" }), { command: "refresh-deck" });
  const session = createRemoteSession(`room_${"ab".repeat(16)}`, 1000);
  assert.equal(session.expiresAt, 1000 + 3 * 60 * 60 * 1000);
  assert.equal(isRemoteSessionActive(session, 1000), true);
  assert.equal(isRemoteSessionActive(session, session.expiresAt), false);
});

test("remote state is bounded and does not carry meeting data", () => {
  assert.deepEqual(normalizeRemoteState({ surface: "award", index: 2, total: 8, canDrawTopic: true, timer: "running", canRefreshAwards: true, title: "ignored" }), {
    surface: "presentation", index: 2, total: 8, canDrawTopic: true, drawTopicMode: "draw", timer: "running", canRefreshDeck: false, canRefreshAwards: true, canReloadExternal: false, canFullscreenExternal: false,
  });
});

test("phone URL carries only the one-time room in its hash", () => {
  assert.equal(remotePresentationUrl(108, "room_abc"), "/m/108/presentation/remote#room_abc");
});

test("room IDs use CSPRNG bytes and fail closed without crypto", () => {
  assert.equal(createRemoteRoomId({ getRandomValues: (bytes) => bytes.fill(0xab) }), `room_${"ab".repeat(16)}`);
  assert.throws(() => createRemoteRoomId(null), /Secure random room ID is unavailable/);
});

test("remote adapter filters commands, normalizes state, and removes its channel", async () => {
  const handlers = new Map();
  const sent = [];
  const commands = [];
  const states = [];
  let removed;
  const channel = {
    on(type, { event }, handler) { handlers.set(event, handler); return this; },
    subscribe(handler) { handler("SUBSCRIBED"); return this; },
    send(message) { sent.push(message); return Promise.resolve("ok"); },
  };
  const remote = createPresentationRemote({
    roomId: `room_${"ab".repeat(16)}`,
    onCommand: (command) => commands.push(command),
    onState: (state) => states.push(state),
    client: { channel: () => channel, removeChannel: (value) => { removed = value; return Promise.resolve(); } },
  });

  handlers.get("command")({ payload: { command: "open-window" } });
  handlers.get("command")({ payload: { command: "next" } });
  handlers.get("state")({ payload: { state: { index: 3, total: 7, timer: "bad", title: "private" } } });
  await assert.rejects(remote.publishCommand("open-window"), /Invalid presentation remote command/);
  await remote.publishCommand("next");
  await remote.publishState({ index: 4, title: "private" });
  await remote.close();

  assert.deepEqual(commands, [{ command: "next" }]);
  assert.deepEqual(states, [{ surface: "presentation", index: 3, total: 7, canDrawTopic: false, drawTopicMode: "draw", timer: "idle", canRefreshDeck: false, canRefreshAwards: false, canReloadExternal: false, canFullscreenExternal: false }]);
  assert.deepEqual(sent, [
    { type: "broadcast", event: "command", payload: { type: "command", command: "next" } },
    { type: "broadcast", event: "state", payload: { type: "state", state: { surface: "presentation", index: 4, total: 0, canDrawTopic: false, drawTopicMode: "draw", timer: "idle", canRefreshDeck: false, canRefreshAwards: false, canReloadExternal: false, canFullscreenExternal: false } } },
  ]);
  assert.equal(removed, channel);
});

test("invalid rooms never create a channel and no-config remotes stay inert", async () => {
  let channelCalls = 0;
  const statuses = [];
  const invalidRoom = createPresentationRemote({
    roomId: "",
    onStatus: (status) => statuses.push(status),
    client: { channel: () => { channelCalls += 1; } },
  });
  const unavailable = createPresentationRemote({ roomId: `room_${"cd".repeat(16)}`, onStatus: (status) => statuses.push(status), client: null });

  await assert.rejects(invalidRoom.publishCommand("next"), /Invalid presentation remote room/);
  await assert.rejects(invalidRoom.publishState({}), /Invalid presentation remote room/);
  assert.equal(channelCalls, 0);
  assert.deepEqual(statuses, ["invalid-room", "unavailable"]);
  await assert.rejects(unavailable.publishCommand("bad"), /Invalid presentation remote command/);
  assert.equal(await unavailable.publishCommand("next"), null);
});

test("remote state only passes through the known draw topic modes", () => {
  assert.equal(normalizeRemoteState({ drawTopicMode: "redraw" }).drawTopicMode, "redraw");
  assert.equal(normalizeRemoteState({ drawTopicMode: "anything" }).drawTopicMode, "draw");
});

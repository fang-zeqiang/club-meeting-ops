import { createClient } from "@supabase/supabase-js";

export const REMOTE_COMMANDS = new Set(["previous", "next", "go-to", "draw-topic", "timer-start", "timer-pause", "timer-reset", "refresh-deck", "refresh-awards", "reload-external", "fullscreen-external"]);

const REMOTE_TIMERS = new Set(["idle", "running", "paused"]);
const REMOTE_ROOM_ID = /^room_(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
export const REMOTE_TIMEOUT_MS = 3 * 60 * 60 * 1000;
const env = import.meta.env || {};
const supabase = env.VITE_SUPABASE_URL && env.VITE_SUPABASE_PUBLISHABLE_KEY
  ? createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY)
  : null;

export function isRemoteCommand(command) {
  return REMOTE_COMMANDS.has(command);
}

export function normalizeRemoteCommand(value) {
  const command = typeof value === "string" ? value : value?.command;
  if (!isRemoteCommand(command)) return null;
  if (command !== "go-to") return { command };
  const page = Number(value?.page);
  return Number.isInteger(page) && page > 0 && page <= 999 ? { command, page } : null;
}

export function createRemoteRoomId(cryptoApi = globalThis.crypto) {
  if (cryptoApi?.randomUUID) return `room_${cryptoApi.randomUUID()}`;
  if (!cryptoApi?.getRandomValues) throw new Error("Secure random room ID is unavailable");
  const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
  return `room_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function remotePresentationUrl(meetingNumber, roomId) {
  return `/m/${encodeURIComponent(meetingNumber)}/presentation/remote#${encodeURIComponent(roomId)}`;
}

export function createRemoteSession(roomId, now = Date.now()) {
  if (!REMOTE_ROOM_ID.test(roomId || "")) return null;
  return { roomId, expiresAt: Number(now) + REMOTE_TIMEOUT_MS };
}

export function isRemoteSessionActive(session, now = Date.now()) {
  return REMOTE_ROOM_ID.test(session?.roomId || "") && Number.isFinite(session?.expiresAt) && Number(now) < session.expiresAt;
}

export function normalizeRemoteState(value = {}) {
  const { index, total, canDrawTopic, drawTopicMode, timer, canRefreshDeck, canRefreshAwards, canReloadExternal, canFullscreenExternal } = value || {};
  return {
    surface: "presentation",
    index: Math.max(0, Number(index) || 0),
    total: Math.max(0, Number(total) || 0),
    canDrawTopic: Boolean(canDrawTopic),
    drawTopicMode: drawTopicMode === "redraw" ? "redraw" : "draw",
    timer: REMOTE_TIMERS.has(timer) ? timer : "idle",
    canRefreshDeck: Boolean(canRefreshDeck),
    canRefreshAwards: Boolean(canRefreshAwards),
    canReloadExternal: Boolean(canReloadExternal),
    canFullscreenExternal: Boolean(canFullscreenExternal),
  };
}

export function createPresentationRemote({ roomId, onCommand = () => {}, onState = () => {}, onStatus = () => {}, onRequestState = () => {}, client = supabase }) {
  if (!REMOTE_ROOM_ID.test(roomId || "")) {
    onStatus("invalid-room");
    return {
      roomId,
      publishCommand: () => Promise.reject(new Error("Invalid presentation remote room")),
      publishState: () => Promise.reject(new Error("Invalid presentation remote room")),
      requestState: () => Promise.reject(new Error("Invalid presentation remote room")),
      close: () => Promise.resolve(),
    };
  }

  if (!client) {
    onStatus("unavailable");
    return {
      roomId,
      publishCommand(command, options = {}) {
        if (!normalizeRemoteCommand({ command, ...options })) return Promise.reject(new Error("Invalid presentation remote command"));
        return Promise.resolve(null);
      },
      publishState: () => Promise.resolve(null),
      requestState: () => Promise.resolve(null),
      close: () => Promise.resolve(),
    };
  }

  const channel = client
    .channel(`presentation-remote:${roomId}`)
    .on("broadcast", { event: "command" }, ({ payload }) => {
      const command = normalizeRemoteCommand(payload);
      if (command) onCommand(command);
    })
    .on("broadcast", { event: "state" }, ({ payload }) => onState(normalizeRemoteState(payload?.state)))
    .on("broadcast", { event: "request-state" }, () => onRequestState())
    .subscribe((status) => onStatus(status));

  return {
    roomId,
    publishCommand(command, options = {}) {
      const payload = normalizeRemoteCommand({ command, ...options });
      if (!payload) return Promise.reject(new Error("Invalid presentation remote command"));
      return channel.send({ type: "broadcast", event: "command", payload: { type: "command", ...payload } });
    },
    publishState(state) {
      return channel.send({ type: "broadcast", event: "state", payload: { type: "state", state: normalizeRemoteState(state) } });
    },
    requestState() {
      return channel.send({ type: "broadcast", event: "request-state", payload: {} });
    },
    close() {
      return client.removeChannel(channel);
    },
  };
}

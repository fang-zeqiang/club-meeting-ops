export function randomId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `fallback_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

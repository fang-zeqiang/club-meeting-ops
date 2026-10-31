const BURST_CAPACITY = 10;
const TOKENS_PER_SECOND = 5;

export function takeTableTopicsWriteToken(buckets, meetingId, now = Date.now()) {
  const previous = buckets.get(meetingId) || { tokens: BURST_CAPACITY, updatedAt: now };
  const elapsedSeconds = Math.max(0, now - previous.updatedAt) / 1000;
  const tokens = Math.min(BURST_CAPACITY, previous.tokens + elapsedSeconds * TOKENS_PER_SECOND);
  const next = { tokens, updatedAt: now };

  if (tokens < 1) {
    buckets.set(meetingId, next);
    return false;
  }

  next.tokens -= 1;
  buckets.set(meetingId, next);
  return true;
}

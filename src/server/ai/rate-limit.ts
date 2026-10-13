import "server-only";

/**
 * Per-user limit on AI requests, kept in memory per Cloud Run instance. Enough to stop a runaway
 * client or a script during the demo; a shared store would be needed for strict global limits.
 */
const WINDOW_MS = 10 * 60 * 1000;
const MAX_REQUESTS = Number(process.env.AI_RATE_LIMIT ?? 30);
const hits = new Map<string, number[]>();

/** `key` is the account id, or a prefixed one ("voice:…") for a separate budget; `max` overrides the default. */
export function takeAiToken(
  userId: string,
  max = MAX_REQUESTS,
): { ok: true } | { ok: false; retryAfterSeconds: number } {
  const now = Date.now();
  const recent = (hits.get(userId) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= max) {
    hits.set(userId, recent);
    return { ok: false, retryAfterSeconds: Math.ceil((WINDOW_MS - (now - recent[0])) / 1000) };
  }
  recent.push(now);
  hits.set(userId, recent);
  return { ok: true };
}

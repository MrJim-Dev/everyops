import "server-only";
import { sql } from "kysely";
import { db } from "@/server/db";

/**
 * Per-account limit on AI requests, shared by every Cloud Run instance through Postgres (table ai_rate_limit).
 * Counts are kept in 10-minute windows; the current window plus the overlapping part of the previous one give a
 * sliding 10-minute count. If the database can't be reached (or the migration hasn't run yet) it falls back to a
 * per-instance count in memory, so AI features keep working.
 */
const WINDOW_MS = 10 * 60 * 1000;
const MAX_REQUESTS = Number(process.env.AI_RATE_LIMIT ?? 30);

export type TokenResult = { ok: true } | { ok: false; retryAfterSeconds: number };

/** How many requests the sliding window holds: all of this window, and the part of the last one still inside it. */
export function slidingCount(previous: number, current: number, elapsedMs: number, windowMs = WINDOW_MS) {
  return previous * Math.max(0, 1 - elapsedMs / windowMs) + current;
}

/** Seconds until enough of the previous window has slid out for one more request (at most until this one ends). */
function retryAfter(previous: number, current: number, elapsedMs: number, max: number, windowMs: number) {
  const untilWindowEnds = Math.ceil((windowMs - elapsedMs) / 1000);
  if (!previous || current >= max) return untilWindowEnds;
  const neededFraction = 1 - (max - current) / previous;
  return Math.min(untilWindowEnds, Math.max(1, Math.ceil((neededFraction * windowMs - elapsedMs) / 1000)));
}

/**
 * Takes one request from the budget for `key` (the account id, or a prefixed one such as "voice:…" for a separate
 * budget). Refused requests aren't counted, so waiting is enough to be let back in.
 */
export async function takeAiToken(key: string, max = MAX_REQUESTS): Promise<TokenResult> {
  return takeToken(key, max, WINDOW_MS);
}

/**
 * The same sliding-window limit for any key and window, shared by every instance through Postgres (public forms,
 * uploads and page data use it with their own prefixes and windows). Falls back to memory when the database fails.
 */
export async function takeToken(key: string, max: number, windowMs: number): Promise<TokenResult> {
  const now = Date.now();
  const start = Math.floor(now / windowMs) * windowMs;
  const elapsed = now - start;
  try {
    const { rows } = await sql<{ current: number; previous: number }>`
      with bump as (
        insert into ai_rate_limit (key, window_start, hits) values (${key}, ${new Date(start)}, 1)
        on conflict (key, window_start) do update set hits = ai_rate_limit.hits + 1
        returning hits
      )
      select (select hits from bump) as current,
             coalesce((select hits from ai_rate_limit where key = ${key} and window_start = ${new Date(start - windowMs)}), 0) as previous
    `.execute(db);
    const current = Number(rows[0]?.current ?? 1);
    const previous = Number(rows[0]?.previous ?? 0);
    if (Math.random() < 0.01)
      void sql`delete from ai_rate_limit where window_start < ${new Date(now - 24 * 60 * 60 * 1000)}`
        .execute(db)
        .catch(() => {});
    if (slidingCount(previous, current, elapsed, windowMs) <= max) return { ok: true };
    await sql`update ai_rate_limit set hits = hits - 1 where key = ${key} and window_start = ${new Date(start)}`.execute(
      db,
    );
    return { ok: false, retryAfterSeconds: retryAfter(previous, current - 1, elapsed, max, windowMs) };
  } catch (error) {
    warnOnce(error);
    return takeLocalToken(key, max, now, windowMs);
  }
}

let warned = false;
function warnOnce(error: unknown) {
  if (warned) return;
  warned = true;
  const message = error instanceof Error ? error.message : String(error);
  console.warn(JSON.stringify({ event: "ai_rate_limit_fallback", message }));
}

/** The per-instance fallback: timestamps of recent requests, kept in memory. */
const hits = new Map<string, number[]>();
function takeLocalToken(key: string, max: number, now: number, windowMs: number): TokenResult {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= max) {
    hits.set(key, recent);
    return { ok: false, retryAfterSeconds: Math.ceil((windowMs - (now - recent[0])) / 1000) };
  }
  recent.push(now);
  hits.set(key, recent);
  return { ok: true };
}

/** How much of the AI limit a key has used in the last 10 minutes (for showing it, not for deciding). */
export async function aiRequestsUsed(key: string): Promise<{ used: number; max: number }> {
  const now = Date.now();
  const start = Math.floor(now / WINDOW_MS) * WINDOW_MS;
  try {
    const { rows } = await sql<{ window_start: Date; hits: number }>`
      select window_start, hits from ai_rate_limit where key = ${key}
        and window_start in (${new Date(start)}, ${new Date(start - WINDOW_MS)})`.execute(db);
    const current = rows.find((r) => r.window_start.getTime() === start)?.hits ?? 0;
    const previous = rows.find((r) => r.window_start.getTime() === start - WINDOW_MS)?.hits ?? 0;
    return {
      used: Math.min(MAX_REQUESTS, Math.round(slidingCount(previous, current, now - start))),
      max: MAX_REQUESTS,
    };
  } catch {
    return { used: 0, max: MAX_REQUESTS };
  }
}

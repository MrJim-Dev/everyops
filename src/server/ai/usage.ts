import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { sql } from "kysely";
import { todayKey } from "@/lib/time";
import { db } from "@/server/db";

/**
 * AI use per workspace and month. A route runs its Gemini work inside withAiUsage(scope, …); generateJson adds each
 * round's tokens to that scope (streamed answers included, failed and retried rounds too, since they cost the same).
 * scope is the workspace id, or "account:USER" for setup before a workspace exists.
 */
const store = new AsyncLocalStorage<{ scope: string }>();

/** Tokens a workspace may use in a month (AI_MONTHLY_TOKEN_BUDGET); 0 or unset means no budget. */
export const monthlyBudget = () => Math.max(0, Number(process.env.AI_MONTHLY_TOKEN_BUDGET ?? 0) || 0);

const monthOf = (now = new Date()) => `${todayKey(now).slice(0, 7)}-01`;

export function withAiUsage<T>(scope: string, fn: () => T): T {
  return store.run({ scope }, fn);
}

/**
 * Checks and counts a request for the scope. Returns the response to send when it's over budget; the route then
 * calls enterAiUsage(scope) so its Gemini tokens are counted too.
 */
export async function startAiUsage(scope: string): Promise<Response | null> {
  const check = await chargeAiRequest(scope);
  if (!check.ok) return Response.json({ ok: false, message: check.message }, { status: 429 });
  return null;
}

/**
 * Counts the rest of this request's Gemini tokens to the scope. Call it in the route itself, not after an await in
 * another function: Node restores the caller's context when an awaited function returns.
 */
export function enterAiUsage(scope: string) {
  store.enterWith({ scope });
}

/** Called by generateJson after each round. Never throws: counting must not break an answer. */
export function countTokens(tokens: number) {
  const scope = store.getStore()?.scope;
  if (!scope || !(tokens > 0)) return;
  void sql`insert into ai_usage (scope, month, tokens) values (${scope}, ${monthOf()}, ${Math.round(tokens)})
    on conflict (scope, month) do update set tokens = ai_usage.tokens + excluded.tokens`
    .execute(db)
    .catch((error) => console.warn(JSON.stringify({ event: "ai_usage_error", message: String(error) })));
}

export type UsageCheck = { ok: true } | { ok: false; message: string };

/**
 * Counts one request for the scope and checks its monthly budget: over budget, the request is refused with a
 * message the owner can act on. Without a budget it only counts.
 */
export async function chargeAiRequest(scope: string): Promise<UsageCheck> {
  try {
    const { rows } = await sql<{ tokens: string }>`
      insert into ai_usage (scope, month, requests) values (${scope}, ${monthOf()}, 1)
      on conflict (scope, month) do update set requests = ai_usage.requests + 1
      returning tokens`.execute(db);
    const budget = monthlyBudget();
    if (budget && Number(rows[0]?.tokens ?? 0) >= budget)
      return {
        ok: false,
        message:
          "This workspace has used its AI allowance for this month. It renews on the 1st; the owner can raise AI_MONTHLY_TOKEN_BUDGET.",
      };
  } catch (error) {
    console.warn(JSON.stringify({ event: "ai_usage_error", message: String(error) }));
  }
  return { ok: true };
}

export type UsageSummary = {
  month: string;
  tokens: number;
  requests: number;
  budget: number;
  lastMonth: number;
};

export async function usageOf(scope: string, now = new Date()): Promise<UsageSummary> {
  const month = monthOf(now);
  const last = monthOf(new Date(Date.parse(`${month}T00:00:00+08:00`) - 86_400_000));
  const { rows } = await sql<{ month: Date | string; tokens: string; requests: number }>`
    select month, tokens, requests from ai_usage where scope = ${scope} and month in (${month}, ${last})`.execute(
    db,
  );
  const key = (m: Date | string) => (typeof m === "string" ? m.slice(0, 10) : todayKey(m));
  const now_ = rows.find((r) => key(r.month) === month);
  const before = rows.find((r) => key(r.month) === last);
  return {
    month,
    tokens: Number(now_?.tokens ?? 0),
    requests: Number(now_?.requests ?? 0),
    budget: monthlyBudget(),
    lastMonth: Number(before?.tokens ?? 0),
  };
}

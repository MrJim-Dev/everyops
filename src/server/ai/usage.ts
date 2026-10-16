import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import path from "node:path";
import { sql } from "kysely";
import { type AiFeature, type CallTokens, costMicros } from "@/lib/ai-usage";
import { todayKey } from "@/lib/time";
import { db } from "@/server/db";

/**
 * AI use per workspace and month. A route runs its Gemini work inside withAiUsage(scope, …); generateJson adds each
 * round's tokens to that scope (streamed answers included, failed and retried rounds too, since they cost the same).
 * scope is the workspace id, or "account:USER" for setup before a workspace exists.
 *
 * Each call is also logged on its own (table ai_call, see recordAiCall) with who, what for and where it ran, so
 * settings can show where the use comes from.
 */
type UsageContext = {
  scope: string;
  userId?: string;
  workspaceId?: string;
  feature: AiFeature;
  /** One id per user action, so a message that makes several calls (retries, lookups, twins) reads as one. */
  requestId: string;
};
const store = new AsyncLocalStorage<UsageContext>();

/** Who and what a route's Gemini work is for. The scope's account or workspace fills in what isn't given. */
export type UsageMeta = { userId?: string; workspaceId?: string; feature?: AiFeature };

function contextFor(scope: string, meta: UsageMeta = {}): UsageContext {
  const account = scope.startsWith("account:") ? scope.slice(8) : undefined;
  return {
    scope,
    userId: meta.userId ?? account,
    workspaceId: meta.workspaceId ?? (account ? undefined : scope),
    feature: meta.feature ?? "other",
    requestId: randomUUID(),
  };
}

/** Tokens a workspace may use in a month (AI_MONTHLY_TOKEN_BUDGET); 0 or unset means no budget. */
export const monthlyBudget = () => Math.max(0, Number(process.env.AI_MONTHLY_TOKEN_BUDGET ?? 0) || 0);

const monthOf = (now = new Date()) => `${todayKey(now).slice(0, 7)}-01`;

export function withAiUsage<T>(scope: string, fn: () => T, meta?: UsageMeta): T {
  return store.run(contextFor(scope, meta), fn);
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
export function enterAiUsage(scope: string, meta?: UsageMeta) {
  store.enterWith(contextFor(scope, meta));
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

/**
 * Where this process runs: "production" on Cloud Run, "script:NAME@HOST" for a script under scripts/ (benchmarks,
 * evals) and "local:HOST" for a dev server. Local runs call the same Vertex project as production, so this is what
 * tells their cost apart.
 */
let origin: string | undefined;
export function aiOrigin(): string {
  if (origin) return origin;
  if (process.env.K_SERVICE) origin = "production";
  else {
    const host = hostname();
    const entry = process.argv[1] ?? "";
    origin = /(^|[\\/])scripts[\\/]/.test(entry) ? `script:${path.basename(entry)}@${host}` : `local:${host}`;
  }
  return origin;
}

export type AiCall = {
  task: string;
  model: string;
  location: string;
  attempt: number;
  rounds: number;
  outcome: string;
  tokens: CallTokens;
  /** True when the tokens were estimated from the text (a call stopped before Gemini reported its usage). */
  estimated: boolean;
  ms: number;
};

/**
 * Logs one Gemini call to ai_call, with the route's context when there is one (a script's calls belong to no one
 * and are logged as "script"). Never throws or waits: logging must not slow or break an answer.
 */
export function recordAiCall(call: AiCall) {
  const ctx = store.getStore();
  const where = aiOrigin();
  const feature: AiFeature = ctx?.feature ?? (where.startsWith("script:") ? "script" : "other");
  const t = call.tokens;
  const cost = costMicros(call.model, call.location, t);
  try {
    void sql`insert into ai_call (user_id, workspace_id, request_id, feature, task, model, location, attempt, rounds,
        outcome, input_tokens, cached_tokens, output_tokens, thinking_tokens, estimated, cost_micros, ms, origin)
      values (${ctx?.userId ?? null}, ${ctx?.workspaceId ?? null}, ${ctx?.requestId ?? null}, ${feature}, ${call.task},
        ${call.model}, ${call.location}, ${call.attempt}, ${call.rounds}, ${call.outcome}, ${Math.round(t.input)},
        ${Math.round(t.cached)}, ${Math.round(t.output)}, ${Math.round(t.thinking)}, ${call.estimated}, ${cost},
        ${Math.round(call.ms)}, ${where})`
      .execute(db)
      .catch((error) => console.warn(JSON.stringify({ event: "ai_call_log_error", message: String(error) })));
  } catch (error) {
    // No database configured (a script run without DATABASE_URL): the console line in generateJson still has it.
    console.warn(JSON.stringify({ event: "ai_call_log_error", message: String(error) }));
  }
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

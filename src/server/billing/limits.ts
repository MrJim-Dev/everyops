import "server-only";
import { sql } from "kysely";
import type { AiFeature } from "@/lib/ai-usage";
import { isDemoEmail } from "@/lib/auth/demo";
import {
  type AiRefusal,
  type CountedLimit,
  dailyCapMessage,
  decideAi,
  fits,
  limitMessage,
} from "@/lib/billing/decide";
import { creditsFromMicros, PLANS, type Plan, type PlanId, planOf } from "@/lib/billing/plans";
import { DEFAULT_TIME_ZONE, todayKey } from "@/lib/time";
import { takeToken } from "@/server/ai/rate-limit";
import { db } from "@/server/db";
import { isSiteAdmin } from "@/server/waitlist-admin";

/**
 * Enforcing plans (src/lib/billing): which plan an account is on, what it has used, and the checks every write path
 * calls before adding something a plan counts. The decisions themselves are pure functions in src/lib/billing.
 */

type Ex = Parameters<ReturnType<typeof sql>["execute"]>[0];

/** A plan limit was reached. Write paths turn it into a 403 with this message; the transaction rolls back. */
export class PlanLimitError extends Error {
  constructor(
    message: string,
    readonly limit: CountedLimit,
  ) {
    super(message);
  }
}

/** For write paths: a plan limit becomes a 403 with its message; anything else is rethrown. */
export function planLimitResult(error: unknown): { ok: false; status: 403; message: string } {
  if (error instanceof PlanLimitError) return { ok: false, status: 403, message: error.message };
  throw error;
}

/** What a visitor on a public page sees instead: the owner's plan is the owner's business. */
export const VISITOR_LIMIT_MESSAGE =
  "This business can't take new entries online right now. Please contact them directly.";
export function visitorLimitResult(error: unknown): { ok: false; status: 403; message: string } {
  if (error instanceof PlanLimitError) return { ok: false, status: 403, message: VISITOR_LIMIT_MESSAGE };
  throw error;
}

const DAY_MS = 86_400_000;

/** The first day of this billing month (calendar month in Asia/Manila), as YYYY-MM-01. */
export const billingMonth = (now = new Date()) => `${todayKey(now, DEFAULT_TIME_ZONE).slice(0, 7)}-01`;
const monthStart = (now = new Date()) => new Date(`${billingMonth(now)}T00:00:00+08:00`);
const dayStart = (now = new Date()) => new Date(`${todayKey(now, DEFAULT_TIME_ZONE)}T00:00:00+08:00`);
/** When this month's credits renew: the 1st of next month. */
export function renewsOn(now = new Date()): string {
  const [y, m] = billingMonth(now).split("-").map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}

export type PlanSource = "assigned" | "default" | "site-admin" | "demo";

export type AccountPlan = {
  userId: string;
  email: string;
  verified: boolean;
  plan: Plan;
  source: PlanSource;
  status: string;
  suspended: boolean;
  suspendedReason: string | null;
  /** Extra credits for this month. */
  bonusCredits: number;
  note: string | null;
};

type PlanRow = {
  email: string;
  verified: boolean | null;
  plan: string | null;
  status: string | null;
  bonus_credits: number | null;
  bonus_month: Date | string | null;
  suspended_at: Date | null;
  suspended_reason: string | null;
  note: string | null;
};

const monthKey = (m: Date | string | null) =>
  !m ? null : typeof m === "string" ? m.slice(0, 10) : todayKey(m, DEFAULT_TIME_ZONE);

function toPlan(userId: string, r: PlanRow, now = new Date()): AccountPlan {
  const source: PlanSource = r.plan
    ? "assigned"
    : isDemoEmail(r.email)
      ? "demo"
      : isSiteAdmin(r.email)
        ? "site-admin"
        : "default";
  const id: PlanId = r.plan
    ? planOf(r.plan).id
    : source === "demo"
      ? "demo"
      : source === "site-admin"
        ? "internal"
        : "free";
  return {
    userId,
    email: r.email,
    verified: !!r.verified,
    plan: PLANS[id],
    source,
    status: r.status ?? "active",
    suspended: !!r.suspended_at,
    suspendedReason: r.suspended_reason,
    bonusCredits: monthKey(r.bonus_month) === billingMonth(now) ? (r.bonus_credits ?? 0) : 0,
    note: r.note,
  };
}

/** The plan an account is on: the assigned one, else Internal for site admins, Demo for the demo, Free for the rest. */
export async function accountPlan(userId: string, ex: Ex = db): Promise<AccountPlan> {
  const { rows } = await sql<PlanRow>`
    select u.email, u."emailVerified" as verified, p.plan, p.status, p.bonus_credits, p.bonus_month,
      p.suspended_at, p.suspended_reason, p.note
    from "user" u left join account_plan p on p.user_id = u.id where u.id = ${userId}`.execute(ex);
  const row = rows[0] ?? ({ email: "", verified: false } as PlanRow);
  return toPlan(userId, row);
}

/** Who pays for a workspace: its owner. */
export async function ownerOf(workspaceId: string, ex: Ex = db): Promise<string | null> {
  const { rows } = await sql<{
    owner_id: string;
  }>`select owner_id from workspace where id = ${workspaceId}`.execute(ex);
  return rows[0]?.owner_id ?? null;
}

/** Gemini cost this billing month for everything the account pays for, in micro-dollars. */
export async function costThisMonth(userId: string, ex: Ex = db, now = new Date()): Promise<number> {
  const { rows } = await sql<{ micros: string | null }>`
    select sum(cost_micros) as micros from ai_call where billed_to = ${userId} and at >= ${monthStart(now)}`.execute(
    ex,
  );
  return Number(rows[0]?.micros ?? 0);
}

/* ------------------------------------------------------------------------------------------------------------ */
/* The AI safety switch: when today's Gemini spending across EveryOps passes AI_DAILY_SPEND_LIMIT_USD, AI pauses   */
/* for the plans that allow it (Free, Demo) until midnight in Manila, and the site admins are emailed once.       */

/** US dollars of Gemini a day across EveryOps before free AI pauses. Set in code so a deploy can't drop it. */
export const DEFAULT_DAILY_SPEND_LIMIT_USD = 25;
export const dailySpendLimitUsd = () => {
  const n = Number(process.env.AI_DAILY_SPEND_LIMIT_USD);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_DAILY_SPEND_LIMIT_USD;
};

let spendCache: { at: number; day: string; micros: number } | null = null;
/** Today's Gemini spending across EveryOps, read at most once a minute per instance. */
export async function spendToday(now = new Date()): Promise<number> {
  const day = todayKey(now, DEFAULT_TIME_ZONE);
  if (spendCache && spendCache.day === day && now.getTime() - spendCache.at < 60_000)
    return spendCache.micros;
  const { rows } = await sql<{ micros: string | null }>`
    select sum(cost_micros) as micros from ai_call where at >= ${dayStart(now)}`.execute(db);
  spendCache = { at: now.getTime(), day, micros: Number(rows[0]?.micros ?? 0) };
  return spendCache.micros;
}

export async function safetySwitchOn(now = new Date()): Promise<boolean> {
  const on = (await spendToday(now)) >= dailySpendLimitUsd() * 1_000_000;
  if (on) void tellAdminsOnce(todayKey(now, DEFAULT_TIME_ZONE));
  return on;
}

async function tellAdminsOnce(day: string) {
  try {
    const { rows } = await sql<{ id: string }>`
      insert into billing_event (user_id, kind, detail) values (null, 'safety_switch', ${JSON.stringify({ day, limitUsd: dailySpendLimitUsd() })}::jsonb)
      on conflict do nothing returning id`.execute(db);
    if (!rows.length) return;
    const { notifyAdmins } = await import("./notify");
    await notifyAdmins({
      subject: "EveryOps paused free AI for today",
      heading: "Free AI is paused for today",
      lines: [
        `Gemini spending today passed the $${dailySpendLimitUsd()} safety limit, so AI on Free and Demo accounts is paused until midnight (Manila). Paid plans keep working.`,
        "See who used it on the accounts page.",
      ],
      action: { label: "Open accounts", path: "/admin/accounts" },
    });
  } catch (error) {
    console.warn(JSON.stringify({ event: "safety_switch_notify_error", message: String(error) }));
  }
}

/* ------------------------------------------------------------------------------------------------------------ */

export type AiCheck = { ok: true } | { ok: false; status: number; code: AiRefusal; message: string };

/**
 * Whether an AI request may start: the paying account's plan, credits and suspension, the asker's verified email,
 * the safety switch, and the plan's daily caps on setup. Called by startAiUsage before any Gemini call.
 * scope is a workspace id (its owner pays) or "account:USER" (setup and voice, the person pays).
 */
export async function checkAi(
  scope: string,
  actorId: string | undefined,
  feature: AiFeature,
): Promise<AiCheck> {
  const payerId = scope.startsWith("account:") ? scope.slice(8) : await ownerOf(scope);
  if (!payerId) return { ok: true };
  const payer = await accountPlan(payerId);
  const actor = actorId && actorId !== payerId ? await accountPlan(actorId) : payer;
  const exempt = (a: AccountPlan) => a.plan.id === "internal" || a.plan.id === "demo";
  const [used, switchOn] = await Promise.all([costThisMonth(payerId), safetySwitchOn()]);
  const decision = decideAi({
    plan: payer.plan,
    verified: actor.verified || exempt(actor),
    suspended: payer.suspended || actor.suspended,
    usedCredits: creditsFromMicros(used),
    bonusCredits: payer.bonusCredits,
    safetySwitchOn: switchOn,
    feature,
    forOwner: payerId !== actorId,
  });
  if (!decision.ok) return refuse(decision.code, decision.message, payerId, feature);
  const who = actorId ?? payerId;
  const limits = payer.plan.limits;
  const recent = await takeToken(`plan10:${who}`, limits.aiPer10Min, 10 * 60_000);
  if (!recent.ok)
    return refuse(
      "credits",
      `That's a lot of AI requests in a short time. Try again in ${Math.ceil(recent.retryAfterSeconds / 60)} min.`,
      payerId,
      feature,
      429,
    );
  if (feature === "setup-design" && !(await takeToken(`day:design:${who}`, limits.designsPerDay, DAY_MS)).ok)
    return refuse("daily_designs", dailyCapMessage("daily_designs", payer.plan), payerId, feature);
  if (
    feature === "setup-interview" &&
    !(await takeToken(`day:turns:${who}`, limits.interviewTurnsPerDay, DAY_MS)).ok
  )
    return refuse("daily_turns", dailyCapMessage("daily_turns", payer.plan), payerId, feature);
  return { ok: true };
}

function refuse(
  code: AiRefusal,
  message: string,
  payerId: string,
  feature: AiFeature,
  status = 402,
): AiCheck {
  console.info(JSON.stringify({ event: "ai_refused", code, feature, payer: payerId }));
  return { ok: false, status: code === "verify_email" || code === "suspended" ? 403 : status, code, message };
}

/* ------------------------------------------------------------------------------------------------------------ */
/* Counted limits. Each throws PlanLimitError when adding would pass the owner's plan.                            */

async function planOfWorkspace(ex: Ex, workspaceId: string): Promise<Plan | null> {
  const owner = await ownerOf(workspaceId, ex);
  return owner ? (await accountPlan(owner, ex)).plan : null;
}

const check = (plan: Plan, kind: CountedLimit, limit: number, current: number, adding: number) => {
  if (!fits(limit, current, adding)) throw new PlanLimitError(limitMessage(kind, plan), kind);
};

/** Before a new workspace (not a starter one) is created for the account. */
export async function assertWorkspaceRoom(userId: string, ex: Ex = db) {
  const { plan } = await accountPlan(userId, ex);
  const { rows } = await sql<{ n: number }>`
    select count(*)::int as n from workspace where owner_id = ${userId} and not starter`.execute(ex);
  check(plan, "workspaces", plan.limits.workspaces, rows[0]?.n ?? 0, 1);
}

/** Before a team save: everyone kept plus pending invites, owner excluded, against what's there now. */
export async function assertTeamRoom(ex: Ex, workspaceId: string, nextCount: number) {
  const plan = await planOfWorkspace(ex, workspaceId);
  if (!plan) return;
  const { rows } = await sql<{ n: number }>`
    select (select count(*) from workspace_member where workspace_id = ${workspaceId})::int
      + (select count(*) from workspace_invite where workspace_id = ${workspaceId})::int as n`.execute(ex);
  const now = rows[0]?.n ?? 0;
  check(plan, "members", plan.limits.members, now, nextCount - now);
}

/** Before new records are inserted into a workspace (every write path goes through insertRecords). */
export async function assertRecordRoom(ex: Ex, workspaceId: string, adding: number) {
  if (adding <= 0) return;
  const plan = await planOfWorkspace(ex, workspaceId);
  if (!plan) return;
  const { rows } = await sql<{ n: number }>`
    select count(*)::int as n from workspace_record where workspace_id = ${workspaceId}`.execute(ex);
  check(plan, "records", plan.limits.records, rows[0]?.n ?? 0, adding);
}

/** Bytes uploaded to every workspace the account owns. */
export async function storageUsed(userId: string, ex: Ex = db): Promise<number> {
  const { rows } = await sql<{ bytes: string | null }>`
    select sum(f.bytes) as bytes from file_upload f join workspace w on w.id = f.workspace_id
    where w.owner_id = ${userId}`.execute(ex);
  return Number(rows[0]?.bytes ?? 0);
}

/** Before a file is stored for a workspace. */
export async function assertStorageRoom(workspaceId: string, bytes: number) {
  const owner = await ownerOf(workspaceId);
  if (!owner) return;
  const { plan } = await accountPlan(owner);
  const used = await storageUsed(owner);
  check(plan, "storageMb", plan.limits.storageMb * 1_000_000, used, bytes);
}

export async function recordUpload(workspaceId: string, name: string, bytes: number) {
  await sql`insert into file_upload (name, workspace_id, bytes) values (${name}, ${workspaceId}, ${bytes})
    on conflict (name) do nothing`
    .execute(db)
    .catch((error) =>
      console.warn(JSON.stringify({ event: "file_upload_log_error", message: String(error) })),
    );
}

/** Automation emails the workspace's owner may still send today, across all their workspaces. */
export async function emailRoom(
  workspaceId: string,
): Promise<{ left: number; plan: Plan; suspended: boolean }> {
  const owner = await ownerOf(workspaceId);
  const account = owner ? await accountPlan(owner) : null;
  const plan = account?.plan ?? PLANS.free;
  const ceiling = Number(process.env.AUTOMATION_EMAIL_DAILY_LIMIT);
  const limit =
    Number.isFinite(ceiling) && ceiling > 0
      ? Math.min(ceiling, plan.limits.emailsPerDay)
      : plan.limits.emailsPerDay;
  const { rows } = await sql<{ n: number }>`
    select coalesce(sum(jsonb_array_length(r.emails)), 0)::int as n from automation_run r
    join workspace w on w.id = r.workspace_id
    where w.owner_id = ${owner} and r.status = 'sent' and r.finished_at > now() - interval '1 day'`.execute(
    db,
  );
  return { left: Math.max(0, limit - (rows[0]?.n ?? 0)), plan, suspended: !!account?.suspended };
}

/** Before a custom domain is added: custom domains across every workspace the owner has. */
export async function assertDomainRoom(workspaceId: string) {
  const owner = await ownerOf(workspaceId);
  if (!owner) return;
  const { plan } = await accountPlan(owner);
  const { rows } = await sql<{ n: number }>`
    select count(*)::int as n from workspace_domain d join workspace w on w.id = d.workspace_id
    where w.owner_id = ${owner} and d.kind = 'custom'`.execute(db);
  check(plan, "customDomains", plan.limits.customDomains, rows[0]?.n ?? 0, 1);
}

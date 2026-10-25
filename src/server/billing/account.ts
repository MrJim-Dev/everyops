import "server-only";
import { sql } from "kysely";
import { allowanceOf } from "@/lib/billing/decide";
import { creditsFromMicros, isPlanId, type PlanId } from "@/lib/billing/plans";
import type { AccountRow, PlanUsage, SpendOverview } from "@/lib/billing/usage";
import { DEFAULT_TIME_ZONE, todayKey } from "@/lib/time";
import { db } from "@/server/db";
import {
  accountPlan,
  billingMonth,
  costThisMonth,
  dailySpendLimitUsd,
  renewsOn,
  safetySwitchOn,
  spendToday,
  storageUsed,
} from "./limits";
import type { PaymentEvent } from "./provider";
import { paymentProvider } from "./provider";

const monthStart = (now = new Date()) => new Date(`${billingMonth(now)}T00:00:00+08:00`);
const dayStart = (now = new Date()) => new Date(`${todayKey(now, DEFAULT_TIME_ZONE)}T00:00:00+08:00`);

/** Everything Account → Plan & usage shows, in one round of queries. */
export async function planUsage(userId: string, now = new Date()): Promise<PlanUsage> {
  const account = await accountPlan(userId);
  const from = monthStart(now);
  const [micros, features, ws, members, records, storage, emails, domains, keys, today, requests, switchOn] =
    await Promise.all([
      costThisMonth(userId, db, now),
      sql<{ feature: string; micros: string; requests: number }>`
        select feature, sum(cost_micros) as micros, count(distinct request_id)::int as requests from ai_call
        where billed_to = ${userId} and at >= ${from} group by feature order by 2 desc`.execute(db),
      sql<{ used: number; starter: number }>`
        select count(*) filter (where not starter)::int as used, count(*) filter (where starter)::int as starter
        from workspace where owner_id = ${userId}`.execute(db),
      sql<{ n: number; name: string }>`
        select (select count(*) from workspace_member m where m.workspace_id = w.id)::int
          + (select count(*) from workspace_invite i where i.workspace_id = w.id)::int as n, w.doc->>'name' as name
        from workspace w where w.owner_id = ${userId} order by 1 desc limit 1`.execute(db),
      sql<{ n: number; name: string }>`
        select count(r.id)::int as n, w.doc->>'name' as name from workspace w
        left join workspace_record r on r.workspace_id = w.id
        where w.owner_id = ${userId} group by w.id order by 1 desc limit 1`.execute(db),
      storageUsed(userId),
      sql<{ n: number }>`
        select coalesce(sum(jsonb_array_length(r.emails)), 0)::int as n from automation_run r
        join workspace w on w.id = r.workspace_id
        where w.owner_id = ${userId} and r.status = 'sent' and r.finished_at > now() - interval '1 day'`.execute(
        db,
      ),
      sql<{ n: number }>`
        select count(*)::int as n from workspace_domain d join workspace w on w.id = d.workspace_id
        where w.owner_id = ${userId} and d.kind = 'custom'`.execute(db),
      sql<{ n: number }>`
        select count(*)::int as n from api_key where user_id = ${userId} and revoked_at is null`.execute(db),
      sql<{ designs: number; turns: number }>`
        select count(distinct request_id) filter (where feature = 'setup-design')::int as designs,
          count(distinct request_id) filter (where feature = 'setup-interview')::int as turns
        from ai_call where user_id = ${userId} and at >= ${dayStart(now)}`.execute(db),
      sql<{ at: Date; detail: Record<string, unknown> }>`
        select at, detail from billing_event where user_id = ${userId} and kind = 'checkout_requested'
          -- Only requests since the plan last changed: a handled request stops showing.
          and at > coalesce((select p.updated_at from account_plan p where p.user_id = ${userId}), 'epoch')
        order by at desc limit 5`.execute(db),
      safetySwitchOn(now),
    ]);
  return {
    plan: account.plan.id,
    source: account.source,
    status: account.status,
    suspended: account.suspended,
    suspendedReason: account.suspendedReason,
    verified: account.verified,
    email: account.email,
    month: billingMonth(now),
    renewsOn: renewsOn(now),
    credits: {
      used: creditsFromMicros(micros),
      allowance: allowanceOf(account.plan, account.bonusCredits),
      bonus: account.bonusCredits,
    },
    byFeature: features.rows.map((r) => ({
      feature: r.feature,
      credits: creditsFromMicros(Number(r.micros)),
      requests: r.requests,
    })),
    workspaces: { used: ws.rows[0]?.used ?? 0, starter: ws.rows[0]?.starter ?? 0 },
    members: { used: members.rows[0]?.n ?? 0, workspace: members.rows[0]?.name ?? null },
    records: { used: records.rows[0]?.n ?? 0, workspace: records.rows[0]?.name ?? null },
    storageBytes: storage,
    emailsToday: emails.rows[0]?.n ?? 0,
    customDomains: domains.rows[0]?.n ?? 0,
    apiKeys: keys.rows[0]?.n ?? 0,
    today: { designs: today.rows[0]?.designs ?? 0, turns: today.rows[0]?.turns ?? 0 },
    requests: requests.rows.map((r) => ({ at: new Date(r.at).toISOString(), detail: r.detail })),
    paymentsOnline: paymentProvider().online,
    safetySwitchOn: switchOn,
  };
}

/** Every account with its plan and this month's use, heaviest AI users first. */
export async function listAccounts(now = new Date()): Promise<AccountRow[]> {
  const from = monthStart(now);
  const { rows } = await sql<{
    id: string;
    name: string;
    email: string;
    verified: boolean;
    created_at: Date;
    micros: string | null;
    requests: number;
    last_ai: Date | null;
    workspaces: number;
    records: number;
    bytes: string | null;
    pending: Record<string, unknown> | null;
  }>`
    select u.id, u.name, u.email, u."emailVerified" as verified, u."createdAt" as created_at,
      ai.micros, coalesce(ai.requests, 0)::int as requests, ai.last_ai,
      (select count(*) from workspace w where w.owner_id = u.id and not w.starter)::int as workspaces,
      (select count(*) from workspace_record r join workspace w on w.id = r.workspace_id where w.owner_id = u.id)::int as records,
      (select sum(f.bytes) from file_upload f join workspace w on w.id = f.workspace_id where w.owner_id = u.id) as bytes,
      (select e.detail from billing_event e where e.user_id = u.id and e.kind = 'checkout_requested'
        and e.at > coalesce((select p.updated_at from account_plan p where p.user_id = u.id), 'epoch')
        order by e.at desc limit 1) as pending
    from "user" u
    left join lateral (
      select sum(cost_micros) as micros, count(distinct request_id) as requests, max(at) as last_ai
      from ai_call c where c.billed_to = u.id and c.at >= ${from}
    ) ai on true
    order by coalesce(ai.micros, 0) desc, u."createdAt" desc
    limit 500`.execute(db);
  return Promise.all(
    rows.map(async (r) => {
      const a = await accountPlan(r.id);
      return {
        id: r.id,
        name: r.name,
        email: r.email,
        verified: !!r.verified,
        createdAt: new Date(r.created_at).toISOString(),
        plan: a.plan.id,
        source: a.source,
        status: a.status,
        suspended: a.suspended,
        suspendedReason: a.suspendedReason,
        bonusCredits: a.bonusCredits,
        note: a.note,
        creditsUsed: creditsFromMicros(Number(r.micros ?? 0)),
        allowance: allowanceOf(a.plan, a.bonusCredits),
        aiRequests: r.requests,
        workspaces: r.workspaces,
        records: r.records,
        storageBytes: Number(r.bytes ?? 0),
        lastAiAt: r.last_ai ? new Date(r.last_ai).toISOString() : null,
        pendingRequest: r.pending
          ? r.pending.item === "plan"
            ? `${String(r.pending.plan)} (${String(r.pending.period)})`
            : `${String(r.pending.credits)} credits`
          : null,
      };
    }),
  );
}

export async function spendOverview(now = new Date()): Promise<SpendOverview> {
  const { rows } = await sql<{ micros: string | null; wasted: string | null }>`
    select sum(cost_micros) as micros, sum(cost_micros) filter (where outcome <> 'ok') as wasted
    from ai_call where at >= ${monthStart(now)}`.execute(db);
  const today = await spendToday(now);
  return {
    todayMicros: today,
    monthMicros: Number(rows[0]?.micros ?? 0),
    wastedMonthMicros: Number(rows[0]?.wasted ?? 0),
    limitUsd: dailySpendLimitUsd(),
    on: today >= dailySpendLimitUsd() * 1_000_000,
  };
}

export type AccountChange = {
  plan?: PlanId;
  /** Credits to add for this month (an admin grant). */
  grantCredits?: number;
  /** A reason suspends; null lifts a suspension. */
  suspend?: string | null;
  note?: string | null;
};

/** A site admin changes an account's plan, credits, suspension or note. Every change is logged in billing_event. */
export async function updateAccount(admin: string, userId: string, change: AccountChange, now = new Date()) {
  if (change.plan !== undefined && !isPlanId(change.plan))
    return { ok: false as const, message: "Unknown plan." };
  const grant = Math.round(change.grantCredits ?? 0);
  if (grant < 0 || grant > 1_000_000)
    return { ok: false as const, message: "Grant between 0 and 1,000,000 credits." };
  const month = billingMonth(now);
  const exists = await sql`select 1 from "user" where id = ${userId}`.execute(db);
  if (!exists.rows.length) return { ok: false as const, message: "No such account." };
  await db.transaction().execute(async (trx) => {
    await sql`insert into account_plan (user_id, updated_by) values (${userId}, ${admin}) on conflict (user_id) do nothing`.execute(
      trx,
    );
    if (change.plan)
      await sql`update account_plan set plan = ${change.plan}, status = 'active', updated_by = ${admin}, updated_at = now()
        where user_id = ${userId}`.execute(trx);
    // A first row without a plan would read as Free; keep what the account was on.
    else
      await sql`update account_plan set plan = coalesce(plan, ${(await accountPlan(userId, trx)).plan.id}) where user_id = ${userId}`.execute(
        trx,
      );
    if (grant)
      await sql`update account_plan set
          bonus_credits = case when bonus_month = ${month}::date then bonus_credits + ${grant} else ${grant} end,
          bonus_month = ${month}::date, updated_by = ${admin}, updated_at = now()
        where user_id = ${userId}`.execute(trx);
    if (change.suspend !== undefined)
      await sql`update account_plan set suspended_at = ${change.suspend ? now : null},
          suspended_reason = ${change.suspend || null}, updated_by = ${admin}, updated_at = now()
        where user_id = ${userId}`.execute(trx);
    if (change.note !== undefined)
      await sql`update account_plan set note = ${change.note || null}, updated_by = ${admin}, updated_at = now()
        where user_id = ${userId}`.execute(trx);
    const events: [string, Record<string, unknown>][] = [];
    if (change.plan) events.push(["plan_assigned", { plan: change.plan }]);
    if (grant) events.push(["credits_granted", { credits: grant, month }]);
    if (change.suspend !== undefined)
      events.push([change.suspend ? "suspended" : "unsuspended", { reason: change.suspend }]);
    if (change.note !== undefined) events.push(["note", { note: change.note }]);
    for (const [kind, detail] of events)
      await sql`insert into billing_event (user_id, kind, detail, actor) values (${userId}, ${kind}, ${JSON.stringify(detail)}::jsonb, ${admin})`.execute(
        trx,
      );
  });
  return { ok: true as const, account: await accountPlan(userId) };
}

/** Applies what a payment provider's webhook says happened. Ready for a provider; unused while payment is manual. */
export async function applyPaymentEvent(provider: string, event: PaymentEvent, now = new Date()) {
  const month = billingMonth(now);
  await db.transaction().execute(async (trx) => {
    await sql`insert into account_plan (user_id, provider) values (${event.userId}, ${provider}) on conflict (user_id) do nothing`.execute(
      trx,
    );
    switch (event.type) {
      case "plan.activated":
        await sql`update account_plan set plan = ${event.plan}, status = 'active', provider = ${provider},
            provider_subscription = ${event.providerRef}, current_period_end = ${event.periodEnd}, updated_at = now()
          where user_id = ${event.userId}`.execute(trx);
        break;
      case "plan.past_due":
        await sql`update account_plan set status = 'past_due', updated_at = now() where user_id = ${event.userId}`.execute(
          trx,
        );
        break;
      case "plan.canceled":
        await sql`update account_plan set plan = 'free', status = 'canceled', updated_at = now() where user_id = ${event.userId}`.execute(
          trx,
        );
        break;
      case "credits.purchased":
        await sql`update account_plan set
            bonus_credits = case when bonus_month = ${month}::date then bonus_credits + ${event.credits} else ${event.credits} end,
            bonus_month = ${month}::date, updated_at = now()
          where user_id = ${event.userId}`.execute(trx);
        break;
    }
    await sql`insert into billing_event (user_id, kind, detail, actor)
      values (${event.userId}, ${event.type}, ${JSON.stringify(event)}::jsonb, ${provider})`.execute(trx);
  });
}

import "server-only";
import { type RawBuilder, sql } from "kysely";
import {
  AI_PERIODS,
  type AiPeriod,
  featureLabel,
  originLabel,
  stepLabel,
  type UsageCall,
  type UsageGroup,
  type UsageReport,
} from "@/lib/ai-usage";
import { addDays, daysBetween, todayKey } from "@/lib/time";
import { db } from "@/server/db";

export const isPeriod = (value: string | null): value is AiPeriod => !!value && value in AI_PERIODS;

/** The period's bounds in Manila days: from its first day to now (or to the end of last month). */
export function periodRange(period: AiPeriod, now = new Date()) {
  const today = todayKey(now);
  const start = (key: string) => new Date(`${key}T00:00:00+08:00`);
  const monthStart = `${today.slice(0, 7)}-01`;
  if (period === "30d") {
    const fromKey = addDays(today, -29);
    return { from: start(fromKey), to: now, fromKey, toKey: today };
  }
  if (period === "month") return { from: start(monthStart), to: now, fromKey: monthStart, toKey: today };
  const toKey = addDays(monthStart, -1);
  const fromKey = `${toKey.slice(0, 7)}-01`;
  return { from: start(fromKey), to: start(monthStart), fromKey, toKey };
}

/** Whose use to report: one workspace's, or everything one account started (any workspace, setup, voice). */
export type UsageFilter = { workspaceId: string } | { userId: string };

type GroupRow = {
  key: string | null;
  a: string | null;
  b: string | null;
  calls: number;
  requests: number;
  tokens: string;
  cost: string;
  wasted: string;
};

const SUMS = sql`count(*)::int as calls,
  count(distinct coalesce(c.request_id, c.id::text))::int as requests,
  coalesce(sum(c.input_tokens + c.output_tokens + c.thinking_tokens), 0)::bigint as tokens,
  coalesce(sum(c.cost_micros), 0)::bigint as cost,
  coalesce(sum(case when c.outcome <> 'ok' then c.cost_micros else 0 end), 0)::bigint as wasted`;

const NONE = sql`null`;
const NO_JOIN = sql``;

const toGroup = (r: GroupRow, label: string, detail?: string): UsageGroup => ({
  key: r.key ?? "",
  label,
  ...(detail ? { detail } : {}),
  calls: r.calls,
  requests: r.requests,
  tokens: Number(r.tokens),
  costMicros: Number(r.cost),
  wastedMicros: Number(r.wasted),
});

/**
 * The AI use report shown in settings: totals, a day-by-day line, breakdowns by feature, step, model and where it
 * ran, and the latest calls. people adds a breakdown by person (owners and admins); otherwise a workspace's latest
 * calls are only the viewer's own.
 */
export async function usageReport(
  filter: UsageFilter,
  period: AiPeriod,
  { viewer, people = false }: { viewer: string; people?: boolean },
  now = new Date(),
): Promise<UsageReport> {
  const range = periodRange(period, now);
  const scope =
    "workspaceId" in filter ? sql`c.workspace_id = ${filter.workspaceId}` : sql`c.user_id = ${filter.userId}`;
  const where = sql`${scope} and c.at >= ${range.from} and c.at < ${range.to}`;
  const group = (
    key: RawBuilder<unknown>,
    a: RawBuilder<unknown> = NONE,
    b: RawBuilder<unknown> = NONE,
    join: RawBuilder<unknown> = NO_JOIN,
  ) =>
    sql<GroupRow>`select ${key}::text as key, ${a}::text as a, ${b}::text as b, ${SUMS}
      from ai_call c ${join} where ${where} group by 1, 2, 3 order by cost desc, calls desc limit 50`
      .execute(db)
      .then((r) => r.rows);

  const account = "userId" in filter;
  const [totals, daily, features, steps, models, origins, persons, workspaces, recent] = await Promise.all([
    sql<{
      calls: number;
      requests: number;
      input: string;
      cached: string;
      output: string;
      thinking: string;
      cost: string;
      wasted_calls: number;
      wasted: string;
    }>`select count(*)::int as calls,
        count(distinct coalesce(c.request_id, c.id::text))::int as requests,
        coalesce(sum(c.input_tokens), 0)::bigint as input, coalesce(sum(c.cached_tokens), 0)::bigint as cached,
        coalesce(sum(c.output_tokens), 0)::bigint as output, coalesce(sum(c.thinking_tokens), 0)::bigint as thinking,
        coalesce(sum(c.cost_micros), 0)::bigint as cost,
        count(*) filter (where c.outcome <> 'ok')::int as wasted_calls,
        coalesce(sum(c.cost_micros) filter (where c.outcome <> 'ok'), 0)::bigint as wasted
      from ai_call c where ${where}`.execute(db),
    sql<{ day: string; cost: string; tokens: string; calls: number }>`
      select to_char(c.at at time zone 'Asia/Manila', 'YYYY-MM-DD') as day, coalesce(sum(c.cost_micros), 0)::bigint as cost,
        coalesce(sum(c.input_tokens + c.output_tokens + c.thinking_tokens), 0)::bigint as tokens, count(*)::int as calls
      from ai_call c where ${where} group by 1 order by 1`.execute(db),
    group(sql`c.feature`),
    group(sql`c.feature || '/' || c.task`, sql`c.feature`, sql`c.task`),
    group(sql`c.model || '@' || c.location`, sql`c.model`, sql`c.location`),
    group(sql`c.origin`),
    people && !account
      ? group(sql`c.user_id`, sql`u.name`, sql`u.email`, sql`left join "user" u on u.id = c.user_id`)
      : Promise.resolve(null),
    account
      ? group(
          sql`c.workspace_id`,
          sql`w.doc->>'name'`,
          NONE,
          sql`left join workspace w on w.id = c.workspace_id`,
        )
      : Promise.resolve(null),
    sql<{
      at: Date;
      feature: string;
      task: string;
      model: string;
      location: string;
      outcome: string;
      attempt: number;
      tokens: number;
      estimated: boolean;
      cost: string;
      ms: number;
      origin: string;
      person: string | null;
      workspace: string | null;
    }>`select c.at, c.feature, c.task, c.model, c.location, c.outcome, c.attempt,
        c.input_tokens + c.output_tokens + c.thinking_tokens as tokens, c.estimated, c.cost_micros as cost, c.ms,
        c.origin, u.name as person, w.doc->>'name' as workspace
      from ai_call c left join "user" u on u.id = c.user_id left join workspace w on w.id = c.workspace_id
      where ${where} ${people || account ? NO_JOIN : sql`and c.user_id = ${viewer}`}
      order by c.at desc limit 30`.execute(db),
  ]);

  const t = totals.rows[0];
  const byDay = new Map(daily.rows.map((d) => [d.day, d]));
  const days = daysBetween(range.fromKey, range.toKey) + 1;
  return {
    period,
    from: range.fromKey,
    to: range.toKey,
    totals: {
      calls: t?.calls ?? 0,
      requests: t?.requests ?? 0,
      input: Number(t?.input ?? 0),
      cached: Number(t?.cached ?? 0),
      output: Number(t?.output ?? 0),
      thinking: Number(t?.thinking ?? 0),
      costMicros: Number(t?.cost ?? 0),
      wastedCalls: t?.wasted_calls ?? 0,
      wastedMicros: Number(t?.wasted ?? 0),
    },
    daily: Array.from({ length: days }, (_, i) => {
      const day = addDays(range.fromKey, i);
      const d = byDay.get(day);
      return { day, costMicros: Number(d?.cost ?? 0), tokens: Number(d?.tokens ?? 0), calls: d?.calls ?? 0 };
    }),
    byFeature: features.map((r) => toGroup(r, featureLabel(r.key ?? ""))),
    byStep: steps.map((r) => toGroup(r, stepLabel(r.b ?? ""), featureLabel(r.a ?? ""))),
    byModel: models.map((r) =>
      toGroup(
        r,
        r.a ?? "",
        r.b === "global"
          ? "Global endpoint"
          : r.b === "anthropic"
            ? "Anthropic API"
            : `Regional endpoint · ${r.b}`,
      ),
    ),
    byOrigin: origins.map((r) => toGroup(r, originLabel(r.key ?? ""))),
    ...(persons
      ? {
          byPerson: persons.map((r) =>
            toGroup(r, r.a ?? (r.key ? "Former member" : "No one"), r.b ?? undefined),
          ),
        }
      : {}),
    ...(workspaces
      ? {
          byWorkspace: workspaces.map((r) =>
            toGroup(
              r,
              r.key ? (r.a ?? "Deleted workspace") : "Setup and account",
              r.key ? undefined : "Setting up workspaces, voice input and the change planner",
            ),
          ),
        }
      : {}),
    recent: recent.rows.map(
      (r): UsageCall => ({
        at: new Date(r.at).toISOString(),
        feature: r.feature,
        task: r.task,
        model: r.model,
        location: r.location,
        outcome: r.outcome,
        attempt: r.attempt,
        tokens: Number(r.tokens),
        estimated: r.estimated,
        costMicros: Number(r.cost),
        ms: r.ms,
        origin: r.origin,
        ...(r.person ? { person: r.person } : {}),
        ...(r.workspace ? { workspace: r.workspace } : {}),
      }),
    ),
  };
}

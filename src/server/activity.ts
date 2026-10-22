import "server-only";
import { type Kysely, sql, type Transaction } from "kysely";
import {
  type Action,
  type ActivityItem,
  type ActivityResult,
  type ActorType,
  RETENTION_DAYS,
} from "@/lib/activity";
import type { RecordActor } from "@/lib/blueprint/types";
import { type Database, db } from "./db";

/**
 * The activity log: who or what changed a workspace. Writes go in the same transaction as the change (pass the
 * transaction); denied requests and reads by AI agents are logged on their own. A person's quick repeated edits to
 * the same records or page within two minutes update one entry instead of adding many.
 */

type Ex = Kysely<Database> | Transaction<Database>;

export type Actor = {
  type: ActorType;
  /** The key id, rule id, form id; for people their user id. */
  id?: string | null;
  /** Shown in the log. A person's name is looked up when it's left out. */
  name?: string | null;
  userId?: string | null;
  keyId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
};

export type Entry = {
  workspaceId: string | null;
  action: Action;
  target?: string | null;
  ids?: string[];
  count?: number;
  result?: ActivityResult;
  detail?: string | null;
};

const MAX_IDS = 100;
const COALESCE: Action[] = ["record.update", "page.update"];

export async function logActivity(ex: Ex, actor: Actor, entries: Entry | Entry[]): Promise<void> {
  const list = (Array.isArray(entries) ? entries : [entries]).filter((e) => e.count !== 0 || e.ids?.length);
  for (const e of list) {
    const ids = [...new Set(e.ids ?? [])].slice(0, MAX_IDS);
    const count = e.count ?? e.ids?.length ?? 0;
    const result = e.result ?? "ok";
    if (actor.type === "person" && result === "ok" && COALESCE.includes(e.action) && e.workspaceId) {
      const { rows } = await sql<{ id: string }>`
        update activity_log set at = now(), count = greatest(count, ${count})
        where id = (select id from activity_log where workspace_id = ${e.workspaceId} and actor_type = 'person'
          and actor_id = ${actor.id ?? null} and action = ${e.action} and target is not distinct from ${e.target ?? null}
          and ids = ${ids}::text[] and result = 'ok' and at > now() - interval '2 minutes'
          order by at desc limit 1)
        returning id`.execute(ex);
      if (rows.length) continue;
    }
    await sql`insert into activity_log (workspace_id, actor_type, actor_id, actor_name, user_id, key_id, action,
        target, ids, count, result, detail, ip, user_agent)
      values (${e.workspaceId}, ${actor.type}, ${actor.id ?? null},
        coalesce(${actor.name ?? null}, (select name from "user" where id = ${actor.userId ?? null})),
        ${actor.userId ?? null}, ${actor.keyId ?? null}, ${e.action}, ${e.target ?? null}, ${ids}::text[],
        ${count}, ${result}, ${e.detail?.slice(0, 500) ?? null}, ${actor.ip ?? null},
        ${actor.userAgent?.slice(0, 300) ?? null})`.execute(ex);
  }
}

/** A person acting in the app. */
export const personActor = (userId: string): Actor => ({ type: "person", id: userId, userId });

/**
 * How a write is stamped on the records it touches (Created by / Last edited by): the actor's kind, id and name,
 * with a person's name looked up from their account (their email when they haven't set one).
 */
export async function recordActor(ex: Ex, actor: Actor): Promise<RecordActor> {
  let name = actor.name ?? null;
  if (!name && actor.userId) {
    const { rows } = await sql<{ name: string | null; email: string | null }>`
      select name, email from "user" where id = ${actor.userId}`.execute(ex);
    name = rows[0]?.name?.trim() || rows[0]?.email || null;
  }
  return { type: actor.type, id: actor.id ?? actor.userId ?? null, name: name ?? "Someone" };
}

type Row = {
  id: string;
  at: Date;
  workspace_id: string | null;
  actor_type: ActorType;
  actor_id: string | null;
  actor_name: string | null;
  key_id: string | null;
  action: Action;
  target: string | null;
  ids: string[];
  count: number;
  result: ActivityResult;
  detail: string | null;
  ip: string | null;
  user_agent: string | null;
};

const toItem = (r: Row): ActivityItem => ({
  id: Number(r.id),
  at: r.at.toISOString(),
  workspaceId: r.workspace_id,
  actorType: r.actor_type,
  actorId: r.actor_id,
  actorName: r.actor_name,
  keyId: r.key_id,
  action: r.action,
  target: r.target,
  ids: r.ids,
  count: r.count,
  result: r.result,
  detail: r.detail,
  ip: r.ip,
  userAgent: r.user_agent,
});

export type ActivityFilter = {
  actorType?: string | null;
  actorId?: string | null;
  action?: string | null;
  result?: string | null;
  from?: Date | null;
  to?: Date | null;
  /** Entries older than this id (the next page). */
  before?: number | null;
  limit?: number;
};

/** A workspace's log, newest first, filtered. */
export async function listActivity(workspaceId: string, f: ActivityFilter = {}): Promise<ActivityItem[]> {
  const limit = Math.min(Math.max(f.limit ?? 50, 1), 5000);
  const conds = [
    sql`workspace_id = ${workspaceId}`,
    sql`at > now() - make_interval(days => ${RETENTION_DAYS})`,
  ];
  if (f.actorType) conds.push(sql`actor_type = ${f.actorType}`);
  if (f.actorId) conds.push(sql`actor_id = ${f.actorId}`);
  if (f.action)
    conds.push(f.action.endsWith(".") ? sql`action like ${`${f.action}%`}` : sql`action = ${f.action}`);
  if (f.result) conds.push(sql`result = ${f.result}`);
  if (f.from) conds.push(sql`at >= ${f.from}`);
  if (f.to) conds.push(sql`at < ${f.to}`);
  if (f.before) conds.push(sql`id < ${f.before}`);
  const { rows } = await sql<Row>`select * from activity_log where ${sql.join(conds, sql` and `)}
    order by at desc, id desc limit ${limit}`.execute(db);
  return rows.map(toItem);
}

/** The people, keys, agents and automations that appear in a workspace's log, for its filter. */
export async function activityActors(workspaceId: string) {
  const { rows } = await sql<{ actor_type: ActorType; actor_id: string | null; actor_name: string | null }>`
    select distinct on (actor_type, actor_id) actor_type, actor_id, actor_name from activity_log
    where workspace_id = ${workspaceId} and actor_id is not null order by actor_type, actor_id, at desc`.execute(
    db,
  );
  return rows.map((r) => ({
    type: r.actor_type,
    id: r.actor_id as string,
    name: r.actor_name ?? r.actor_id,
  }));
}

export type KeyUsage = {
  total: number;
  denied: number;
  lastAt: string | null;
  lastAction: string | null;
  workspaces: number;
};

/** Each of an account's keys' use over the last 30 days, across every workspace. */
export async function keyUsage(userId: string): Promise<Record<string, KeyUsage>> {
  const { rows } = await sql<{
    key_id: string;
    total: number;
    denied: number;
    last_at: Date | null;
    last_action: string | null;
    workspaces: number;
  }>`
    select key_id, count(*)::int as total, count(*) filter (where result = 'denied')::int as denied,
      max(at) as last_at, (array_agg(action order by at desc))[1] as last_action,
      count(distinct workspace_id)::int as workspaces
    from activity_log where user_id = ${userId} and key_id is not null and at > now() - interval '30 days'
      and action not in ('key.create', 'key.revoke')
    group by key_id`.execute(db);
  return Object.fromEntries(
    rows.map((r) => [
      r.key_id,
      {
        total: r.total,
        denied: r.denied,
        lastAt: r.last_at?.toISOString() ?? null,
        lastAction: r.last_action,
        workspaces: r.workspaces,
      },
    ]),
  );
}

/** Drops entries past the retention period; the cron job calls it. */
export async function trimActivity(): Promise<number> {
  const done =
    await sql`delete from activity_log where at < now() - make_interval(days => ${RETENTION_DAYS})`.execute(
      db,
    );
  return Number(done.numAffectedRows ?? 0);
}

/**
 * One entry per action and record type for a batch of writes (a browser save, an automation pass): new records,
 * changed records and deleted ones.
 */
export function recordEntries(
  workspaceId: string,
  puts: { record: { id: string; entityId: string }; rev: number | null }[],
  deleted: { id: string; entityId: string }[] = [],
): Entry[] {
  const groups = new Map<string, Entry>();
  const add = (action: Action, entityId: string, id: string) => {
    const key = `${action} ${entityId}`;
    const g = groups.get(key) ?? { workspaceId, action, target: entityId, ids: [], count: 0 };
    g.ids?.push(id);
    g.count = (g.count ?? 0) + 1;
    groups.set(key, g);
  };
  for (const p of puts)
    add(p.rev === null ? "record.create" : "record.update", p.record.entityId, p.record.id);
  for (const d of deleted) add("record.delete", d.entityId, d.id);
  return [...groups.values()];
}

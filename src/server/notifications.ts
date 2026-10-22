import "server-only";
import { sql } from "kysely";
import type { Alert, Email } from "@/lib/engine/automations";
import { db } from "./db";
import type { readRecords } from "./workspace-data";

type Ex = Parameters<typeof readRecords>[0];

/**
 * Notifications from automations (notify_people). Who an alert goes to is read when it's sent: owner, admins
 * (owner and admins), team (everyone in the workspace) and staff by role, and addresses (typed or from a
 * {{field}}) by email. Members get an in-app notification (the bell beside Search), and an email too when the
 * automation asks; anyone else gets an email, sent with the automation's other emails (daily limit, retries, run
 * history). So "notify the owner and {{player.email}}" reaches the owner in the app and the player by email.
 */

const EMAIL = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/;

export type Notification = {
  id: number;
  title: string;
  body: string | null;
  recordId: string | null;
  ruleName: string | null;
  createdAt: string;
  read: boolean;
};

type Person = { id: string; email: string; role: "owner" | "admin" | "staff" | "viewer" };

async function people(ex: Ex, workspaceId: string): Promise<Person[]> {
  const { rows } = await sql<Person>`
    select u.id, lower(u.email) as email, 'owner' as role from workspace w join "user" u on u.id = w.owner_id
    where w.id = ${workspaceId}
    union all
    select u.id, lower(u.email) as email, m.role from workspace_member m join "user" u on u.id = m.user_id
    where m.workspace_id = ${workspaceId}`.execute(ex);
  return rows;
}

/** Who one alert reaches: the members to notify in the app, and the addresses to email. */
export function recipients(alert: Alert, team: Person[]): { members: Person[]; emails: string[] } {
  const members = new Map<string, Person>();
  const emails = new Set<string>();
  for (const raw of alert.to.split(/[,;\n]/)) {
    const t = raw.trim().toLowerCase();
    if (!t) continue;
    const group =
      t === "owner"
        ? team.filter((p) => p.role === "owner")
        : t === "admins" || t === "admin"
          ? team.filter((p) => p.role === "owner" || p.role === "admin")
          : t === "team" || t === "everyone"
            ? team
            : t === "staff"
              ? team.filter((p) => p.role === "staff")
              : null;
    if (group) for (const p of group) members.set(p.id, p);
    else if (EMAIL.test(t)) {
      const member = team.find((p) => p.email === t);
      if (member) members.set(member.id, member);
      else emails.add(t);
    }
  }
  if (alert.email) for (const p of members.values()) emails.add(p.email);
  return { members: [...members.values()], emails: [...emails] };
}

/**
 * Sends a run's alerts inside its transaction: in-app notifications are written now, and the emails to send are
 * returned for the run to queue with its others. Returns a line for the run's history too.
 */
export async function sendAlerts(
  ex: Ex,
  workspaceId: string,
  rule: { id: string; name: string },
  alerts: Alert[],
): Promise<{ emails: Email[]; detail: string | null }> {
  if (!alerts.length) return { emails: [], detail: null };
  const team = await people(ex, workspaceId);
  const rows: Record<string, string | null>[] = [];
  const emails: Email[] = [];
  for (const alert of alerts) {
    const { members, emails: to } = recipients(alert, team);
    for (const p of members)
      rows.push({
        workspace_id: workspaceId,
        user_id: p.id,
        title: alert.title.slice(0, 300),
        body: alert.body.slice(0, 2000) || null,
        record_id: alert.recordId,
        rule_id: rule.id,
        rule_name: rule.name,
      });
    for (const address of to)
      emails.push({ to: address, subject: alert.title, body: alert.body || alert.title });
  }
  if (rows.length)
    await sql`
      insert into notification (workspace_id, user_id, title, body, record_id, rule_id, rule_name)
      select x.workspace_id, x.user_id, x.title, x.body, x.record_id, x.rule_id, x.rule_name
      from jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) as x(workspace_id text, user_id text, title text,
        body text, record_id text, rule_id text, rule_name text)`.execute(ex);
  const notified = new Set(rows.map((r) => r.user_id)).size;
  return {
    emails,
    detail: notified ? `Notified ${notified} ${notified === 1 ? "person" : "people"} in the app.` : null,
  };
}

/** A person's latest notifications in a workspace, newest first, and how many they haven't read. */
export async function listNotifications(
  workspaceId: string,
  userId: string,
  limit = 30,
): Promise<{ items: Notification[]; unread: number }> {
  const [{ rows }, { rows: count }] = await Promise.all([
    sql<{
      id: string;
      title: string;
      body: string | null;
      record_id: string | null;
      rule_name: string | null;
      created_at: Date;
      read_at: Date | null;
    }>`
      select id, title, body, record_id, rule_name, created_at, read_at from notification
      where workspace_id = ${workspaceId} and user_id = ${userId}
      order by created_at desc, id desc limit ${limit}`.execute(db),
    sql<{ n: number }>`
      select count(*)::int as n from notification
      where workspace_id = ${workspaceId} and user_id = ${userId} and read_at is null`.execute(db),
  ]);
  return {
    items: rows.map((r) => ({
      id: Number(r.id),
      title: r.title,
      body: r.body,
      recordId: r.record_id,
      ruleName: r.rule_name,
      createdAt: r.created_at.toISOString(),
      read: !!r.read_at,
    })),
    unread: count[0]?.n ?? 0,
  };
}

/** Marks a person's notifications read: the given ones, or all of them in the workspace. */
export async function markRead(workspaceId: string, userId: string, ids?: number[]): Promise<void> {
  await sql`
    update notification set read_at = now()
    where workspace_id = ${workspaceId} and user_id = ${userId} and read_at is null
      ${ids ? sql`and id = any(${ids}::bigint[])` : sql``}`.execute(db);
}

import "server-only";
import { sql } from "kysely";
import type { DataRecord, WorkspaceData } from "@/lib/blueprint/types";
import { freshSample } from "@/lib/catalog/shift";
import {
  type Invite,
  type Member,
  type MemberRole,
  newWorkspaceId,
  type Role,
  toDoc,
  type Workspace,
  type WorkspaceDoc,
  workspaceFrom,
} from "@/lib/store/workspace-model";
import { db } from "./db";

const ID = /^[a-z0-9][a-z0-9-]{1,79}$/;
export const MAX_DOC_BYTES = 4_000_000;

type Row = { id: string; owner_id: string; doc: WorkspaceDoc; owner_name: string; owner_email: string };

/** The caller's role in a workspace, or null if they have no access. */
export async function roleIn(
  workspaceId: string,
  userId: string,
): Promise<{ role: Role; ownerId: string } | null> {
  const { rows } = await sql<{ owner_id: string; role: MemberRole | null }>`
    select w.owner_id, m.role from workspace w
    left join workspace_member m on m.workspace_id = w.id and m.user_id = ${userId}
    where w.id = ${workspaceId}`.execute(db);
  const row = rows[0];
  if (!row) return null;
  if (row.owner_id === userId) return { role: "owner", ownerId: row.owner_id };
  return row.role ? { role: row.role, ownerId: row.owner_id } : null;
}

/** Creates the demo workspaces from the starter templates, once per account. */
async function seedIfNew(userId: string) {
  const inserted =
    await sql`insert into account_seed (user_id) values (${userId}) on conflict do nothing`.execute(db);
  if (!Number(inserted.numAffectedRows ?? 0)) return;
  const { rows } = await sql<{
    id: string;
    name: string;
    summary: string;
    source_system_id: string | null;
    doc: WorkspaceData & { builtOn: string };
  }>`select * from workspace_template order by sort`.execute(db);
  const now = new Date();
  for (const [i, t] of rows.entries()) {
    const data = freshSample(t.doc.blueprint, t.doc.records, t.doc.builtOn, t.name, now);
    const ws = workspaceFrom(
      {
        name: t.name,
        summary: t.summary,
        data,
        source: t.source_system_id ? { systemId: t.source_system_id, version: "1.2" } : undefined,
      },
      newWorkspaceId(t.id),
      now.toISOString(),
    );
    ws.openedAt = new Date(now.getTime() - i * 60_000).toISOString();
    await sql`insert into workspace (id, owner_id, doc) values (${ws.slug}, ${userId}, ${JSON.stringify(toDoc(ws))}::jsonb)`.execute(
      db,
    );
  }
}

/** Everything the account can open: its own workspaces and the ones it was invited to. */
export async function listWorkspaces(userId: string): Promise<Workspace[]> {
  await seedIfNew(userId);
  const { rows } = await sql<Row>`
    select w.id, w.owner_id, w.doc, u.name as owner_name, u.email as owner_email
    from workspace w join "user" u on u.id = w.owner_id
    where w.owner_id = ${userId}
       or exists (select 1 from workspace_member m where m.workspace_id = w.id and m.user_id = ${userId})`.execute(
    db,
  );
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const members = await sql<{
    workspace_id: string;
    user_id: string;
    role: MemberRole;
    joined_at: Date;
    name: string;
    email: string;
  }>`
    select m.workspace_id, m.user_id, m.role, m.joined_at, u.name, u.email
    from workspace_member m join "user" u on u.id = m.user_id
    where m.workspace_id = any(${ids})`.execute(db);
  const invites = await sql<{
    workspace_id: string;
    token: string;
    email: string;
    role: MemberRole;
    invited_by: string;
    invited_at: Date;
  }>`
    select * from workspace_invite where workspace_id = any(${ids})`.execute(db);

  return rows.map((r) => {
    const team: Member[] = members.rows
      .filter((m) => m.workspace_id === r.id)
      .map((m) => ({
        accountId: m.user_id,
        name: m.name,
        email: m.email,
        role: m.role,
        joinedAt: m.joined_at.toISOString(),
      }));
    const mine = r.owner_id === userId ? "owner" : team.find((m) => m.accountId === userId)?.role;
    const manager = mine === "owner" || mine === "admin";
    return {
      ...r.doc,
      slug: r.id,
      ownerId: r.owner_id,
      owner: { name: r.owner_name, email: r.owner_email },
      members: team,
      invites: manager
        ? invites.rows
            .filter((i) => i.workspace_id === r.id)
            .map((i) => ({
              token: i.token,
              email: i.email,
              role: i.role,
              invitedBy: i.invited_by,
              invitedAt: i.invited_at.toISOString(),
            }))
        : [],
    };
  });
}

export type SaveResult = { ok: true } | { ok: false; status: number; message: string };

/** One workspace the caller can open, with their role in it. */
export async function loadWorkspace(
  id: string,
  userId: string,
): Promise<{ workspace: Workspace; role: Role } | null> {
  const access = await roleIn(id, userId);
  if (!access) return null;
  const { rows } = await sql<{ doc: WorkspaceDoc }>`select doc from workspace where id = ${id}`.execute(db);
  if (!rows[0]) return null;
  return { workspace: { ...rows[0].doc, slug: id, ownerId: access.ownerId }, role: access.role };
}

/**
 * Saves a workspace from the browser. Owners and admins save the whole document and the team;
 * staff only save records; viewers can't save. New ids create a workspace owned by the caller.
 */
export async function saveWorkspace(userId: string, ws: Workspace): Promise<SaveResult> {
  if (!ID.test(ws.slug)) return { ok: false, status: 400, message: "Invalid workspace id." };
  const access = await roleIn(ws.slug, userId);
  const doc = toDoc(ws);

  if (!access) {
    const created =
      await sql`insert into workspace (id, owner_id, doc) values (${ws.slug}, ${userId}, ${JSON.stringify(doc)}::jsonb)
      on conflict (id) do nothing`.execute(db);
    return Number(created.numAffectedRows ?? 0)
      ? { ok: true }
      : { ok: false, status: 403, message: "You don't have access to this workspace." };
  }
  if (access.role === "viewer") return { ok: false, status: 403, message: "Viewers can't make changes." };

  if (access.role === "staff") {
    // Staff edit records and page text only; the blueprint, history and settings stay as the owner left them.
    const records: DataRecord[] = doc.records;
    const docs = doc.docs && typeof doc.docs === "object" ? doc.docs : {};
    await sql`update workspace set doc = jsonb_set(jsonb_set(doc, '{records}', ${JSON.stringify(records)}::jsonb), '{docs}', ${JSON.stringify(docs)}::jsonb), updated_at = now()
      where id = ${ws.slug}`.execute(db);
    return { ok: true };
  }

  await db.transaction().execute(async (trx) => {
    await sql`update workspace set doc = ${JSON.stringify(doc)}::jsonb, updated_at = now() where id = ${ws.slug}`.execute(
      trx,
    );
    // The team: managers can change roles and remove people; joining only happens by accepting an invite.
    const keep = (ws.members ?? []).filter((m) => m.accountId !== access.ownerId);
    const keepIds = keep.map((m) => m.accountId);
    await sql`delete from workspace_member where workspace_id = ${ws.slug} and not (user_id = any(${keepIds}))`.execute(
      trx,
    );
    for (const m of keep)
      await sql`update workspace_member set role = ${m.role} where workspace_id = ${ws.slug} and user_id = ${m.accountId}`.execute(
        trx,
      );
    const invites: Invite[] = ws.invites ?? [];
    const tokens = invites.map((i) => i.token);
    await sql`delete from workspace_invite where workspace_id = ${ws.slug} and not (token = any(${tokens}))`.execute(
      trx,
    );
    for (const i of invites)
      await sql`insert into workspace_invite (token, workspace_id, email, role, invited_by, invited_at)
        values (${i.token}, ${ws.slug}, ${i.email.toLowerCase()}, ${i.role}, ${i.invitedBy}, ${i.invitedAt})
        on conflict (token) do update set role = excluded.role`.execute(trx);
  });
  return { ok: true };
}

/** Owners delete the workspace; members leave it. */
export async function removeWorkspace(userId: string, id: string): Promise<SaveResult> {
  const access = await roleIn(id, userId);
  if (!access) return { ok: false, status: 404, message: "Workspace not found." };
  if (access.role === "owner") await sql`delete from workspace where id = ${id}`.execute(db);
  else await sql`delete from workspace_member where workspace_id = ${id} and user_id = ${userId}`.execute(db);
  return { ok: true };
}

export type InviteInfo = {
  workspaceId: string;
  workspaceName: string;
  ownerId: string;
  email: string;
  role: MemberRole;
  invitedBy: string;
};

export async function findInvite(token: string): Promise<InviteInfo | null> {
  const { rows } = await sql<{
    workspace_id: string;
    email: string;
    role: MemberRole;
    invited_by: string;
    owner_id: string;
    name: string;
  }>`
    select i.workspace_id, i.email, i.role, i.invited_by, w.owner_id, w.doc->>'name' as name
    from workspace_invite i join workspace w on w.id = i.workspace_id where i.token = ${token}`.execute(db);
  const r = rows[0];
  return r
    ? {
        workspaceId: r.workspace_id,
        workspaceName: r.name,
        ownerId: r.owner_id,
        email: r.email,
        role: r.role,
        invitedBy: r.invited_by,
      }
    : null;
}

export async function acceptInvite(
  token: string,
  user: { id: string; email: string },
): Promise<{ ok: true; workspaceId: string } | { ok: false; message: string }> {
  const invite = await findInvite(token);
  if (!invite) return { ok: false, message: "This invite is no longer valid." };
  if (invite.ownerId === user.id) return { ok: false, message: "You already own this workspace." };
  if (invite.email !== user.email.toLowerCase())
    return {
      ok: false,
      message: `This invite was sent to ${invite.email}. Sign in with that account to join.`,
    };
  await db.transaction().execute(async (trx) => {
    await sql`insert into workspace_member (workspace_id, user_id, role) values (${invite.workspaceId}, ${user.id}, ${invite.role})
      on conflict (workspace_id, user_id) do update set role = excluded.role`.execute(trx);
    await sql`delete from workspace_invite where token = ${token}`.execute(trx);
  });
  return { ok: true, workspaceId: invite.workspaceId };
}

/** Seeds or refreshes a demo workspace template (scripts/db-seed.ts). */
export async function upsertWorkspaceTemplate(t: {
  id: string;
  name: string;
  summary: string;
  sourceSystemId?: string;
  sort: number;
  data: WorkspaceData;
  builtOn: string;
}) {
  await sql`insert into workspace_template (id, name, summary, source_system_id, doc, sort)
    values (${t.id}, ${t.name}, ${t.summary}, ${t.sourceSystemId ?? null}, ${JSON.stringify({ ...t.data, builtOn: t.builtOn })}::jsonb, ${t.sort})
    on conflict (id) do update set name = excluded.name, summary = excluded.summary, source_system_id = excluded.source_system_id,
      doc = excluded.doc, sort = excluded.sort, updated_at = now()`.execute(db);
}

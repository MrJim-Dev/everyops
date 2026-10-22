import "server-only";
import { sql } from "kysely";
import { notesFromSetup } from "@/lib/assistant/memory";
import type { Blueprint, DataRecord, WorkspaceData } from "@/lib/blueprint/types";
import { freshSample } from "@/lib/catalog/shift";
import { renumberTaken } from "@/lib/engine/sequence";
import { htmlDocKeys } from "@/lib/public/html-page";
import {
  type ChangeEntry,
  type Invite,
  importedIds,
  type Member,
  type MemberRole,
  mergeStaffChanges,
  newWorkspaceId,
  type Role,
  toDoc,
  type Workspace,
  workspaceFrom,
} from "@/lib/store/workspace-model";
import type { PatchResult, WorkspaceMeta, WorkspacePatch } from "@/lib/store/workspace-sync";
import { logActivity, personActor, recordActor, recordEntries } from "./activity";
import { deliverSoon, fireOnSave, logSaveRuns } from "./automations";
import { db } from "./db";
import { inviteEmail } from "./emails";
import { appUrl, sendMail } from "./mail";
import { hasEndpoints, queueChanges, queueEvents, sendSoon } from "./webhooks";
import {
  currentBlueprint,
  deleteRecords,
  metaFrom,
  putRecords,
  readRecords,
  readWorkspace,
  writeChanges,
  writeContent,
  writePages,
} from "./workspace-data";
import { applyEditsIn } from "./workspace-memory";
import { enterZone } from "./zone";

const ID = /^[a-z0-9][a-z0-9-]{1,79}$/;
/** Largest save accepted. Saves are patches now; only creating a big workspace comes close. */
export const MAX_PATCH_BYTES = 4_000_000;

export type SaveResult = { ok: true } | { ok: false; status: number; message: string };

type Row = { id: string; owner_id: string; doc: WorkspaceMeta; owner_name: string; owner_email: string };

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

/**
 * Creates the demo workspaces from the starter templates, once per account. The marker and the workspaces commit
 * together, so a failed seed is tried again on the next load instead of leaving the account empty.
 */
async function seedIfNew(userId: string) {
  const seeded = await sql`select 1 from account_seed where user_id = ${userId}`.execute(db);
  if (seeded.rows.length) return;
  const { rows } = await sql<{
    id: string;
    name: string;
    summary: string;
    source_system_id: string | null;
    doc: WorkspaceData & { builtOn: string };
  }>`select * from workspace_template order by sort`.execute(db);
  const now = new Date();
  await db.transaction().execute(async (trx) => {
    const inserted =
      await sql`insert into account_seed (user_id) values (${userId}) on conflict do nothing`.execute(trx);
    if (!Number(inserted.numAffectedRows ?? 0)) return;
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
      const doc = toDoc(ws);
      await sql`insert into workspace (id, owner_id, doc) values (${ws.slug}, ${userId}, ${JSON.stringify(metaFrom(doc))}::jsonb)`.execute(
        trx,
      );
      await writeContent(trx, ws.slug, doc);
    }
  });
}

/** One workspace's team and pending invites, for owners and admins (the assistant uses it for team changes). */
/** The workspaces someone can open, with their role in each: light enough for every API call. */
export async function accessibleWorkspaces(
  userId: string,
): Promise<{ id: string; name: string; role: Role; ownerId: string }[]> {
  const { rows } = await sql<{ id: string; name: string; owner_id: string; role: MemberRole | null }>`
    select w.id, w.doc->>'name' as name, w.owner_id, m.role
    from workspace w left join workspace_member m on m.workspace_id = w.id and m.user_id = ${userId}
    where w.owner_id = ${userId} or m.user_id is not null
    order by w.doc->>'name'`.execute(db);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    ownerId: r.owner_id,
    role: r.owner_id === userId ? "owner" : (r.role as Role),
  }));
}

export async function loadTeam(workspaceId: string): Promise<{ members: Member[]; invites: Invite[] }> {
  const members = await sql<{
    user_id: string;
    role: MemberRole;
    joined_at: Date;
    name: string;
    email: string;
  }>`
    select m.user_id, m.role, m.joined_at, u.name, u.email
    from workspace_member m join "user" u on u.id = m.user_id where m.workspace_id = ${workspaceId}`.execute(
    db,
  );
  const invites = await sql<{
    token: string;
    email: string;
    role: MemberRole;
    invited_by: string;
    invited_at: Date;
  }>`
    select token, email, role, invited_by, invited_at from workspace_invite where workspace_id = ${workspaceId}`.execute(
    db,
  );
  return {
    members: members.rows.map((m) => ({
      accountId: m.user_id,
      name: m.name,
      email: m.email,
      role: m.role,
      joinedAt: m.joined_at.toISOString(),
    })),
    invites: invites.rows.map((i) => ({
      token: i.token,
      email: i.email,
      role: i.role,
      invitedBy: i.invited_by,
      invitedAt: i.invited_at.toISOString(),
    })),
  };
}

/**
 * Everything the account can open: its own workspaces and the ones it was invited to, as summaries (settings,
 * current blueprint, team, record counts, latest change). Records and history load when a workspace opens.
 */
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
  const [members, invites, blueprints, counts, latest] = await Promise.all([
    sql<{
      workspace_id: string;
      user_id: string;
      role: MemberRole;
      joined_at: Date;
      name: string;
      email: string;
    }>`
      select m.workspace_id, m.user_id, m.role, m.joined_at, u.name, u.email
      from workspace_member m join "user" u on u.id = m.user_id
      where m.workspace_id = any(${ids})`.execute(db),
    sql<{
      workspace_id: string;
      token: string;
      email: string;
      role: MemberRole;
      invited_by: string;
      invited_at: Date;
    }>`select * from workspace_invite where workspace_id = any(${ids})`.execute(db),
    sql<{ workspace_id: string; blueprint: Blueprint }>`
      select v.workspace_id, v.blueprint from workspace w
      join workspace_version v on v.workspace_id = w.id and v.version = (w.doc->>'currentVersion')::int
      where w.id = any(${ids})`.execute(db),
    sql<{ workspace_id: string; records: number; this_week: number }>`
      select workspace_id, count(*)::int as records,
        (count(*) filter (where created_at > now() - interval '7 days'))::int as this_week
      from workspace_record where workspace_id = any(${ids}) group by workspace_id`.execute(db),
    // The latest change that wasn't undone, without the records and page text it keeps for undo.
    sql<{ workspace_id: string; entry: ChangeEntry }>`
      select distinct on (workspace_id) workspace_id,
        entry - 'recordChanges' - 'replacedRecords' - 'removedRecords' - 'replacedDocs' - 'teamBefore' - 'createdRecordIds' as entry
      from workspace_change where workspace_id = any(${ids}) and not entry ? 'undoneAt'
      order by workspace_id, applied_at desc`.execute(db),
  ]);
  const bp = new Map(blueprints.rows.map((b) => [b.workspace_id, b.blueprint]));
  const count = new Map(counts.rows.map((c) => [c.workspace_id, c]));
  const last = new Map(latest.rows.map((c) => [c.workspace_id, { ...c.entry, recordChanges: [] }]));

  return rows.flatMap((r) => {
    const current = bp.get(r.id);
    if (!current) return [];
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
    const lastChange = last.get(r.id);
    return [
      {
        ...metaFrom(r.doc),
        slug: r.id,
        loaded: false,
        versions: [],
        current,
        records: [],
        changes: lastChange ? [lastChange] : [],
        stats: { records: count.get(r.id)?.records ?? 0, recordsThisWeek: count.get(r.id)?.this_week ?? 0 },
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
      } satisfies Workspace,
    ];
  });
}

/** One workspace the caller can open, whole, with their role and each record's rev. */
export async function loadWorkspace(
  id: string,
  userId: string,
): Promise<{ workspace: Workspace; role: Role; revs: Record<string, number> } | null> {
  if (!ID.test(id)) return null;
  const access = await roleIn(id, userId);
  if (!access) return null;
  const found = await readWorkspace(db, id);
  if (!found) return null;
  // The team comes too: the browser replaces its summary with this copy and reads a member's role from it, so
  // without it staff and admins could only view a workspace once it opened.
  const team = await loadTeam(id);
  const manager = access.role === "owner" || access.role === "admin";
  return {
    workspace: {
      ...found.doc,
      slug: id,
      syncedAt: found.syncedAt,
      ownerId: access.ownerId,
      members: team.members,
      invites: manager ? team.invites : [],
      loaded: true,
    },
    role: access.role,
    revs: found.revs,
  };
}

class Conflict extends Error {
  constructor(readonly result: Extract<PatchResult, { ok: false }>) {
    super(result.message);
  }
}

/**
 * Saves what changed in a workspace (see workspace-sync.ts). Owners and admins save everything; staff save records,
 * page text (not custom HTML, which is shown to the public) and data-only history; viewers can't save. A patch
 * marked create for an id nobody has makes a new workspace owned by the caller. Records are checked by rev: if
 * anyone saved one since the browser read it, nothing is saved and the conflicting ids come back to be merged.
 */
export async function patchWorkspace(
  userId: string,
  slug: string,
  patch: WorkspacePatch,
  options: { demo?: boolean } = {},
): Promise<PatchResult> {
  if (!ID.test(slug)) return { ok: false, status: 400, message: "Invalid workspace id." };
  let access = await roleIn(slug, userId);
  if (!access) {
    if (!patch.create || !patch.meta || !patch.versions?.length)
      return { ok: false, status: 404, message: "Workspace not found." };
    const created = await sql`insert into workspace (id, owner_id, doc)
      values (${slug}, ${userId}, ${JSON.stringify(metaFrom(patch.meta))}::jsonb) on conflict (id) do nothing`.execute(
      db,
    );
    if (!Number(created.numAffectedRows ?? 0))
      return { ok: false, status: 403, message: "You don't have access to this workspace." };
    access = { role: "owner", ownerId: userId };
  }
  if (access.role === "viewer") return { ok: false, status: 403, message: "Viewers can't make changes." };
  const manager = access.role === "owner" || access.role === "admin";
  const ownerId = access.ownerId;

  const newInvites: Invite[] = [];
  let revs: Record<string, number> = {};
  let updated: DataRecord[] = [];
  let emailRuns: number[] = [];
  let hooks = 0;
  try {
    await db.transaction().execute(async (trx) => {
      // One save at a time per workspace (public bookings take the same lock); each is a few rows now.
      const { rows } = await sql<{
        doc: WorkspaceMeta;
      }>`select doc from workspace where id = ${slug} for update`.execute(trx);
      const stored = rows[0]?.doc;
      if (!stored) throw new Conflict({ ok: false, status: 404, message: "Workspace not found." });

      if (manager && patch.versions?.length) {
        for (const v of patch.versions) {
          const added = await sql`insert into workspace_version (workspace_id, version, blueprint)
            values (${slug}, ${v.version}, ${JSON.stringify(v.blueprint)}::jsonb) on conflict do nothing`.execute(
            trx,
          );
          if (Number(added.numAffectedRows ?? 0)) continue;
          const same = await sql<{
            same: boolean;
          }>`select blueprint = ${JSON.stringify(v.blueprint)}::jsonb as same
            from workspace_version where workspace_id = ${slug} and version = ${v.version}`.execute(trx);
          if (!same.rows[0]?.same)
            throw new Conflict({
              ok: false,
              status: 409,
              message: "Someone else changed this workspace's design. Reload to see their version.",
              reload: true,
            });
        }
      }
      let currentVersion = stored.currentVersion;
      if (manager && patch.meta) {
        const known = await sql<{ n: number }>`select count(*)::int as n from workspace_version
          where workspace_id = ${slug} and version = ${patch.meta.currentVersion}`.execute(trx);
        if (!known.rows[0]?.n)
          throw new Conflict({
            ok: false,
            status: 400,
            message: "That version of the workspace doesn't exist.",
          });
        currentVersion = patch.meta.currentVersion;
        if (currentVersion !== stored.currentVersion)
          await logActivity(trx, personActor(userId), {
            workspaceId: slug,
            action: "design.version",
            target: `v${currentVersion}`,
            count: 1,
            detail: `Version ${stored.currentVersion} → ${currentVersion}`,
          });
        if (currentVersion !== stored.currentVersion)
          hooks += await queueEvents(trx, slug, [
            {
              type: "change.applied",
              recordType: null,
              data: { fromVersion: stored.currentVersion, toVersion: currentVersion },
            },
          ]);
        await sql`update workspace set doc = ${JSON.stringify(metaFrom(patch.meta))}::jsonb where id = ${slug}`.execute(
          trx,
        );
        // Setup is cleared when the workspace is created from it. What the interview learned about the business
        // goes into the assistant's memory first, so the assistant knows the business from the first message.
        if (stored.setup && !patch.meta.setup)
          await applyEditsIn(trx, slug, notesFromSetup(stored.setup, patch.meta.summary), "setup");
      }

      if (patch.records) {
        // New records whose sequence number another device took a moment ago (two registers, both "#1251") get the
        // next free one. The workspace row is locked, so every number in use is visible here.
        let puts = patch.records.put;
        const fresh = puts.filter((p) => p.rev === null).map((p) => p.record);
        const bp = fresh.length ? await currentBlueprint(trx, slug) : undefined;
        enterZone(bp);
        if (bp) {
          const types = [...new Set(fresh.map((r) => r.entityId))];
          const { rows } = await sql<{ id: string; entity_id: string; data: DataRecord["data"] }>`
            select id, entity_id, data from workspace_record
            where workspace_id = ${slug} and entity_id = any(${types}::text[])`.execute(trx);
          const stored = rows.map((r) => ({
            id: r.id,
            entityId: r.entity_id,
            data: r.data,
            createdAt: "",
            updatedAt: "",
          }));
          const numbered = renumberTaken(bp, stored, fresh);
          if (numbered.changed.length) {
            const byId = new Map(numbered.changed.map((r) => [r.id, r]));
            puts = puts.map((p) =>
              byId.has(p.record.id) ? { ...p, record: byId.get(p.record.id) as DataRecord } : p,
            );
            updated = numbered.changed;
          }
        }
        // Automations that fire on a save are logged (and their emails queued) with the save itself.
        const rulesBp = await currentBlueprint(trx, slug);
        enterZone(rulesBp);
        const watching = fireOnSave(rulesBp);
        // Webhooks need each changed record's previous values too (changed fields, status changes).
        const hooked = await hasEndpoints(trx, slug);
        const editIds = puts.filter((p) => p.rev !== null).map((p) => p.record.id);
        const beforeEdit = new Map<string, DataRecord>();
        if ((watching || hooked) && editIds.length) {
          const { rows } = await sql<{ id: string; entity_id: string; data: DataRecord["data"] }>`
            select id, entity_id, data from workspace_record
            where workspace_id = ${slug} and id = any(${editIds}::text[])`.execute(trx);
          for (const r of rows)
            beforeEdit.set(r.id, {
              id: r.id,
              entityId: r.entity_id,
              data: r.data,
              createdAt: "",
              updatedAt: "",
            });
        }
        const deleteIds = patch.records.delete.map((d) => d.id);
        const deleting = deleteIds.length
          ? (
              await sql<{ id: string; entity_id: string; data: DataRecord["data"] }>`
                select id, entity_id, data from workspace_record
                where workspace_id = ${slug} and id = any(${deleteIds}::text[])`.execute(trx)
            ).rows.map(
              (r): DataRecord => ({
                id: r.id,
                entityId: r.entity_id,
                data: r.data,
                createdAt: "",
                updatedAt: "",
              }),
            )
          : [];
        const put = await putRecords(trx, slug, puts, await recordActor(trx, personActor(userId)));
        const conflicts = [...put.conflicts, ...(await deleteRecords(trx, slug, patch.records.delete))];
        if (conflicts.length)
          throw new Conflict({
            ok: false,
            status: 409,
            message: "Someone else changed these records. Merging their changes.",
            conflicts,
          });
        revs = put.revs;
        await logActivity(trx, personActor(userId), recordEntries(slug, puts, deleting));
        // Records an import in this save added or changed are data that already happened: the browser didn't run
        // the save automations on them (applyImportOps), and neither does the server, so old bookings don't email.
        // They don't send webhooks either, so a 2,000-row import doesn't flood an integration.
        const imported = importedIds(patch.changes);
        const watched = imported.size ? puts.filter((p) => !imported.has(p.record.id)) : puts;
        if (hooked && rulesBp)
          hooks += await queueChanges(trx, slug, rulesBp, [
            ...watched
              .filter((p) => p.rev === null || beforeEdit.has(p.record.id))
              .map((p) => ({
                before: p.rev === null ? undefined : beforeEdit.get(p.record.id),
                after: p.record,
              })),
            ...deleting.map((d) => ({ before: d })),
          ]);
        if (watching && rulesBp && watched.length) {
          const changes = watched.map((p) => ({ before: beforeEdit.get(p.record.id), after: p.record }));
          const records = (await readRecords(trx, slug)).map((s) => s.record);
          emailRuns = await logSaveRuns(trx, slug, rulesBp, changes, records, "save");
        }
      }

      if (patch.pages && Object.keys(patch.pages).length) {
        const pages = { ...patch.pages };
        if (!manager) {
          // Custom HTML (pages and HTML blocks) is code shown to the public: owners and admins only.
          const bp = await currentBlueprint(trx, slug);
          for (const key of bp ? htmlDocKeys(bp) : []) delete pages[key];
        }
        await writePages(trx, slug, pages);
        await logActivity(
          trx,
          personActor(userId),
          Object.entries(pages).map(([key, d]) => ({
            workspaceId: slug,
            action: "page.update" as const,
            target: key,
            count: 1,
            ...(d ? {} : { detail: "removed" }),
          })),
        );
      }

      if (patch.changes?.length) {
        if (manager) await writeChanges(trx, slug, patch.changes);
        else {
          // Staff add data-only entries at the current version and mark such entries undone; nothing else.
          const ids = patch.changes.map((c) => c.id);
          const known = await sql<{ entry: ChangeEntry }>`select entry from workspace_change
            where workspace_id = ${slug} and id = any(${ids}::text[])`.execute(trx);
          const before = known.rows.map((k) => k.entry);
          const merged = mergeStaffChanges(before, patch.changes, currentVersion);
          const was = new Map(before.map((c) => [c.id, JSON.stringify(c)]));
          await writeChanges(
            trx,
            slug,
            merged.filter((c) => was.get(c.id) !== JSON.stringify(c)),
          );
        }
      }

      if (manager && patch.team) {
        // The team: managers can change roles and remove people; joining only happens by accepting an invite.
        const keep = patch.team.members.filter((m) => m.accountId !== ownerId);
        const keepIds = keep.map((m) => m.accountId);
        await sql`delete from workspace_member where workspace_id = ${slug} and not (user_id = any(${keepIds}))`.execute(
          trx,
        );
        for (const m of keep)
          await sql`update workspace_member set role = ${m.role} where workspace_id = ${slug} and user_id = ${m.accountId}`.execute(
            trx,
          );
        const tokens = patch.team.invites.map((i) => i.token);
        await sql`delete from workspace_invite where workspace_id = ${slug} and not (token = any(${tokens}))`.execute(
          trx,
        );
        for (const i of patch.team.invites) {
          // The shared demo account can't invite anyone, so nobody can use it to send email.
          if (options.demo) continue;
          // xmax = 0 only for a freshly inserted row, so each invite is emailed once, not on every save.
          const { rows: ins } = await sql<{
            inserted: boolean;
          }>`insert into workspace_invite (token, workspace_id, email, role, invited_by, invited_at)
            values (${i.token}, ${slug}, ${i.email.toLowerCase()}, ${i.role}, ${i.invitedBy}, ${i.invitedAt})
            on conflict (token) do update set role = excluded.role
            returning (xmax = 0) as inserted`.execute(trx);
          if (ins[0]?.inserted) newInvites.push(i);
        }
      }
      await sql`update workspace set updated_at = now() where id = ${slug}`.execute(trx);
    });
  } catch (e) {
    if (e instanceof Conflict) return e.result;
    throw e;
  }
  // After the commit, so an email never points at an invite that was rolled back. The sender's name
  // comes from their account, not from the browser.
  if (newInvites.length) {
    const [sender, name] = await Promise.all([
      sql<{ name: string }>`select name from "user" where id = ${userId}`.execute(db),
      sql<{ name: string }>`select doc->>'name' as name from workspace where id = ${slug}`.execute(db),
    ]);
    await Promise.all(
      newInvites.map((i) =>
        sendMail(
          inviteEmail({
            to: i.email.toLowerCase(),
            workspaceName: name.rows[0]?.name ?? "a workspace",
            invitedBy: sender.rows[0]?.name ?? i.invitedBy,
            role: i.role,
            url: appUrl(
              `/invite/${encodeURIComponent(i.token)}?email=${encodeURIComponent(i.email.toLowerCase())}`,
            ),
          }),
        ),
      ),
    );
  }
  deliverSoon(emailRuns);
  sendSoon(hooks);
  return { ok: true, revs, ...(updated.length ? { updated } : {}) };
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

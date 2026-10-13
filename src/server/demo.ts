import "server-only";
import { sql } from "kysely";
import { DEMO_ACCOUNT } from "@/lib/auth/demo";
import { db } from "./db";

async function demoUserId(): Promise<string | undefined> {
  const { rows } = await sql<{
    id: string;
  }>`select id from "user" where lower(email) = ${DEMO_ACCOUNT.email}`.execute(db);
  return rows[0]?.id;
}

/** Saves the demo account's current workspaces as the state the nightly reset returns to. */
export async function snapshotDemoAccount() {
  const id = await demoUserId();
  if (!id) return { ok: false as const, message: "Demo account not found." };
  return db.transaction().execute(async (trx) => {
    await sql`delete from demo_snapshot`.execute(trx);
    const saved =
      await sql`insert into demo_snapshot (workspace_id, doc) select id, doc from workspace where owner_id = ${id}`.execute(
        trx,
      );
    return { ok: true as const, workspaces: Number(saved.numAffectedRows ?? 0) };
  });
}

/**
 * Puts the shared demo account back to its saved snapshot: workspaces return to their saved content,
 * workspaces added since are removed, and other people's memberships, invites, publications and the
 * demo's sessions are cleared. Without a snapshot, the default demo workspaces are seeded again.
 */
export async function resetDemoAccount() {
  const id = await demoUserId();
  if (!id) return { ok: false as const, message: "Demo account not found." };
  return db.transaction().execute(async (trx) => {
    const run = async (q: ReturnType<typeof sql>) => Number((await q.execute(trx)).numAffectedRows ?? 0);
    const snapshot = Number(
      (await sql<{ n: number }>`select count(*)::int as n from demo_snapshot`.execute(trx)).rows[0]?.n ?? 0,
    );
    let removed: number;
    let restored = 0;
    if (snapshot) {
      removed = await run(
        sql`delete from workspace where owner_id = ${id} and id not in (select workspace_id from demo_snapshot)`,
      );
      restored = await run(sql`insert into workspace (id, owner_id, doc)
        select workspace_id, ${id}, doc from demo_snapshot
        on conflict (id) do update set doc = excluded.doc, updated_at = now() where workspace.owner_id = ${id}`);
      await run(
        sql`delete from workspace_member where workspace_id in (select id from workspace where owner_id = ${id})`,
      );
      await run(
        sql`delete from workspace_invite where workspace_id in (select id from workspace where owner_id = ${id})`,
      );
    } else {
      removed = await run(sql`delete from workspace where owner_id = ${id}`);
      // Without the seed marker, the next workspace list creates fresh demo workspaces.
      await run(sql`delete from account_seed where user_id = ${id}`);
    }
    const result = {
      ok: true as const,
      mode: snapshot ? ("snapshot" as const) : ("defaults" as const),
      removed,
      restored,
      publications: await run(sql`delete from published_system where author_id = ${id}`),
      memberships: await run(sql`delete from workspace_member where user_id = ${id}`),
      sessions: await run(sql`delete from session where "userId" = ${id}`),
    };
    await sql`update "user" set name = ${DEMO_ACCOUNT.name}, "updatedAt" = now() where id = ${id}`.execute(
      trx,
    );
    return result;
  });
}

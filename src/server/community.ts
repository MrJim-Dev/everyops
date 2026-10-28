import "server-only";
import { sql } from "kysely";
import { DEMO_ACCOUNT } from "@/lib/auth/demo";
import type { Blueprint, DataRecord, IconName } from "@/lib/blueprint/types";
import type { CatalogCategory } from "@/lib/catalog";
import type { TemplateUsage } from "@/lib/community/usage";
import { slugify } from "@/lib/store/workspace-model";
import { db } from "./db";

/** A community system as stored: the blueprint, listing details, and optional sample data. */
export type CommunityDoc = {
  name: string;
  summary: string;
  category: CatalogCategory;
  icon: IconName;
  author: string;
  license: "MIT" | "Apache-2.0";
  version: string;
  uses: number;
  includes: string[];
  blueprint: Blueprint;
  /** Official templates ship sample records; user-published systems never carry data. */
  sample?: { records: DataRecord[]; builtOn: string };
};

export type CommunitySystem = CommunityDoc & {
  id: string;
  official: boolean;
  authorId: string | null;
  sourceWorkspaceId: string | null;
  publishedAt: string;
  updatedAt: string;
} & TemplateUsage;

type Row = {
  id: string;
  author_id: string | null;
  source_workspace_id: string | null;
  is_official: boolean;
  doc: CommunityDoc;
  published_at: Date;
  updated_at: Date;
  /** How it's used, counted live (see USAGE). */
  uses?: number;
  active?: number;
  recent?: number;
};

const toSystem = (r: Row): CommunitySystem => ({
  ...r.doc,
  // Only real use counts; the stored figure was a placeholder.
  uses: Number(r.uses ?? 0),
  active: Number(r.active ?? 0),
  recent: Number(r.recent ?? 0),
  id: r.id,
  official: r.is_official,
  authorId: r.author_id,
  sourceWorkspaceId: r.source_workspace_id,
  publishedAt: r.published_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
});

/**
 * How each community system is used (see TemplateUsage), from the workspaces whose source names it. Starter
 * workspaces don't count: every new account gets them without choosing anything. They're marked via "starter";
 * older ones are the workspaces written in the same transaction as the account's seed marker (the same now()).
 * Nor do a system's own source workspace (what it was built and published from) or anything in the shared demo
 * account, whose data resets every night.
 */
const USAGE = sql`
  with built as (
    select w.id, w.created_at, w.doc->'source'->>'systemId' as system_id
    from workspace w
    where w.doc->'source'->>'systemId' is not null
      and coalesce(w.doc->'source'->>'via', '') <> 'starter'
      and not exists (select 1 from published_system p where p.source_workspace_id = w.id)
      and not exists (select 1 from "user" u where u.id = w.owner_id and lower(u.email) = ${DEMO_ACCOUNT.email})
      and not (
        w.doc->'source'->>'via' is null
        and exists (
          select 1 from account_seed s
          where s.user_id = w.owner_id and w.created_at between s.seeded_at - interval '5 seconds' and s.seeded_at + interval '5 seconds'
        )
      )
  )
  select system_id,
    count(*)::int as uses,
    count(*) filter (where exists (
      select 1 from workspace_record r
      where r.workspace_id = built.id and r.changed_at > now() - interval '30 days'
        and r.changed_at > built.created_at + interval '1 day'
    ))::int as active,
    count(*) filter (where built.created_at > now() - interval '30 days')::int as recent
  from built group by system_id`;

export async function listCommunity(): Promise<CommunitySystem[]> {
  const { rows } = await sql<Row>`
    with usage as (${USAGE})
    select p.*, u.uses, u.active, u.recent
    from published_system p left join usage u on u.system_id = p.id
    order by p.is_official asc, p.published_at desc`.execute(db);
  return rows.map(toSystem);
}

export async function getCommunity(id: string): Promise<CommunitySystem | null> {
  const { rows } = await sql<Row>`
    with usage as (${USAGE})
    select p.*, u.uses, u.active, u.recent
    from published_system p left join usage u on u.system_id = p.id
    where p.id = ${id}`.execute(db);
  return rows[0] ? toSystem(rows[0]) : null;
}

const bump = (version: string) => {
  const [major, minor] = version.split(".").map(Number);
  return `${major}.${(minor || 0) + 1}`;
};

export async function publishSystem(
  authorId: string,
  sourceWorkspaceId: string,
  doc: Omit<CommunityDoc, "version" | "uses" | "sample">,
) {
  const base = slugify(doc.name);
  const id = `${base}-${authorId.slice(-4).toLowerCase()}-${Date.now().toString(36).slice(-3)}`;
  const full: CommunityDoc = { ...doc, version: "1.0", uses: 0 };
  await sql`insert into published_system (id, author_id, source_workspace_id, doc)
    values (${id}, ${authorId}, ${sourceWorkspaceId}, ${JSON.stringify(full)}::jsonb)`.execute(db);
  return getCommunity(id);
}

export async function updateSystem(
  id: string,
  authorId: string,
  patch: Omit<CommunityDoc, "version" | "uses" | "sample">,
) {
  const current = await getCommunity(id);
  if (!current || current.official || current.authorId !== authorId) return null;
  const doc: CommunityDoc = { ...patch, version: bump(current.version), uses: current.uses };
  await sql`update published_system set doc = ${JSON.stringify(doc)}::jsonb, updated_at = now() where id = ${id}`.execute(
    db,
  );
  return getCommunity(id);
}

export async function unpublishSystem(id: string, authorId: string) {
  const { numAffectedRows } = await sql`delete from published_system
    where id = ${id} and author_id = ${authorId} and not is_official`.execute(db);
  return Number(numAffectedRows ?? 0) > 0;
}

/**
 * Seeds or refreshes an official template (scripts/db-seed.ts). An official system built in the demo account
 * (source_workspace_id set) is kept as it is: its blueprint and samples come from that workspace, not the catalog.
 */
export async function upsertOfficial(id: string, doc: CommunityDoc) {
  await sql`insert into published_system (id, author_id, is_official, doc)
    values (${id}, null, true, ${JSON.stringify(doc)}::jsonb)
    on conflict (id) do update set doc = excluded.doc, is_official = true, updated_at = now()
    where published_system.source_workspace_id is null`.execute(db);
}

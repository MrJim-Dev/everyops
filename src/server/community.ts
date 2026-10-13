import "server-only";
import { sql } from "kysely";
import type { Blueprint, DataRecord, IconName } from "@/lib/blueprint/types";
import type { CatalogCategory } from "@/lib/catalog";
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
};

type Row = {
  id: string;
  author_id: string | null;
  source_workspace_id: string | null;
  is_official: boolean;
  doc: CommunityDoc;
  published_at: Date;
  updated_at: Date;
};

const toSystem = (r: Row): CommunitySystem => ({
  ...r.doc,
  id: r.id,
  official: r.is_official,
  authorId: r.author_id,
  sourceWorkspaceId: r.source_workspace_id,
  publishedAt: r.published_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
});

export async function listCommunity(): Promise<CommunitySystem[]> {
  const { rows } = await sql<Row>`
    select * from published_system order by is_official asc, published_at desc`.execute(db);
  return rows.map(toSystem);
}

export async function getCommunity(id: string): Promise<CommunitySystem | null> {
  const { rows } = await sql<Row>`select * from published_system where id = ${id}`.execute(db);
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

/** Seeds or refreshes an official template (scripts/db-seed.ts). */
export async function upsertOfficial(id: string, doc: CommunityDoc) {
  await sql`insert into published_system (id, author_id, is_official, doc)
    values (${id}, null, true, ${JSON.stringify(doc)}::jsonb)
    on conflict (id) do update set doc = excluded.doc, is_official = true, updated_at = now()`.execute(db);
}

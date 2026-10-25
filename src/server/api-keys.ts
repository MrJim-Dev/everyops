import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { sql } from "kysely";
import {
  type ApiKeyInfo,
  keyIdOf,
  keyStatus,
  PERMISSIONS,
  type Permission,
  SECRET_PREFIX,
  visiblePrefix,
} from "@/lib/api-keys";
import { apiAllows } from "@/lib/billing/plans";
import { logActivity, personActor } from "./activity";
import { accountPlan } from "./billing/limits";
import { db } from "./db";

/** Most keys one account keeps (revoked ones included until they're cleaned up). */
export const MAX_KEYS = 25;

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const random = (length: number, alphabet = ALPHABET): string => {
  const bytes = randomBytes(length * 2);
  let out = "";
  // Rejection sampling keeps every character equally likely.
  for (const b of bytes) {
    if (out.length === length) break;
    if (b < 256 - (256 % alphabet.length)) out += alphabet[b % alphabet.length];
  }
  return out.length === length ? out : random(length, alphabet);
};

const hashOf = (secret: string) => createHash("sha256").update(secret.trim()).digest("hex");

type Row = {
  id: string;
  user_id: string;
  name: string;
  prefix: string;
  workspaces: string[] | null;
  permissions: string[];
  expires_at: Date | null;
  last_used_at: Date | null;
  last_used_ip: string | null;
  revoked_at: Date | null;
  created_at: Date;
};

const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);
const toInfo = (r: Row): ApiKeyInfo => ({
  id: r.id,
  name: r.name,
  prefix: r.prefix,
  workspaces: r.workspaces,
  permissions: r.permissions.filter((p): p is Permission => (PERMISSIONS as readonly string[]).includes(p)),
  expiresAt: iso(r.expires_at),
  lastUsedAt: iso(r.last_used_at),
  lastUsedIp: r.last_used_ip,
  revokedAt: iso(r.revoked_at),
  createdAt: new Date(r.created_at).toISOString(),
});

export async function listKeys(userId: string): Promise<ApiKeyInfo[]> {
  const { rows } =
    await sql<Row>`select * from api_key where user_id = ${userId} order by created_at desc`.execute(db);
  return rows.map(toInfo);
}

export type NewKey = {
  name: string;
  workspaces: string[] | null;
  permissions: Permission[];
  expiresInDays: number | null;
};

/** Makes a key and returns its secret, the only time it's ever available. */
export async function createKey(
  userId: string,
  input: NewKey,
): Promise<{ ok: true; key: ApiKeyInfo; secret: string } | { ok: false; message: string }> {
  // The plan decides what keys may do: none on Free, reading on Starter, everything from Pro.
  const { plan } = await accountPlan(userId);
  if (plan.limits.api === "none")
    return { ok: false, message: `API keys come with the Starter plan. Upgrade in Account → Plan & usage.` };
  const beyond = input.permissions.filter((p) => !apiAllows(plan.limits.api, p));
  if (beyond.length)
    return {
      ok: false,
      message: `The ${plan.name} plan's keys can only read. Remove ${beyond.join(", ")} or upgrade to Pro.`,
    };
  const { rows: count } = await sql<{ n: number }>`
    select count(*)::int as n from api_key where user_id = ${userId} and revoked_at is null`.execute(db);
  if ((count[0]?.n ?? 0) >= MAX_KEYS)
    return { ok: false, message: `You can have up to ${MAX_KEYS} keys. Revoke one you no longer use.` };
  const id = random(8, "abcdefghijklmnopqrstuvwxyz0123456789");
  const secret = `${SECRET_PREFIX}${id}_${random(32)}`;
  const expires = input.expiresInDays ? new Date(Date.now() + input.expiresInDays * 86_400_000) : null;
  const { rows } = await sql<Row>`
    insert into api_key (id, user_id, name, prefix, hash, workspaces, permissions, expires_at)
    values (${id}, ${userId}, ${input.name}, ${visiblePrefix(id)}, ${hashOf(secret)},
      ${input.workspaces}::text[], ${input.permissions}::text[], ${expires})
    returning *`.execute(db);
  await logActivity(
    db,
    { ...personActor(userId), keyId: id },
    {
      workspaceId: null,
      action: "key.create",
      target: input.name,
      count: 1,
      detail: [
        input.workspaces
          ? `${input.workspaces.length} workspace${input.workspaces.length === 1 ? "" : "s"}`
          : "all workspaces",
        input.permissions.join(", "),
      ].join(" · "),
    },
  );
  return { ok: true, key: toInfo(rows[0]), secret };
}

export async function revokeKey(userId: string, id: string): Promise<boolean> {
  const { rows } = await sql<{ name: string }>`
    update api_key set revoked_at = now() where id = ${id} and user_id = ${userId} and revoked_at is null
    returning name`.execute(db);
  if (rows[0])
    await logActivity(
      db,
      { ...personActor(userId), keyId: id },
      {
        workspaceId: null,
        action: "key.revoke",
        target: rows[0].name,
        count: 1,
      },
    );
  return rows.length > 0;
}

export type VerifiedKey = { key: ApiKeyInfo; user: { id: string; name: string; email: string } };

/**
 * The key a secret belongs to, when it's active. The lookup is by hash, so the secret itself is never compared or
 * stored. Last use (time and IP) is written at most once a minute per key.
 */
export async function verifyKey(secret: string, ip: string | null): Promise<VerifiedKey | null> {
  if (!keyIdOf(secret)) return null;
  const { rows } = await sql<Row & { user_name: string; user_email: string }>`
    select k.*, u.name as user_name, u.email as user_email from api_key k join "user" u on u.id = k.user_id
    where k.hash = ${hashOf(secret)}`.execute(db);
  const row = rows[0];
  if (!row) return null;
  const key = toInfo(row);
  if (keyStatus(key) !== "active") return null;
  if (!row.last_used_at || Date.now() - new Date(row.last_used_at).getTime() > 60_000)
    void sql`update api_key set last_used_at = now(), last_used_ip = ${ip} where id = ${row.id}`
      .execute(db)
      .catch(() => {});
  return { key, user: { id: row.user_id, name: row.user_name, email: row.user_email } };
}

import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { sql } from "kysely";
import {
  canPropose,
  canRead,
  geminiSchema,
  type OutsideAction,
  PROVIDERS,
  type ProviderId,
  splitToolName,
  toolName,
} from "@/lib/connections";
import { type Actor, logActivity, personActor } from "./activity";
import { db } from "./db";
import { appUrl } from "./mail";
import { McpClient, type McpTool } from "./mcp-client";
import { seal, unseal } from "./secret-box";

/**
 * Outside MCP servers connected to a workspace. An owner or admin connects one with Google OAuth (their own account,
 * offline access); the tokens are sealed. Ask EveryOps may call the provider's vetted read tools while it looks things
 * up (owners and admins only, since it's that person's calendar or mail), and may only propose its write tools:
 * those run when an owner or admin presses Apply. Disconnecting deletes the tokens at once and revokes them at Google.
 */

const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const redirectUri = () => appUrl("/api/connections/callback");

const stateKey = () => process.env.BETTER_AUTH_SECRET ?? "";
const mac = (data: string) =>
  createHmac("sha256", stateKey()).update(`connection-state:${data}`).digest("base64url");

export type ConnectState = { w: string; p: ProviderId; u: string; n: string; e: number };

/** A signed, 10-minute state for the OAuth round trip; the nonce also goes in a cookie. */
export function makeState(workspaceId: string, provider: ProviderId, userId: string) {
  const state: ConnectState = {
    w: workspaceId,
    p: provider,
    u: userId,
    n: randomBytes(12).toString("base64url"),
    e: Date.now() + 600_000,
  };
  const data = Buffer.from(JSON.stringify(state)).toString("base64url");
  return { value: `${data}.${mac(data)}`, nonce: state.n };
}

export function readState(value: string | null): ConnectState | null {
  const [data, sig] = (value ?? "").split(".");
  if (!data || !sig) return null;
  const expected = Buffer.from(mac(data));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const state = JSON.parse(Buffer.from(data, "base64url").toString()) as ConnectState;
  return state.e > Date.now() && state.p in PROVIDERS ? state : null;
}

export const googleReady = () => Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

export function authorizeUrl(provider: ProviderId, state: string, email?: string) {
  const q = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: ["openid", "email", ...PROVIDERS[provider].scopes].join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "false",
    state,
    ...(email ? { login_hint: email } : {}),
  });
  return `${GOOGLE_AUTH}?${q}`;
}

type TokenAnswer = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  id_token?: string;
};

async function token(params: Record<string, string>): Promise<TokenAnswer> {
  const res = await fetch(GOOGLE_TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      ...params,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => ({}))) as TokenAnswer & {
    error?: string;
    error_description?: string;
  };
  if (!res.ok) throw new Error(body.error_description ?? body.error ?? `HTTP ${res.status}`);
  return body;
}

/** Finishes the OAuth round trip: exchanges the code and saves the connection (replacing an earlier one). */
export async function completeConnection(state: ConnectState, code: string) {
  const t = await token({ code, grant_type: "authorization_code", redirect_uri: redirectUri() });
  if (!t.refresh_token) throw new Error("Google didn't grant offline access. Try connecting again.");
  const granted = (t.scope ?? "").split(" ");
  const missing = PROVIDERS[state.p].scopes.filter((s) => !granted.includes(s));
  if (missing.length)
    throw new Error("Some permissions were unticked on Google's screen. Connect again and allow them all.");
  // The id token comes straight from Google's token endpoint over TLS, so its payload can be read as is.
  const email = t.id_token
    ? (JSON.parse(Buffer.from(t.id_token.split(".")[1], "base64url").toString()) as { email?: string }).email
    : undefined;
  const id = `wc_${randomBytes(9).toString("base64url")}`;
  await db.transaction().execute(async (trx) => {
    await sql`insert into workspace_connection (id, workspace_id, provider, account_email, access_token, refresh_token,
        expires_at, scopes, created_by)
      values (${id}, ${state.w}, ${state.p}, ${email ?? null}, ${seal(t.access_token)}, ${seal(t.refresh_token as string)},
        ${new Date(Date.now() + t.expires_in * 1000)}, ${granted}::text[], ${state.u})
      on conflict (workspace_id, provider) do update set id = excluded.id, account_email = excluded.account_email,
        access_token = excluded.access_token, refresh_token = excluded.refresh_token, expires_at = excluded.expires_at,
        scopes = excluded.scopes, created_by = excluded.created_by, created_at = now()`.execute(trx);
    await logActivity(trx, personActor(state.u), {
      workspaceId: state.w,
      action: "connection.create",
      target: PROVIDERS[state.p].name,
      count: 1,
      detail: email ?? null,
    });
  });
}

type Row = {
  id: string;
  workspace_id: string;
  provider: ProviderId;
  account_email: string | null;
  access_token: string | null;
  refresh_token: string;
  expires_at: Date | null;
  created_by: string;
  created_at: Date;
};

export type ConnectionInfo = {
  provider: ProviderId;
  accountEmail: string | null;
  connectedBy: string | null;
  connectedAt: string;
};

export async function listConnections(workspaceId: string): Promise<ConnectionInfo[]> {
  const { rows } = await sql<Row & { by: string | null }>`select c.*, u.name as by from workspace_connection c
    left join "user" u on u.id = c.created_by where c.workspace_id = ${workspaceId} order by c.created_at`.execute(
    db,
  );
  return rows
    .filter((r) => r.provider in PROVIDERS)
    .map((r) => ({
      provider: r.provider,
      accountEmail: r.account_email,
      connectedBy: r.by,
      connectedAt: r.created_at.toISOString(),
    }));
}

/** Disconnects: the row (and so every tool) goes at once; the tokens are then revoked at Google. */
export async function disconnect(
  workspaceId: string,
  provider: ProviderId,
  userId: string,
): Promise<boolean> {
  const { rows } =
    await sql<Row>`delete from workspace_connection where workspace_id = ${workspaceId} and provider = ${provider}
    returning *`.execute(db);
  const row = rows[0];
  if (!row) return false;
  await logActivity(db, personActor(userId), {
    workspaceId,
    action: "connection.revoke",
    target: PROVIDERS[provider].name,
    count: 1,
    detail: row.account_email,
  });
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(unseal(row.refresh_token))}`, {
    method: "POST",
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  return true;
}

/** A fresh access token for a connection, refreshing it (and saving the new one) when it's about to expire. */
async function accessToken(row: Row): Promise<string> {
  if (row.access_token && row.expires_at && row.expires_at.getTime() > Date.now() + 60_000)
    return unseal(row.access_token);
  const t = await token({ refresh_token: unseal(row.refresh_token), grant_type: "refresh_token" });
  await sql`update workspace_connection set access_token = ${seal(t.access_token)},
    expires_at = ${new Date(Date.now() + t.expires_in * 1000)} where id = ${row.id}`.execute(db);
  return t.access_token;
}

async function client(row: Row) {
  return new McpClient(PROVIDERS[row.provider].mcpUrl, await accessToken(row)).connect();
}

/** MCP servers for tests and local runs: OUTSIDE_MCP_URL_<PROVIDER> replaces the provider's URL (never in production). */
const override = (provider: ProviderId) =>
  process.env.NODE_ENV !== "production"
    ? process.env[`OUTSIDE_MCP_URL_${provider.toUpperCase()}`]
    : undefined;

async function clientFor(row: Row) {
  const url = override(row.provider);
  return url ? new McpClient(url, "local-test").connect() : client(row);
}

export type OutsideTools = {
  providers: ProviderId[];
  declarations: { name: string; description: string; parametersJsonSchema: unknown }[];
  /** Write tools Ask EveryOps may propose, described for the prompt. */
  proposable: string[];
  run: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  notes: string[];
};

/**
 * The outside read tools a lookup may call, from every connected server (listed live, so a disconnected server's
 * tools are gone at once). Only vetted tools are offered; a server that can't be reached is left out with a note.
 */
export async function outsideTools(workspaceId: string, actor: Actor): Promise<OutsideTools | null> {
  const { rows } =
    await sql<Row>`select * from workspace_connection where workspace_id = ${workspaceId}`.execute(db);
  const live = rows.filter((r) => r.provider in PROVIDERS);
  if (!live.length) return null;
  const clients = new Map<ProviderId, McpClient>();
  const declarations: OutsideTools["declarations"] = [];
  const proposable: string[] = [];
  const notes: string[] = [];
  await Promise.all(
    live.map(async (row) => {
      try {
        const c = await clientFor(row);
        const listed: McpTool[] = await c.listTools();
        clients.set(row.provider, c);
        for (const t of listed) {
          const name = toolName(row.provider, t.name);
          const description = `${PROVIDERS[row.provider].name}: ${(t.description ?? t.name).slice(0, 600)}`;
          if (canRead(row.provider, t.name))
            declarations.push({ name, description, parametersJsonSchema: geminiSchema(t.inputSchema) });
          else if (canPropose(row.provider, t.name))
            proposable.push(
              `- ${name}: ${description} Arguments (JSON schema): ${JSON.stringify(geminiSchema(t.inputSchema)).slice(0, 1500)}`,
            );
        }
      } catch (e) {
        notes.push(
          `${PROVIDERS[row.provider].name} couldn't be reached (${(e as Error).message.slice(0, 160)}).`,
        );
      }
    }),
  );
  const run = async (name: string, args: Record<string, unknown>) => {
    const split = splitToolName(name);
    if (!split || !canRead(split.provider, split.tool)) return { error: `"${name}" isn't an allowed tool.` };
    const c = clients.get(split.provider);
    if (!c) return { error: `${PROVIDERS[split.provider].name} isn't connected.` };
    try {
      const out = await c.callTool(split.tool, args);
      await logActivity(db, actor, {
        workspaceId,
        action: "outside.read",
        target: `${PROVIDERS[split.provider].name} · ${split.tool}`,
        count: 1,
        result: out.isError ? "error" : "ok",
      });
      return out.isError ? { error: out.text.slice(0, 2000) } : { result: out.text.slice(0, 20_000) };
    } catch (e) {
      return { error: (e as Error).message.slice(0, 300) };
    }
  };
  return { providers: [...clients.keys()], declarations, proposable, run, notes };
}

/** Saves the outside writes a lookup proposed (vetted write tools of connected providers only). */
export async function proposeActions(
  workspaceId: string,
  userId: string,
  proposals: { tool: string; arguments: string; summary: string }[],
  connected: ProviderId[],
): Promise<OutsideAction[]> {
  const out: OutsideAction[] = [];
  for (const p of proposals.slice(0, 3)) {
    const split = splitToolName(p.tool);
    if (!split || !connected.includes(split.provider) || !canPropose(split.provider, split.tool)) continue;
    let args: Record<string, unknown>;
    try {
      args = JSON.parse(p.arguments);
      if (!args || typeof args !== "object" || Array.isArray(args)) continue;
    } catch {
      continue;
    }
    const { rows } = await sql<{
      id: string;
    }>`insert into connection_action (workspace_id, provider, tool, args, summary, proposed_by)
      values (${workspaceId}, ${split.provider}, ${split.tool}, ${JSON.stringify(args)}::jsonb, ${p.summary.slice(0, 300)}, ${userId})
      returning id`.execute(db);
    out.push({
      id: Number(rows[0].id),
      provider: split.provider,
      tool: split.tool,
      summary: p.summary.slice(0, 300),
      args,
      status: "proposed",
    });
  }
  return out;
}

export async function listActions(workspaceId: string, limit = 20): Promise<OutsideAction[]> {
  const { rows } = await sql<{
    id: string;
    provider: ProviderId;
    tool: string;
    summary: string;
    args: Record<string, unknown>;
    status: OutsideAction["status"];
    result: string | null;
  }>`
    select * from connection_action where workspace_id = ${workspaceId} order by created_at desc limit ${limit}`.execute(
    db,
  );
  return rows.map((r) => ({
    id: Number(r.id),
    provider: r.provider,
    tool: r.tool,
    summary: r.summary,
    args: r.args,
    status: r.status,
    result: r.result,
  }));
}

/**
 * An owner or admin's decision on a proposed outside write. Apply runs it now through the connected server (the
 * only way an outside write ever runs); Dismiss closes it. Both are logged.
 */
export async function decideAction(
  workspaceId: string,
  actionId: number,
  userId: string,
  decision: "apply" | "dismiss",
): Promise<{ ok: true; action: OutsideAction } | { ok: false; status: number; message: string }> {
  const { rows } = await sql<{
    id: string;
    provider: ProviderId;
    tool: string;
    args: Record<string, unknown>;
    summary: string;
  }>`
    update connection_action set status = ${decision === "apply" ? "applying" : "dismissed"}, decided_by = ${userId}, decided_at = now()
    where id = ${actionId} and workspace_id = ${workspaceId} and status = 'proposed' returning *`.execute(db);
  const a = rows[0];
  if (!a) return { ok: false, status: 409, message: "This action was already decided." };
  const base = { id: Number(a.id), provider: a.provider, tool: a.tool, summary: a.summary, args: a.args };
  if (decision === "dismiss") {
    await logActivity(db, personActor(userId), {
      workspaceId,
      action: "outside.action",
      target: `${PROVIDERS[a.provider].name} · ${a.tool}`,
      count: 1,
      detail: `Dismissed: ${a.summary}`,
    });
    return { ok: true, action: { ...base, status: "dismissed" } };
  }
  let status: OutsideAction["status"] = "failed";
  let result: string;
  try {
    if (!canPropose(a.provider, a.tool)) throw new Error("That action isn't allowed.");
    const { rows: conn } =
      await sql<Row>`select * from workspace_connection where workspace_id = ${workspaceId} and provider = ${a.provider}`.execute(
        db,
      );
    if (!conn[0]) throw new Error(`${PROVIDERS[a.provider].name} is no longer connected.`);
    const out = await (await clientFor(conn[0])).callTool(a.tool, a.args);
    status = out.isError ? "failed" : "applied";
    result = out.text.slice(0, 2000);
  } catch (e) {
    result = (e as Error).message.slice(0, 500);
  }
  await sql`update connection_action set status = ${status}, result = ${result} where id = ${a.id}`.execute(
    db,
  );
  await logActivity(db, personActor(userId), {
    workspaceId,
    action: "outside.action",
    target: `${PROVIDERS[a.provider].name} · ${a.tool}`,
    count: 1,
    result: status === "applied" ? "ok" : "error",
    detail: a.summary,
  });
  return { ok: true, action: { ...base, status, result } };
}

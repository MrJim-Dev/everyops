import "server-only";
import { sql } from "kysely";
import { db } from "./db";

/** A design change an AI agent asked for through MCP's propose_change, waiting for an owner or admin. */
export type AgentRequest = {
  id: number;
  request: string;
  keyName: string | null;
  by: string;
  createdAt: string;
};

export async function openRequests(workspaceId: string): Promise<AgentRequest[]> {
  const { rows } = await sql<{
    id: string;
    request: string;
    key_name: string | null;
    name: string;
    created_at: Date;
  }>`
    select r.id, r.request, r.key_name, u.name, r.created_at from agent_request r join "user" u on u.id = r.user_id
    where r.workspace_id = ${workspaceId} and r.status = 'open' order by r.created_at desc limit 20`.execute(
    db,
  );
  return rows.map((r) => ({
    id: Number(r.id),
    request: r.request,
    keyName: r.key_name,
    by: r.name,
    createdAt: new Date(r.created_at).toISOString(),
  }));
}

/** Closes a request: drafted with Ask EveryOps, or dismissed. */
export async function closeRequest(workspaceId: string, id: number, status: "drafted" | "dismissed") {
  const { numAffectedRows } = await sql`
    update agent_request set status = ${status}, closed_at = now()
    where workspace_id = ${workspaceId} and id = ${id} and status = 'open'`.execute(db);
  return Number(numAffectedRows ?? 0) > 0;
}

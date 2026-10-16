import "server-only";
import { sql } from "kysely";
import { type ApiCaller, apiCaller } from "./api-auth";
import { db } from "./db";
import { runTool, ToolError } from "./mcp/tools";

/**
 * The public REST API (/api/v1) runs the same tools as the MCP server, so both check access, validate values and
 * write records the same way. Success answers { data }; failures answer { error: { code, message, details? } }.
 */

const CODES = { 400: "invalid", 403: "forbidden", 404: "not_found", 409: "conflict" } as const;

export const apiError = (status: number, code: string, message: string, details?: unknown) =>
  Response.json({ error: { code, message, ...(details === undefined ? {} : { details }) } }, { status });

export const badRequest = (message: string) => apiError(400, "invalid", message);

/** Adds each record's rev, so a client can update what it listed without reading each record again. */
export async function withRevs<R extends { id: string }>(workspaceId: string, records: R[]) {
  const ids = records.map((r) => r.id);
  if (!ids.length) return [];
  const { rows } = await sql<{ id: string; rev: number }>`
    select id, rev from workspace_record where workspace_id = ${workspaceId} and id = any(${ids}::text[])`.execute(
    db,
  );
  const revs = new Map(rows.map((r) => [r.id, r.rev]));
  return records.map((r) => ({ ...r, rev: revs.get(r.id) ?? null }));
}

/** The request's JSON body as an object, or null when it isn't one. */
export async function jsonBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json();
    return body && typeof body === "object" && !Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}

type Run = (
  call: (name: string, args: Record<string, unknown>) => Promise<unknown>,
  caller: ApiCaller,
) => Promise<Response>;

/** Authenticates the request, then lets the handler call tools in one workspace; tool errors become API errors. */
export async function restRoute(request: Request, workspaceId: string, run: Run): Promise<Response> {
  const { caller, error } = await apiCaller(request);
  if (error) return error;
  try {
    return await run((name, args) => runTool(caller, workspaceId, name, args), caller);
  } catch (e) {
    if (e instanceof ToolError) return apiError(e.status, CODES[e.status], e.message, e.details);
    throw e;
  }
}

/** A write tool's result: 409 with the current record on a stale rev, else { data }. */
export function writeResponse(result: unknown, status = 200): Response {
  const r = result as {
    ok: boolean;
    conflict?: boolean;
    message?: string;
    current?: unknown;
    record?: unknown;
    automations?: string[];
  };
  if (r.conflict) return apiError(409, "conflict", r.message ?? "Conflict.", { current: r.current });
  return Response.json(
    { data: r.record ?? null, ...(r.automations?.length ? { meta: { automations: r.automations } } : {}) },
    { status },
  );
}

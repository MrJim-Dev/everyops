import "server-only";
import { allowedIn, PERMISSIONS, type Permission } from "@/lib/api-keys";
import { removesSomething } from "@/lib/assistant/permissions";
import type { Blueprint } from "@/lib/blueprint/types";
import type { ChangePlan } from "@/lib/engine/changes";
import type { Role } from "@/lib/store/workspace-model";
import type { ApiCaller } from "../api-auth";

/** What every MCP tool shares: its shape, the context it runs in, and its errors. */

export type McpScope = { kind: "account" } | { kind: "workspace"; workspaceId: string };

/** A tool call that can't be done; status is what the REST API answers with (400 unless set). */
export class ToolError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409 = 400,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export type Args = Record<string, unknown>;
export type Ctx = { caller: ApiCaller; scope: McpScope; workspaceId: string; bp: Blueprint; role: Role };

export type Tool = {
  name: string;
  title: string;
  description: string;
  permission: Permission;
  /** Tools that work without a workspace (list_workspaces). */
  accountOnly?: boolean;
  readOnly: boolean;
  destructive?: boolean;
  properties: Record<string, unknown>;
  required: string[];
  run: (ctx: Ctx, args: Args) => Promise<unknown>;
};

export const str = (v: unknown, name: string) => {
  if (typeof v !== "string" || !v.trim()) throw new ToolError(`"${name}" is required.`);
  return v.trim();
};

export const optStr = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
export const optInt = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : undefined;

/** Whether the caller may also do this in the workspace (its key, capped by its owner's role there). */
export const may = (ctx: Ctx, p: Permission) =>
  allowedIn(
    ctx.caller.key ?? { workspaces: null, permissions: [...PERMISSIONS] },
    ctx.workspaceId,
    ctx.role,
  ).has(p);

/** Throws unless the caller may also do this; what says what for, in the message. */
export const need = (ctx: Ctx, p: Permission, what: string) => {
  if (!may(ctx, p))
    throw new ToolError(
      ctx.caller.key && !ctx.caller.key.permissions.includes(p)
        ? `This key doesn't have the ${p} permission, which ${what} needs.`
        : `Your role here (${ctx.role}) can't ${what}.`,
      403,
    );
};

/**
 * Why an agent can't apply a plan itself; empty when it can. Team changes always wait for a person, and so do
 * removals while the owner has "Always ask before removing" on; the rest is what the key and its owner's role allow.
 */
export function planBlockers(
  plan: Pick<ChangePlan, "ops" | "recordOps" | "docOps" | "teamOps">,
  permissions: { confirmDeletes: boolean },
  can: (p: "design:apply" | "records:write" | "pages:write") => boolean,
) {
  const blockers: string[] = [];
  if (plan.teamOps?.length) blockers.push("Team invites and role changes always wait for an owner or admin.");
  if (permissions.confirmDeletes && removesSomething(plan))
    blockers.push('It removes something, and "Always ask before removing" is on in Settings → Assistant.');
  if (plan.ops.length && !can("design:apply"))
    blockers.push("It changes the design, which needs the design:apply permission (owners and admins).");
  if (plan.recordOps?.length && !can("records:write")) blockers.push("It changes records (records:write).");
  if (plan.docOps?.length && !can("pages:write")) blockers.push("It changes page text (pages:write).");
  return blockers;
}

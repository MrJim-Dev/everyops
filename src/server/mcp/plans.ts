import "server-only";
import { sql } from "kysely";
import { appliesOnItsOwn, removesSomething } from "@/lib/assistant/permissions";
import type { Screen } from "@/lib/assistant/screen";
import { isDemoEmail } from "@/lib/auth/demo";
import type { ChangePlan } from "@/lib/engine/changes";
import { applyPlan, revertChanges } from "@/lib/store/apply-plan";
import { blueprintOf, canEdit, canManage, type Workspace } from "@/lib/store/workspace-model";
import { baselineOf, diffWorkspace } from "@/lib/store/workspace-sync";
import { logActivity } from "../activity";
import { assistantTurn } from "../ai/assistant";
import { takeAiToken } from "../ai/rate-limit";
import { startAiUsage, withAiUsage } from "../ai/usage";
import { actorOf } from "../api-auth";
import { db } from "../db";
import { readMemory } from "../workspace-memory";
import { loadTeam, loadWorkspace, patchWorkspace } from "../workspaces";
import { type Ctx, may, need, planBlockers, ToolError } from "./kit";

/**
 * Ask EveryOps over MCP. An agent asks in plain words and gets the assistant's answer, the same one the app gives
 * (it reads the workspace, looks records up and plans changes, checked like every plan). A plan is kept in
 * agent_request; apply_change applies it the way the Apply button does: against the design it was made for, saved
 * to History and undoable. What a person must decide (team changes, removals while "Always ask before removing" is
 * on, or anything the key may not apply) goes to the owners' Requests from agents instead.
 */

const who = (ctx: Ctx) =>
  ctx.caller.key ? `${ctx.caller.key.name} (${ctx.caller.user.name}'s key)` : ctx.caller.user.name;

const summary = (plan: ChangePlan) => ({
  title: plan.title,
  steps: plan.steps,
  facts: plan.facts,
  changes: {
    design: plan.ops.length,
    records: plan.recordOps?.length ?? 0,
    pages: plan.docOps?.length ?? 0,
    team: plan.teamOps?.length ?? 0,
    removes: removesSomething(plan),
  },
});

export async function askEveryOps(ctx: Ctx, message: string, screen: Screen) {
  const limit = await takeAiToken(ctx.caller.user.id);
  if (!limit.ok) throw new ToolError(`Too many questions. Try again in ${limit.retryAfterSeconds} seconds.`);
  const over = await startAiUsage(ctx.workspaceId);
  if (over) throw new ToolError(((await over.json()) as { message: string }).message);
  const found = await loadWorkspace(ctx.workspaceId, ctx.caller.user.id);
  if (!found) throw new ToolError("Workspace not found.", 404);
  const manager = canManage(found.role);
  const [team, memory] = await Promise.all([
    manager ? loadTeam(ctx.workspaceId) : undefined,
    readMemory(ctx.workspaceId),
  ]);
  const canDesign = manager && (may(ctx, "design:apply") || may(ctx, "design:propose"));
  const canEditRecords = canEdit(found.role) && (may(ctx, "records:write") || may(ctx, "pages:write"));
  const turn = await withAiUsage(
    ctx.workspaceId,
    () =>
      assistantTurn({
        blueprint: blueprintOf(found.workspace),
        records: found.workspace.records,
        messages: [{ role: "user", text: message }],
        screen,
        docs: found.workspace.docs,
        canDesign,
        canEditRecords,
        userId: ctx.caller.user.id,
        workspaceId: ctx.workspaceId,
        team,
        workspaceName: found.workspace.name,
        summary: found.workspace.summary,
        memory,
      }),
    { userId: ctx.caller.user.id, feature: "assistant" },
  );
  if (!turn.ok) throw new ToolError(turn.message);
  const answer = {
    kind: turn.kind,
    reply: turn.reply,
    ...(turn.suggestions.length ? { suggestions: turn.suggestions } : {}),
    ...(turn.evidence ? { evidence: turn.evidence } : {}),
  };
  if (!turn.plan) return answer;
  if (memory.permissions.autonomy === "read_only")
    return {
      kind: "answer",
      reply:
        "Ask EveryOps is set to read only in this workspace, so it doesn't prepare changes. An owner or admin can allow them in Settings → Assistant.",
    };
  const plan: ChangePlan = {
    ...turn.plan,
    baseVersion: turn.plan.baseVersion ?? found.workspace.currentVersion,
  };
  const blockers = planBlockers(plan, memory.permissions, (p) => may(ctx, p));
  const status = blockers.length ? "open" : "planned";
  const { rows } = await sql<{ id: string }>`
    insert into agent_request (workspace_id, user_id, key_id, key_name, request, status, plan, base_version)
    values (${ctx.workspaceId}, ${ctx.caller.user.id}, ${ctx.caller.key?.id ?? null}, ${ctx.caller.key?.name ?? null},
      ${message.slice(0, 2000)}, ${status}, ${JSON.stringify(plan)}::jsonb, ${plan.baseVersion ?? null})
    returning id`.execute(db);
  const planId = Number(rows[0]?.id);
  if (blockers.length)
    await logActivity(db, actorOf(ctx.caller), {
      workspaceId: ctx.workspaceId,
      action: "change.propose",
      ids: [String(planId)],
      detail: message.slice(0, 500),
    });
  return {
    ...answer,
    plan: {
      planId,
      ...summary(plan),
      ...(blockers.length
        ? {
            canApply: false,
            waitsFor: blockers,
            message: "Saved to Requests from agents (History) for an owner or admin. Nothing has changed.",
          }
        : {
            canApply: true,
            ...(appliesOnItsOwn(plan, memory.permissions) ? { ownerAllowsAutoApply: true } : {}),
            message:
              "Nothing has changed yet. Show the person the steps, then call apply_change with planId.",
          }),
    },
  };
}

/** Saves a changed workspace the way the browser does: only what differs, checked by role and rev. */
async function save(
  ctx: Ctx,
  before: { workspace: Workspace; revs: Record<string, number> },
  after: Workspace,
) {
  const patch = diffWorkspace(baselineOf(before.workspace, before.revs), after);
  if (!patch) return;
  const result = await patchWorkspace(ctx.caller.user.id, ctx.workspaceId, patch, {
    demo: isDemoEmail(ctx.caller.user.email),
  });
  if (!result.ok)
    throw new ToolError(
      result.status === 409 ? `${result.message} Read the workspace again and retry.` : result.message,
      result.status === 403 || result.status === 404 || result.status === 409 ? result.status : 400,
    );
}

export async function applyChange(ctx: Ctx, planId: number) {
  const { rows } = await sql<{ plan: ChangePlan | null; status: string; base_version: number | null }>`
    select plan, status, base_version from agent_request
    where workspace_id = ${ctx.workspaceId} and id = ${planId} and user_id = ${ctx.caller.user.id}`.execute(
    db,
  );
  const row = rows[0];
  if (!row?.plan) throw new ToolError(`No plan ${planId}. Make one with ask_everyops.`, 404);
  if (row.status === "applied") throw new ToolError("That plan was already applied.", 409);
  if (row.status !== "planned")
    throw new ToolError("That plan waits for an owner or admin in Requests from agents.", 409);
  const plan = row.plan;
  const memory = await readMemory(ctx.workspaceId);
  const blockers = planBlockers(plan, memory.permissions, (p) => may(ctx, p));
  if (blockers.length) throw new ToolError(blockers.join(" "), 403);
  const found = await loadWorkspace(ctx.workspaceId, ctx.caller.user.id);
  if (!found) throw new ToolError("Workspace not found.", 404);
  if (plan.ops.length && row.base_version !== null && found.workspace.currentVersion !== row.base_version)
    throw new ToolError(
      "The design changed since this plan was made. Ask again with ask_everyops for a plan on the current design.",
      409,
    );
  const { workspace, entry } = applyPlan(found.workspace, plan, { by: who(ctx) });
  await save(ctx, found, workspace);
  await sql`update agent_request set status = 'applied', closed_at = now() where id = ${planId}`.execute(db);
  await logActivity(db, actorOf(ctx.caller), {
    workspaceId: ctx.workspaceId,
    action: "change.apply",
    target: entry.title,
    ids: [entry.id],
    count: 1,
  });
  return {
    ok: true,
    changeId: entry.id,
    title: entry.title,
    version: entry.toVersion,
    message: "Applied and saved to History. undo_change with changeId puts it back.",
  };
}

export async function undoChange(ctx: Ctx, changeId: string) {
  const found = await loadWorkspace(ctx.workspaceId, ctx.caller.user.id);
  if (!found) throw new ToolError("Workspace not found.", 404);
  const entry = found.workspace.changes.find((c) => c.id === changeId);
  if (!entry) throw new ToolError(`No change "${changeId}" in History.`, 404);
  if (entry.undoneAt) throw new ToolError("That change is already undone.", 409);
  const design = entry.fromVersion !== entry.toVersion || !!entry.teamBefore;
  need(ctx, design ? "design:apply" : "records:write", design ? "undo a design change" : "undo a change");
  const result = revertChanges(found.workspace, [changeId]);
  if (!result.ok)
    throw new ToolError(
      result.blocking?.length
        ? `Newer changes come after it; undo these first: ${result.blocking.map((c) => `${c.id} (${c.title})`).join(", ")}`
        : "That change can't be undone any more.",
      409,
    );
  await save(ctx, found, result.workspace);
  await logActivity(db, actorOf(ctx.caller), {
    workspaceId: ctx.workspaceId,
    action: "change.undo",
    target: entry.title,
    ids: [entry.id],
    count: 1,
  });
  return { ok: true, undone: result.undone.map((c) => ({ id: c.id, title: c.title })) };
}

/** History, newest first: what changed, who applied it and whether it's been undone. */
export async function listChanges(ctx: Ctx, limit = 20) {
  const found = await loadWorkspace(ctx.workspaceId, ctx.caller.user.id);
  if (!found) throw new ToolError("Workspace not found.", 404);
  return {
    currentVersion: found.workspace.currentVersion,
    changes: found.workspace.changes.slice(0, Math.min(Math.max(limit, 1), 50)).map((c) => ({
      id: c.id,
      title: c.title,
      request: c.request,
      steps: c.steps,
      appliedAt: c.appliedAt,
      ...(c.appliedBy ? { appliedBy: c.appliedBy } : {}),
      ...(c.undoneAt ? { undoneAt: c.undoneAt } : {}),
      design: c.fromVersion !== c.toVersion,
      version: c.toVersion,
    })),
  };
}

/** The requests and plans agents left in this workspace, newest first. */
export async function listRequests(ctx: Ctx) {
  const { rows } = await sql<{
    id: string;
    request: string;
    status: string;
    key_name: string | null;
    created_at: Date;
    has_plan: boolean;
  }>`
    select id, request, status, key_name, created_at, plan is not null as has_plan from agent_request
    where workspace_id = ${ctx.workspaceId} order by created_at desc limit 30`.execute(db);
  return rows.map((r) => ({
    id: Number(r.id),
    request: r.request,
    status: r.status,
    plan: r.has_plan,
    by: r.key_name,
    createdAt: new Date(r.created_at).toISOString(),
  }));
}

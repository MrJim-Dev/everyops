import { currencyOf } from "@/lib/format";
import "server-only";
import { sql } from "kysely";
import { allowedIn } from "@/lib/api-keys";
import { findEntity } from "@/lib/blueprint/lookup";
import type { Blueprint, Entity } from "@/lib/blueprint/types";
import { coerceValues } from "@/lib/engine/coerce";
import { logActivity } from "../activity";
import { recordTools } from "../ai/record-tools";
import { type ApiCaller, actorOf, workspaceAccess } from "../api-auth";
import { db } from "../db";
import { readPage, writeRecord } from "../record-writes";
import { currentBlueprint, readCurrent, readRecords } from "../workspace-data";
import { accessibleWorkspaces } from "../workspaces";
import { type Args, type Ctx, type McpScope, str, type Tool, ToolError } from "./kit";
import { MORE_TOOLS } from "./more-tools";
import { readView, viewSummary } from "./views";

export { type McpScope, ToolError };

/**
 * The EveryOps MCP tools. On the account endpoint (/mcp) every tool but list_workspaces takes a workspace; on a
 * workspace's endpoint (/mcp/w/<id>) it's fixed and can't be changed. Every call is checked again here: the key
 * must reach the workspace and have the tool's permission, capped by its owner's current role there.
 */

const entityOf = (bp: Blueprint, idOrName: unknown) => {
  const key = str(idOrName, "entityId");
  const e =
    findEntity(bp, key) ??
    bp.entities.find(
      (x) => x.name.toLowerCase() === key.toLowerCase() || x.pluralName.toLowerCase() === key.toLowerCase(),
    );
  if (!e)
    throw new ToolError(
      `No record type "${key}". Record types: ${bp.entities.map((x) => x.id).join(", ")}`,
      404,
    );
  return e;
};

const describeField = (f: Entity["fields"][number]) => ({
  id: f.id,
  name: f.name,
  type: f.type,
  ...(f.required ? { required: true } : {}),
  // Records store a choice's id; writes take its label or id.
  ...(f.options?.length ? { options: f.options.map((o) => ({ id: o.id, label: o.label })) } : {}),
  ...(f.relation ? { linksTo: f.relation.entityId } : {}),
  ...(f.type === "formula" || f.type === "rollup" ? { computed: true } : {}),
  ...(f.type === "time_range" ? { range: f.range ?? "times" } : {}),
});

const FILTERS = {
  type: "array",
  description: "Conditions that must all hold",
  items: {
    type: "object",
    properties: {
      fieldId: { type: "string" },
      op: { type: "string", enum: ["eq", "neq", "contains", "gt", "gte", "lt", "lte", "empty", "not_empty"] },
      value: {
        type: "string",
        description: "Choice label, linked record name or id, YYYY-MM-DD, digits, true/false",
      },
    },
    required: ["fieldId", "op"],
  },
};

const lookup = async (ctx: Ctx, name: string, args: Args) => {
  const result = await recordTools(ctx.workspaceId, ctx.bp).run(name, args);
  if (result && typeof result === "object" && "error" in result) {
    const message = String((result as { error: unknown }).error);
    throw new ToolError(message, /^No record\b/.test(message) ? 404 : 400);
  }
  return result;
};

/** A record as tools and the REST API show it: its id, every field by id, and its rev. */
const flat = (record: { id: string; data: Record<string, unknown> }, rev: number | null) => ({
  id: record.id,
  ...record.data,
  rev,
});

const writeResult = (r: Awaited<ReturnType<typeof writeRecord>>) => {
  if (!r.ok) {
    if (r.current)
      return {
        ok: false,
        conflict: true,
        message: r.message,
        current: flat(r.current.record, r.current.rev),
      };
    throw new ToolError(r.message, r.status);
  }
  return {
    ok: true,
    ...(r.record ? { record: flat(r.record, r.rev) } : {}),
    ...(r.notices.length ? { automations: r.notices } : {}),
  };
};

const CORE_TOOLS: Tool[] = [
  {
    name: "list_workspaces",
    title: "List workspaces",
    description:
      "The EveryOps workspaces this key can reach, with your role and what the key may do in each.",
    permission: "mcp",
    accountOnly: true,
    readOnly: true,
    properties: {},
    required: [],
    run: async (ctx) => {
      const scope = ctx.caller.key ?? { workspaces: null, permissions: [] };
      return (await accessibleWorkspaces(ctx.caller.user.id))
        .map((w) => ({
          id: w.id,
          name: w.name,
          role: w.role,
          permissions: [...allowedIn(scope, w.id, w.role)],
        }))
        .filter((w) => w.permissions.includes("mcp"));
    },
  },
  {
    name: "describe_workspace",
    title: "Describe a workspace",
    description:
      "A workspace's record types (with every field: id, type, choices, links), how many records each has, its pages with their tabs and dashboard cards, and its automations (trigger, conditions, actions). Call this first: the other tools take these ids. describe_view and read_view show a tab's settings and contents.",
    permission: "records:read",
    readOnly: true,
    properties: {},
    required: [],
    run: async (ctx) => {
      const { rows } = await sql<{ entity_id: string; n: number }>`
        select entity_id, count(*)::int as n from workspace_record where workspace_id = ${ctx.workspaceId} group by entity_id`.execute(
        db,
      );
      const counts = new Map(rows.map((r) => [r.entity_id, r.n]));
      return {
        id: ctx.workspaceId,
        name: ctx.bp.workspaceName,
        timeZone: "Asia/Manila",
        currency: currencyOf(ctx.bp),
        recordTypes: ctx.bp.entities.map((e) => ({
          id: e.id,
          name: e.name,
          pluralName: e.pluralName,
          titleField: e.primaryFieldId,
          records: counts.get(e.id) ?? 0,
          ...(e.parent ? { lineItemsOf: e.parent.entityId } : {}),
          ...(e.booking
            ? {
                booking: {
                  resource: e.booking.resourceFieldId,
                  time: e.booking.timeFieldId,
                  status: e.booking.statusFieldId,
                },
              }
            : {}),
          fields: e.fields.map((f) => describeField(f)),
        })),
        pages: ctx.bp.systems.map((s) => ({
          id: s.id,
          name: s.name,
          ...(s.group ? { group: s.group } : {}),
          tabs: s.viewIds.flatMap((id) => {
            const v = ctx.bp.views.find((x) => x.id === id);
            if (!v) return [];
            const { pageId: _p, page: _n, ...tab } = viewSummary(ctx.bp, v);
            return [tab];
          }),
          cards: s.widgetIds.flatMap((id) => {
            const w = ctx.bp.widgets.find((x) => x.id === id);
            return w ? [{ id: w.id, title: w.title, type: w.type, recordType: w.entityId }] : [];
          }),
        })),
        automations: ctx.bp.rules.map((r) => ({
          id: r.id,
          name: r.name,
          on: r.trigger.event,
          recordType: r.trigger.entityId,
          enabled: r.enabled !== false,
          trigger: r.trigger,
          ...(r.when ? { when: r.when } : {}),
          actions: r.actions,
        })),
      };
    },
  },
  {
    name: "search_records",
    title: "Search records",
    description:
      "Records of one type by text and filters, sorted, with how many match; nextOffset fetches the next page. Linked records come with their names.",
    permission: "records:read",
    readOnly: true,
    properties: {
      entityId: { type: "string", description: "A record type id from describe_workspace" },
      query: { type: "string" },
      filters: FILTERS,
      sortBy: { type: "string", description: 'A field id, or "createdAt"' },
      sortDir: { type: "string", enum: ["asc", "desc"] },
      limit: { type: "integer", minimum: 1, maximum: 50 },
      offset: { type: "integer", minimum: 0, description: "nextOffset from the previous call" },
    },
    required: ["entityId"],
    run: async (ctx, args) => {
      const offset = typeof args.offset === "number" && args.offset > 0 ? Math.trunc(args.offset) : 0;
      const page = (await lookup(ctx, "search_records", {
        ...args,
        offset,
        entityId: entityOf(ctx.bp, args.entityId).id,
      })) as { total?: number; shown?: number };
      const seen = offset + (page.shown ?? 0);
      return {
        ...page,
        nextOffset: page.shown && typeof page.total === "number" && seen < page.total ? seen : null,
      };
    },
  },
  {
    name: "get_record",
    title: "Get a record",
    description:
      "One record with every field, the records linked to it, and its rev (send the rev back when you update it).",
    permission: "records:read",
    readOnly: true,
    properties: { id: { type: "string" } },
    required: ["id"],
    run: async (ctx, args) => {
      const id = str(args.id, "id");
      const result = (await lookup(ctx, "get_record", { id })) as Record<string, unknown>;
      const { rows } = await sql<{ rev: number }>`
        select rev from workspace_record where workspace_id = ${ctx.workspaceId} and id = ${id}`.execute(db);
      return { ...result, rev: rows[0]?.rev ?? null };
    },
  },
  {
    name: "aggregate",
    title: "Count and total records",
    description:
      "Exact count, sum, avg, min or max over one record type, optionally filtered and grouped by a field or by day, week or month of a date field.",
    permission: "records:read",
    readOnly: true,
    properties: {
      entityId: { type: "string" },
      metric: { type: "string", enum: ["count", "sum", "avg", "min", "max"] },
      fieldId: { type: "string", description: "The number or money field for sum, avg, min and max" },
      filters: FILTERS,
      groupBy: { type: "string" },
      dateFieldId: { type: "string" },
      bucket: { type: "string", enum: ["day", "week", "month"] },
    },
    required: ["entityId", "metric"],
    run: (ctx, args) => lookup(ctx, "aggregate", { ...args, entityId: entityOf(ctx.bp, args.entityId).id }),
  },
  {
    name: "read_page",
    title: "Read a page",
    description:
      "The text of a document page (markdown) or a custom page (HTML), or a drawing's shapes, by its tab id from describe_workspace. For other tabs use read_view.",
    permission: "pages:read",
    readOnly: true,
    properties: { viewId: { type: "string" } },
    required: ["viewId"],
    run: async (ctx, args) => {
      const viewId = str(args.viewId, "viewId");
      const view = ctx.bp.views.find((v) => v.id === viewId);
      if (!view) throw new ToolError(`No tab "${viewId}".`, 404);
      if (view.type === "canvas") {
        const doc = await readCurrent(db, ctx.workspaceId);
        return doc ? readView(doc.blueprint, doc.records, doc.docs, ctx.workspaceId, view) : null;
      }
      // Until someone saves a page it shows what the design started it with, as in the app.
      const body =
        (await readPage(ctx.workspaceId, viewId)) ??
        (view.type === "html" ? (view.html ?? null) : view.type === "document" ? (view.starter ?? "") : null);
      if (body === null)
        throw new ToolError(
          `"${view.name}" has no page text (it's a ${view.type} view): read_view shows what it holds.`,
          404,
        );
      return {
        id: viewId,
        name: view.name,
        type: view.type,
        text: body.slice(0, 60_000),
        truncated: body.length > 60_000,
      };
    },
  },
  {
    name: "create_record",
    title: "Create a record",
    description:
      "Adds a record, checked like the app checks it (required fields, valid choices, free booking slots); save automations run. values maps field ids or names to values: choices by label, links by the linked record's name or id, dates YYYY-MM-DD, times in Manila, time ranges as {start, end}.",
    permission: "records:write",
    readOnly: false,
    properties: {
      entityId: { type: "string" },
      values: { type: "object", additionalProperties: true },
    },
    required: ["entityId", "values"],
    run: async (ctx, args) => {
      const entity = entityOf(ctx.bp, args.entityId);
      const records = (await readRecords(db, ctx.workspaceId)).map((s) => s.record);
      const { data, errors } = coerceValues(ctx.bp, records, entity, (args.values ?? {}) as Args);
      if (errors.length) throw new ToolError(errors.join("\n"));
      return writeResult(
        await writeRecord(ctx.workspaceId, actorOf(ctx.caller), {
          kind: "create",
          entityId: entity.id,
          data,
        }),
      );
    },
  },
  {
    name: "update_record",
    title: "Update a record",
    description:
      "Changes some fields of a record (others stay). Send the rev from get_record: if someone changed the record since, nothing is written and you get it as it is now.",
    permission: "records:write",
    readOnly: false,
    properties: {
      id: { type: "string" },
      values: { type: "object", additionalProperties: true },
      rev: { type: "integer" },
    },
    required: ["id", "values"],
    run: async (ctx, args) => {
      const id = str(args.id, "id");
      const records = (await readRecords(db, ctx.workspaceId)).map((s) => s.record);
      const record = records.find((r) => r.id === id);
      const entity = ctx.bp.entities.find((e) => e.id === record?.entityId);
      if (!record || !entity) throw new ToolError(`No record "${id}".`, 404);
      const { data, errors } = coerceValues(ctx.bp, records, entity, (args.values ?? {}) as Args);
      if (errors.length) throw new ToolError(errors.join("\n"));
      return writeResult(
        await writeRecord(ctx.workspaceId, actorOf(ctx.caller), {
          kind: "update",
          id,
          patch: data,
          ...(typeof args.rev === "number" ? { rev: args.rev } : {}),
        }),
      );
    },
  },
  {
    name: "delete_record",
    title: "Delete a record",
    description:
      "Deletes a record and its line items. Send the rev from get_record to make sure you delete what you read.",
    permission: "records:write",
    readOnly: false,
    destructive: true,
    properties: { id: { type: "string" }, rev: { type: "integer" } },
    required: ["id"],
    run: async (ctx, args) =>
      writeResult(
        await writeRecord(ctx.workspaceId, actorOf(ctx.caller), {
          kind: "delete",
          id: str(args.id, "id"),
          ...(typeof args.rev === "number" ? { rev: args.rev } : {}),
        }),
      ),
  },
  {
    name: "propose_change",
    title: "Propose a design change",
    description:
      "Leaves a request for the workspace's owners and admins to review in EveryOps (a new field, page, automation or dashboard card). Ask EveryOps drafts it there as a plan they approve; nothing changes until they do. Describe the change in plain words.",
    permission: "design:propose",
    readOnly: false,
    properties: { request: { type: "string", description: "What should change, and why" } },
    required: ["request"],
    run: async (ctx, args) => {
      const request = str(args.request, "request").slice(0, 2000);
      const { rows } = await sql<{ id: string }>`
        insert into agent_request (workspace_id, user_id, key_id, key_name, request)
        values (${ctx.workspaceId}, ${ctx.caller.user.id}, ${ctx.caller.key?.id ?? null}, ${ctx.caller.key?.name ?? null}, ${request})
        returning id`.execute(db);
      await logActivity(db, actorOf(ctx.caller), {
        workspaceId: ctx.workspaceId,
        action: "change.propose",
        ids: [String(rows[0]?.id)],
        detail: request,
      });
      return {
        ok: true,
        requestId: Number(rows[0]?.id),
        message: "Saved for the owners and admins to review in EveryOps. Nothing has changed yet.",
      };
    },
  },
];

export const TOOLS: Tool[] = [...CORE_TOOLS, ...MORE_TOOLS];

/** The tools offered on an endpoint, with their JSON Schemas. */
export function toolList(scope: McpScope) {
  return TOOLS.filter((t) => scope.kind === "account" || !t.accountOnly).map((t) => {
    const withWorkspace = scope.kind === "account" && !t.accountOnly;
    return {
      name: t.name,
      title: t.title,
      description: t.description,
      inputSchema: {
        type: "object",
        properties: {
          ...(withWorkspace
            ? { workspace: { type: "string", description: "A workspace id from list_workspaces" } }
            : {}),
          ...t.properties,
        },
        required: [...(withWorkspace ? ["workspace"] : []), ...t.required],
      },
      annotations: { readOnlyHint: t.readOnly, destructiveHint: !!t.destructive, openWorldHint: false },
    };
  });
}

/** Runs a tool for a caller: the workspace, its scope and the tool's permission are checked first. */
export async function callTool(
  caller: ApiCaller,
  scope: McpScope,
  name: string,
  args: Args,
): Promise<unknown> {
  const tool = TOOLS.find((t) => t.name === name && (scope.kind === "account" || !t.accountOnly));
  if (!tool) throw new ToolError(`Unknown tool "${name}".`);
  if (tool.accountOnly)
    return tool.run(
      { caller, scope, workspaceId: "", bp: undefined as unknown as Blueprint, role: "viewer" },
      args,
    );
  const workspaceId = scope.kind === "workspace" ? scope.workspaceId : str(args.workspace, "workspace");
  const access = await workspaceAccess(caller, workspaceId, "mcp");
  if (access.error) throw await accessError(access.error);
  const { workspace: _w, ...rest } = args;
  return runTool(caller, workspaceId, name, rest, scope);
}

const accessError = async (response: Response) =>
  new ToolError(
    await response.json().then((b: { error: { message: string } }) => b.error.message),
    response.status === 403 ? 403 : 404,
  );

/**
 * Runs a workspace tool after checking the caller may reach the workspace and has the tool's permission (capped by
 * their role). The REST API calls this directly; MCP calls it through callTool, which also needs the mcp permission.
 */
export async function runTool(
  caller: ApiCaller,
  workspaceId: string,
  name: string,
  args: Args,
  scope: McpScope = { kind: "workspace", workspaceId },
): Promise<unknown> {
  const tool = TOOLS.find((t) => t.name === name && !t.accountOnly);
  if (!tool) throw new ToolError(`Unknown tool "${name}".`);
  const allowed = await workspaceAccess(caller, workspaceId, tool.permission);
  if (allowed.error) throw await accessError(allowed.error);
  const bp = await currentBlueprint(db, workspaceId);
  if (!bp) throw new ToolError("Workspace not found.", 404);
  if (!(tool.readOnly && caller.client === "mcp"))
    return tool.run({ caller, scope, workspaceId, bp, role: allowed.role }, args);
  // An AI agent's reads are logged too (writes log themselves), so owners can see what it looked at.
  const log = (result: "ok" | "error", detail: string | null) =>
    logActivity(db, actorOf(caller), {
      workspaceId,
      action: "mcp.tool_call",
      target: name,
      count: 1,
      result,
      detail,
    });
  try {
    const out = await tool.run({ caller, scope, workspaceId, bp, role: allowed.role }, args);
    await log(
      "ok",
      typeof args.entityId === "string" ? args.entityId : typeof args.id === "string" ? args.id : null,
    );
    return out;
  } catch (e) {
    await log("error", e instanceof Error ? e.message : String(e));
    throw e;
  }
}

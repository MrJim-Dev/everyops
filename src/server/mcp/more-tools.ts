import "server-only";
import { MAX_INSTRUCTIONS, MAX_NOTE_CHARS, MEMORY_KINDS, type MemoryEdit } from "@/lib/assistant/memory";
import type { Screen } from "@/lib/assistant/screen";
import { parseCanvas } from "@/lib/canvas/model";
import { canManage } from "@/lib/store/workspace-model";
import { addDays, at } from "@/lib/time";
import { listActivity, logActivity } from "../activity";
import { actorOf } from "../api-auth";
import { deliverPending, listRuns, runTimedAutomations } from "../automations";
import { db } from "../db";
import { writePageText } from "../record-writes";
import { pageVersionBody, pageVersions, readCurrent } from "../workspace-data";
import { readMemory, rememberEdits, saveMemory } from "../workspace-memory";
import { loadTeam } from "../workspaces";
import { type Args, type Ctx, optInt, optStr, str, type Tool, ToolError } from "./kit";
import { applyChange, askEveryOps, listChanges, listRequests, undoChange } from "./plans";
import { availability, describeView, readDashboard, readView } from "./views";

/**
 * MCP tools beyond records: pages and layouts as the app shows them, page text and its history, booking
 * availability, Ask EveryOps with plans an agent can apply and undo, automations, memory, the activity log and team.
 */

const MAX_PAGE_CHARS = 1_000_000;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const current = async (ctx: Ctx) => {
  const doc = await readCurrent(db, ctx.workspaceId);
  if (!doc) throw new ToolError("Workspace not found.", 404);
  return doc;
};

const viewOf = (ctx: Ctx, viewId: unknown) => {
  const id = str(viewId, "viewId");
  const view = ctx.bp.views.find((v) => v.id === id || v.name.toLowerCase() === id.toLowerCase());
  if (!view) throw new ToolError(`No tab "${id}". Tabs: ${ctx.bp.views.map((v) => v.id).join(", ")}`, 404);
  return view;
};

const pageOf = (ctx: Ctx, pageId: unknown) => {
  const id = str(pageId, "pageId");
  const system = ctx.bp.systems.find((s) => s.id === id || s.name.toLowerCase() === id.toLowerCase());
  if (!system)
    throw new ToolError(`No page "${id}". Pages: ${ctx.bp.systems.map((s) => s.id).join(", ")}`, 404);
  return system;
};

const DAY_ARG = {
  type: "string",
  description: "YYYY-MM-DD on the workspace's clock (the schema's timeZone)",
};

export const MORE_TOOLS: Tool[] = [
  {
    name: "describe_view",
    title: "Describe a tab or card",
    description:
      "Every setting of one tab (viewId) or dashboard card (widgetId): a table's columns, filter, sort and grouping, a board's lanes and card fields, a calendar's date field, a form's questions and steps, a layout page's sections and parts, a website's blocks. Field names come with their ids.",
    permission: "pages:read",
    readOnly: true,
    properties: {
      viewId: { type: "string", description: "A tab id from describe_workspace" },
      widgetId: { type: "string", description: "A dashboard card id from describe_workspace" },
    },
    required: [],
    run: async (ctx, args) => {
      const widgetId = optStr(args.widgetId);
      if (widgetId) {
        const widget = ctx.bp.widgets.find((w) => w.id === widgetId);
        if (!widget) throw new ToolError(`No dashboard card "${widgetId}".`, 404);
        const page = ctx.bp.systems.find((s) => s.widgetIds.includes(widget.id));
        return { ...widget, ...(page ? { pageId: page.id, page: page.name } : {}) };
      }
      return describeView(ctx.bp, viewOf(ctx, args.viewId), ctx.workspaceId);
    },
  },
  {
    name: "read_view",
    title: "Read a tab or dashboard",
    description:
      "What a tab shows right now, worked out like the app draws it: a table's rows with its own filter, sort, columns, groups and totals; a board's lanes and cards; a calendar's events from..to; a schedule's bookings and free slots for a day; an approval queue's pending items; notes; a register's products; a layout page's parts (numbers, charts, lists); a website's blocks; a page's text or a drawing's shapes. Give pageId instead for that page's dashboard cards with their numbers.",
    permission: "records:read",
    readOnly: true,
    properties: {
      viewId: { type: "string", description: "A tab id from describe_workspace" },
      pageId: { type: "string", description: "A page id: its dashboard cards and tabs" },
      limit: { type: "integer", minimum: 1, maximum: 200 },
      offset: { type: "integer", minimum: 0, description: "nextOffset from the previous call" },
      from: DAY_ARG,
      to: DAY_ARG,
    },
    required: [],
    run: async (ctx, args) => {
      const doc = await current(ctx);
      if (!args.viewId && args.pageId)
        return readDashboard(doc.blueprint, doc.records, pageOf(ctx, args.pageId));
      return readView(doc.blueprint, doc.records, doc.docs, ctx.workspaceId, viewOf(ctx, args.viewId), {
        limit: optInt(args.limit),
        offset: optInt(args.offset),
        from: optStr(args.from),
        to: optStr(args.to),
      });
    },
  },
  {
    name: "write_page",
    title: "Write a page",
    description:
      "Replaces the text of a document page (markdown), a custom page (HTML; owners and admins, it's public code) or a drawing (canvas JSON { version: 1, shapes }). The text it replaces is kept as a version (page_history).",
    permission: "pages:write",
    readOnly: false,
    properties: { viewId: { type: "string" }, text: { type: "string" } },
    required: ["viewId", "text"],
    run: async (ctx, args) => {
      const view = viewOf(ctx, args.viewId);
      if (typeof args.text !== "string") throw new ToolError('"text" is required.');
      if (args.text.length > MAX_PAGE_CHARS)
        throw new ToolError("Page text is limited to 1,000,000 characters.");
      if (view.type !== "document" && view.type !== "html" && view.type !== "canvas")
        throw new ToolError(
          `"${view.name}" is a ${view.type} tab: its design changes through ask_everyops, its records with the record tools.`,
        );
      if (view.type === "html" && !canManage(ctx.role))
        throw new ToolError(
          "Custom HTML pages are shown to the public: only owners and admins can change them.",
          403,
        );
      const body = view.type === "canvas" ? JSON.stringify(parseCanvas(args.text)) : args.text;
      const updatedAt = await writePageText(ctx.workspaceId, actorOf(ctx.caller), view.id, body);
      return { ok: true, id: view.id, name: view.name, type: view.type, characters: body.length, updatedAt };
    },
  },
  {
    name: "page_history",
    title: "A page's earlier versions",
    description:
      "The kept versions of a page's text, newest first. With versionId, that version's text (put it back with write_page).",
    permission: "pages:read",
    readOnly: true,
    properties: { viewId: { type: "string" }, versionId: { type: "integer" } },
    required: ["viewId"],
    run: async (ctx, args) => {
      const view = viewOf(ctx, args.viewId);
      const versionId = optInt(args.versionId);
      if (versionId === undefined)
        return { id: view.id, versions: await pageVersions(db, ctx.workspaceId, view.id) };
      const body = await pageVersionBody(db, ctx.workspaceId, view.id, versionId);
      if (body === null) throw new ToolError(`No version ${versionId} of "${view.name}".`, 404);
      return { id: view.id, versionId, text: body.slice(0, 60_000), truncated: body.length > 60_000 };
    },
  },
  {
    name: "check_availability",
    title: "Check availability",
    description:
      "Free and taken times for one resource (a court, a room, a chair) from a day on, the way the booking form offers them; for whole-day bookings (stays, rentals), free and taken days. create_record on the booking type books one.",
    permission: "records:read",
    readOnly: true,
    properties: {
      entityId: { type: "string", description: "The booking record type; optional when there's only one" },
      resource: { type: "string", description: "The resource record's id or name" },
      date: DAY_ARG,
      days: { type: "integer", minimum: 1, maximum: 14 },
    },
    required: ["resource", "date"],
    run: async (ctx, args) => {
      const bookable = ctx.bp.entities.filter((e) => e.booking);
      const key = optStr(args.entityId);
      const entity = key
        ? bookable.find((e) => e.id === key || e.name.toLowerCase() === key.toLowerCase())
        : bookable.length === 1
          ? bookable[0]
          : undefined;
      if (!entity)
        throw new ToolError(
          bookable.length
            ? `Say which booking type: ${bookable.map((e) => e.id).join(", ")}`
            : "This workspace has no bookings with times.",
        );
      const date = str(args.date, "date");
      if (!DAY.test(date)) throw new ToolError("date is YYYY-MM-DD.");
      const doc = await current(ctx);
      const field = entity.fields.find((f) => f.id === entity.booking?.resourceFieldId);
      const type = doc.blueprint.entities.find((e) => e.id === field?.relation?.entityId);
      const wanted = str(args.resource, "resource").toLowerCase();
      const resource = doc.records.find(
        (r) =>
          r.entityId === type?.id &&
          (r.id === args.resource || String(r.data[type.primaryFieldId] ?? "").toLowerCase() === wanted),
      );
      if (!type || !resource)
        throw new ToolError(`No ${type?.name.toLowerCase() ?? "resource"} "${args.resource}".`, 404);
      return {
        recordType: entity.id,
        resource: { id: resource.id, name: String(resource.data[type.primaryFieldId] ?? resource.id) },
        ...availability(doc.blueprint, doc.records, entity, resource.id, date, optInt(args.days) ?? 1),
      };
    },
  },
  {
    name: "ask_everyops",
    title: "Ask EveryOps",
    description:
      "Asks the workspace's own assistant, in plain words, the way a person asks in the app: questions about the business and its records, or a change (add a field, a page, a report card, an automation, a website section; mark bookings paid; rewrite a page). Changes come back as a plan with steps and a planId; nothing changes until apply_change. A plan the key may not apply, team changes, and removals while the owner asks to approve them are saved for an owner or admin instead. Uses the workspace's AI allowance.",
    permission: "records:read",
    readOnly: false,
    properties: {
      message: { type: "string", description: "What to ask or change, in plain words" },
      pageId: { type: "string", description: "The page it's about, like the screen a person has open" },
      viewId: { type: "string" },
      recordId: { type: "string" },
    },
    required: ["message"],
    run: async (ctx, args) => {
      const message = str(args.message, "message").slice(0, 4000);
      const systemId = optStr(args.pageId) ? pageOf(ctx, args.pageId).id : undefined;
      const viewId = optStr(args.viewId) ? viewOf(ctx, args.viewId).id : undefined;
      const recordId = optStr(args.recordId);
      const screen: Screen = {
        area: systemId || viewId ? "page" : "home",
        ...(systemId ? { systemId } : {}),
        ...(viewId ? { viewId } : {}),
        ...(recordId ? { recordId } : {}),
      };
      return askEveryOps(ctx, message, screen);
    },
  },
  {
    name: "apply_change",
    title: "Apply a plan",
    description:
      "Applies a plan from ask_everyops, the way the Apply button does: checked against the design it was made for, saved to History, undoable with undo_change. Design changes need the design:apply permission; record and page changes need records:write and pages:write.",
    permission: "records:read",
    readOnly: false,
    properties: { planId: { type: "integer" } },
    required: ["planId"],
    run: async (ctx, args) => {
      const planId = optInt(args.planId);
      if (planId === undefined) throw new ToolError('"planId" is required.');
      return applyChange(ctx, planId);
    },
  },
  {
    name: "undo_change",
    title: "Undo a change",
    description:
      "Undoes a change in History (newest first: anything applied after it has to be undone before it). Design changes need design:apply.",
    permission: "records:read",
    readOnly: false,
    destructive: true,
    properties: {
      changeId: { type: "string", description: "A change id from list_changes or apply_change" },
    },
    required: ["changeId"],
    run: async (ctx, args) => undoChange(ctx, str(args.changeId, "changeId")),
  },
  {
    name: "list_changes",
    title: "History",
    description:
      "The workspace's change history, newest first: what changed, who applied it, whether it was undone.",
    permission: "records:read",
    readOnly: true,
    properties: { limit: { type: "integer", minimum: 1, maximum: 50 } },
    required: [],
    run: async (ctx, args) => listChanges(ctx, optInt(args.limit) ?? 20),
  },
  {
    name: "list_change_requests",
    title: "Requests from agents",
    description:
      "Requests and plans agents left in this workspace with their status: open (waiting for an owner or admin), planned, applied, drafted or dismissed.",
    permission: "design:propose",
    readOnly: true,
    properties: {},
    required: [],
    run: async (ctx) => ({ requests: await listRequests(ctx) }),
  },
  {
    name: "automation_runs",
    title: "Automation runs",
    description:
      "What the workspace's automations did recently: on which record, and whether their emails went.",
    permission: "records:read",
    readOnly: true,
    properties: {},
    required: [],
    run: async (ctx) => ({ runs: await listRuns(ctx.workspaceId) }),
  },
  {
    name: "run_automation",
    title: "Run an automation now",
    description:
      "Runs a scheduled or date automation straight away, for every record it applies to today, like Run now in the app (owners and admins).",
    permission: "manage",
    readOnly: false,
    properties: { ruleId: { type: "string", description: "An automation id from describe_workspace" } },
    required: ["ruleId"],
    run: async (ctx, args) => {
      const id = str(args.ruleId, "ruleId");
      const rule = ctx.bp.rules.find((r) => r.id === id || r.name.toLowerCase() === id.toLowerCase());
      if (!rule) throw new ToolError(`No automation "${id}".`, 404);
      if (rule.trigger.event !== "schedule" && rule.trigger.event !== "date_reached")
        throw new ToolError(
          `"${rule.name}" runs when records are saved; only scheduled and date automations run on their own.`,
        );
      const timed = await runTimedAutomations(new Date(), {
        workspaceId: ctx.workspaceId,
        ruleId: rule.id,
        force: true,
      });
      await deliverPending(timed.pending);
      await logActivity(db, actorOf(ctx.caller), {
        workspaceId: ctx.workspaceId,
        action: "automation.run",
        target: rule.name,
        count: timed.runs,
      });
      return { ok: true, automation: rule.name, runs: timed.runs };
    },
  },
  {
    name: "read_memory",
    title: "What Ask EveryOps remembers",
    description:
      "The workspace's memory: the owner's standing instructions, notes about the business, how the team works and its goals, and what the assistant may do on its own.",
    permission: "records:read",
    readOnly: true,
    properties: {},
    required: [],
    run: async (ctx) => readMemory(ctx.workspaceId),
  },
  {
    name: "update_memory",
    title: "Change what Ask EveryOps remembers",
    description:
      "Adds, changes or removes memory notes (kind: business, preference or goal; up to 300 characters each), and optionally replaces the standing instructions. Owners and admins.",
    permission: "manage",
    readOnly: false,
    properties: {
      edits: {
        type: "array",
        items: {
          type: "object",
          properties: {
            action: { type: "string", enum: ["add", "update", "remove"] },
            id: { type: "string", description: "The note's id, to update or remove it" },
            kind: { type: "string", enum: [...MEMORY_KINDS] },
            text: { type: "string" },
          },
          required: ["action"],
        },
      },
      instructions: { type: "string" },
    },
    required: [],
    run: async (ctx, args) => {
      const edits = (Array.isArray(args.edits) ? args.edits : []).map((raw, i): MemoryEdit => {
        const e = (raw ?? {}) as Args;
        const text = optStr(e.text)?.slice(0, MAX_NOTE_CHARS);
        const kind = MEMORY_KINDS.find((k) => k === e.kind);
        if (e.action === "add" && text) return { action: "add", kind: kind ?? "business", text };
        if (e.action === "update" && optStr(e.id) && text)
          return { action: "update", id: str(e.id, "id"), text, ...(kind ? { kind } : {}) };
        if (e.action === "remove" && optStr(e.id)) return { action: "remove", id: str(e.id, "id") };
        throw new ToolError(`edits[${i}]: add needs text; update needs id and text; remove needs id.`);
      });
      const changed = edits.length ? await rememberEdits(ctx.workspaceId, edits, "owner") : null;
      if (typeof args.instructions === "string") {
        const memory = await readMemory(ctx.workspaceId);
        await saveMemory(ctx.workspaceId, {
          instructions: args.instructions.slice(0, MAX_INSTRUCTIONS),
          notes: memory.notes.map((n) => ({ id: n.id, kind: n.kind, text: n.text })),
        });
      }
      return {
        ok: true,
        ...(changed
          ? { added: changed.added.length, updated: changed.updated.length, removed: changed.removed.length }
          : {}),
        memory: await readMemory(ctx.workspaceId),
      };
    },
  },
  {
    name: "read_activity",
    title: "Activity log",
    description:
      "Who or what changed the workspace, newest first (people, API keys, AI agents, automations). Filter by action (e.g. record.update, or record. for all record actions), result and days on the workspace's clock; before is the last id for the next page. Owners and admins.",
    permission: "manage",
    readOnly: true,
    properties: {
      action: { type: "string" },
      result: { type: "string", enum: ["ok", "denied", "conflict", "error"] },
      from: DAY_ARG,
      to: DAY_ARG,
      before: { type: "integer" },
      limit: { type: "integer", minimum: 1, maximum: 200 },
    },
    required: [],
    run: async (ctx, args) => {
      const day = (v: unknown, next = false) => {
        const s = optStr(v);
        if (!s || !DAY.test(s)) return null;
        // The day's start on the workspace's clock.
        return new Date(at(next ? addDays(s, 1) : s, "00:00"));
      };
      const items = await listActivity(ctx.workspaceId, {
        action: optStr(args.action) ?? null,
        result: optStr(args.result) ?? null,
        from: day(args.from),
        to: day(args.to, true),
        before: optInt(args.before) ?? null,
        limit: Math.min(optInt(args.limit) ?? 50, 200),
      });
      return {
        items: items.map(({ ip: _ip, userAgent: _ua, ...rest }) => rest),
        next: items.length ? items[items.length - 1].id : null,
      };
    },
  },
  {
    name: "list_team",
    title: "Team",
    description: "The workspace's members with their roles, and invites not yet accepted. Owners and admins.",
    permission: "manage",
    readOnly: true,
    properties: {},
    required: [],
    run: async (ctx) => {
      const team = await loadTeam(ctx.workspaceId);
      return {
        members: team.members.map((m) => ({
          name: m.name,
          email: m.email,
          role: m.role,
          joinedAt: m.joinedAt,
        })),
        invites: team.invites.map((i) => ({ email: i.email, role: i.role, invitedAt: i.invitedAt })),
      };
    },
  },
];

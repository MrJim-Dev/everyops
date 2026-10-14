import { z } from "zod";
import { findEntity, recordTitle } from "@/lib/blueprint/lookup";
import type { Block, Blueprint, DataRecord, Entity, FieldValue, System, View } from "@/lib/blueprint/types";
import { applyFilter } from "@/lib/engine/query";
import { formatDate } from "@/lib/format";
import { dateKey } from "@/lib/time";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * What the person has on screen when they ask: the page and tab from the URL, plus what the view itself
 * knows (the open record, the search, the dates shown). The assistant reads it to understand "this" and "here".
 */
export const screenSchema = z.object({
  area: z.enum(["home", "page", "ask", "history", "settings"]),
  systemId: z.string().max(80).optional(),
  viewId: z.string().max(80).optional(),
  settingsTab: z.enum(["general", "team", "publish"]).optional(),
  /** The record open in the side panel, or the note selected in a notebook. */
  recordId: z.string().max(120).optional(),
  search: z.string().max(200).optional(),
  /** First and last day shown by a calendar or schedule. */
  from: z.string().regex(DAY).optional(),
  to: z.string().regex(DAY).optional(),
  /** Calendar status filter: "active" hides cancelled, "all", or one option id. */
  status: z.string().max(60).optional(),
  /** A website section the person picked in the preview: the landing or form view and the block's id. */
  block: z.object({ viewId: z.string().max(80), blockId: z.string().max(80) }).optional(),
});
export type Screen = z.infer<typeof screenSchema>;

/** Views that list one record type, in the order the assistant prefers when it opens a record. */
const LISTS: View["type"][] = ["table", "kanban", "notes", "calendar", "approval_queue", "slot_grid"];
const MAX_LISTED = 40;
const MAX_DOC_CHARS = 6000;

/** The date a calendar or schedule places a record on. */
function dateFieldOf(view: View, entity: Entity): string | undefined {
  if (view.type === "calendar") return view.dateFieldId;
  if (view.type === "slot_grid") return entity.booking?.timeFieldId;
  return undefined;
}

function daysOf(value: FieldValue | undefined): [string, string] | undefined {
  if (value && typeof value === "object" && !Array.isArray(value) && "start" in value)
    return [dateKey(value.start), dateKey(value.end || value.start)];
  if (typeof value === "string" && value) return [dateKey(value), dateKey(value)];
  return undefined;
}

/** The records the person can see in the current view: its own filter, the search and the dates shown. */
export function visibleRecords(bp: Blueprint, records: DataRecord[], view: View, screen: Screen) {
  const entity = findEntity(bp, view.entityId);
  if (!entity) return [];
  let shown = applyFilter(bp, entity, records, "filter" in view ? view.filter : undefined);
  const status = entity.fields.find((f) => f.type === "status");
  const statusFilter = screen.status ?? (view.type === "slot_grid" ? "active" : undefined);
  if (status && statusFilter && statusFilter !== "all")
    shown = shown.filter((r) =>
      statusFilter === "active" ? r.data[status.id] !== "cancelled" : r.data[status.id] === statusFilter,
    );
  const dateField = dateFieldOf(view, entity);
  const { from, to } = screen;
  if (dateField && from && to)
    shown = shown.filter((r) => {
      const days = daysOf(r.data[dateField]);
      return !!days && days[0] <= to && days[1] >= from;
    });
  const q = screen.search?.trim().toLowerCase();
  if (q)
    shown = shown.filter((r) =>
      `${recordTitle(entity, r)} ${JSON.stringify(r.data)}`.toLowerCase().includes(q),
    );
  return shown;
}

function shownDates(screen: Screen) {
  if (!screen.from || !screen.to) return undefined;
  return screen.from === screen.to
    ? formatDate(screen.from, { withYear: true })
    : `${formatDate(screen.from)} – ${formatDate(screen.to, { withYear: true })}`;
}

/**
 * "Where the person is looking" for the assistant's prompt, plus the records on screen so they can go
 * first in the data and are never the part that gets cut off.
 */
export function describeScreen(
  bp: Blueprint,
  records: DataRecord[],
  screen: Screen,
  docs: Record<string, { body: string }> = {},
): { text: string; focusIds: string[]; entityId?: string } {
  const lines: string[] = [];
  const focusIds: string[] = [];
  let entityId: string | undefined;
  if (screen.area === "home") lines.push("- The workspace home.");
  else if (screen.area === "ask")
    lines.push("- Ask EveryOps, the page for describing changes to the workspace.");
  else if (screen.area === "history")
    lines.push("- History: the list of applied changes, where they can be undone.");
  else if (screen.area === "settings")
    lines.push(
      `- Settings, ${screen.settingsTab ?? "general"} tab (workspace name, team members, publishing).`,
    );
  else {
    const system = bp.systems.find((s) => s.id === screen.systemId);
    const viewId = screen.viewId ?? system?.viewIds[0];
    const view = system?.viewIds.includes(viewId ?? "") ? bp.views.find((v) => v.id === viewId) : undefined;
    const entity = view ? findEntity(bp, view.entityId) : undefined;
    entityId = entity?.id;
    if (!system) lines.push(`- A page that doesn't exist (${screen.systemId ?? "unknown"}).`);
    else if (!view) {
      const widgets = system.widgetIds
        .map((id) => bp.widgets.find((w) => w.id === id)?.title)
        .filter(Boolean);
      lines.push(
        `- Page: ${system.name} (${system.id}), a dashboard${widgets.length ? ` with: ${widgets.join(", ")}` : ""}.`,
      );
    } else {
      const tab = system.viewIds.length > 1 ? `, tab ${view.name} (${view.id})` : "";
      const what = entity ? `${view.type} of ${entity.pluralName}` : view.type;
      lines.push(`- Page: ${system.name} (${system.id})${tab}, showing a ${what}.`);
      const dates = shownDates(screen);
      const shownBits = [
        dates && `dates ${dates}`,
        screen.status && screen.status !== "active" && `status ${screen.status}`,
        screen.search?.trim() && `search "${screen.search.trim()}"`,
      ].filter(Boolean);
      if (shownBits.length) lines.push(`- Showing: ${shownBits.join("; ")}.`);
      if (entity && LISTS.includes(view.type)) {
        const shown = visibleRecords(bp, records, view, screen);
        focusIds.push(...shown.map((r) => r.id));
        const names = shown.slice(0, MAX_LISTED).map((r) => `${recordTitle(entity, r)} (${r.id})`);
        const more = shown.length > names.length ? ", …" : "";
        lines.push(
          `- On screen: ${shown.length} ${shown.length === 1 ? entity.name : entity.pluralName}${
            names.length ? `: ${names.join(", ")}${more}` : ""
          }.`,
        );
      }
      if (view.type === "document") {
        const body = (docs[view.id]?.body ?? view.starter ?? "").slice(0, MAX_DOC_CHARS);
        lines.push(body.trim() ? `- The page's text:\n${body}` : "- The page is empty.");
      }
      if ((view.type === "landing" || view.type === "form") && view.blocks?.length)
        lines.push(
          `- The page's sections (blocks), top to bottom:\n${view.blocks
            .map((b) => `  - ${JSON.stringify(blockWords(b, docs, view.id))}`)
            .join("\n")}`,
        );
    }
  }
  const picked = screen.block && bp.views.find((v) => v.id === screen.block?.viewId);
  const pickedBlock =
    picked && (picked.type === "landing" || picked.type === "form")
      ? picked.blocks?.find((b) => b.id === screen.block?.blockId)
      : undefined;
  if (picked && pickedBlock)
    lines.push(
      `- The person clicked one section of ${picked.name} (view ${picked.id}) to edit it: ${JSON.stringify(
        blockWords(pickedBlock, docs, picked.id),
      )}. "This", "it", "here" and "the section" mean that block. Change its words with a renames entry (kind section, id ${pickedBlock.id}); change only what they ask and keep the rest of its words.`,
    );
  const open = screen.recordId ? records.find((r) => r.id === screen.recordId) : undefined;
  const openEntity = open && findEntity(bp, open.entityId);
  if (open && openEntity) {
    focusIds.unshift(open.id);
    lines.push(
      `- Open in the side panel: ${openEntity.name} "${recordTitle(openEntity, open)}": ${JSON.stringify({ id: open.id, ...open.data })}`,
    );
  }
  return { text: lines.join("\n"), focusIds: [...new Set(focusIds)], entityId: entityId ?? openEntity?.id };
}

/** A block as the assistant should read it: its current words, including any the team edited in the app. */
function blockWords(
  b: Block,
  docs: Record<string, { body: string }>,
  viewId: string,
): Record<string, unknown> {
  const edited = docs[`${viewId}:${b.id}`]?.body || undefined;
  switch (b.type) {
    case "hero": {
      let mine: Record<string, string> = {};
      try {
        mine = edited ? JSON.parse(edited) : {};
      } catch {}
      return {
        blockId: b.id,
        type: "hero",
        title: mine.heading || b.heading,
        text: mine.subheading || b.subheading,
        button: b.ctaViewId ? mine.ctaLabel || b.ctaLabel : undefined,
      };
    }
    case "text":
      return { blockId: b.id, type: "text", text: (edited ?? b.markdown).slice(0, 2000) };
    case "html":
      return { blockId: b.id, type: "html" };
    case "records":
      return { blockId: b.id, type: "records", title: b.title, shows: b.entityId, layout: b.layout };
    case "form":
      return { blockId: b.id, type: "form", title: b.title, form: b.viewId };
    case "contact": {
      const items = [
        b.phone && { title: "Phone", body: b.phone },
        b.email && { title: "Email", body: b.email },
        b.address && { title: "Address", body: b.address },
        b.hours && { title: "Hours", body: b.hours },
      ].filter(Boolean);
      return { blockId: b.id, type: "contact", title: b.title, items };
    }
    default:
      return { blockId: b.id, type: b.type, title: b.title, items: b.items };
  }
}

/** Where the assistant can take someone. Flat, because Gemini fills flat shapes reliably. */
export type RawGoTo = {
  to: "none" | "page" | "record" | "home" | "history" | "settings" | "team" | "publish" | "ask";
  pageId?: string;
  tabId?: string;
  recordId?: string;
  open: boolean;
};

/** A checked destination. path is relative to the workspace: append it to the workspace's basePath. */
export type Navigation = { path: string; label: string; recordId?: string; open: boolean };

const norm = (x: string) =>
  x
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .replace(/(es|s)$/, "");

function byIdOrName<T extends { id: string; name: string }>(items: T[], key: string | undefined) {
  if (!key) return undefined;
  return (
    items.find((x) => x.id === key) ??
    items.find((x) => norm(x.id) === norm(key) || norm(x.name) === norm(key))
  );
}

/** The workspace-relative path of the screen, so a record can be opened without leaving the page. */
export function screenPath(screen: Screen): string {
  if (screen.area === "page" && screen.systemId)
    return `/${screen.systemId}${screen.viewId ? `/${screen.viewId}` : ""}`;
  if (screen.area === "settings")
    return screen.settingsTab && screen.settingsTab !== "general"
      ? `/settings/${screen.settingsTab}`
      : "/settings";
  if (screen.area === "ask" || screen.area === "history") return `/${screen.area}`;
  return "";
}

function pagePath(system: System, view?: View) {
  const tab = view && system.viewIds.length > 1 && system.viewIds[0] !== view.id ? view : undefined;
  return `/${system.id}${tab ? `/${tab.id}` : ""}`;
}

/**
 * Turns the assistant's goTo into a link, or nothing if it points at something that doesn't exist or the person
 * can't open. Loose names ("calendar", "Courts") are matched to ids, since the model sometimes uses them.
 */
export function resolveGoTo(
  bp: Blueprint,
  records: DataRecord[],
  raw: RawGoTo | undefined,
  ctx: { screen: Screen; canManage: boolean },
): Navigation | undefined {
  if (!raw || raw.to === "none") return undefined;
  const open = raw.open;
  switch (raw.to) {
    case "home": {
      const first = bp.systems[0];
      return first ? { path: `/${first.id}`, label: first.name, open } : undefined;
    }
    case "history":
      return { path: "/history", label: "History", open };
    case "settings":
      return { path: "/settings", label: "Settings", open };
    case "team":
      return { path: "/settings/team", label: "Team settings", open };
    case "publish":
      return ctx.canManage ? { path: "/settings/publish", label: "Publish settings", open } : undefined;
    case "ask":
      return ctx.canManage ? { path: "/ask", label: "Ask EveryOps", open } : undefined;
    case "page": {
      let system = byIdOrName(bp.systems, raw.pageId);
      const onPage = system ? bp.views.filter((v) => system?.viewIds.includes(v.id)) : [];
      const view = byIdOrName(onPage, raw.tabId) ?? byIdOrName(bp.views, raw.tabId);
      if (view && !system?.viewIds.includes(view.id))
        system = bp.systems.find((s) => s.viewIds.includes(view.id));
      if (!system) return undefined;
      const tab = view && system.viewIds.length > 1 ? view : undefined;
      return { path: pagePath(system, tab), label: tab ? `${system.name} › ${tab.name}` : system.name, open };
    }
    case "record": {
      const record = records.find((r) => r.id === raw.recordId);
      const entity = record && findEntity(bp, record.entityId);
      if (!record || !entity) return undefined;
      const label = `${entity.name}: ${recordTitle(entity, record)}`;
      const here = bp.views.find((v) => v.id === ctx.screen.viewId);
      if (ctx.screen.area === "page" && here?.entityId === entity.id && LISTS.includes(here.type))
        return { path: screenPath(ctx.screen), label, recordId: record.id, open };
      for (const type of LISTS)
        for (const s of bp.systems) {
          const v = bp.views.find(
            (x) => s.viewIds.includes(x.id) && x.type === type && x.entityId === entity.id,
          );
          if (v) return { path: pagePath(s, v), label, recordId: record.id, open };
        }
      // No list shows this record type: open it over whatever page the person is on.
      return { path: screenPath(ctx.screen), label, recordId: record.id, open };
    }
  }
}
/**
 * What a reply is based on, as links: record ids open the record, page and tab ids open the page. Unknown ids
 * are dropped, so a made-up id never becomes a broken link.
 */
export function resolveSources(
  bp: Blueprint,
  records: DataRecord[],
  ids: string[],
  ctx: { screen: Screen; canManage: boolean },
): Navigation[] {
  const out: Navigation[] = [];
  for (const id of ids) {
    const nav = records.some((r) => r.id === id)
      ? resolveGoTo(bp, records, { to: "record", recordId: id, open: false }, ctx)
      : bp.systems.some((s) => s.id === id)
        ? resolveGoTo(bp, records, { to: "page", pageId: id, open: false }, ctx)
        : bp.views.some((v) => v.id === id)
          ? resolveGoTo(bp, records, { to: "page", tabId: id, open: false }, ctx)
          : undefined;
    if (nav && !out.some((n) => n.path === nav.path && n.recordId === nav.recordId)) out.push(nav);
    if (out.length === 8) break;
  }
  return out;
}

/** The workspace-relative path of the screen, so a record can be opened without leaving the page. */

import "server-only";
import type { Part } from "@google/genai";
import { type AttachmentRef, attachmentsIn } from "@/lib/assistant/attachments";
import {
  describeScreen,
  type Navigation,
  resolveGoTo,
  resolveSources,
  type Screen,
} from "@/lib/assistant/screen";
import { markersOf, stepsFromMarkers } from "@/lib/blueprint/form-steps";
import type {
  Block,
  Blueprint,
  DataRecord,
  Entity,
  Field,
  FormStep,
  FormView,
  RecordData,
  View,
  Widget,
} from "@/lib/blueprint/types";
import { validateBlueprint } from "@/lib/blueprint/validate";
import { requestGuide } from "@/lib/catalog/playbooks";
import { widgetValue } from "@/lib/engine/aggregate";
import {
  applyOps,
  type BlockPatch,
  type ChangeOp,
  type ChangePlan,
  commitChange,
  type DocOp,
  type RecordOp,
  type TeamOp,
} from "@/lib/engine/changes";
import { impliedRules, misplacedStock, replaceableRules } from "@/lib/engine/implied-rules";
import { metricFormatter } from "@/lib/engine/metric-format";
import { optionUsage, strandedOptions } from "@/lib/engine/options";
import { applyRecordOps } from "@/lib/engine/records";
import { registerFields } from "@/lib/engine/register";
import { formSnippet } from "@/lib/public/html-page";
import {
  bookingDayFieldIds,
  bookingEndDayFieldIds,
  isPublic,
  publicFieldsOf,
  publicForm,
} from "@/lib/public/resolve";
import { copyFromBlocks, mainForm, standardBlocks } from "@/lib/public/site-template";
import { type Invite, type Member, randomToken } from "@/lib/store/workspace-model";
import { todayKey } from "@/lib/time";
import {
  ASSISTANT_RETRY_NOTE,
  ASSISTANT_SYSTEM,
  ASSISTANT_TEXT_LIMITS,
  type AssistantAnswer,
  assistantAnswer,
  designOp,
} from "./assistant-prompt";
import { attachmentParts, copyPhotoToWorkspace } from "./attachments";
import { fillNotesView, tidyBlocks, toEntity, toFieldValue, toRule, toView } from "./design";
import { view } from "./design-prompt";
import { dataDigest } from "./digest";
import { generateJsonHedged } from "./gemini";
import { lookupData } from "./lookup";

export type AssistantMessage = { role: "user" | "assistant"; text: string; attachments?: AttachmentRef[] };
export type AssistantResult =
  | {
      ok: true;
      kind: "answer" | "plan" | "clarify";
      reply: string;
      suggestions: string[];
      plan?: ChangePlan;
      /** A checked page or record to open, now (open) or as a link. */
      navigate?: Navigation;
      /** What the reply is based on, as links that open the record or page. */
      sources?: Navigation[];
    }
  | { ok: false; message: string };

type RawPlan = AssistantAnswer["plan"];

const DATE_TYPES = new Set(["date", "datetime", "time_range"]);
/** Every view type; the answer schema lets free pages name theirs as text, so it's checked here. */
const VIEW_TYPES = new Set<string>(view.options.map((o) => (o.shape.type as { value: string }).value));

/** Fills the parts of a new view that Gemini often leaves out, from the record type's own fields. */
function fillView(view: View, entity: Entity) {
  const has = (id: string | undefined) => !!id && entity.fields.some((f) => f.id === id);
  const status = entity.fields.find((f) => f.type === "status");
  switch (view.type) {
    case "table":
      view.fieldIds = view.fieldIds.filter(has);
      if (!view.fieldIds.length)
        view.fieldIds = entity.fields
          .filter((f) => f.type !== "long_text")
          .slice(0, 6)
          .map((f) => f.id);
      break;
    case "kanban":
      if (!has(view.statusFieldId) && status) view.statusFieldId = status.id;
      view.cardFieldIds = view.cardFieldIds.filter((id) => has(id) && id !== view.statusFieldId);
      break;
    case "calendar": {
      if (!has(view.dateFieldId)) {
        const date = entity.fields.find((f) => DATE_TYPES.has(f.type));
        if (date) view.dateFieldId = date.id;
      }
      if (!has(view.titleFieldId)) view.titleFieldId = entity.primaryFieldId;
      break;
    }
    case "approval_queue":
      if (!has(view.statusFieldId) && status) view.statusFieldId = status.id;
      break;
    case "form":
      view.fieldIds = view.fieldIds.filter(has);
      break;
  }
}

/** Charts need a date to plot over or a field to group by; a donut always groups. Drops ids that don't exist. */
function fillWidget(widget: Widget, entity: Entity) {
  const has = (id: string | undefined) => !!id && entity.fields.some((f) => f.id === id);
  if (widget.metric.fieldId && !has(widget.metric.fieldId)) widget.metric = { op: "count" };
  const chart = widget.chart;
  if (widget.type !== "chart" || !chart) return;
  if (!has(chart.groupByFieldId)) delete chart.groupByFieldId;
  if (!has(chart.splitByFieldId)) delete chart.splitByFieldId;
  if (!has(chart.dateFieldId)) {
    delete chart.dateFieldId;
    if (!chart.groupByFieldId) {
      const date = entity.fields.find((f) => DATE_TYPES.has(f.type));
      if (date) chart.dateFieldId = date.id;
    }
  }
  if (chart.kind === "donut" && !chart.groupByFieldId) chart.kind = "bar";
  if (!chart.bucket) chart.bucket = "day";
}

type RawRemoval = Extract<RawPlan["ops"][number], { op: "remove" }>;

/** The model's "remove" turned into one removal op, or the reason it can't be. */
function toRemoval(bp: Blueprint, o: RawRemoval, planned: ChangeOp[]): ChangeOp | string {
  const list = (ids: string[]) => (ids.length ? ` (existing: ${ids.slice(0, 30).join(", ")})` : "");
  switch (o.what) {
    case "record_type":
      return bp.entities.some((e) => e.id === o.id)
        ? { op: "remove_entity", entityId: o.id }
        : `"${o.id}" isn't a record type${list(bp.entities.map((e) => e.id))}`;
    case "field": {
      const entity = bp.entities.find((e) => e.id === o.parentId);
      if (!entity) return `parentId must be the field's record type${list(bp.entities.map((e) => e.id))}`;
      if (!entity.fields.some((f) => f.id === o.id))
        return `"${o.id}" isn't a field of ${entity.id}${list(entity.fields.map((f) => f.id))}`;
      if (entity.primaryFieldId === o.id) return `"${o.id}" names each ${entity.name} and can't be removed`;
      return { op: "remove_field", entityId: entity.id, fieldId: o.id };
    }
    case "page":
      return bp.systems.some((s) => s.id === o.id)
        ? { op: "remove_system", systemId: o.id }
        : `"${o.id}" isn't a page${list(bp.systems.map((s) => s.id))}`;
    case "tab":
      return bp.views.some((v) => v.id === o.id)
        ? { op: "remove_view", viewId: o.id }
        : `"${o.id}" isn't a tab${list(bp.views.map((v) => v.id))}`;
    case "card":
      return bp.widgets.some((w) => w.id === o.id)
        ? { op: "remove_widget", widgetId: o.id }
        : `"${o.id}" isn't a card${list(bp.widgets.map((w) => w.id))}`;
    case "rule":
      return bp.rules.some((r) => r.id === o.id)
        ? { op: "remove_rule", ruleId: o.id }
        : `"${o.id}" isn't a rule${list(bp.rules.map((r) => r.id))}`;
    case "block": {
      const view = bp.views.find((v) => v.id === o.parentId);
      const blocks =
        view && (view.type === "form" || view.type === "landing") ? (view.blocks ?? []) : undefined;
      const added = planned.flatMap((p) =>
        p.op === "add_block" && p.viewId === o.parentId ? [p.block.id] : [],
      );
      if (!view || !blocks) return "parentId must be the form or landing view the block is on";
      return blocks.some((b) => b.id === o.id) || added.includes(o.id)
        ? { op: "remove_block", viewId: view.id, blockId: o.id }
        : `"${o.id}" isn't a block on ${o.parentId}${list(blocks.map((b) => b.id))}`;
    }
  }
}

type RawBlockEdit = {
  title?: string;
  text?: string;
  items?: { title: string; body: string }[];
};

/**
 * A section's new words as Gemini writes them ("Title: …", "Text: …", "Button: …", "Item: title | body",
 * "Phone: …"), as title, text and item rows. A line without a label is the text.
 */
export function sectionWords(raw: string): RawBlockEdit {
  const out: RawBlockEdit = { items: [] };
  const extra: string[] = [];
  for (const line of raw.split("\n")) {
    const m = /^\s*([A-Za-z ]{2,12}):\s*(.*)$/.exec(line);
    const label = m?.[1].trim().toLowerCase();
    const value = m?.[2].trim() ?? "";
    if (!m || !label) {
      if (line.trim()) extra.push(line);
      continue;
    }
    if (label === "title" || label === "heading" || label === "headline") out.title = value;
    else if (label === "text" || label === "intro" || label === "subheading" || label === "body")
      out.text = value;
    else if (label === "item" || label === "step" || label === "highlight") {
      const [title, ...body] = value.split("|");
      out.items?.push({ title: title.trim(), body: body.join("|").trim() });
    } else out.items?.push({ title: m[1].trim(), body: value });
  }
  if (extra.length) out.text = [out.text, ...extra].filter(Boolean).join("\n");
  return out;
}

/** Gemini's flat section edit, turned into the words that block type has. */
export function blockPatchFrom(block: Block, o: RawBlockEdit): BlockPatch {
  const title = o.title?.trim() || undefined;
  const text = o.text?.trim() || undefined;
  const items = o.items
    ?.map((i) => ({ title: i.title.trim(), body: i.body.trim() }))
    .filter((i) => i.title || i.body);
  switch (block.type) {
    case "hero": {
      // The hero's button text comes as an items row titled Button (keeps Gemini's schema small).
      const button = items?.find((i) => /button|cta/i.test(i.title))?.body;
      return {
        ...(title ? { heading: title } : {}),
        ...(text ? { subheading: text } : {}),
        ...(button ? { ctaLabel: button } : {}),
      };
    }
    case "text":
      return text ? { markdown: text } : {};
    case "records":
    case "form":
      return title ? { title } : {};
    case "highlights":
    case "steps":
      return {
        ...(title ? { title } : {}),
        ...(items?.length ? { items: items.filter((i) => i.title) } : {}),
      };
    case "contact": {
      const row = (re: RegExp) => items?.find((i) => re.test(i.title))?.body;
      const details = {
        phone: row(/phone|mobile|call|tel/i),
        email: row(/mail/i),
        address: row(/address|location|where|map/i),
        hours: row(/hour|open|time|schedule/i),
      };
      return {
        ...(title ? { title } : {}),
        ...Object.fromEntries(Object.entries(details).filter(([, v]) => v !== undefined)),
      };
    }
    default:
      return {};
  }
}

/**
 * "Turn the bookings list into a board" arrives as remove the tab plus add one. Adds run before removals, so a new
 * tab reusing the old tab's id was skipped (the id existed) and the removal then took the only copy: the plan said
 * Applied and the tab was gone. Even with a new id the board landed at the end of the tabs. A removal and an
 * addition on the same page become one replace_view that keeps the tab's place. An addition that reuses a tab id
 * nothing removes is an error sent back to Gemini instead of a silent no-op.
 */
export function replacedTabs(bp: Blueprint, ops: ChangeOp[], errors: string[]) {
  const systemOf = (viewId: string) => bp.systems.find((s) => s.viewIds.includes(viewId));
  const take = (op: ChangeOp) => ops.splice(ops.indexOf(op), 1);
  for (const add of ops.filter((o): o is Extract<ChangeOp, { op: "add_view" }> => o.op === "add_view")) {
    const removals = ops.filter((o): o is Extract<ChangeOp, { op: "remove_view" }> => o.op === "remove_view");
    const sameId = removals.find((r) => r.viewId === add.view.id);
    if (sameId) {
      take(sameId);
      ops.splice(ops.indexOf(add), 1, { op: "replace_view", viewId: sameId.viewId, view: add.view });
      continue;
    }
    if (bp.views.some((v) => v.id === add.view.id)) {
      errors.push(
        `add_view: tab "${add.view.id}" already exists. Give the new tab its own id, or remove the old one in the same plan to replace it.`,
      );
      continue;
    }
    // One tab out and one tab in on the same page is a swap, even with a new id.
    const here = removals.filter((r) => systemOf(r.viewId)?.id === add.systemId);
    const added = ops.filter((o) => o.op === "add_view" && o.systemId === add.systemId);
    if (here.length === 1 && added.length === 1) {
      take(here[0]);
      ops.splice(ops.indexOf(add), 1, { op: "replace_view", viewId: here[0].viewId, view: add.view });
    }
  }
}

/**
 * What a plan adds that isn't in the workspace after applying it. An op that quietly does nothing (an id that
 * already existed) must never reach the person as "Applied".
 */
export function missingAfterApply(ops: ChangeOp[], next: Blueprint): string[] {
  return ops.flatMap((op) => {
    if ((op.op === "add_view" || op.op === "replace_view") && !next.views.some((v) => v.id === op.view.id))
      return [`${op.op}: tab "${op.view.id}" isn't in the workspace after the plan; use a new id`];
    if (op.op === "add_widget" && !next.widgets.some((w) => w.id === op.widget.id))
      return [`add_widget: card "${op.widget.id}" isn't in the workspace after the plan; use a new id`];
    if (op.op === "add_entity" && !next.entities.some((e) => e.id === op.entity.id))
      return [`add_entity: "${op.entity.id}" isn't in the workspace after the plan; use a new id`];
    return [];
  });
}

/**
 * What a public form really shows a visitor, for the assistant's context: listed fields visitors never see (the team
 * fills those in), what the booking slot picker fills, and whether a booking can run several slots. Without it the
 * assistant read a proof-of-payment field in the form's design and said visitors could upload one when they couldn't.
 */
function visitorView(bp: Blueprint, view: FormView): string {
  if (!isPublic(view)) return "";
  const entity = bp.entities.find((e) => e.id === view.entityId);
  if (!entity) return "";
  const asked = new Set(publicFieldsOf(bp, view).map((f) => f.id));
  const hidden = view.fieldIds.filter((id) => !asked.has(id) && entity.fields.some((f) => f.id === id));
  const booking = entity.booking;
  const day = [...bookingDayFieldIds(entity), ...bookingEndDayFieldIds(entity)].filter((id) => asked.has(id));
  const dates = entity.fields.find((f) => f.id === booking?.timeFieldId)?.range === "dates";
  const picker = dates
    ? "a month calendar (check-in, then check-out)"
    : `a ${{ days: "day strip", grid: "court grid", month: "month calendar" }[view.bookingLayout ?? "days"]} calendar, ${view.multipleSlots === false ? "one slot per booking" : "several slots in a row allowed"}`;
  return [
    hidden.length ? `, visitors don't see ${hidden.join(", ")} (the team fills them in)` : "",
    booking && asked.has(booking.timeFieldId)
      ? `, visitors pick ${booking.timeFieldId}${day.length ? ` (and ${day.join(", ")} follow it)` : ""} on ${picker}`
      : "",
  ].join("");
}

export function toDesignOps(
  bp: Blueprint,
  raw: RawPlan["ops"],
  renames: RawPlan["renames"] = [],
  formulas: RawPlan["formulas"] = [],
  workspaceName = "",
): { ops: ChangeOp[]; errors: string[] } {
  const ops: ChangeOp[] = [];
  const errors: string[] = [];
  const formulaFor = new Set(formulas.map((f) => f.widgetId));
  // A plan that adds one new section usually means its new views and widgets go there.
  const newSystems = raw.flatMap((o) => (o.op === "add_system" && o.system ? [o.system.id] : []));
  const defaultSystem = newSystems.length === 1 ? newSystems[0] : undefined;
  for (const [i, o] of raw.entries()) {
    const at = `ops[${i}] ${o.op}`;
    const systemId = ("systemId" in o ? o.systemId : undefined) || defaultSystem;
    const newName = "name" in o ? o.name.trim() : "";
    switch (o.op) {
      case "add_field":
        if (o.entityId && o.field)
          ops.push({ op: "add_field", entityId: o.entityId, field: o.field as Field });
        else errors.push(`${at}: needs entityId and field`);
        break;
      case "update_field":
        if (o.entityId && o.fieldId && o.patch)
          ops.push({ op: "update_field", entityId: o.entityId, fieldId: o.fieldId, patch: o.patch });
        else errors.push(`${at}: needs entityId, fieldId and patch`);
        break;
      case "add_view_field":
        // Without a view, new fields are shown in their tables automatically (below).
        if (o.viewId && o.fieldId) ops.push({ op: "add_view_field", viewId: o.viewId, fieldId: o.fieldId });
        break;
      case "rename_workspace":
        if (newName) ops.push({ op: "rename_workspace", name: newName });
        else errors.push(`${at}: needs name`);
        break;
      case "add_entity":
        if (o.entity) ops.push({ op: "add_entity", entity: toEntity(o.entity) });
        else errors.push(`${at}: needs entity`);
        break;
      case "add_view":
        if (o.view && !VIEW_TYPES.has(o.view.type))
          errors.push(`${at}: "${o.view.type}" isn't a view type (${[...VIEW_TYPES].join(", ")})`);
        else if (o.view && systemId) {
          // A custom HTML page's draft arrives as starter (free pages share one shape in the answer schema).
          const raw = o.view as typeof o.view & { starter?: string };
          const view = toView(raw.type === "html" && raw.starter ? { ...raw, html: raw.starter } : raw);
          // A multi-step form arrives as "# Step title" markers among its fields.
          if (view.type === "form") {
            const { fieldIds, steps } = stepsFromMarkers(view.fieldIds);
            view.fieldIds = fieldIds;
            if (steps) Object.assign(view, { steps, review: true });
          }
          ops.push({ op: "add_view", systemId, view });
        } else errors.push(`${at}: needs view and systemId`);
        break;
      case "add_widget":
        if (o.widget && systemId) {
          // The assistant's widget shapes leave out what has a good default (to fit Gemini's schema budget): an
          // agenda or heatmap counts records, and a stat that compares periods shows its trend line.
          const { dateFieldId, fieldIds, ...rest } = structuredClone(o.widget) as Widget & {
            dateFieldId?: string;
            fieldIds?: string[];
          };
          const widget = rest as Widget;
          if (widget.type === "agenda" && dateFieldId)
            widget.agenda = { dateFieldId, ...(fieldIds?.length ? { fieldIds } : {}) };
          if (widget.type === "heatmap" && dateFieldId) widget.heatmap = { dateFieldId };
          widget.metric ??= { op: "count" };
          if (widget.type === "stat" && widget.compare) widget.sparkline = true;
          // Stat and progress share a shape: a progress bar needs its target, a stat has none.
          if (widget.type === "progress" && !widget.target) widget.type = "stat";
          if (widget.type === "stat") delete widget.target;
          if (!widget.filter) delete widget.filter;
          ops.push({ op: "add_widget", systemId, widget });
        } else errors.push(`${at}: needs widget and systemId`);
        break;
      case "update_widget": {
        const widget = bp.widgets.find((w) => w.id === o.widgetId);
        if (!widget) {
          errors.push(
            `${at}: widget "${o.widgetId}" doesn't exist (widgets: ${bp.widgets.map((w) => w.id).join(", ")})`,
          );
          break;
        }
        const patch: Extract<ChangeOp, { op: "update_widget" }>["patch"] = {
          ...(o.title?.trim() ? { title: o.title.trim() } : {}),
          ...(o.filter !== undefined ? { filter: o.filter } : {}),
          ...(o.metric ? { metric: o.metric } : {}),
          ...(o.target !== undefined ? { target: o.target } : {}),
        };
        if (Object.keys(patch).length) ops.push({ op: "update_widget", widgetId: widget.id, patch });
        else if (!formulaFor.has(widget.id)) errors.push(`${at}: nothing to change`);
        break;
      }
      case "add_system":
        if (o.system) ops.push({ op: "add_system", system: { ...o.system, viewIds: [], widgetIds: [] } });
        else errors.push(`${at}: needs system`);
        break;
      case "add_rule":
        if (o.rule) ops.push({ op: "add_rule", rule: toRule(o.rule) });
        else errors.push(`${at}: needs rule`);
        break;
      case "move_view":
        if (o.viewId && systemId) ops.push({ op: "move_view", viewId: o.viewId, systemId });
        else errors.push(`${at}: needs viewId and systemId`);
        break;
      case "update_view": {
        const view = bp.views.find((v) => v.id === o.viewId);
        const entity = view && bp.entities.find((e) => e.id === view.entityId);
        // A form's fields can carry "# Step title" markers that split it into steps.
        const split = view?.type === "form" && o.fieldIds ? stepsFromMarkers(o.fieldIds) : undefined;
        // "@How to pay" or "@how_to_pay": blocks named by title or id, on the form or added to it in this plan.
        if (split?.steps && view?.type === "form") {
          const blocks = [
            ...(view.blocks ?? []),
            ...ops.flatMap((x) => (x.op === "add_block" && x.viewId === view.id ? [x.block] : [])),
          ];
          const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
          for (const s of split.steps)
            if (s.blockIds)
              s.blockIds = s.blockIds.map(
                (id) =>
                  blocks.find((b) => b.id === id)?.id ??
                  blocks.find(
                    (b) => key(b.id) === key(id) || ("title" in b && key(b.title ?? "") === key(id)),
                  )?.id ??
                  id,
              );
        }
        const fieldIds = split ? split.fieldIds : o.fieldIds;
        // Fields added earlier in the same plan count too ("add guest name and phone, then ask them on the form").
        const added = ops.flatMap((x) =>
          x.op === "add_field" && x.entityId === entity?.id ? [x.field.id] : [],
        );
        const unknown = entity
          ? (fieldIds ?? []).filter((id) => !entity.fields.some((f) => f.id === id) && !added.includes(id))
          : [];
        // A field of another record type on this view (an order line's product on the order form) is a slip: it's
        // dropped, and the rest of the update stands. Only a list with nothing valid left goes back to Gemini.
        if (unknown.length && entity && unknown.length === (fieldIds ?? []).length) {
          errors.push(
            `${at}: ${unknown.join(", ")} aren't fields of ${entity.id} (fields: ${entity.fields.map((f) => f.id).join(", ")})`,
          );
          break;
        }
        const kept = fieldIds?.filter((id) => !unknown.includes(id));
        for (const s of split?.steps ?? []) s.fieldIds = s.fieldIds.filter((id) => !unknown.includes(id));
        if (
          view &&
          kept?.length &&
          !["table", "kanban", "approval_queue", "form", "checkout"].includes(view.type)
        ) {
          errors.push(`${at}: a ${view.type} view has no columns to order`);
          break;
        }
        const patch = {
          ...(o.public !== undefined ? { public: o.public } : {}),
          ...(o.intro ? { intro: o.intro } : {}),
          ...(kept?.length ? { fieldIds: kept } : {}),
          // Steps keep the form's own review setting; a form getting steps for the first time ends with one.
          ...(split?.steps
            ? {
                steps: split.steps,
                review: view?.type === "form" && view.steps?.length ? !!view.review : true,
              }
            : {}),
        };
        if (Object.keys(patch).length) ops.push({ op: "update_view", viewId: o.viewId, patch });
        break;
      }
      case "add_block":
        ops.push({
          op: "add_block",
          viewId: o.viewId,
          block: structuredClone(o.block) as Block,
          ...(o.beforeBlockId ? { beforeBlockId: o.beforeBlockId } : {}),
        });
        break;
      case "remove": {
        const removal = toRemoval(bp, o, ops);
        if (typeof removal === "string") errors.push(`${at} ${o.what}: ${removal}`);
        else ops.push(removal);
        break;
      }
      case "move_page":
        // A page added earlier in this plan can be moved too ("add a website page at the top").
        if (
          bp.systems.some((s) => s.id === o.pageId) ||
          ops.some((x) => x.op === "add_system" && x.system.id === o.pageId)
        )
          ops.push({ op: "move_system", systemId: o.pageId, index: Math.round(o.position) });
        else errors.push(`${at}: page "${o.pageId}" doesn't exist`);
        break;
    }
  }
  // Formula cards: the formula goes on a card added in this plan, or onto an existing card as an update.
  for (const [i, f] of formulas.entries()) {
    const { widgetId, ...rest } = f;
    const calc = structuredClone(rest);
    const added = ops.find((x) => x.op === "add_widget" && x.widget.id === widgetId);
    const existing = bp.widgets.find((w) => w.id === widgetId);
    const type = added?.op === "add_widget" ? added.widget.type : existing?.type;
    if (!type) {
      errors.push(
        `formulas[${i}]: widget "${widgetId}" doesn't exist; add a stat with add_widget first (existing: ${bp.widgets.map((w) => w.id).join(", ")})`,
      );
      continue;
    }
    if (type !== "stat" && type !== "progress") {
      errors.push(
        `formulas[${i}]: "${widgetId}" is a ${type}; only stat and progress widgets take a formula`,
      );
      continue;
    }
    if (added?.op === "add_widget") {
      added.widget.calc = calc;
      continue;
    }
    const update = ops.find((x) => x.op === "update_widget" && x.widgetId === widgetId);
    if (update?.op === "update_widget") update.patch.calc = calc;
    else ops.push({ op: "update_widget", widgetId, patch: { calc } });
  }
  for (const [i, r] of renames.entries()) {
    const name = r.newName.trim();
    if (!name) errors.push(`renames[${i}]: needs newName`);
    else if (r.kind === "section") {
      // New words for a website section travel as a rename (keeps Gemini's schema in budget).
      const view = bp.views.find(
        (v) => (v.type === "landing" || v.type === "form") && v.blocks?.some((b) => b.id === r.id),
      );
      const block =
        view?.type === "landing" || view?.type === "form"
          ? view.blocks?.find((b) => b.id === r.id)
          : undefined;
      if (!view || !block) {
        errors.push(`renames[${i}]: there's no website section "${r.id}"`);
        continue;
      }
      const patch = blockPatchFrom(block, sectionWords(name));
      if (Object.keys(patch).length)
        ops.push({ op: "update_block", viewId: view.id, blockId: block.id, patch });
      else errors.push(`renames[${i}]: nothing to change on the ${block.type} section`);
    } else if (r.kind === "button") {
      // A form's button words travel as a rename: inside ops, Gemini looped on them.
      const form = [...bp.views, ...ops.flatMap((x) => (x.op === "add_view" ? [x.view] : []))].find(
        (v) => v.id === r.id,
      );
      if (form?.type !== "form") errors.push(`renames[${i}]: "${r.id}" isn't a form`);
      // A button says a few words; a run-on label ("Book Court & Pay Later/Now via GCash/Maya details below…")
      // is dropped rather than shown.
      else if (name.length <= 40)
        ops.push({ op: "update_view", viewId: form.id, patch: { submitLabel: name } });
    } else if (r.kind === "page") ops.push({ op: "rename_system", systemId: r.id, name });
    else ops.push({ op: "rename_view", viewId: r.id, name });
  }
  // New fields show up as a column in every table of their record type.
  for (const op of [...ops]) {
    if (op.op !== "add_field") continue;
    for (const v of bp.views)
      if (
        v.type === "table" &&
        v.entityId === op.entityId &&
        !ops.some((x) => x.op === "add_view_field" && x.viewId === v.id && x.fieldId === op.field.id)
      )
        ops.push({ op: "add_view_field", viewId: v.id, fieldId: op.field.id });
  }
  // New views get sensible defaults for anything Gemini left blank (columns, the date or status to use).
  // Loose record type names ("bookings", "Booking") are pointed at the real id first.
  const allEntities = [...bp.entities, ...ops.flatMap((x) => (x.op === "add_entity" ? [x.entity] : []))];
  const norm = (x: string) =>
    x
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")
      .replace(/(es|s)$/, "");
  const resolveEntity = (id: string) =>
    allEntities.some((e) => e.id === id)
      ? id
      : (allEntities.find((e) => [e.id, e.name, e.pluralName].some((k) => norm(k) === norm(id)))?.id ?? id);
  for (const op of ops) {
    const calc =
      op.op === "add_widget" ? op.widget.calc : op.op === "update_widget" ? op.patch.calc : undefined;
    if (calc) for (const t of calc.terms) t.entityId = resolveEntity(t.entityId);
    if (op.op === "add_widget")
      op.widget.entityId = calc?.terms[0] ? calc.terms[0].entityId : resolveEntity(op.widget.entityId);
    if (
      op.op === "add_view" &&
      op.view.type !== "document" &&
      op.view.type !== "canvas" &&
      op.view.type !== "html" &&
      op.view.type !== "landing"
    )
      op.view.entityId = resolveEntity(op.view.entityId);
  }
  // A new landing page uses the standard site: its hero words stay, the rest comes from the data.
  // Blocks the plan adds to that new page are folded in: their words become its copy; custom HTML stays as is.
  // A form added with it is the site's booking or sign-up form, so it's public (the site's button opens it).
  if (ops.some((x) => x.op === "add_view" && x.view.type === "landing"))
    for (const x of ops) if (x.op === "add_view" && x.view.type === "form") x.view.public = true;
  for (const op of [...ops]) {
    if (op.op !== "add_view" || op.view.type !== "landing") continue;
    const viewId = op.view.id;
    const added = ops.flatMap((x) => (x.op === "add_block" && x.viewId === viewId ? [x.block] : []));
    const others = ops.filter(
      (x) =>
        !(x.op === "add_view" && x.view.type === "landing") && !(x.op === "add_block" && x.viewId === viewId),
    );
    const blocks = [...(op.view.blocks ?? []), ...added];
    op.view.blocks = [
      ...standardBlocks(applyOps(bp, others), workspaceName, copyFromBlocks(blocks)),
      ...blocks.filter((b) => b.type === "html"),
    ];
    op.view.layout = "standard";
    for (let k = ops.length - 1; k >= 0; k--) {
      const x = ops[k];
      if (x.op === "add_block" && x.viewId === viewId) ops.splice(k, 1);
    }
  }
  // Blocks on public pages point at real record types, fields and forms.
  // Fields added earlier in this plan count, so a new form or block can use them.
  const addedFields = (id: string) =>
    ops.flatMap((x) => (x.op === "add_field" && x.entityId === id ? [x.field] : []));
  const fieldsOf = (id: string) =>
    new Set([
      ...(allEntities.find((e) => e.id === id)?.fields.map((f) => f.id) ?? []),
      ...addedFields(id).map((f) => f.id),
    ]);
  const formIds = new Set([
    ...bp.views.filter((v) => v.type === "form").map((v) => v.id),
    ...ops.flatMap((x) => (x.op === "add_view" && x.view.type === "form" ? [x.view.id] : [])),
  ]);
  const resolveLoose = (id: string | undefined) => (id === undefined ? id : resolveEntity(id));
  for (const op of ops) {
    if (op.op === "add_view" && (op.view.type === "landing" || op.view.type === "form") && op.view.blocks)
      op.view.blocks = tidyBlocks(op.view.blocks, resolveLoose, fieldsOf, formIds);
    if (op.op === "add_block") {
      const [cleaned] = tidyBlocks([op.block], resolveLoose, fieldsOf, formIds);
      if (cleaned) op.block = cleaned;
      else errors.push(`add_block: the ${op.block.type} block points at fields or forms that don't exist`);
    }
  }
  const entityFor = (id: string) => {
    const created = ops.flatMap((x) => (x.op === "add_entity" && x.entity.id === id ? [x.entity] : []))[0];
    const existing = bp.entities.find((e) => e.id === id);
    const extra = addedFields(id);
    const entity =
      created ??
      (existing && extra.length ? { ...existing, fields: [...existing.fields, ...extra] } : existing);
    return { entity, isNew: !!created };
  };
  for (const op of [...ops]) {
    if (op.op === "add_widget") {
      const { entity } = entityFor(op.widget.entityId);
      if (entity) fillWidget(op.widget, entity);
      continue;
    }
    if (op.op !== "add_view") continue;
    if (
      op.view.type === "document" ||
      op.view.type === "canvas" ||
      op.view.type === "html" ||
      op.view.type === "landing"
    ) {
      op.view.entityId = "";
      continue;
    }
    const { entity, isNew } = entityFor(op.view.entityId);
    if (!entity) continue;
    if (op.view.type === "notes") {
      // A notebook on an existing record type with no long text gets a Body field through its own step.
      const before = entity.fields.length;
      const target = isNew ? entity : structuredClone(entity);
      fillNotesView(op.view, target);
      if (!isNew && target.fields.length > before) {
        const added = target.fields.at(-1);
        if (
          added &&
          !ops.some((x) => x.op === "add_field" && x.entityId === entity.id && x.field.id === added.id)
        )
          ops.push({ op: "add_field", entityId: entity.id, field: added });
      }
      continue;
    }
    fillView(op.view, entity);
  }
  // Tweaks to a record type created in this same plan are folded into its definition.
  const folded = ops.filter((op) => {
    if (op.op !== "update_field") return true;
    const created = ops.find((x) => x.op === "add_entity" && x.entity.id === op.entityId);
    if (!created || created.op !== "add_entity") return true;
    const i = created.entity.fields.findIndex((f) => f.id === op.fieldId);
    if (i < 0) return true;
    created.entity.fields[i] = { ...created.entity.fields[i], ...op.patch } as Field;
    return false;
  });
  // Gemini sometimes lists the same addition twice; keep the first of each id.
  const seen = new Set<string>();
  const unique = folded.filter((op) => {
    const key =
      op.op === "add_widget"
        ? `widget:${op.widget.id}`
        : op.op === "add_view"
          ? `view:${op.view.id}`
          : op.op === "add_system"
            ? `system:${op.system.id}`
            : op.op === "add_entity"
              ? `entity:${op.entity.id}`
              : op.op === "add_field"
                ? `field:${op.entityId}.${op.field.id}`
                : JSON.stringify(op);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  // Things are created before anything that refers to them, whatever order Gemini listed them in.
  const ORDER: ChangeOp["op"][] = [
    "rename_workspace",
    "add_entity",
    "add_field",
    "update_field",
    "add_system",
    "add_view",
    "replace_view",
    "move_view",
    "update_view",
    "add_block",
    "update_block",
    "add_view_field",
    "add_widget",
    "update_widget",
    "add_rule",
    "rename_system",
    "rename_view",
    "remove_block",
    "remove_widget",
    "remove_rule",
    "remove_view",
    "remove_field",
    "remove_system",
    "remove_entity",
    "move_system",
  ];
  const rank = (op: ChangeOp) => {
    const i = ORDER.indexOf(op.op);
    return i < 0 ? ORDER.length : i;
  };
  // Removing a field or rule the same plan adds again ("merge the duplicates": drop rider, add rider as a choice)
  // means redefine it; the add replaces it in place, so the removal is dropped instead of deleting the new one.
  const kept = unique.filter(
    (op) =>
      !(
        op.op === "remove_field" &&
        unique.some((x) => x.op === "add_field" && x.entityId === op.entityId && x.field.id === op.fieldId)
      ) && !(op.op === "remove_rule" && unique.some((x) => x.op === "add_rule" && x.rule.id === op.ruleId)),
  );
  // A field redefined as a choice without its options keeps the ones it had, or takes them from the duplicate the
  // plan merges away (rider_select, status_options): Gemini drops them often, and they're already in the workspace.
  for (const op of kept) {
    if (op.op !== "add_field" || !["select", "status", "multi_select"].includes(op.field.type)) continue;
    if (op.field.options?.length) continue;
    const fields = bp.entities.find((e) => e.id === op.entityId)?.fields ?? [];
    // Its duplicates count whether or not this plan removes them (a repair round often sends only the fixed op).
    const siblings = fields.filter((f) => f.id.startsWith(`${op.field.id}_`));
    const from = [fields.find((f) => f.id === op.field.id), ...siblings].find((f) => f?.options?.length);
    if (from?.options) op.field.options = from.options;
  }
  ops.splice(0, ops.length, ...kept.sort((a, b) => rank(a) - rank(b)));
  // Existing ids can't be redefined, and every new view or widget must land in a section.
  for (const op of ops) {
    const viewKnown = (id: string) =>
      bp.views.some((v) => v.id === id) ||
      ops.some((x) => (x.op === "add_view" || x.op === "replace_view") && x.view.id === id);
    const systemKnown = (id: string) =>
      bp.systems.some((s) => s.id === id) || ops.some((x) => x.op === "add_system" && x.system.id === id);
    if (
      (op.op === "move_view" ||
        op.op === "rename_view" ||
        op.op === "update_view" ||
        op.op === "add_block" ||
        op.op === "update_block" ||
        op.op === "remove_block") &&
      !viewKnown(op.viewId)
    )
      errors.push(`${op.op}: view "${op.viewId}" doesn't exist`);
    if ((op.op === "move_view" || op.op === "rename_system") && !systemKnown(op.systemId))
      errors.push(`${op.op}: page "${op.systemId}" doesn't exist`);
    if (op.op === "add_entity" && bp.entities.some((e) => e.id === op.entity.id))
      errors.push(`Record type "${op.entity.id}" already exists`);
    if (
      op.op === "update_field" &&
      !bp.entities.find((e) => e.id === op.entityId)?.fields.some((f) => f.id === op.fieldId) &&
      !ops.some((x) => x.op === "add_field" && x.entityId === op.entityId && x.field.id === op.fieldId)
    ) {
      const known = [
        ...(bp.entities.find((e) => e.id === op.entityId)?.fields ?? []),
        ...ops.flatMap((x) => (x.op === "add_entity" && x.entity.id === op.entityId ? x.entity.fields : [])),
      ].map((f) => f.id);
      errors.push(
        `update_field: "${op.fieldId}" isn't a field of ${op.entityId}${known.length ? ` (fields: ${known.join(", ")})` : ""}. Put new fields in add_entity or add_field instead.`,
      );
    }
  }
  return { ops, errors };
}

/** Image field values of the form "attachment:<id>": an attached photo to copy into the workspace for the record. */
const PHOTO_VALUE = /^attachment:(\S+)$/;

/** New text for document pages; only pages of type document take text. */
function toDocOps(
  bp: Blueprint,
  records: DataRecord[],
  raw: RawPlan["pageTexts"],
  errors: string[],
): DocOp[] {
  const ops: DocOp[] = [];
  for (const [i, p] of raw.entries()) {
    const view = bp.views.find((v) => v.id === p.viewId);
    // A custom HTML page's text is its HTML; Gemini sometimes writes a drafted page here instead of in starter.
    if (view?.type === "html")
      ops.push({ viewId: view.id, body: fillEmbeds(p.markdown, bp, records, view.id, errors) });
    else if (view?.type !== "document") {
      const pages = bp.views.filter((v) => v.type === "document" || v.type === "html").map((v) => v.id);
      errors.push(
        `pageTexts[${i}]: "${p.viewId}" isn't a document or HTML page (those pages: ${pages.join(", ") || "none"})`,
      );
    } else ops.push({ viewId: view.id, body: p.markdown });
  }
  return ops;
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Team changes checked against the real team: roles change only for people who are there. */
function toTeamOps(
  team: { members: Member[]; invites: Invite[] } | undefined,
  raw: RawPlan["team"],
  errors: string[],
): TeamOp[] {
  const ops: TeamOp[] = [];
  const members = team?.members ?? [];
  const invites = team?.invites ?? [];
  for (const [i, t] of raw.entries()) {
    const email = t.email.trim().toLowerCase();
    const at = `team[${i}] ${t.action}`;
    const isMember = members.some((m) => m.email.toLowerCase() === email);
    const invited = invites.some((x) => x.email.toLowerCase() === email);
    if (!EMAIL.test(email)) errors.push(`${at}: "${t.email}" isn't an email address`);
    else if (t.action === "revoke_invite") {
      if (invited) ops.push({ op: "revoke_invite", email });
      else errors.push(`${at}: nobody with ${email} has a pending invite`);
    } else if (!t.role) errors.push(`${at}: needs a role (admin, staff or viewer)`);
    else if (t.action === "invite") {
      if (isMember) errors.push(`${at}: ${email} is already on the team; use set_role`);
      else ops.push({ op: "invite", email, role: t.role });
    } else if (isMember || invited) ops.push({ op: "set_role", email, role: t.role });
    else errors.push(`${at}: ${email} isn't on the team or invited; invite them instead`);
  }
  return ops;
}

async function toRecordOps(
  bp: Blueprint,
  records: DataRecord[],
  raw: RawPlan["recordOps"],
  /** Turns an attached photo's id into the workspace picture path, or null if it can't be used. */
  photo: (attachmentId: string) => Promise<string | null>,
): Promise<{ ops: RecordOp[]; errors: string[] }> {
  const errors: string[] = [];
  const refs = new Map<string, string>();
  for (const o of raw)
    if (o.op === "create_record" && o.entityId)
      refs.set(o.ref ?? `r${refs.size}`, `${o.entityId}_${randomToken(3)}`);
  const resolve = (targetEntity: string | undefined) => (v: string) => {
    if (refs.has(v)) return refs.get(v);
    if (records.some((r) => r.id === v)) return v;
    // Gemini sometimes links by name: match the linked type's primary field.
    const target = bp.entities.find((e) => e.id === targetEntity);
    const hit =
      target &&
      records.find(
        (r) =>
          r.entityId === target.id &&
          String(r.data[target.primaryFieldId] ?? "").toLowerCase() === v.toLowerCase(),
      );
    return hit?.id;
  };
  const ops: RecordOp[] = [];
  let created = 0;
  for (const [i, o] of raw.entries()) {
    if (o.op === "delete_record") {
      if (o.recordId && records.some((r) => r.id === o.recordId))
        ops.push({ op: "delete_record", recordId: o.recordId });
      else errors.push(`recordOps[${i}]: no record "${o.recordId ?? ""}" to delete`);
      continue;
    }
    const entityId =
      o.op === "create_record" ? o.entityId : records.find((r) => r.id === o.recordId)?.entityId;
    const entity = bp.entities.find((e) => e.id === entityId);
    if (!entity) {
      errors.push(
        `recordOps[${i}]: ${o.op === "create_record" ? `unknown record type "${o.entityId}"` : `no record "${o.recordId}"`}`,
      );
      continue;
    }
    const data: RecordData = {};
    for (const { fieldId, value } of o.values) {
      const field = entity.fields.find((f) => f.id === fieldId);
      if (!field) {
        errors.push(`recordOps[${i}]: ${entity.name} has no field "${fieldId}"`);
        continue;
      }
      const attached = field.type === "image" ? PHOTO_VALUE.exec(value.trim()) : null;
      if (attached) {
        const path = await photo(attached[1]);
        if (path) data[field.id] = path;
        else
          errors.push(
            `recordOps[${i}]: "${value}" isn't a photo attached in this conversation that a record can show (PNG, JPG, WebP or GIF)`,
          );
        continue;
      }
      const v = toFieldValue(field, value, resolve(field.relation?.entityId));
      if (v === undefined)
        errors.push(`recordOps[${i}]: "${value}" doesn't fit ${entity.name}.${field.id} (${field.type})`);
      else data[field.id] = v;
    }
    if (o.op === "create_record") {
      const ref = o.ref ?? `r${created}`;
      ops.push({
        op: "create_record",
        id: refs.get(ref) ?? `${entity.id}_${randomToken(3)}`,
        entityId: entity.id,
        data,
      });
      created++;
    } else ops.push({ op: "update_record", recordId: o.recordId as string, patch: data });
  }
  return { ops, errors };
}

/** One assistant turn: an answer, a question back, or a plan rehearsed on a copy of the workspace. */
export async function assistantTurn(input: {
  blueprint: Blueprint;
  records: DataRecord[];
  messages: AssistantMessage[];
  /** What the person has on screen. */
  screen: Screen;
  /** Text of document pages, by view id. */
  docs?: Record<string, { body: string }>;
  canDesign: boolean;
  canEditRecords: boolean;
  /** The signed-in person; attachments are read from their own files only. */
  userId: string;
  /** The workspace the plan is for; attached photos used in records are copied into its uploads. */
  workspaceId: string;
  /** Owners and admins see the team, so they can invite people and change roles. */
  team?: { members: Member[]; invites: Invite[] };
  /** Called with what the assistant is doing, shown while it works. */
  onStatus?: (status: string) => void;
  /** The business name, for the words of a new website. */
  workspaceName?: string;
}): Promise<AssistantResult> {
  const { blueprint: bp, records } = input;
  const permissions = input.canDesign
    ? "The person can change the design and the data."
    : input.canEditRecords
      ? "The person is staff: they can change data (records) but not the design. Don't plan design changes; say an owner or admin can."
      : "The person is a viewer: answer questions only. For changes, say an owner or admin can make them.";
  const screen = describeScreen(bp, records, input.screen, input.docs);
  const status = input.onStatus ?? (() => {});
  const where = bp.systems.find((s) => s.id === input.screen.systemId);
  if (where) status(`Looking at ${where.name}`);
  status(
    `Summarising ${records.length} ${records.length === 1 ? "record" : "records"} across ${bp.entities.length} record types`,
  );
  const team =
    input.canDesign && input.team
      ? `\n\nTeam (you can invite people and change roles):\n${
          [
            ...input.team.members.map((m) => `- ${m.name} <${m.email}>: ${m.role}`),
            ...input.team.invites.map((i) => `- invited <${i.email}>: ${i.role}, not joined yet`),
          ].join("\n") || "- nobody besides the owner"
        }`
      : "";
  const today = todayKey();
  const weekday = new Date(`${today}T12:00:00+08:00`).toLocaleDateString("en-PH", {
    weekday: "long",
    timeZone: "Asia/Manila",
  });
  // A digest of the records instead of every record, plus exact lookups (SQL) for what this message needs.
  const digest = dataDigest(bp, records, { ids: screen.focusIds, entityId: screen.entityId });
  const looked = await lookupData({
    workspaceId: input.workspaceId,
    blueprint: bp,
    digest,
    screen: screen.text,
    today: `${weekday}, ${today}`,
    messages: input.messages,
    onStatus: status,
  });
  const context = `Today in Manila: ${weekday}, ${today}
${permissions}${team}

What the person is looking at:
${screen.text}

Sidebar pages (in order), with their tabs:
${bp.systems
  .map(
    (s) =>
      `- ${s.name} (${s.id}): ${
        [
          ...s.viewIds.map((id) => {
            const v = bp.views.find((x) => x.id === id);
            if (!v) return id;
            const extra =
              v.type === "form" || v.type === "landing"
                ? `${isPublic(v) ? ", public" : ", team only"}${
                    v.blocks?.length
                      ? `, blocks: ${v.blocks.map((b) => `${b.type} ${b.id}`).join(" / ")}`
                      : ""
                  }${
                    // The form's fields as update_view writes them: steps and the blocks each step shows.
                    v.type === "form" ? `, fields: ${JSON.stringify(markersOf(v))}` : ""
                  }${v.type === "form" ? visitorView(bp, v) : ""}`
                : v.type === "html"
                  ? isPublic(v)
                    ? ", public"
                    : ", team only"
                  : v.type === "checkout"
                    ? // What the Register really shows, so "where do I pick the branch" gets a true answer.
                      `, the register asks: products, payment method${registerFields(bp, v)
                        .map(
                          ({ field }) => `, ${field.name} (${field.id}${field.required ? ", required" : ""})`,
                        )
                        .join("")}${v.fieldIds?.length ? `, fieldIds: ${JSON.stringify(v.fieldIds)}` : ""}`
                    : "";
            return `${v.name} (${v.id}, ${v.type}${v.entityId ? ` of ${v.entityId}` : ""}${extra})`;
          }),
          ...(s.widgetIds.length ? [`${s.widgetIds.length} dashboard widgets`] : []),
        ].join(", ") || "empty"
      }`,
  )
  .join("\n")}

Blueprint:
${JSON.stringify(bp)}

Data (a digest: counts and totals per record type, then records on screen and small record types in full):
${digest}${
  looked
    ? `

Looked up just now for this message (exact, from the database):
${looked}`
    : ""
}${requestGuide(input.messages.filter((m) => m.role === "user").at(-1)?.text ?? "")}

Conversation:
${input.messages
  .map((m) => {
    const files = m.attachments?.length
      ? `\n[Attached: ${m.attachments.map((a) => `${a.name} (attachment:${a.id})`).join(", ")}]`
      : "";
    return `${m.role === "user" ? "Person" : "You"}: ${m.text || "(sent files)"}${files}`;
  })
  .join("\n\n")}`;

  // Files the person attached follow the text on every attempt, including a repair.
  const attachments = attachmentsIn(input.messages);
  if (attachments.length)
    status(`Reading ${attachments.length} attached ${attachments.length === 1 ? "file" : "files"}`);
  const fileParts = await attachmentParts(input.userId, attachments);
  const withFiles = (text: string): string | Part[] => (fileParts.length ? [{ text }, ...fileParts] : text);
  // Each attached photo is copied into the workspace at most once per turn, even across repair attempts.
  const copies = new Map<string, Promise<string | null>>();
  const photo = (id: string) => {
    if (!attachments.some((a) => a.id === id && a.kind === "image")) return Promise.resolve(null);
    if (!copies.has(id)) copies.set(id, copyPhotoToWorkspace(input.userId, id, input.workspaceId));
    return copies.get(id) as Promise<string | null>;
  };
  let prompt = withFiles(context);
  // Two rounds of fixes: a big multi-part request can slip in a new place after the first one.
  let repairs = 0;
  let restarted = false;
  for (let attempt = 0; attempt < 4; attempt++) {
    status(
      attempt === 0
        ? "Thinking it through"
        : repairs
          ? "Reworking the plan so it fits your workspace"
          : "Gemini's first answer didn't come through, trying again",
    );
    const setAside: string[] = [];
    // Answers take 3–8 s and plans with pages 10–25 s. A stalled call gets a parallel twin after 28 s.
    const result = await generateJsonHedged(
      assistantAnswer,
      {
        system: ASSISTANT_SYSTEM,
        prompt,
        task: "assistant",
        repair: (json) => setAsideBadOps(fixOpNames(json), setAside),
        timeoutMs: 60_000,
        thinking: "LOW",
        // Real plans are 200–2,500 tokens, and up to about 6,000 with a drafted HTML page; a looping answer stops
        // here and the next attempt starts.
        maxOutputTokens: 12_000,
        // A drafted HTML page is one long text value (4–15k characters), not a runaway.
        maxStringChars: 24_000,
        textLimits: ASSISTANT_TEXT_LIMITS,
      },
      { hedgeMs: 28_000, retryNote: ASSISTANT_RETRY_NOTE },
    );
    if (!result.ok) {
      // Every hedged try went wrong (a loop, a cut-off answer): start over once before telling the person.
      if (result.retryable && !restarted) {
        restarted = true;
        continue;
      }
      return { ok: false, message: result.error };
    }
    const a = result.data;
    const suggestions = a.suggestions.slice(0, 3);
    const navigate = resolveGoTo(bp, records, a.goTo, { screen: input.screen, canManage: input.canDesign });
    const sources = resolveSources(bp, records, a.sources ?? [], {
      screen: input.screen,
      canManage: input.canDesign,
    });
    const withNav = { ...(navigate ? { navigate } : {}), ...(sources.length ? { sources } : {}) };
    if (a.kind !== "plan") return { ok: true, kind: a.kind, reply: a.reply, suggestions, ...withNav };
    status("Checking the plan against your workspace");

    const design = toDesignOps(bp, a.plan.ops, a.plan.renames, a.plan.formulas, input.workspaceName);
    // Operations that fit no shape were set aside; Gemini gets them back to fix with the rest of the plan.
    const errors = [...setAside, ...design.errors];
    if (design.ops.length && !input.canDesign)
      errors.push("This person can't change the design; plan data changes only or explain who can.");
    if (design.ops.length)
      openUpPublicForms(
        bp,
        design.ops,
        a.plan.pageTexts.map((p) => p.markdown),
        // "A multistep booking form": a form the plan touches gets steps even when Gemini left them out.
        /multi[\s-]?step|in steps|step[\s-]by[\s-]step|wizard/i.test(input.messages.at(-1)?.text ?? ""),
      );
    // A tab swapped for another layout keeps its place (see replacedTabs).
    replacedTabs(bp, design.ops, errors);
    let next = design.ops.length ? applyOps(bp, design.ops) : bp;
    // An automation Gemini got wrong that EveryOps can work out itself is replaced, not sent back.
    const replace = design.ops.length
      ? replaceableRules(
          bp,
          next,
          design.ops.flatMap((op) => (op.op === "add_rule" ? [op.rule.id] : [])),
        )
      : [];
    if (replace.length) {
      const kept = design.ops.filter((op) => !(op.op === "add_rule" && replace.includes(op.rule.id)));
      design.ops.splice(0, design.ops.length, ...kept);
      next = applyOps(bp, design.ops);
    }
    // What the request implies but the plan left out: receiving stock raises it, selling lowers it, approved leave
    // takes days off the balance. Added as automations and shown on the card, so the owner sees what got connected.
    const implied = design.ops.length ? impliedRules(bp, next) : [];
    if (implied.length) {
      design.ops.push(...implied.map(({ rule }) => ({ op: "add_rule" as const, rule })));
      next = applyOps(bp, design.ops);
    }
    // A step that says an automation changes needs an operation behind it (the implied ones count).
    errors.push(...unbackedRuleSteps(a.plan.steps, design.ops));
    // "Add stock management" in a workspace that sells means stock on what it sells.
    const stockNote = design.ops.length
      ? misplacedStock(bp, next, input.messages.filter((m) => m.role === "user").at(-1)?.text ?? "")
      : undefined;
    if (stockNote) errors.push(stockNote);
    // Whatever the plan adds must be there once it is applied; an op that quietly did nothing never shows as Applied.
    errors.push(...missingAfterApply(design.ops, next));
    embedForms(next, records, design.ops, errors);
    errors.push(...unanswerable(next, design.ops));
    const before = new Set(validateBlueprint(bp).map((e) => `${e.path} ${e.message}`));
    for (const e of validateBlueprint(next))
      if (!before.has(`${e.path} ${e.message}`)) errors.push(`${e.path}: ${e.message}`);
    for (const op of design.ops)
      if ((op.op === "add_view" || op.op === "add_widget") && !next.systems.some((s) => s.id === op.systemId))
        errors.push(`${op.op}: section "${op.systemId}" doesn't exist`);

    const recordPart = await toRecordOps(next, records, a.plan.recordOps, photo);
    errors.push(...recordPart.errors);
    if (recordPart.ops.length && !input.canEditRecords) errors.push("This person can't change data.");
    const docOps = toDocOps(next, records, a.plan.pageTexts, errors);
    if (docOps.length && !input.canEditRecords) errors.push("This person can't edit pages.");
    const teamOps = toTeamOps(input.team, a.plan.team, errors);
    if (teamOps.length && !input.canDesign) errors.push("Only owners and admins can change the team.");
    let removedCount = 0;
    if (!errors.length) {
      if (recordPart.ops.length)
        status(
          `Trying ${recordPart.ops.length} data ${recordPart.ops.length === 1 ? "change" : "changes"} on a copy`,
        );
      // Rehearse the data edits on a copy so validation, rules and booking conflicts are checked now.
      const staged = design.ops.length
        ? commitChange({ blueprint: bp, records }, next).data
        : { blueprint: bp, records };
      const rehearsal = recordPart.ops.length ? applyRecordOps(staged, recordPart.ops) : null;
      if (rehearsal) errors.push(...rehearsal.errors);
      const known = new Set(next.entities.map((e) => e.id));
      removedCount = records.filter((r) => !known.has(r.entityId)).length + (rehearsal?.removed.length ?? 0);
      // An option can only go once no record (after this plan's own edits) still uses it.
      if (design.ops.length)
        errors.push(...strandedOptions(bp, next, optionUsage(bp, rehearsal?.data.records ?? staged.records)));
    }
    if (!errors.length && (design.ops.length || recordPart.ops.length || docOps.length || teamOps.length)) {
      // Cards the plan adds or changes show their real new value, worked out on the rehearsed workspace.
      const cardFacts = design.ops.flatMap((op) => {
        const id =
          op.op === "add_widget" ? op.widget.id : op.op === "update_widget" ? op.widgetId : undefined;
        const w = id ? next.widgets.find((x) => x.id === id) : undefined;
        if (!w || (w.type !== "stat" && w.type !== "progress")) return [];
        return [{ label: w.title, value: metricFormatter(next, w)(widgetValue(next, w, records)) }];
      });
      // How many records go is counted here, not trusted to the model.
      if (removedCount)
        cardFacts.unshift({ label: "Records deleted", value: `${removedCount} (undo brings them back)` });
      const facts = [
        ...cardFacts,
        ...a.plan.facts.filter((f) => !cardFacts.some((c) => c.label === f.label)),
      ];
      return {
        ok: true,
        kind: "plan",
        reply: a.reply,
        suggestions,
        ...withNav,
        plan: {
          // History shows the person's own words, without the note about which section they clicked.
          request: (input.messages.at(-1)?.text ?? "").replace(/^\(About the .+? section I clicked\)\n?/, ""),
          baseVersion: bp.version,
          title: a.plan.title || "Workspace change",
          facts: facts.slice(0, 6),
          steps: [
            ...a.plan.steps.slice(0, Math.max(0, 10 - implied.length)),
            ...implied.map(({ label, detail }) => ({ kind: "add" as const, label, detail })),
          ],
          ops: design.ops,
          recordOps: recordPart.ops,
          ...(docOps.length ? { docOps } : {}),
          ...(teamOps.length ? { teamOps } : {}),
        },
      };
    }
    console.warn(
      JSON.stringify({
        event: "assistant_plan_rejected",
        attempt,
        errors: errors.slice(0, 12),
        ops: JSON.stringify(a.plan.ops).slice(0, 3000),
      }),
    );
    if (repairs === 2) break;
    repairs++;
    if (errors.some((e) => e.endsWith("needs options")))
      errors.push(
        'Every select and status field needs "options": [{ "id": "lead", "label": "Lead", "tone": "neutral" }, …] with the choices the person described, or sensible ones.',
      );
    prompt = withFiles(
      `${context}\n\nYour previous plan:\n${JSON.stringify(a.plan)}\n\nIt was rejected:\n- ${errors.length ? errors.slice(0, 15).join("\n- ") : "it had no operations"}\nReturn the complete corrected plan: every operation the request needs, not only the ones you fixed. The person never saw the rejected plan, so write the reply as your first answer: don't mention corrections or errors.`,
    );
  }
  return {
    ok: false,
    message: "I couldn't put together a valid change for that. Try describing it a little differently.",
  };
}

/**
 * An operation that fits none of the operation shapes would fail the whole answer (it showed as a raw schema error).
 * It's taken out instead and described in `setAside`, so Gemini gets it back to fix with the rest of the plan.
 */
export function setAsideBadOps(json: unknown, setAside: string[]): unknown {
  const plan = (json as { plan?: { ops?: unknown } })?.plan;
  if (!plan || !Array.isArray(plan.ops)) return json;
  setAside.length = 0;
  plan.ops = plan.ops.filter((o: { op?: unknown } | null, i: number) => {
    if (designOp.safeParse(o).success) return true;
    const branch = designOp.options.find((b) => b.shape.op.value === o?.op);
    const issues = branch?.safeParse(o).error?.issues ?? [];
    const why = branch
      ? issues
          .slice(0, 3)
          .map((x) => `${x.path.join(".") || "op"}: ${x.message}`)
          .join("; ")
      : `"${String(o?.op)}" isn't an operation`;
    setAside.push(
      `ops[${i}] ${String(o?.op)} doesn't fit its shape (${why}): ${JSON.stringify(o).slice(0, 300)}`,
    );
    return false;
  });
  return json;
}

/** Form ids that custom HTML pages in this plan embed or post to (data-everyops-embed, data-everyops-form). */
function embeddedIn(ops: ChangeOp[], pageHtml: string[] = []): string[] {
  // Form blocks on pages the plan adds or adds blocks to (a landing page with a booking form) count too.
  const blocks = ops.flatMap((op) =>
    op.op === "add_block"
      ? [op.block]
      : op.op === "add_view" && (op.view.type === "landing" || op.view.type === "form")
        ? (op.view.blocks ?? [])
        : [],
  );
  const forms = blocks.flatMap((b) => (b.type === "form" ? [b.viewId] : []));
  const html = [
    ...ops.flatMap((op) =>
      op.op === "add_view" && op.view.type === "html" && op.view.html ? [op.view.html] : [],
    ),
    ...pageHtml,
    ...blocks.flatMap((b) => (b.type === "html" ? [b.html] : [])),
  ].flatMap((h) => [...h.matchAll(/data-everyops-(?:embed|form)\s*=\s*["']([^"']+)["']/g)].map((m) => m[1]));
  return [...forms, ...html];
}

/** Forms this plan adds, changes or puts on a custom page: the ones whose public use it must check. */
function touchedForms(ops: ChangeOp[], embeds: string[]): Set<string> {
  return new Set([
    ...ops.flatMap((op) =>
      op.op === "add_view" ? [op.view.id] : op.op === "update_view" ? [op.viewId] : [],
    ),
    ...embeds,
  ]);
}

/**
 * Public forms that would fail every visitor, fixed the way an owner would: a form embedded on a custom page is made
 * public (the page saves through it), and a public form this plan adds or opens up stops requiring what visitors
 * can't fill in (a link to a private list such as players) and asks who is booking when it doesn't yet. Gemini was
 * told this and still slipped often; the fix is the same every time, so it's made here.
 */
export function openUpPublicForms(
  bp: Blueprint,
  ops: ChangeOp[],
  pageHtml: string[] = [],
  wantsSteps = false,
) {
  const embeds = embeddedIn(ops, pageHtml);
  let next = applyOps(bp, ops);
  for (const id of new Set(embeds)) {
    const view = next.views.find((v) => v.id === id);
    if (view?.type !== "form" || view.public) continue;
    const added = ops.find((op) => op.op === "add_view" && op.view.id === id);
    if (added?.op === "add_view" && added.view.type === "form") added.view.public = true;
    else ops.push({ op: "update_view", viewId: id, patch: { public: true } });
  }
  next = applyOps(bp, ops);
  const touched = touchedForms(ops, embeds);
  for (const view of next.views) {
    if (view.type !== "form" || !view.public || !touched.has(view.id)) continue;
    const entity = next.entities.find((e) => e.id === view.entityId);
    if (!entity) continue;
    // Anything required that visitors aren't asked (a link to a private list, an order number the business assigns)
    // becomes optional, or every submission would fail. The same test as unanswerable(), so nothing is left for it.
    for (const f of stuckFields(next, view, entity))
      if (f.id !== entity.booking?.resourceFieldId)
        ops.push({ op: "update_field", entityId: entity.id, fieldId: f.id, patch: { required: false } });
    const contact = view.fieldIds.some((id) => {
      const f = entity.fields.find((x) => x.id === id);
      return f?.type === "text" && /name|phone|mobile|email|contact|guest|customer|client/.test(f.id);
    });
    if (contact) continue;
    const guest = [
      { id: "guest_name", name: "Your name", type: "text" as const, required: true },
      { id: "guest_phone", name: "Mobile number", type: "text" as const, required: true },
    ];
    for (const f of guest)
      if (!entity.fields.some((x) => x.id === f.id))
        ops.push({ op: "add_field", entityId: entity.id, field: f });
    const ids = guest.map((f) => f.id);
    const added = ops.find((op) => op.op === "add_view" && op.view.id === view.id);
    if (added?.op === "add_view" && added.view.type === "form") {
      added.view.fieldIds.push(...ids);
      if (added.view.steps) added.view.steps = withGuestStep(added.view.steps, ids);
    } else
      ops.push({
        op: "update_view",
        viewId: view.id,
        patch: {
          fieldIds: [...view.fieldIds, ...ids],
          ...(view.steps?.length ? { steps: withGuestStep(view.steps, ids) } : {}),
        },
      });
  }

  if (!wantsSteps) return;
  // Asked for a form in steps: a form the plan touches that still has none is split the usual way.
  next = applyOps(bp, ops);
  // A new landing page's button opens the main public form, so that's the form they mean.
  if (ops.some((op) => op.op === "add_view" && op.view.type === "landing")) {
    const main = mainForm(next);
    if (main) touched.add(main.id);
  }
  for (const view of next.views) {
    if (view.type !== "form" || !touched.has(view.id) || view.steps?.length) continue;
    const entity = next.entities.find((e) => e.id === view.entityId);
    const steps = entity && autoSteps(next, view, entity);
    if (!steps) continue;
    const added = ops.find((op) => op.op === "add_view" && op.view.id === view.id);
    if (added?.op === "add_view" && added.view.type === "form")
      Object.assign(added.view, { steps, review: true });
    else ops.push({ op: "update_view", viewId: view.id, patch: { steps, review: true } });
  }
}

/** A form's fields in the usual steps: the booking's resource and time, then who it's for, then the rest. */
function autoSteps(bp: Blueprint, view: FormView, entity: Entity): FormStep[] | undefined {
  const asked = view.public ? publicFieldsOf(bp, view).map((f) => f.id) : view.fieldIds;
  const booking = entity.booking;
  const when = asked.filter((id) => id === booking?.resourceFieldId || id === booking?.timeFieldId);
  const you = asked.filter((id) => {
    const f = entity.fields.find((x) => x.id === id);
    return (
      !when.includes(id) &&
      f?.type === "text" &&
      /name|phone|mobile|email|contact|guest|customer|client/.test(id)
    );
  });
  const rest = asked.filter((id) => !when.includes(id) && !you.includes(id));
  const resourceId = entity.fields.find((f) => f.id === booking?.resourceFieldId)?.relation?.entityId;
  const resource = bp.entities.find((e) => e.id === resourceId);
  const steps: FormStep[] = [
    { id: "when", title: resource ? `${resource.name} and time` : "Date and time", fieldIds: when },
    { id: "your_details", title: "Your details", fieldIds: you },
    { id: "details", title: when.length || you.length ? "Other details" : "Details", fieldIds: rest },
  ].filter((s) => s.fieldIds.length);
  return steps.length >= 2 ? steps : undefined;
}

/** Guest details go on the step about the person (details, contact, player), else on their own before the last. */
function withGuestStep(steps: FormStep[], ids: string[]): FormStep[] {
  const out = steps.map((s) => ({ ...s, fieldIds: [...s.fieldIds] }));
  const home = out.find((s) => /detail|contact|you|player|guest|info/i.test(s.title));
  if (home) home.fieldIds.push(...ids);
  else
    out.splice(Math.max(0, out.length - 1), 0, { id: "your_details", title: "Your details", fieldIds: ids });
  return out;
}

/** Required fields a public form doesn't ask visitors for, which the app can't fill in itself either. */
function stuckFields(bp: Blueprint, view: FormView, entity: Entity) {
  const asked = new Set(publicFieldsOf(bp, view).map((f) => f.id));
  return entity.fields.filter(
    (f) =>
      f.required &&
      !asked.has(f.id) &&
      !["formula", "rollup", "status", "money"].includes(f.type) &&
      f.id !== entity.parent?.fieldId,
  );
}

/**
 * A public form this plan adds or opens up must not require what a visitor can't fill in: every submission would
 * fail. openUpPublicForms already makes those optional; this is the last check before the plan is shown.
 */
export function unanswerable(next: Blueprint, ops: ChangeOp[]): string[] {
  const touched = touchedForms(ops, embeddedIn(ops));
  return next.views.flatMap((v) => {
    if (v.type !== "form" || !v.public || !touched.has(v.id)) return [];
    const entity = next.entities.find((e) => e.id === v.entityId);
    if (!entity) return [];
    const stuck = stuckFields(next, v, entity);
    return stuck.length
      ? [
          `${v.id}: visitors can't fill in ${stuck.map((f) => f.id).join(", ")} (required, but not shown on public forms). Make ${stuck.length > 1 ? "them" : "it"} optional with update_field, and ask who is booking with text fields (guest name, phone) added with add_field and listed in the form.`,
        ]
      : [];
  });
}

/**
 * A custom HTML page asks for a working form with <div data-everyops-embed="formViewId"></div>; it's replaced with
 * the same markup "Connect a form" inserts (the form's real fields, in steps when the form has them), so the page
 * saves real records. Checked against the workspace as this plan leaves it, so a form added in the plan works too.
 */
export function embedForms(next: Blueprint, records: DataRecord[], ops: ChangeOp[], errors: string[]) {
  for (const op of ops) {
    if (op.op !== "add_view" || op.view.type !== "html" || !op.view.html?.includes("data-everyops-embed"))
      continue;
    op.view.html = fillEmbeds(op.view.html, next, records, op.view.id, errors);
  }
}

/** Replaces each data-everyops-embed placeholder in a page's HTML with its public form's markup. */
function fillEmbeds(html: string, next: Blueprint, records: DataRecord[], pageId: string, errors: string[]) {
  const tag = /<(\w+)\b[^>]*\bdata-everyops-embed\s*=\s*["']([^"']+)["'][^>]*>(?:\s*<\/\1>)?/g;
  const forms = next.views.filter((v) => v.type === "form" && v.public);
  return html.replace(tag, (whole, _tag: string, id: string) => {
    const view = next.views.find((v) => v.id === id);
    const form = view?.type === "form" && view.public ? publicForm(next, records, view) : null;
    if (form) return formSnippet(form);
    errors.push(
      `${pageId}: data-everyops-embed="${id}" isn't a public form (public forms: ${forms.map((f) => f.id).join(", ") || "none; add one with public true"})`,
    );
    return whole;
  });
}

const OP_NAMES = new Set([
  "add_field",
  "add_entity",
  "add_view",
  "add_widget",
  "add_system",
  "add_rule",
  "add_block",
]);

const OP_ALIASES: Record<string, string> = {
  patch_field: "update_field",
  patch: "update_field",
  edit_field: "update_field",
  modify_field: "update_field",
  change_field: "update_field",
  edit_view: "update_view",
  patch_view: "update_view",
  // There's no rule editing op: a rule is redefined by adding it again with its id.
  update_rule: "add_rule",
  edit_rule: "add_rule",
};

/**
 * Gemini sometimes drops the add_ prefix ("op": "widget"), writes create_ for add_, or invents a near name
 * ("patch_field"); put the real name back so one slip doesn't sink a whole plan.
 */
function fixOpNames(json: unknown): unknown {
  const ops = (json as { plan?: { ops?: { op?: unknown }[] } })?.plan?.ops;
  if (!Array.isArray(ops)) return json;
  for (const o of ops) {
    if (typeof o?.op !== "string") continue;
    const name = o.op.replace(/^create_/, "add_");
    if (OP_ALIASES[name]) o.op = OP_ALIASES[name];
    else if (!name.startsWith("add_") && OP_NAMES.has(`add_${name}`)) o.op = `add_${name}`;
    else o.op = name;
  }
  return json;
}

/**
 * The card's steps are Gemini's own words, so a plan could say "Delivery automation rule: formula changed" without an
 * operation that changes it; it then showed as applied while the automation stayed the same. A step about an
 * automation needs an add_rule (which replaces the one with the same id) or a remove_rule behind it.
 */
export function unbackedRuleSteps(
  steps: { label: string; detail?: string }[],
  ops: { op: string }[],
): string[] {
  if (ops.some((o) => o.op === "add_rule" || o.op === "remove_rule")) return [];
  const claimed = steps.find((s) => /\bautomations?\b|\brule\b/i.test(`${s.label} ${s.detail ?? ""}`));
  return claimed
    ? [
        `Step "${claimed.label}" changes an automation, but no operation does: add_rule with the automation's id and the complete new rule (trigger, and actions with target, fieldId and delta) replaces it.`,
      ]
    : [];
}

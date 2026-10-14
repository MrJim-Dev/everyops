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
import { stepsFromMarkers } from "@/lib/blueprint/form-steps";
import type {
  Block,
  Blueprint,
  DataRecord,
  Entity,
  Field,
  RecordData,
  View,
  Widget,
} from "@/lib/blueprint/types";
import { validateBlueprint } from "@/lib/blueprint/validate";
import { widgetValue } from "@/lib/engine/aggregate";
import {
  applyOps,
  type ChangeOp,
  type ChangePlan,
  commitChange,
  type DocOp,
  type RecordOp,
  type TeamOp,
} from "@/lib/engine/changes";
import { metricFormatter } from "@/lib/engine/metric-format";
import { optionUsage, strandedOptions } from "@/lib/engine/options";
import { applyRecordOps } from "@/lib/engine/records";
import { isPublic } from "@/lib/public/resolve";
import { type Invite, type Member, randomToken } from "@/lib/store/workspace-model";
import { todayKey } from "@/lib/time";
import { ASSISTANT_SYSTEM, type AssistantAnswer, assistantAnswer } from "./assistant-prompt";
import { attachmentParts, copyPhotoToWorkspace } from "./attachments";
import { fillNotesView, tidyBlocks, toEntity, toFieldValue, toRule, toView } from "./design";
import { generateJsonHedged } from "./gemini";

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

const MAX_RECORD_CHARS = 120_000;

/**
 * Records as compact JSON lines per record type, cut off if the workspace is very large. What the person is
 * looking at goes first, so it's never the part that gets cut.
 */
function recordContext(bp: Blueprint, records: DataRecord[], focus: { ids: string[]; entityId?: string }) {
  const lines: string[] = [];
  let size = 0;
  let cut = false;
  const rank = new Map(focus.ids.map((id, i) => [id, i]));
  const first = (r: DataRecord) => rank.get(r.id) ?? Number.MAX_SAFE_INTEGER;
  const entities = [...bp.entities].sort(
    (a, b) => Number(b.id === focus.entityId) - Number(a.id === focus.entityId),
  );
  for (const e of entities) {
    const own = records.filter((r) => r.entityId === e.id).sort((a, b) => first(a) - first(b));
    lines.push(`## ${e.pluralName} (${e.id}): ${own.length} records`);
    for (const r of own) {
      const line = JSON.stringify({ id: r.id, ...r.data });
      if (size + line.length > MAX_RECORD_CHARS) {
        cut = true;
        break;
      }
      size += line.length;
      lines.push(line);
    }
  }
  if (cut) lines.push("(Data cut off here: the workspace has more records than fit.)");
  return lines.join("\n");
}

type RawPlan = AssistantAnswer["plan"];

const DATE_TYPES = new Set(["date", "datetime", "time_range"]);

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

function toDesignOps(
  bp: Blueprint,
  raw: RawPlan["ops"],
  renames: RawPlan["renames"] = [],
  formulas: RawPlan["formulas"] = [],
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
        if (o.view && systemId) {
          const view = toView(o.view);
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
        const fieldIds = split ? split.fieldIds : o.fieldIds;
        // Fields added earlier in the same plan count too ("add guest name and phone, then ask them on the form").
        const added = ops.flatMap((x) =>
          x.op === "add_field" && x.entityId === entity?.id ? [x.field.id] : [],
        );
        const unknown = entity
          ? (fieldIds ?? []).filter((id) => !entity.fields.some((f) => f.id === id) && !added.includes(id))
          : [];
        if (unknown.length && entity) {
          errors.push(
            `${at}: ${unknown.join(", ")} aren't fields of ${entity.id} (fields: ${entity.fields.map((f) => f.id).join(", ")})`,
          );
          break;
        }
        if (view && fieldIds?.length && !["table", "kanban", "approval_queue", "form"].includes(view.type)) {
          errors.push(`${at}: a ${view.type} view has no columns to order`);
          break;
        }
        const patch = {
          ...(o.public !== undefined ? { public: o.public } : {}),
          ...(o.intro ? { intro: o.intro } : {}),
          ...(o.submitLabel ? { submitLabel: o.submitLabel } : {}),
          ...(fieldIds?.length ? { fieldIds } : {}),
          ...(split?.steps ? { steps: split.steps, review: true } : {}),
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
        if (bp.systems.some((s) => s.id === o.pageId))
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
    else if (r.kind === "page") ops.push({ op: "rename_system", systemId: r.id, name });
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
  // Blocks on public pages point at real record types, fields and forms.
  const fieldsOf = (id: string) =>
    new Set(allEntities.find((e) => e.id === id)?.fields.map((f) => f.id) ?? []);
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
    return { entity: created ?? bp.entities.find((e) => e.id === id), isNew: !!created };
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
    "move_view",
    "update_view",
    "add_block",
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
  ops.splice(0, ops.length, ...unique.sort((a, b) => rank(a) - rank(b)));
  // Existing ids can't be redefined, and every new view or widget must land in a section.
  for (const op of ops) {
    const viewKnown = (id: string) =>
      bp.views.some((v) => v.id === id) || ops.some((x) => x.op === "add_view" && x.view.id === id);
    const systemKnown = (id: string) =>
      bp.systems.some((s) => s.id === id) || ops.some((x) => x.op === "add_system" && x.system.id === id);
    if (
      (op.op === "move_view" ||
        op.op === "rename_view" ||
        op.op === "update_view" ||
        op.op === "add_block") &&
      !viewKnown(op.viewId)
    )
      errors.push(`${op.op}: view "${op.viewId}" doesn't exist`);
    if ((op.op === "move_view" || op.op === "rename_system") && !systemKnown(op.systemId))
      errors.push(`${op.op}: page "${op.systemId}" doesn't exist`);
    if (op.op === "add_entity" && bp.entities.some((e) => e.id === op.entity.id))
      errors.push(`Record type "${op.entity.id}" already exists`);
    if (
      op.op === "add_field" &&
      bp.entities.find((e) => e.id === op.entityId)?.fields.some((f) => f.id === op.field.id)
    )
      errors.push(`Field "${op.field.id}" already exists on ${op.entityId}`);
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
function toDocOps(bp: Blueprint, raw: RawPlan["pageTexts"], errors: string[]): DocOp[] {
  const ops: DocOp[] = [];
  for (const [i, p] of raw.entries()) {
    const view = bp.views.find((v) => v.id === p.viewId);
    if (view?.type !== "document") {
      const pages = bp.views.filter((v) => v.type === "document").map((v) => v.id);
      errors.push(
        `pageTexts[${i}]: "${p.viewId}" isn't a document page (document pages: ${pages.join(", ") || "none"})`,
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
    `Reading ${records.length} ${records.length === 1 ? "record" : "records"} across ${bp.entities.length} record types`,
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
                  }`
                : v.type === "html"
                  ? isPublic(v)
                    ? ", public"
                    : ", team only"
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

Records:
${recordContext(bp, records, { ids: screen.focusIds, entityId: screen.entityId })}

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
  let repaired = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    status(attempt === 0 ? "Thinking it through" : "Reworking the plan so it fits your workspace");
    // Answers take 3–8 s and plans with pages 10–25 s. A stalled call gets a parallel twin after 28 s.
    const result = await generateJsonHedged(
      assistantAnswer,
      {
        system: ASSISTANT_SYSTEM,
        prompt,
        task: "assistant",
        repair: fixOpNames,
        timeoutMs: 60_000,
        thinking: "LOW",
        // Real plans are 200–2,500 tokens; a looping answer stops here and the next attempt starts.
        maxOutputTokens: 6000,
      },
      { hedgeMs: 28_000 },
    );
    if (!result.ok) return { ok: false, message: result.error };
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

    const design = toDesignOps(bp, a.plan.ops, a.plan.renames, a.plan.formulas);
    const errors = [...design.errors];
    if (design.ops.length && !input.canDesign)
      errors.push("This person can't change the design; plan data changes only or explain who can.");
    const next = design.ops.length ? applyOps(bp, design.ops) : bp;
    const before = new Set(validateBlueprint(bp).map((e) => `${e.path} ${e.message}`));
    for (const e of validateBlueprint(next))
      if (!before.has(`${e.path} ${e.message}`)) errors.push(`${e.path}: ${e.message}`);
    for (const op of design.ops)
      if ((op.op === "add_view" || op.op === "add_widget") && !next.systems.some((s) => s.id === op.systemId))
        errors.push(`${op.op}: section "${op.systemId}" doesn't exist`);

    const recordPart = await toRecordOps(next, records, a.plan.recordOps, photo);
    errors.push(...recordPart.errors);
    if (recordPart.ops.length && !input.canEditRecords) errors.push("This person can't change data.");
    const docOps = toDocOps(next, a.plan.pageTexts, errors);
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
          request: input.messages.at(-1)?.text ?? "",
          baseVersion: bp.version,
          title: a.plan.title || "Workspace change",
          facts: facts.slice(0, 6),
          steps: a.plan.steps.slice(0, 10),
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
    if (repaired) break;
    repaired = true;
    if (errors.some((e) => e.endsWith("needs options")))
      errors.push(
        'Every select and status field needs "options": [{ "id": "lead", "label": "Lead", "tone": "neutral" }, …] with the choices the person described, or sensible ones.',
      );
    prompt = withFiles(
      `${context}\n\nYour previous plan:\n${JSON.stringify(a.plan)}\n\nIt was rejected:\n- ${errors.length ? errors.slice(0, 15).join("\n- ") : "it had no operations"}\nReturn a corrected answer. The person never saw the rejected plan, so write the reply as your first answer: don't mention corrections or errors.`,
    );
  }
  return {
    ok: false,
    message: "I couldn't put together a valid change for that. Try describing it a little differently.",
  };
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
  edit_field: "update_field",
  modify_field: "update_field",
  change_field: "update_field",
  edit_view: "update_view",
  patch_view: "update_view",
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

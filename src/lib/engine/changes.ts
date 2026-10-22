import { findEntity } from "@/lib/blueprint/lookup";
import { walkPath } from "@/lib/blueprint/paths";
import type {
  Block,
  BlockItem,
  Blueprint,
  BookingLayout,
  DataRecord,
  Entity,
  Field,
  FieldValue,
  FormStep,
  PrintTemplate,
  RecordData,
  Rule,
  System,
  View,
  Widget,
  WorkspaceData,
} from "@/lib/blueprint/types";
import { validateBlueprint } from "@/lib/blueprint/validate";
import { computeAll } from "./compute";
import { recordContext } from "./context";
import { parseExpr, run, truthy } from "./expr";
import { completeRule, unrequireFilled } from "./rule-repair";

/**
 * The only edits a change plan may make to the design. Every one is reversible: a change saves a whole new
 * blueprint version, so undo goes back to the previous one, and records it removes are kept on its history entry.
 */
export type ChangeOp =
  | { op: "add_field"; entityId: string; field: Field }
  | { op: "update_field"; entityId: string; fieldId: string; patch: Partial<Omit<Field, "id">> }
  | { op: "add_view"; systemId: string; view: View }
  | { op: "add_view_field"; viewId: string; fieldId: string }
  | { op: "add_widget"; systemId: string; widget: Widget }
  /** Changes a dashboard card: its title, what it counts or adds up, its formula, or its target. */
  | {
      op: "update_widget";
      widgetId: string;
      patch: Partial<Pick<Widget, "title" | "filter" | "metric" | "calc" | "target">>;
    }
  | { op: "rename_workspace"; name: string }
  /** The currency the workspace's money reads in. Amounts stay as they are; only how they read changes. */
  | { op: "set_currency"; currency: string }
  | { op: "add_entity"; entity: Entity }
  | { op: "add_system"; system: System }
  /** Adds an automation, or replaces the one with the same id (how an automation is fixed or changed). */
  | { op: "add_rule"; rule: Rule }
  /** Moves a view (tab) to another page. A page left with nothing on it is removed. */
  | { op: "move_view"; viewId: string; systemId: string }
  | { op: "rename_system"; systemId: string; name: string }
  | { op: "rename_view"; viewId: string; name: string }
  /**
   * View settings. Forms and landing pages: who can see them, the intro, the button. fieldIds sets which fields
   * a view shows and in what order: a form's questions, a table's columns, a board's card fields or an approval
   * queue's details, or the extra order fields a Register asks.
   */
  | {
      op: "update_view";
      viewId: string;
      /** Forms: steps replace the form's steps (an empty list makes it one page again). */
      patch: {
        public?: boolean;
        intro?: string;
        submitLabel?: string;
        fieldIds?: string[];
        steps?: FormStep[];
        review?: boolean;
        multipleSlots?: boolean;
        bookingLayout?: BookingLayout;
      };
    }
  /** Adds a block (live data, text, a form) to a form or landing page, optionally before another block. */
  | { op: "add_block"; viewId: string; block: Block; beforeBlockId?: string }
  /** Removes a record type with everything built on it: its tabs, cards, rules, links to it and line items. */
  | { op: "remove_entity"; entityId: string }
  /** Removes a field from a record type and from the columns, cards and blocks that show it. */
  | { op: "remove_field"; entityId: string; fieldId: string }
  /** Removes a sidebar page with its tabs and cards. */
  | { op: "remove_system"; systemId: string }
  | { op: "remove_view"; viewId: string }
  /**
   * Swaps a tab for a new one in the same place on its page, e.g. a table turned into a board. Links to the old
   * tab ("View all" on cards) point at the new one.
   */
  | { op: "replace_view"; viewId: string; view: View }
  | { op: "remove_widget"; widgetId: string }
  | { op: "remove_rule"; ruleId: string }
  | { op: "remove_block"; viewId: string; blockId: string }
  /** Moves a sidebar page to a position (0 is the top). */
  | { op: "move_system"; systemId: string; index: number }
  /** Lists a page under a sidebar group, or on its own when group is "". */
  | { op: "group_system"; systemId: string; group: string }
  /** Changes the words of one block on a form or landing page. Fields that don't apply to its type are ignored. */
  | { op: "update_block"; viewId: string; blockId: string; patch: BlockPatch }
  /** Replaces a landing page's blocks, e.g. with the standard site layout. */
  | {
      op: "replace_blocks";
      viewId: string;
      blocks: Block[];
      layout?: "standard";
    }
  /** Adds a print template (an invoice, a quote), or replaces the one with the same id. */
  | { op: "add_print_template"; template: PrintTemplate }
  | { op: "remove_print_template"; templateId: string };

/** New words for a block. Only the keys its type has are used. */
export type BlockPatch = Partial<{
  heading: string;
  subheading: string;
  ctaLabel: string;
  title: string;
  markdown: string;
  items: BlockItem[];
  phone: string;
  email: string;
  address: string;
  hours: string;
}>;

/** The keys each block type can take from a BlockPatch. */
const PATCHABLE: Partial<Record<Block["type"], (keyof BlockPatch)[]>> = {
  hero: ["heading", "subheading", "ctaLabel"],
  text: ["markdown"],
  records: ["title"],
  form: ["title"],
  highlights: ["title", "items"],
  steps: ["title", "items"],
  contact: ["title", "phone", "email", "address", "hours"],
};

/** The patch with only what this block type uses; empty when nothing applies. */
export function patchFor(block: Block, patch: BlockPatch): BlockPatch {
  const keys = PATCHABLE[block.type] ?? [];
  return Object.fromEntries(
    Object.entries(patch).filter(([k, v]) => keys.includes(k as keyof BlockPatch) && v !== undefined),
  ) as BlockPatch;
}

/** Data edits a plan may make after its design changes: add, change or delete records. */
export type RecordOp =
  | { op: "create_record"; id: string; entityId: string; data: RecordData }
  | { op: "update_record"; recordId: string; patch: RecordData }
  /** Deletes a record and its line items. The history entry keeps them so undo can bring them back. */
  | { op: "delete_record"; recordId: string };

/** Text of a document page, by view id. Undo restores the text it replaced. */
export type DocOp = { viewId: string; body: string };

/** Team changes that can be undone: invites and roles. Removing someone can't be undone, so it isn't here. */
export type TeamOp =
  | { op: "invite"; email: string; role: "admin" | "staff" | "viewer" }
  | { op: "set_role"; email: string; role: "admin" | "staff" | "viewer" }
  | { op: "revoke_invite"; email: string };

export type PlanStep = { kind: "add" | "change" | "remove"; label: string; detail: string };

export type ChangePlan = {
  /** Requirements reviewed against validated operations before presenting the plan. */
  coverage?: { request: string; detail: string }[];
  request: string;
  title: string;
  /** Plain-language facts the owner should confirm, e.g. "Peak hours: 5–10 PM". */
  facts: { label: string; value: string }[];
  steps: PlanStep[];
  ops: ChangeOp[];
  /** Applied after `ops`, through the same validation and rules as editing by hand. */
  recordOps?: RecordOp[];
  docOps?: DocOp[];
  teamOps?: TeamOp[];
  /** The blueprint version the plan was checked against; a design plan can't be applied to a newer one. */
  baseVersion?: number;
  /**
   * Where the plan came from when it isn't a person or Ask EveryOps: "import" is a spreadsheet brought in. Its
   * records are added in one pass without the save automations (an import is data that already happened: old
   * bookings shouldn't email their guests or take stock again), and the server doesn't run them either.
   */
  source?: "import";
  /** An import whose owner chose to run the save automations on its rows (this week's stock movements, say). */
  runAutomations?: boolean;
};

export type RecordChange = {
  recordId: string;
  fieldId: string;
  before: FieldValue | undefined;
  after: FieldValue | undefined;
};

export type Impact = {
  changes: RecordChange[];
  changedRecordIds: string[];
  frozenRecordIds: string[];
  errors: string[];
};

/** Which fields a view shows, in order. Unknown ids and repeats are dropped; an empty list leaves it as it was. */
function setViewFields(view: View, entity: Entity | undefined, fieldIds: string[]) {
  if (!entity) return;
  const ids = [...new Set(fieldIds)].filter((id) => entity.fields.some((f) => f.id === id));
  switch (view.type) {
    case "table":
      if (ids.length) view.fieldIds = ids;
      break;
    case "form":
      view.fieldIds = ids;
      break;
    case "kanban":
      view.cardFieldIds = ids.filter((id) => id !== view.statusFieldId);
      break;
    case "approval_queue":
      view.detailFieldIds = ids;
      break;
    case "checkout":
      view.fieldIds = ids;
      break;
  }
}

/* ---------- Removals (on the copy applyOps works on) ---------- */

/**
 * Pages left with nothing on them go, at the end of the plan: a plan that removes a page's only tab and then adds its
 * replacement ("turn the Welcome tab into a custom HTML page") keeps the page. Pages the plan adds aren't dropped
 * here; validation reports one that ends up empty.
 */
const dropEmptySystems = (bp: Blueprint, keep: Set<string> = new Set()) => {
  bp.systems = bp.systems.filter((s) => s.viewIds.length + s.widgetIds.length > 0 || keep.has(s.id));
};

function removeWidget(bp: Blueprint, widgetId: string) {
  bp.widgets = bp.widgets.filter((w) => w.id !== widgetId);
  for (const s of bp.systems) s.widgetIds = s.widgetIds.filter((id) => id !== widgetId);
}

function removeView(bp: Blueprint, viewId: string) {
  bp.views = bp.views.filter((v) => v.id !== viewId);
  for (const s of bp.systems) s.viewIds = s.viewIds.filter((id) => id !== viewId);
  // Links to it: "View all" on list cards, and buttons or embedded forms on public pages.
  for (const w of bp.widgets) if (w.list?.viewId === viewId) delete w.list.viewId;
  for (const v of bp.views)
    if ((v.type === "form" || v.type === "landing") && v.blocks)
      v.blocks = v.blocks
        .filter((b) => !(b.type === "form" && b.viewId === viewId))
        .map((b) => (b.type === "hero" && b.ctaViewId === viewId ? { ...b, ctaViewId: undefined } : b));
}

/**
 * Formula fields that read a field about to go (directly, or through a link into its record type) become plain
 * fields that keep the values they have now, so nothing breaks and no data is lost. Undo restores the formula.
 */
function freezeDependents(bp: Blueprint, entityId: string, fieldId: string) {
  for (const e of bp.entities)
    for (const f of e.fields) {
      if (!f.formula) continue;
      const parsed = parseExpr(f.formula.expr);
      if (!parsed.ok) continue;
      // Directly, or anywhere along a path of links ("delivery.supplier.lead_days").
      const reads = parsed.refs.some((ref) =>
        walkPath(bp, e, ref.split(".")).steps.some((s) => s.entity.id === entityId && s.field.id === fieldId),
      );
      if (!reads) continue;
      f.type = f.formula.resultType;
      delete f.formula;
    }
}

function removeField(bp: Blueprint, entityId: string, fieldId: string) {
  const entity = bp.entities.find((e) => e.id === entityId);
  if (!entity) return;
  freezeDependents(bp, entityId, fieldId);
  entity.fields = entity.fields.filter((f) => f.id !== fieldId);
  const keep = (ids: string[]) => ids.filter((id) => id !== fieldId);
  for (const v of bp.views) {
    if (v.entityId !== entityId) continue;
    if (v.type === "table") {
      v.fieldIds = keep(v.fieldIds);
      v.sort = v.sort?.filter((s) => s.fieldId !== fieldId);
    }
    if (v.type === "form") {
      v.fieldIds = keep(v.fieldIds);
      // Its steps lose the field too; a step left asking nothing (and not holding the add-ons) goes.
      if (v.steps) {
        v.steps = v.steps
          .map((s) => ({ ...s, fieldIds: keep(s.fieldIds) }))
          .filter((s) => s.fieldIds.length || (s.extras && v.extras));
        if (!v.steps.length) delete v.steps;
      }
      if (v.extras?.lineEntityId === entityId) {
        if (v.extras.itemFieldId === fieldId) delete v.extras;
        else if (v.extras.quantityFieldId === fieldId) delete v.extras.quantityFieldId;
      }
    }
    if (v.type === "kanban") v.cardFieldIds = keep(v.cardFieldIds);
    if (v.type === "approval_queue") v.detailFieldIds = keep(v.detailFieldIds);
    if (v.type === "checkout" && v.fieldIds) v.fieldIds = keep(v.fieldIds);
    if (v.type === "notes" && v.metaFieldIds) v.metaFieldIds = keep(v.metaFieldIds);
  }
  for (const w of bp.widgets) if (w.entityId === entityId && w.list) w.list.fieldIds = keep(w.list.fieldIds);
  // A duplicate removed beside its original (payment_method_select next to payment_method, a merge): a chart grouped
  // by the duplicate groups by the original instead of breaking.
  const original = entity.fields.find((f) => fieldId.startsWith(`${f.id}_`));
  if (original)
    for (const w of bp.widgets)
      if (w.entityId === entityId && w.chart?.groupByFieldId === fieldId)
        w.chart.groupByFieldId = original.id;
  for (const v of bp.views)
    if ((v.type === "form" || v.type === "landing") && v.blocks)
      for (const b of v.blocks)
        if (b.type === "records" && b.entityId === entityId) b.fieldIds = keep(b.fieldIds);
  // Anything that can't work without it (a board grouped by it, a formula reading it) is reported by
  // validation, so the plan removes or changes it on purpose.
}

/** A record type and everything that only exists because of it, including its line-item types. */
function removeEntity(bp: Blueprint, entityId: string) {
  if (!bp.entities.some((e) => e.id === entityId)) return;
  for (const child of bp.entities.filter((e) => e.parent?.entityId === entityId && e.id !== entityId))
    removeEntity(bp, child.id);
  bp.entities = bp.entities.filter((e) => e.id !== entityId);
  for (const v of bp.views.filter(
    (v) =>
      v.entityId === entityId ||
      (v.type === "checkout" && (v.productEntityId === entityId || v.lineEntityId === entityId)),
  ))
    removeView(bp, v.id);
  for (const w of bp.widgets.filter(
    (w) => w.entityId === entityId || w.calc?.terms.some((t) => t.entityId === entityId),
  ))
    removeWidget(bp, w.id);
  bp.rules = bp.rules.filter((r) => r.trigger.entityId !== entityId);
  if (bp.printTemplates) bp.printTemplates = bp.printTemplates.filter((t) => t.entityId !== entityId);
  for (const e of bp.entities)
    for (const f of e.fields.filter(
      (f) => f.relation?.entityId === entityId || f.rollup?.childEntityId === entityId,
    ))
      removeField(bp, e.id, f.id);
  for (const v of bp.views)
    if ((v.type === "form" || v.type === "landing") && v.blocks)
      v.blocks = v.blocks.filter((b) => !(b.type === "records" && b.entityId === entityId));
  // A form whose add-ons lived in it offers none now.
  for (const v of bp.views) if (v.type === "form" && v.extras?.lineEntityId === entityId) delete v.extras;
}

export function applyOps(bp: Blueprint, ops: ChangeOp[]): Blueprint {
  const next: Blueprint = structuredClone(bp);
  next.version = bp.version + 1;
  const addTo = (list: string[] | undefined, id: string) => {
    if (list && !list.includes(id)) list.push(id);
  };
  // Ops are copied so applying a plan never changes the plan itself (it's applied once to rehearse, then for real).
  for (const op of structuredClone(ops)) {
    switch (op.op) {
      case "add_field": {
        const entity = next.entities.find((e) => e.id === op.entityId);
        if (!entity) break;
        // An existing id is redefined in place ("make Rider a choice of Jun or Manuel"): the id stays, so views,
        // filters and record values keep pointing at it. Undo restores the previous blueprint.
        const at = entity.fields.findIndex((f) => f.id === op.field.id);
        if (at >= 0) entity.fields[at] = op.field;
        else entity.fields.push(op.field);
        break;
      }
      case "update_field": {
        const entity = next.entities.find((e) => e.id === op.entityId);
        const field = entity?.fields.find((f) => f.id === op.fieldId);
        if (field) Object.assign(field, op.patch);
        break;
      }
      case "add_view": {
        if (next.views.some((v) => v.id === op.view.id)) break;
        next.views.push(op.view);
        addTo(next.systems.find((s) => s.id === op.systemId)?.viewIds, op.view.id);
        break;
      }
      case "add_view_field": {
        const view = next.views.find((v) => v.id === op.viewId);
        if (view?.type === "table" && !view.fieldIds.includes(op.fieldId)) view.fieldIds.push(op.fieldId);
        break;
      }
      case "add_widget": {
        if (next.widgets.some((w) => w.id === op.widget.id)) break;
        next.widgets.push(op.widget);
        addTo(next.systems.find((s) => s.id === op.systemId)?.widgetIds, op.widget.id);
        break;
      }
      case "update_widget": {
        const widget = next.widgets.find((w) => w.id === op.widgetId);
        if (!widget) break;
        Object.assign(widget, op.patch);
        // A card with a formula belongs to the record type of its first total; each total has its own filter.
        if (op.patch.calc?.terms[0]) {
          widget.entityId = op.patch.calc.terms[0].entityId;
          if (op.patch.filter === undefined) delete widget.filter;
          // A formula's totals can span record types, so the period comparison (one date field) no longer applies.
          delete widget.compare;
          delete widget.sparkline;
        }
        if (widget.filter === "") delete widget.filter;
        break;
      }
      case "rename_workspace":
        next.workspaceName = op.name;
        break;
      case "set_currency":
        next.currency = op.currency;
        break;
      case "add_entity":
        if (!next.entities.some((e) => e.id === op.entity.id)) next.entities.push(op.entity);
        break;
      case "add_system":
        if (!next.systems.some((s) => s.id === op.system.id)) next.systems.push(op.system);
        break;
      case "add_rule": {
        // Blanks with one sensible answer (which stock field, which quantity) are filled in; anything else that
        // can't run is reported by validation, so the plan is corrected before anyone sees it.
        const rule = completeRule(next, structuredClone(op.rule));
        const at = next.rules.findIndex((r) => r.id === rule.id);
        if (at >= 0) next.rules[at] = rule;
        else next.rules.push(rule);
        // The field it fills in on add stops being required, so the form saves and the automation runs.
        next.entities = unrequireFilled(next).entities;
        break;
      }
      case "move_view": {
        const target = next.systems.find((s) => s.id === op.systemId);
        if (!target || !next.views.some((v) => v.id === op.viewId)) break;
        for (const s of next.systems) s.viewIds = s.viewIds.filter((id) => id !== op.viewId);
        target.viewIds.push(op.viewId);
        break;
      }
      case "remove_entity":
        removeEntity(next, op.entityId);
        break;
      case "remove_field":
        removeField(next, op.entityId, op.fieldId);
        break;
      case "remove_system": {
        const system = next.systems.find((s) => s.id === op.systemId);
        if (!system) break;
        for (const id of system.viewIds) removeView(next, id);
        for (const id of system.widgetIds) removeWidget(next, id);
        next.systems = next.systems.filter((s) => s.id !== op.systemId);
        break;
      }
      case "remove_view":
        removeView(next, op.viewId);
        break;
      case "replace_view": {
        const at = next.views.findIndex((v) => v.id === op.viewId);
        if (at < 0) break;
        if (op.view.id === op.viewId) {
          next.views[at] = op.view;
          break;
        }
        if (next.views.some((v) => v.id === op.view.id)) break;
        const places = next.systems.flatMap((s) => {
          const i = s.viewIds.indexOf(op.viewId);
          return i < 0 ? [] : [{ s, i }];
        });
        const cards = next.widgets.filter((w) => w.list?.viewId === op.viewId);
        removeView(next, op.viewId);
        next.views.splice(at, 0, op.view);
        for (const { s, i } of places) s.viewIds.splice(i, 0, op.view.id);
        for (const w of cards) if (w.list) w.list.viewId = op.view.id;
        break;
      }
      case "remove_widget":
        removeWidget(next, op.widgetId);
        break;
      case "remove_rule":
        next.rules = next.rules.filter((r) => r.id !== op.ruleId);
        break;
      case "add_print_template": {
        const list = [...(next.printTemplates ?? [])];
        const at = list.findIndex((t) => t.id === op.template.id);
        if (at >= 0) list[at] = structuredClone(op.template);
        else list.push(structuredClone(op.template));
        next.printTemplates = list;
        break;
      }
      case "remove_print_template":
        if (next.printTemplates)
          next.printTemplates = next.printTemplates.filter((t) => t.id !== op.templateId);
        break;
      case "remove_block": {
        const view = next.views.find((v) => v.id === op.viewId);
        if ((view?.type === "form" || view?.type === "landing") && view.blocks)
          view.blocks = view.blocks.filter((b) => b.id !== op.blockId);
        // A step that showed it doesn't any more.
        if (view?.type === "form" && view.steps)
          for (const s of view.steps)
            if (s.blockIds) {
              s.blockIds = s.blockIds.filter((id) => id !== op.blockId);
              if (!s.blockIds.length) delete s.blockIds;
            }
        break;
      }
      case "move_system": {
        const from = next.systems.findIndex((s) => s.id === op.systemId);
        if (from < 0) break;
        const [system] = next.systems.splice(from, 1);
        next.systems.splice(Math.max(0, Math.min(op.index, next.systems.length)), 0, system);
        break;
      }
      case "rename_system": {
        const system = next.systems.find((s) => s.id === op.systemId);
        if (system) system.name = op.name;
        break;
      }
      case "group_system": {
        const system = next.systems.find((s) => s.id === op.systemId);
        const group = op.group.trim();
        if (system && group) system.group = group;
        else if (system) delete system.group;
        break;
      }
      case "rename_view": {
        const view = next.views.find((v) => v.id === op.viewId);
        if (view) view.name = op.name;
        break;
      }
      case "update_view": {
        const view = next.views.find((v) => v.id === op.viewId);
        if (!view) break;
        const { fieldIds, steps, ...settings } = op.patch;
        if (view.type === "form") {
          Object.assign(view, settings);
          if (steps?.length) view.steps = structuredClone(steps);
          else if (steps) {
            delete view.steps;
            delete view.review;
          }
        } else if (
          (view.type === "landing" || view.type === "html" || view.type === "layout") &&
          settings.public !== undefined
        )
          view.public = settings.public;
        // A table "made public" is shared as data for public pages; it never becomes a page of the site.
        else if (view.type === "table" && settings.public !== undefined) {
          if (settings.public) view.publicData = true;
          else delete view.publicData;
        }
        if (fieldIds) setViewFields(view, findEntity(next, view.entityId), fieldIds);
        break;
      }
      case "add_block": {
        const view = next.views.find((v) => v.id === op.viewId);
        if (view?.type !== "form" && view?.type !== "landing") break;
        if (view.type === "form" && !view.blocks) view.blocks = [];
        const blocks = view.blocks ?? [];
        if (blocks.some((b) => b.id === op.block.id)) break;
        const at = op.beforeBlockId ? blocks.findIndex((b) => b.id === op.beforeBlockId) : -1;
        blocks.splice(at < 0 ? blocks.length : at, 0, op.block);
        break;
      }
      case "update_block": {
        const view = next.views.find((v) => v.id === op.viewId);
        if (view?.type !== "form" && view?.type !== "landing") break;
        const i = (view.blocks ?? []).findIndex((b) => b.id === op.blockId);
        const blocks = view.blocks ?? [];
        if (i >= 0) blocks[i] = { ...blocks[i], ...patchFor(blocks[i], op.patch) } as Block;
        break;
      }
      case "replace_blocks": {
        const view = next.views.find((v) => v.id === op.viewId);
        if (view?.type !== "landing") break;
        view.blocks = op.blocks;
        if (op.layout) view.layout = op.layout;
        break;
      }
    }
  }
  dropEmptySystems(next, new Set(ops.flatMap((op) => (op.op === "add_system" ? [op.system.id] : []))));
  return next;
}

function diffRecords(before: DataRecord[], after: DataRecord[]): RecordChange[] {
  const changes: RecordChange[] = [];
  const prior = new Map(before.map((r) => [r.id, r]));
  for (const row of after) {
    const old = prior.get(row.id);
    if (!old) continue;
    const keys = new Set([...Object.keys(old.data), ...Object.keys(row.data)]);
    for (const key of keys) {
      if (JSON.stringify(old.data[key]) !== JSON.stringify(row.data[key]))
        changes.push({ recordId: row.id, fieldId: key, before: old.data[key], after: row.data[key] });
    }
  }
  return changes;
}

/**
 * Dry run: what would happen to existing records under the new blueprint.
 * Records frozen by a formula's freezeWhen keep their values and are counted.
 */
export function computeImpact(ws: WorkspaceData, nextBp: Blueprint, now = new Date()): Impact {
  const errors = validateBlueprint(nextBp).map((e) => e.message);
  if (errors.length) return { changes: [], changedRecordIds: [], frozenRecordIds: [], errors };

  const recomputed = computeAll(nextBp, ws.records, now);
  const changes = diffRecords(ws.records, recomputed);

  const frozen = new Set<string>();
  for (const entity of nextBp.entities) {
    const freezing = entity.fields.filter((f) => f.formula?.freezeWhen);
    if (!freezing.length) continue;
    for (const row of ws.records) {
      if (row.entityId !== entity.id) continue;
      const ctx = recordContext(nextBp, entity, row.data, ws.records, now);
      if (freezing.some((f) => truthy(run(f.formula?.freezeWhen ?? "", ctx)))) frozen.add(row.id);
    }
  }
  return {
    changes,
    changedRecordIds: [...new Set(changes.map((c) => c.recordId))],
    frozenRecordIds: [...frozen],
    errors,
  };
}

export function commitChange(ws: WorkspaceData, nextBp: Blueprint, now = new Date()) {
  const records = computeAll(nextBp, ws.records, now);
  return { data: { blueprint: nextBp, records }, changes: diffRecords(ws.records, records) };
}

/** Restores the previous blueprint and the exact values the change replaced. */
export function revertChange(
  ws: WorkspaceData,
  previous: Blueprint,
  changes: RecordChange[],
  now = new Date(),
): WorkspaceData {
  const byRecord = new Map<string, RecordChange[]>();
  for (const c of changes) byRecord.set(c.recordId, [...(byRecord.get(c.recordId) ?? []), c]);
  const restored = ws.records.map((row) => {
    const own = byRecord.get(row.id);
    if (!own) return row;
    const data = { ...row.data };
    for (const c of own) {
      if (c.before === undefined) delete data[c.fieldId];
      else data[c.fieldId] = c.before;
    }
    return { ...row, data };
  });
  return { blueprint: previous, records: computeAll(previous, restored, now) };
}

export function describeEntity(bp: Blueprint, entityId: string) {
  return findEntity(bp, entityId)?.name ?? entityId;
}

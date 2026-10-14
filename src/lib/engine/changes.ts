import { findEntity } from "@/lib/blueprint/lookup";
import type {
  Block,
  BlockItem,
  Blueprint,
  DataRecord,
  Entity,
  Field,
  FieldValue,
  FormStep,
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
  | { op: "add_entity"; entity: Entity }
  | { op: "add_system"; system: System }
  | { op: "add_rule"; rule: Rule }
  /** Moves a view (tab) to another page. A page left with nothing on it is removed. */
  | { op: "move_view"; viewId: string; systemId: string }
  | { op: "rename_system"; systemId: string; name: string }
  | { op: "rename_view"; viewId: string; name: string }
  /**
   * View settings. Forms and landing pages: who can see them, the intro, the button. fieldIds sets which fields
   * a view shows and in what order: a form's questions, a table's columns, a board's card fields or an approval
   * queue's details.
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
  | { op: "remove_widget"; widgetId: string }
  | { op: "remove_rule"; ruleId: string }
  | { op: "remove_block"; viewId: string; blockId: string }
  /** Moves a sidebar page to a position (0 is the top). */
  | { op: "move_system"; systemId: string; index: number }
  /** Changes the words of one block on a form or landing page. Fields that don't apply to its type are ignored. */
  | { op: "update_block"; viewId: string; blockId: string; patch: BlockPatch }
  /** Replaces a landing page's blocks, e.g. with the standard site layout. */
  | {
      op: "replace_blocks";
      viewId: string;
      blocks: Block[];
      layout?: "standard";
    };

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
  }
}

/* ---------- Removals (on the copy applyOps works on) ---------- */

const dropEmptySystems = (bp: Blueprint) => {
  bp.systems = bp.systems.filter((s) => s.viewIds.length + s.widgetIds.length > 0);
};

function removeWidget(bp: Blueprint, widgetId: string) {
  bp.widgets = bp.widgets.filter((w) => w.id !== widgetId);
  for (const s of bp.systems) s.widgetIds = s.widgetIds.filter((id) => id !== widgetId);
  dropEmptySystems(bp);
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
  dropEmptySystems(bp);
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
      const reads = parsed.refs.some((ref) => {
        const [head, tail] = ref.split(".");
        if (e.id === entityId && head === fieldId) return true;
        const link = e.fields.find((x) => x.id === head);
        return !!tail && tail === fieldId && link?.relation?.entityId === entityId;
      });
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
    if (v.type === "notes" && v.metaFieldIds) v.metaFieldIds = keep(v.metaFieldIds);
  }
  for (const w of bp.widgets) if (w.entityId === entityId && w.list) w.list.fieldIds = keep(w.list.fieldIds);
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
  dropEmptySystems(bp);
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
        if (entity && !entity.fields.some((f) => f.id === op.field.id)) entity.fields.push(op.field);
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
      case "add_entity":
        if (!next.entities.some((e) => e.id === op.entity.id)) next.entities.push(op.entity);
        break;
      case "add_system":
        if (!next.systems.some((s) => s.id === op.system.id)) next.systems.push(op.system);
        break;
      case "add_rule":
        if (!next.rules.some((r) => r.id === op.rule.id)) next.rules.push(op.rule);
        break;
      case "move_view": {
        const target = next.systems.find((s) => s.id === op.systemId);
        if (!target || !next.views.some((v) => v.id === op.viewId)) break;
        for (const s of next.systems) s.viewIds = s.viewIds.filter((id) => id !== op.viewId);
        target.viewIds.push(op.viewId);
        next.systems = next.systems.filter((s) => s.viewIds.length + s.widgetIds.length > 0);
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
      case "remove_widget":
        removeWidget(next, op.widgetId);
        break;
      case "remove_rule":
        next.rules = next.rules.filter((r) => r.id !== op.ruleId);
        break;
      case "remove_block": {
        const view = next.views.find((v) => v.id === op.viewId);
        if ((view?.type === "form" || view?.type === "landing") && view.blocks)
          view.blocks = view.blocks.filter((b) => b.id !== op.blockId);
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
        } else if ((view.type === "landing" || view.type === "html") && settings.public !== undefined)
          view.public = settings.public;
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

import { findEntity } from "@/lib/blueprint/lookup";
import type {
  Block,
  Blueprint,
  DataRecord,
  Entity,
  Field,
  FieldValue,
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
import { run, truthy } from "./expr";

/** The only edits a change plan may make to the design. Nothing here deletes data. */
export type ChangeOp =
  | { op: "add_field"; entityId: string; field: Field }
  | { op: "update_field"; entityId: string; fieldId: string; patch: Partial<Omit<Field, "id">> }
  | { op: "add_view"; systemId: string; view: View }
  | { op: "add_view_field"; viewId: string; fieldId: string }
  | { op: "add_widget"; systemId: string; widget: Widget }
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
      patch: { public?: boolean; intro?: string; submitLabel?: string; fieldIds?: string[] };
    }
  /** Adds a block (live data, text, a form) to a form or landing page, optionally before another block. */
  | { op: "add_block"; viewId: string; block: Block; beforeBlockId?: string };

/** Data edits a plan may make after its design changes: add records or change field values. */
export type RecordOp =
  | { op: "create_record"; id: string; entityId: string; data: RecordData }
  | { op: "update_record"; recordId: string; patch: RecordData };

export type PlanStep = { kind: "add" | "change"; label: string; detail: string };

export type ChangePlan = {
  request: string;
  title: string;
  /** Plain-language facts the owner should confirm, e.g. "Peak hours: 5–10 PM". */
  facts: { label: string; value: string }[];
  steps: PlanStep[];
  ops: ChangeOp[];
  /** Applied after `ops`, through the same validation and rules as editing by hand. */
  recordOps?: RecordOp[];
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
        const { fieldIds, ...settings } = op.patch;
        if (view.type === "form") Object.assign(view, settings);
        else if (view.type === "landing" && settings.public !== undefined) view.public = settings.public;
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

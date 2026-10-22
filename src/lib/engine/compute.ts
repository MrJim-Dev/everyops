import { findEntity } from "@/lib/blueprint/lookup";
import type { Blueprint, DataRecord, Entity, Field, RecordData } from "@/lib/blueprint/types";
import { recordContext } from "./context";
import { parseExpr, run, truthy } from "./expr";

/** Formula fields of an entity in dependency order (cycles are left out). */
export function formulaOrder(entity: Entity): Field[] {
  const formulas = entity.fields.filter((f) => f.type === "formula" && f.formula);
  const ids = new Set(formulas.map((f) => f.id));
  const deps = new Map<string, string[]>();
  for (const f of formulas) {
    const parsed = parseExpr(f.formula?.expr ?? "");
    deps.set(f.id, parsed.ok ? parsed.refs.filter((r) => ids.has(r)) : []);
  }
  const ordered: Field[] = [];
  const state = new Map<string, "visiting" | "done">();
  const visit = (f: Field): boolean => {
    if (state.get(f.id) === "done") return true;
    if (state.get(f.id) === "visiting") return false;
    state.set(f.id, "visiting");
    for (const dep of deps.get(f.id) ?? []) {
      const depField = formulas.find((x) => x.id === dep);
      if (depField && !visit(depField)) return false;
    }
    state.set(f.id, "done");
    ordered.push(f);
    return true;
  };
  for (const f of formulas) visit(f);
  return ordered;
}

function isFrozen(
  bp: Blueprint,
  entity: Entity,
  field: Field,
  data: RecordData,
  records: DataRecord[],
  now: Date,
): boolean {
  const freezeWhen = field.formula?.freezeWhen;
  if (!freezeWhen || data[field.id] === undefined) return false;
  return truthy(run(freezeWhen, recordContext(bp, entity, data, records, now)));
}

function computeFormulas(
  bp: Blueprint,
  entity: Entity,
  data: RecordData,
  records: DataRecord[],
  now: Date,
): RecordData {
  const next = { ...data };
  for (const field of formulaOrder(entity)) {
    if (isFrozen(bp, entity, field, data, records, now)) continue;
    const value = run(field.formula?.expr ?? "", recordContext(bp, entity, next, records, now));
    next[field.id] =
      typeof value === "number" &&
      (field.formula?.resultType === "money" || field.formula?.resultType === "number")
        ? Math.round(value * 100) / 100
        : value;
  }
  return next;
}

/**
 * Record types this browser has only a window of (src/lib/engine/window.ts). Totals over them are worked out on the
 * server from every record, so here they keep the value they came with. Always empty on the server.
 */
let partial: ReadonlySet<string> = new Set();
export function setPartialTypes(ids: Iterable<string>) {
  partial = new Set(ids);
}

function computeRollups(
  bp: Blueprint,
  entity: Entity,
  data: RecordData,
  id: string,
  records: DataRecord[],
  now: Date,
): RecordData {
  const rollups = entity.fields.filter((f) => f.type === "rollup" && f.rollup);
  if (rollups.length === 0) return data;
  const next = { ...data };
  for (const field of rollups) {
    const spec = field.rollup;
    if (!spec) continue;
    // Children the browser has only some of (a windowed type, docs/server-paging.md): the server's total stays.
    if (partial.has(spec.childEntityId)) continue;
    const childEntity = spec.filter ? findEntity(bp, spec.childEntityId) : undefined;
    // A filtered rollup counts only the children its formula is true for (paid lines, open tasks).
    const children = records.filter(
      (r) =>
        r.entityId === spec.childEntityId &&
        r.data[spec.viaFieldId] === id &&
        (!spec.filter ||
          (!!childEntity && truthy(run(spec.filter, recordContext(bp, childEntity, r.data, records, now))))),
    );
    const values = children.map((c) => Number(spec.fieldId ? c.data[spec.fieldId] : 0) || 0);
    switch (spec.op) {
      case "count":
        next[field.id] = children.length;
        break;
      case "sum":
        next[field.id] = values.reduce((a, b) => a + b, 0);
        break;
      case "avg":
        next[field.id] = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
        break;
      case "min":
        next[field.id] = values.length ? Math.min(...values) : 0;
        break;
      case "max":
        next[field.id] = values.length ? Math.max(...values) : 0;
        break;
    }
  }
  return next;
}

/**
 * Recomputes formulas and rollups for every record. Formulas run, rollups
 * aggregate children, then formulas run again so they can read rollups.
 * Frozen values (freezeWhen) are kept.
 */
export function computeAll(bp: Blueprint, records: DataRecord[], now: Date = new Date()): DataRecord[] {
  const pass = (
    rows: DataRecord[],
    step: (entity: Entity, row: DataRecord, all: DataRecord[]) => RecordData,
  ) =>
    rows.map((row) => {
      const entity = findEntity(bp, row.entityId);
      if (!entity) return row;
      const data = step(entity, row, rows);
      return data === row.data ? row : { ...row, data };
    });

  let rows = pass(records, (entity, row, all) => computeFormulas(bp, entity, row.data, all, now));
  rows = pass(rows, (entity, row, all) => computeRollups(bp, entity, row.data, row.id, all, now));
  rows = pass(rows, (entity, row, all) => computeFormulas(bp, entity, row.data, all, now));
  return rows;
}

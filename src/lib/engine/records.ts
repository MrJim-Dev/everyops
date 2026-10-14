import { findRecord, getEntity, optionOf } from "@/lib/blueprint/lookup";
import type {
  Blueprint,
  DataRecord,
  Entity,
  FieldValue,
  RecordData,
  Rule,
  WorkspaceData,
} from "@/lib/blueprint/types";
import { formatRange, isTimeRange } from "@/lib/format";
import { findConflict, resourceLabel } from "./availability";
import type { RecordOp } from "./changes";
import { computeAll } from "./compute";
import { recordContext } from "./context";
import { run, truthy } from "./expr";
import { newId } from "./ids";
import { completeAction } from "./rule-repair";

export type FieldError = { fieldId?: string; message: string };

export type MutationResult =
  | { ok: true; data: WorkspaceData; record: DataRecord; notices: string[] }
  | { ok: false; errors: FieldError[] };

const isEmpty = (v: FieldValue | undefined) =>
  v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

export function validateRecord(
  bp: Blueprint,
  entity: Entity,
  data: RecordData,
  records: DataRecord[],
  ignoreId?: string,
  /** Required fields that may stay empty for now (a public form doesn't ask them; staff fill them in later). */
  notYet?: ReadonlySet<string>,
): FieldError[] {
  const errors: FieldError[] = [];
  for (const field of entity.fields) {
    if (field.type === "formula" || field.type === "rollup") continue;
    const value = data[field.id];
    if (field.required && isEmpty(value) && !notYet?.has(field.id)) {
      errors.push({ fieldId: field.id, message: `${field.name} is required` });
      continue;
    }
    if (isEmpty(value)) continue;
    switch (field.type) {
      case "number":
      case "money":
      case "percent":
        if (typeof value !== "number" || Number.isNaN(value))
          errors.push({ fieldId: field.id, message: `${field.name} must be a number` });
        break;
      case "select":
      case "status":
        if (!optionOf(field, value))
          errors.push({ fieldId: field.id, message: `Choose a valid ${field.name.toLowerCase()}` });
        break;
      case "relation":
        if (typeof value !== "string" || !findRecord(records, value))
          errors.push({ fieldId: field.id, message: `Choose a ${field.name.toLowerCase()}` });
        break;
      case "time_range":
        if (!isTimeRange(value) || Date.parse(value.end) < Date.parse(value.start))
          errors.push({ fieldId: field.id, message: "End must be after start" });
        break;
      case "image":
        if (!isImagePath(value))
          errors.push({ fieldId: field.id, message: `Upload ${field.name.toLowerCase()} again` });
        break;
    }
  }
  if (errors.length === 0 && entity.booking) {
    const conflict = findConflict(entity, data, records, ignoreId);
    if (conflict) {
      const range = conflict.data[entity.booking.timeFieldId];
      const where = resourceLabel(bp, entity, data, records);
      errors.push({
        fieldId: entity.booking.timeFieldId,
        message: `${where || "This resource"} is already booked ${isTimeRange(range) ? formatRange(range) : "at that time"}`,
      });
    }
  }
  return errors;
}

/* ---------- Rules ---------- */

function template(message: string, data: RecordData): string {
  return message.replace(/\{\{(\w+)\}\}/g, (_, id: string) => String(data[id] ?? ""));
}

function matches(rule: Rule, record: DataRecord, event: "created" | "updated", changed: string[]) {
  const t = rule.trigger;
  if (t.entityId !== record.entityId) return false;
  if (t.event === "created") return event === "created";
  if (t.event === "updated") return event === "updated";
  return (
    event === "updated" &&
    !!t.fieldId &&
    changed.includes(t.fieldId) &&
    (t.to === undefined || record.data[t.fieldId] === t.to)
  );
}

function runRules(
  bp: Blueprint,
  records: DataRecord[],
  record: DataRecord,
  event: "created" | "updated",
  changed: string[],
  now: Date,
): { records: DataRecord[]; notices: string[] } {
  const notices: string[] = [];
  let rows = records;
  const entity = getEntity(bp, record.entityId);
  for (const rule of bp.rules) {
    if (!matches(rule, record, event, changed)) continue;
    const ctx = recordContext(bp, entity, record.data, rows, now);
    if (rule.when && !truthy(run(rule.when, ctx))) continue;
    for (const raw of rule.actions) {
      // Saved automations with the stock field or amount left blank still do what their name says.
      const action = completeAction(bp, rule, raw);
      if (!action) continue;
      if (action.type === "notify") {
        notices.push(template(action.message, record.data));
        continue;
      }
      const targetId = action.target.kind === "self" ? record.id : record.data[action.target.fieldId];
      if (typeof targetId !== "string") continue;
      rows = rows.map((row) => {
        if (row.id !== targetId) return row;
        const current = row.data[action.fieldId];
        const value =
          action.type === "set_field"
            ? run(action.value, ctx)
            : (Number(current) || 0) + (Number(run(action.delta, ctx)) || 0);
        return {
          ...row,
          data: { ...row.data, [action.fieldId]: value },
          updatedAt: now.toISOString(),
        };
      });
    }
  }
  return { records: rows, notices };
}

type Contribution = { targetId: string; fieldId: string; amount: number };

/**
 * What a record adds to linked records through its "when created" adjust rules: a delivery's quantity on its
 * product's stock, a sale line's -qty. These stay in step with the record: an edit applies the difference (or
 * moves it when the link changes, or starts once a "when" condition becomes true) and a delete takes it back.
 */
function contributions(bp: Blueprint, records: DataRecord[], record: DataRecord, now: Date): Contribution[] {
  const entity = bp.entities.find((e) => e.id === record.entityId);
  if (!entity) return [];
  const out: Contribution[] = [];
  for (const rule of bp.rules) {
    if (rule.trigger.event !== "created" || rule.trigger.entityId !== record.entityId) continue;
    const ctx = recordContext(bp, entity, record.data, records, now);
    if (rule.when && !truthy(run(rule.when, ctx))) continue;
    for (const raw of rule.actions) {
      const action = completeAction(bp, rule, raw);
      if (action?.type !== "adjust_number" || action.target.kind !== "relation") continue;
      const targetId = record.data[action.target.fieldId];
      if (typeof targetId !== "string") continue;
      out.push({ targetId, fieldId: action.fieldId, amount: Number(run(action.delta, ctx)) || 0 });
    }
  }
  return out;
}

/** Applies the net change between what records added before and what they add now. */
function settle(rows: DataRecord[], before: Contribution[], after: Contribution[], now: Date): DataRecord[] {
  const net = new Map<string, { targetId: string; fieldId: string; amount: number }>();
  const add = (c: Contribution, sign: number) => {
    const key = `${c.targetId}\u0000${c.fieldId}`;
    const entry = net.get(key) ?? { targetId: c.targetId, fieldId: c.fieldId, amount: 0 };
    entry.amount += sign * c.amount;
    net.set(key, entry);
  };
  for (const c of before) add(c, -1);
  for (const c of after) add(c, 1);
  const changes = [...net.values()].filter((c) => Math.abs(c.amount) > 1e-9);
  if (!changes.length) return rows;
  return rows.map((row) => {
    const mine = changes.filter((c) => c.targetId === row.id);
    if (!mine.length) return row;
    const data = { ...row.data };
    for (const c of mine)
      data[c.fieldId] = Math.round(((Number(data[c.fieldId]) || 0) + c.amount) * 100) / 100;
    return { ...row, data, updatedAt: now.toISOString() };
  });
}

/** Removes records and takes back what their automations added to the records that remain. */
function withdraw(bp: Blueprint, records: DataRecord[], gone: ReadonlySet<string>, now: Date): DataRecord[] {
  const before = records.filter((r) => gone.has(r.id)).flatMap((r) => contributions(bp, records, r, now));
  return settle(
    records.filter((r) => !gone.has(r.id)),
    before,
    [],
    now,
  );
}

/* ---------- Mutations ---------- */

export function createRecord(
  ws: WorkspaceData,
  entityId: string,
  input: RecordData,
  now: Date = new Date(),
  /** Lets a plan reserve ids up front so its records can link to each other. */
  id?: string,
  options: { notYet?: ReadonlySet<string> } = {},
): MutationResult {
  const bp = ws.blueprint;
  const entity = getEntity(bp, entityId);
  const errors = validateRecord(bp, entity, input, ws.records, undefined, options.notYet);
  if (errors.length) return { ok: false, errors };

  const stamp = now.toISOString();
  const record: DataRecord = {
    id: id ?? newId(entity.id),
    entityId,
    data: { ...input },
    createdAt: stamp,
    updatedAt: stamp,
  };
  const ruled = runRules(bp, [...ws.records, record], record, "created", [], now);
  const records = computeAll(bp, ruled.records, now);
  const saved = records.find((r) => r.id === record.id) ?? record;
  return { ok: true, data: { ...ws, records }, record: saved, notices: ruled.notices };
}

export function updateRecord(
  ws: WorkspaceData,
  id: string,
  patch: RecordData,
  now: Date = new Date(),
): MutationResult {
  const bp = ws.blueprint;
  const existing = findRecord(ws.records, id);
  if (!existing) return { ok: false, errors: [{ message: "This record no longer exists" }] };
  const entity = getEntity(bp, existing.entityId);
  const data = { ...existing.data, ...patch };
  const errors = validateRecord(bp, entity, data, ws.records, id);
  if (errors.length) return { ok: false, errors };

  const changed = Object.keys(patch).filter(
    (k) => JSON.stringify(existing.data[k]) !== JSON.stringify(patch[k]),
  );
  const record: DataRecord = { ...existing, data, updatedAt: now.toISOString() };
  const replaced = ws.records.map((r) => (r.id === id ? record : r));
  const ruled = runRules(bp, replaced, record, "updated", changed, now);
  const synced = settle(
    ruled.records,
    contributions(bp, ws.records, existing, now),
    contributions(bp, ruled.records, ruled.records.find((r) => r.id === id) ?? record, now),
    now,
  );
  const records = computeAll(bp, synced, now);
  const saved = records.find((r) => r.id === id) ?? record;
  return { ok: true, data: { ...ws, records }, record: saved, notices: ruled.notices };
}

/** Deletes a record and any line items that belong to it. */
export function deleteRecord(ws: WorkspaceData, id: string, now: Date = new Date()): WorkspaceData {
  const childEntities = ws.blueprint.entities.filter((e) => e.parent);
  const gone = new Set(
    ws.records
      .filter((r) => {
        if (r.id === id) return true;
        const parent = childEntities.find((e) => e.id === r.entityId)?.parent;
        return !!parent && r.data[parent.fieldId] === id;
      })
      .map((r) => r.id),
  );
  return { ...ws, records: computeAll(ws.blueprint, withdraw(ws.blueprint, ws.records, gone, now), now) };
}

/**
 * Creates a parent record with its line items in one step (e.g. a POS order
 * and its order lines), then runs rules for each line.
 */
export function createWithLines(
  ws: WorkspaceData,
  parentEntityId: string,
  parentInput: RecordData,
  lineEntityId: string,
  lines: RecordData[],
  now: Date = new Date(),
): MutationResult {
  const parent = createRecord(ws, parentEntityId, parentInput, now);
  if (!parent.ok) return parent;
  const lineEntity = getEntity(ws.blueprint, lineEntityId);
  const parentFieldId = lineEntity.parent?.fieldId;
  if (!parentFieldId) return { ok: false, errors: [{ message: `${lineEntity.name} has no parent` }] };

  let data = parent.data;
  const notices = [...parent.notices];
  for (const line of lines) {
    const result = createRecord(data, lineEntityId, { ...line, [parentFieldId]: parent.record.id }, now);
    if (!result.ok) return result;
    data = result.data;
    notices.push(...result.notices);
  }
  const record = data.records.find((r) => r.id === parent.record.id) ?? parent.record;
  return { ok: true, data, record, notices };
}

/**
 * Applies a plan's record edits in order, each through the same validation, rules and formulas as
 * editing by hand. Returns what changed so the plan can be undone, and why any edit was skipped.
 */
export function applyRecordOps(ws: WorkspaceData, ops: RecordOp[], now: Date = new Date()) {
  let data = ws;
  const created: string[] = [];
  const replaced: DataRecord[] = [];
  const removed: DataRecord[] = [];
  const errors: string[] = [];
  // Records an op's automations changed (a product's stock) come back on undo too.
  const track = (prev: DataRecord[], next: DataRecord[]) => {
    const old = new Map(prev.map((r) => [r.id, r]));
    for (const r of next) {
      const was = old.get(r.id);
      if (
        was &&
        was !== r &&
        JSON.stringify(was.data) !== JSON.stringify(r.data) &&
        !created.includes(r.id) &&
        !replaced.some((x) => x.id === r.id)
      )
        replaced.push(was);
    }
  };
  for (const op of ops) {
    const prev = data.records;
    if (op.op === "create_record") {
      const result = createRecord(data, op.entityId, op.data, now, op.id);
      if (result.ok) {
        data = result.data;
        track(prev, data.records);
        created.push(result.record.id);
      } else errors.push(`New ${op.entityId}: ${result.errors.map((e) => e.message).join("; ")}`);
    } else if (op.op === "delete_record") {
      const target = findRecord(data.records, op.recordId);
      if (!target) {
        errors.push(`${op.recordId}: no such record`);
        continue;
      }
      // Its line items go with it (they can't exist without it), nested ones included.
      const gone = new Set([target.id]);
      for (let grew = true; grew; ) {
        grew = false;
        for (const r of data.records) {
          const parent = data.blueprint.entities.find((e) => e.id === r.entityId)?.parent;
          if (parent && !gone.has(r.id) && gone.has(String(r.data[parent.fieldId] ?? ""))) {
            gone.add(r.id);
            grew = true;
          }
        }
      }
      for (const r of data.records)
        if (gone.has(r.id) && !created.includes(r.id)) removed.push(replaced.find((x) => x.id === r.id) ?? r);
      data = {
        ...data,
        records: computeAll(data.blueprint, withdraw(data.blueprint, data.records, gone, now), now),
      };
      track(prev, data.records);
    } else {
      const result = updateRecord(data, op.recordId, op.patch, now);
      if (result.ok) {
        data = result.data;
        track(prev, data.records);
      } else errors.push(`${op.recordId}: ${result.errors.map((e) => e.message).join("; ")}`);
    }
  }
  // A record changed and then deleted in the same plan comes back from undo as it was at the start.
  const removedIds = new Set(removed.map((r) => r.id));
  return { data, created, replaced: replaced.filter((r) => !removedIds.has(r.id)), removed, errors };
}

/** Images are only ever our own uploads (or, in a preview that isn't saved, a picture held in the browser). */
export function isImagePath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    (/^\/api\/files\/[a-z0-9-]+\/[0-9a-f-]{36}\.(png|jpg|gif|webp)$/.test(value) ||
      value.startsWith("data:image/"))
  );
}

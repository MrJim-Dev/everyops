import type { Blueprint, DataRecord, Entity, Field, System, View, Widget } from "./types";

export function getEntity(bp: Blueprint, entityId: string): Entity {
  const entity = bp.entities.find((e) => e.id === entityId);
  if (!entity) throw new Error(`Unknown entity "${entityId}"`);
  return entity;
}

export function findEntity(bp: Blueprint, entityId: string) {
  return bp.entities.find((e) => e.id === entityId);
}

export function getField(entity: Entity, fieldId: string): Field {
  const field = entity.fields.find((f) => f.id === fieldId);
  if (!field) throw new Error(`Unknown field "${fieldId}" on ${entity.name}`);
  return field;
}

export function findField(entity: Entity, fieldId: string) {
  return entity.fields.find((f) => f.id === fieldId);
}

export function getView(bp: Blueprint, viewId: string): View | undefined {
  return bp.views.find((v) => v.id === viewId);
}

export function getWidget(bp: Blueprint, widgetId: string): Widget | undefined {
  return bp.widgets.find((w) => w.id === widgetId);
}

export function getSystem(bp: Blueprint, systemId: string): System | undefined {
  return bp.systems.find((s) => s.id === systemId);
}

export function recordsOf(records: DataRecord[], entityId: string) {
  return records.filter((r) => r.entityId === entityId);
}

export function findRecord(records: DataRecord[], id: string) {
  return records.find((r) => r.id === id);
}

/** The human label of a record: its primary field, falling back to the id. */
export function recordTitle(entity: Entity, record: DataRecord): string {
  const value = record.data[entity.primaryFieldId];
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number") return String(value);
  return "Untitled";
}

export function optionOf(field: Field, optionId: unknown) {
  return field.options?.find((o) => o.id === optionId);
}

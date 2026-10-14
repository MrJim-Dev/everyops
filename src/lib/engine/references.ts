import type { DataRecord, Entity, Field } from "@/lib/blueprint/types";

/**
 * Reference numbers ("Booking Reference", "Order no.", "Ref code") are the business's to issue. A visitor can't
 * know one, so public forms don't ask for them and the server numbers each submission instead.
 */
const REFERENCE =
  /\b(ref|reference|code|ref.?code|booking.?(no|number|id)|order.?(no|number)|ticket|receipt.?no|confirmation)\b/i;

export function isAutoReference(field: Field): boolean {
  return field.type === "text" && REFERENCE.test(`${field.id.replace(/_/g, " ")} ${field.name}`);
}

/** Required reference fields of a record type: what a public submission must fill in by itself. */
export function autoReferenceFields(entity: Entity): Field[] {
  return entity.fields.filter((f) => f.required && isAutoReference(f));
}

/** The next reference after the highest one in use, e.g. BK-1001, BK-1002 (prefix from the record type). */
export function nextReference(entity: Entity, field: Field, records: DataRecord[]): string {
  const prefix =
    entity.name
      .replace(/[^a-z]/gi, "")
      .slice(0, 2)
      .toUpperCase() || "RF";
  const used = records
    .filter((r) => r.entityId === entity.id)
    .map((r) => Number(String(r.data[field.id] ?? "").replace(/\D/g, "")) || 0);
  return `${prefix}-${Math.max(1000, ...used) + 1}`;
}

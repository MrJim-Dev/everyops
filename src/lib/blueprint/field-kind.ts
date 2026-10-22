import type { Blueprint, Entity, Field } from "./types";

/** How a field's value should look, resolving formulas and rollups to a base kind. */
export type DisplayKind =
  | "text"
  | "long_text"
  | "number"
  | "money"
  | "percent"
  | "rating"
  | "duration"
  | "date"
  | "datetime"
  | "time_range"
  | "choice"
  | "status"
  | "multi"
  | "person"
  | "relation"
  | "checkbox"
  | "image"
  | "email"
  | "phone"
  | "url"
  | "file";

export function displayKind(bp: Blueprint, field: Field): DisplayKind {
  switch (field.type) {
    case "select":
      return "choice";
    case "multi_select":
      return "multi";
    case "formula": {
      const t = field.formula?.resultType;
      if (t === "money" || t === "number" || t === "checkbox" || t === "date") return t;
      return "text";
    }
    case "rollup": {
      const spec = field.rollup;
      if (!spec || spec.op === "count" || !spec.fieldId) return "number";
      const child = bp.entities.find((e) => e.id === spec.childEntityId);
      const target = child?.fields.find((f) => f.id === spec.fieldId);
      if (!target) return "number";
      const kind = displayKind(bp, target);
      // Durations added up or averaged are still time (hours worked, the average session); an average rating
      // reads as a plain number (4.3).
      if (kind === "money" || kind === "duration") return kind;
      return "number";
    }
    default:
      // Who added or changed a record reads as their name.
      return field.type === "created_by" || field.type === "edited_by" ? "text" : field.type;
  }
}

export const isNumericKind = (kind: DisplayKind) =>
  kind === "money" || kind === "number" || kind === "percent" || kind === "rating" || kind === "duration";

/** Fields a person can type into (formulas, rollups, parent links and who-made-it stamps are computed). */
export function editableFields(entity: Entity): Field[] {
  return entity.fields.filter(
    (f) =>
      f.type !== "formula" &&
      f.type !== "rollup" &&
      f.type !== "created_by" &&
      f.type !== "edited_by" &&
      f.id !== entity.parent?.fieldId,
  );
}

export function statusField(entity: Entity): Field | undefined {
  return entity.fields.find((f) => f.type === "status");
}

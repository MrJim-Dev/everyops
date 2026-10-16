import type { Blueprint, Entity, Field } from "./types";

/** How a field's value should look, resolving formulas and rollups to a base kind. */
export type DisplayKind =
  | "text"
  | "long_text"
  | "number"
  | "money"
  | "percent"
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
      return target ? (displayKind(bp, target) === "money" ? "money" : "number") : "number";
    }
    default:
      return field.type;
  }
}

export const isNumericKind = (kind: DisplayKind) =>
  kind === "money" || kind === "number" || kind === "percent";

/** Fields a person can type into (formulas, rollups and parent links are computed). */
export function editableFields(entity: Entity): Field[] {
  return entity.fields.filter(
    (f) => f.type !== "formula" && f.type !== "rollup" && f.id !== entity.parent?.fieldId,
  );
}

export function statusField(entity: Entity): Field | undefined {
  return entity.fields.find((f) => f.type === "status");
}

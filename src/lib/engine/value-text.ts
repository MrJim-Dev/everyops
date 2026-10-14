import { displayKind } from "@/lib/blueprint/field-kind";
import { findEntity, findRecord, optionOf, recordTitle } from "@/lib/blueprint/lookup";
import type { Blueprint, DataRecord, Field, FieldValue } from "@/lib/blueprint/types";
import {
  formatDate,
  formatDateTime,
  formatMoney,
  formatNumber,
  formatPercent,
  formatRange,
  isTimeRange,
} from "@/lib/format";

/** A field's value as plain text, the way it reads on screen: for CSV exports and summaries. */
export function valueText(
  bp: Blueprint,
  records: DataRecord[],
  field: Field,
  value: FieldValue | undefined,
): string {
  if (value === undefined || value === null || value === "") return "";
  switch (displayKind(bp, field)) {
    case "money":
      return formatMoney(Number(value));
    case "number":
      return formatNumber(Number(value));
    case "percent":
      return formatPercent(Number(value));
    case "checkbox":
      return value ? "Yes" : "No";
    case "date":
      return typeof value === "string" ? formatDate(value, { withYear: true }) : "";
    case "datetime":
      return typeof value === "string" ? formatDateTime(value) : "";
    case "time_range":
      if (!isTimeRange(value)) return "";
      return field.range === "dates"
        ? formatRange(value)
        : `${formatDate(value.start)} ${formatRange(value)}`;
    case "status":
    case "choice":
      return optionOf(field, value)?.label ?? String(value);
    case "multi":
      return (Array.isArray(value) ? value : []).map((v) => optionOf(field, v)?.label ?? v).join(", ");
    case "relation": {
      const target = field.relation ? findEntity(bp, field.relation.entityId) : undefined;
      const linked = typeof value === "string" ? findRecord(records, value) : undefined;
      return target && linked ? recordTitle(target, linked) : "";
    }
    default:
      return String(value);
  }
}

/** Rows as CSV text: a header of field names, then one line per record. */
export function toCsv(bp: Blueprint, records: DataRecord[], fields: Field[], rows: DataRecord[]): string {
  const cell = (text: string) => (/[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text);
  const lines = [fields.map((f) => cell(f.name)).join(",")];
  for (const row of rows)
    lines.push(fields.map((f) => cell(valueText(bp, records, f, row.data[f.id]))).join(","));
  return lines.join("\n");
}

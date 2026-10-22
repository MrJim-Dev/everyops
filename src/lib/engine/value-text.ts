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
    case "signature":
      return "Signed";
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

/** A column of a spreadsheet export: its header and how Excel should show it. */
export type SheetColumn = {
  header: string;
  format: "text" | "number" | "money" | "percent" | "date" | "datetime";
};
export type SheetCell = string | number | boolean | null;

/**
 * Rows for an Excel export: numbers stay numbers (money in pesos), dates are dates (date-times as Manila wall time),
 * yes/no stays true/false, and everything else reads as it does on screen. Excel can then sort, sum and filter them.
 */
export function toSheet(
  bp: Blueprint,
  records: DataRecord[],
  fields: Field[],
  rows: DataRecord[],
): { columns: SheetColumn[]; rows: SheetCell[][] } {
  const formats = fields.map((f): SheetColumn["format"] => {
    const kind = displayKind(bp, f);
    if (kind === "money" || kind === "number" || kind === "percent") return kind;
    if (kind === "date" || kind === "datetime") return kind;
    return "text";
  });
  const manila = (iso: string) => new Date(Date.parse(iso) + 8 * 3_600_000).toISOString().slice(0, 16);
  return {
    columns: fields.map((f, i) => ({ header: f.name, format: formats[i] })),
    rows: rows.map((row) =>
      fields.map((f, i) => {
        const value = row.data[f.id];
        if (value === undefined || value === null || value === "") return null;
        const format = formats[i];
        if (format === "money" || format === "number" || format === "percent") {
          const n = Number(value);
          return Number.isFinite(n) ? n : null;
        }
        if (format === "date" && typeof value === "string") return value.slice(0, 10);
        if (format === "datetime" && typeof value === "string") return manila(value);
        if (displayKind(bp, f) === "checkbox") return !!value;
        return valueText(bp, records, f, value);
      }),
    ),
  };
}

import type { Blueprint, DataRecord, Field } from "@/lib/blueprint/types";

/**
 * The assistant's view of the data: a digest per record type (count, sum/avg/min/max of number fields, option
 * tallies, date ranges) plus the records on screen and small record types in full, instead of every record. Exact
 * lookups beyond it go through the tools in record-tools.ts.
 */
export type Kind =
  | "number"
  | "date"
  | "datetime"
  | "range"
  | "option"
  | "options"
  | "relation"
  | "checkbox"
  | "text";

export function kindOf(f: Field): Kind {
  switch (f.type) {
    case "number":
    case "money":
    case "percent":
    case "rating":
    case "duration":
    case "rollup":
      return "number";
    case "formula": {
      const t = f.formula?.resultType;
      return t === "number" || t === "money"
        ? "number"
        : t === "checkbox"
          ? "checkbox"
          : t === "date"
            ? "date"
            : "text";
    }
    case "date":
      return "date";
    case "datetime":
      return "datetime";
    case "time_range":
      return "range";
    case "select":
    case "status":
      return "option";
    case "multi_select":
      return "options";
    case "relation":
    case "person":
      return f.relation ? "relation" : "text";
    case "checkbox":
      return "checkbox";
    default:
      return "text";
  }
}

export const MANILA = "Asia/Manila";
const dayOf = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: MANILA });
const num = (n: number) =>
  Number.isInteger(n) ? n.toLocaleString("en-US") : n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const compact = (r: DataRecord) => JSON.stringify({ id: r.id, ...r.data });

const MAX_DIGEST_CHARS = 24_000;
const SMALL_TYPE = 25;
const MAX_FOCUS = 30;

/** Counts and totals per record type, plus the records that matter right now. */
export function dataDigest(
  bp: Blueprint,
  records: DataRecord[],
  focus: { ids: string[]; entityId?: string },
): string {
  const byEntity = new Map<string, DataRecord[]>();
  for (const r of records) byEntity.set(r.entityId, [...(byEntity.get(r.entityId) ?? []), r]);
  const focusSet = new Set(focus.ids.slice(0, MAX_FOCUS));
  const lines: string[] = [];
  const listed: string[] = [];
  for (const e of bp.entities) {
    const own = byEntity.get(e.id) ?? [];
    lines.push(`## ${e.pluralName} (${e.id}): ${own.length} records`);
    for (const f of e.fields) {
      const kind = kindOf(f);
      const values = own.map((r) => r.data[f.id]).filter((v) => v !== undefined && v !== null && v !== "");
      if (!values.length) continue;
      if (kind === "number") {
        const ns = values.filter((v): v is number => typeof v === "number");
        if (!ns.length) continue;
        const sum = ns.reduce((a, b) => a + b, 0);
        lines.push(
          `- ${f.id} (${f.type}): sum ${num(sum)}, avg ${num(sum / ns.length)}, min ${num(Math.min(...ns))}, max ${num(Math.max(...ns))}`,
        );
      } else if (kind === "option" && (f.options?.length ?? 0) <= 15) {
        const tally = new Map<string, number>();
        for (const v of values) tally.set(String(v), (tally.get(String(v)) ?? 0) + 1);
        lines.push(`- ${f.id} (${f.type}): ${[...tally].map(([k, n]) => `${k} ${n}`).join(", ")}`);
      } else if (kind === "checkbox") {
        const yes = values.filter((v) => v === true).length;
        lines.push(`- ${f.id}: true ${yes}, false ${own.length - yes}`);
      } else if (kind === "datetime" || kind === "range" || kind === "date") {
        const days = values
          .map((v) => (kind === "range" ? (v as { start?: string }).start : String(v)))
          .filter((v): v is string => typeof v === "string" && /^\d{4}-/.test(v))
          .map((v) => (kind === "date" ? v.slice(0, 10) : dayOf(v)))
          .sort();
        if (days.length) lines.push(`- ${f.id} (${f.type}): ${days[0]} to ${days.at(-1)} (Manila dates)`);
      }
    }
    // Small record types (products, courts, staff) are listed whole: they're named in most questions.
    const shown = own.length <= SMALL_TYPE ? own : own.filter((r) => focusSet.has(r.id));
    const latest = own.length > SMALL_TYPE ? own.slice(-3).filter((r) => !focusSet.has(r.id)) : [];
    if (shown.length)
      listed.push(`### ${e.pluralName}${own.length > SMALL_TYPE ? " on screen" : ""}`, ...shown.map(compact));
    if (latest.length) listed.push(`### Latest ${e.pluralName}`, ...latest.map(compact));
  }
  let text = [...lines, "", ...listed].join("\n");
  if (text.length > MAX_DIGEST_CHARS)
    text = `${text.slice(0, MAX_DIGEST_CHARS)}\n(cut off; use the tools for the rest)`;
  return text;
}

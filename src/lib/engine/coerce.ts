import { isEmail, isPhone, normalizeUrl } from "@/lib/blueprint/contact";
import { recordTitle } from "@/lib/blueprint/lookup";
import type { Blueprint, DataRecord, Entity, Field, FieldValue, RecordData } from "@/lib/blueprint/types";
import { parseDuration, parseRating, RATING_MAX } from "@/lib/format";

/**
 * Values an agent or script sends (JSON) as a record's stored values: fields named by id or by name, choices by id or
 * label, links by record id or the linked record's name, dates as YYYY-MM-DD and times in Manila unless they say
 * otherwise. Every value that doesn't fit is reported by field, so the caller can fix it in one go.
 */

const fieldFor = (entity: Entity, key: string) => {
  const k = key.trim().toLowerCase();
  return entity.fields.find((f) => f.id === key) ?? entity.fields.find((f) => f.name.toLowerCase() === k);
};

const MANILA_ISO = (text: string): string | null => {
  const t = text.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return new Date(`${t}T00:00:00+08:00`).toISOString();
  if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(t)) return null;
  const withZone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(t) ? t : `${t.replace(" ", "T")}+08:00`;
  const ms = Date.parse(withZone);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
};

function one(
  bp: Blueprint,
  records: DataRecord[],
  field: Field,
  value: unknown,
): { value: FieldValue } | { error: string } {
  if (value === null || value === undefined || value === "") return { value: null };
  const text = typeof value === "string" ? value.trim() : String(value);
  switch (field.type) {
    case "formula":
    case "rollup":
      return { error: "is worked out by EveryOps and can't be set" };
    case "created_by":
    case "edited_by":
      return { error: "is filled in by EveryOps from whoever adds or changes the record, and can't be set" };
    case "image":
    case "file":
      return { error: "takes an upload, which isn't available here" };
    case "number":
    case "money":
    case "percent": {
      const n = typeof value === "number" ? value : Number(text.replace(/[₱,\s%]/g, ""));
      return Number.isFinite(n) ? { value: n } : { error: `needs a number, not "${text}"` };
    }
    case "checkbox":
      if (typeof value === "boolean") return { value };
      if (/^(true|yes|1)$/i.test(text)) return { value: true };
      if (/^(false|no|0)$/i.test(text)) return { value: false };
      return { error: "needs true or false" };
    case "rating": {
      const n = typeof value === "number" && Number.isInteger(value) ? value : parseRating(text);
      return n !== null && n >= 1 && n <= RATING_MAX
        ? { value: n }
        : { error: `needs 1 to ${RATING_MAX} stars, not "${text}"` };
    }
    case "duration": {
      const n = typeof value === "number" ? value : parseDuration(text);
      return n !== null && n >= 0
        ? { value: n }
        : { error: `needs a length of time like 1:30, 90 or 1h 30m, not "${text}"` };
    }
    case "select":
    case "status": {
      const o = field.options?.find((x) => x.id === text || x.label.toLowerCase() === text.toLowerCase());
      return o
        ? { value: o.id }
        : { error: `needs one of: ${(field.options ?? []).map((x) => x.label).join(", ")}` };
    }
    case "multi_select": {
      const parts = Array.isArray(value) ? value.map(String) : text.split(/\s*,\s*/);
      const ids: string[] = [];
      for (const p of parts.filter(Boolean)) {
        const o = field.options?.find((x) => x.id === p || x.label.toLowerCase() === p.toLowerCase());
        if (!o)
          return { error: `"${p}" isn't one of: ${(field.options ?? []).map((x) => x.label).join(", ")}` };
        ids.push(o.id);
      }
      return { value: ids };
    }
    case "relation": {
      const target = bp.entities.find((e) => e.id === field.relation?.entityId);
      if (!target) return { error: "links to a record type that no longer exists" };
      const mine = records.filter((r) => r.entityId === target.id);
      const hit =
        mine.find((r) => r.id === text) ??
        mine.find((r) => recordTitle(target, r).trim().toLowerCase() === text.toLowerCase());
      return hit
        ? { value: hit.id }
        : {
            error: `needs a ${target.name.toLowerCase()} id or name; no ${target.name.toLowerCase()} "${text}"`,
          };
    }
    case "date": {
      const m = /^(\d{4}-\d{2}-\d{2})/.exec(text);
      return m ? { value: m[1] } : { error: "needs a date as YYYY-MM-DD" };
    }
    case "datetime": {
      const iso = MANILA_ISO(text);
      return iso ? { value: iso } : { error: "needs a date and time as YYYY-MM-DDTHH:MM (Manila)" };
    }
    case "time_range": {
      const v = value as { start?: unknown; end?: unknown };
      if (!v || typeof v !== "object" || typeof v.start !== "string" || typeof v.end !== "string")
        return { error: 'needs { "start": …, "end": … }' };
      if (field.range === "dates") {
        const s = /^(\d{4}-\d{2}-\d{2})/.exec(v.start)?.[1];
        const e = /^(\d{4}-\d{2}-\d{2})/.exec(v.end)?.[1];
        return s && e
          ? { value: { start: s, end: e } }
          : { error: "needs start and end dates as YYYY-MM-DD" };
      }
      const s = MANILA_ISO(v.start);
      const e = MANILA_ISO(v.end);
      return s && e
        ? { value: { start: s, end: e } }
        : { error: "needs start and end as YYYY-MM-DDTHH:MM (Manila)" };
    }
    case "email":
      return isEmail(text) ? { value: text } : { error: "needs an email address" };
    case "phone":
      return isPhone(text) ? { value: text } : { error: "needs a phone number" };
    case "url": {
      const u = normalizeUrl(text);
      return u ? { value: u } : { error: "needs a web address" };
    }
    default:
      return { value: typeof value === "string" ? value : JSON.stringify(value) };
  }
}

export function coerceValues(
  bp: Blueprint,
  records: DataRecord[],
  entity: Entity,
  values: Record<string, unknown>,
): { data: RecordData; errors: string[] } {
  const data: RecordData = {};
  const errors: string[] = [];
  for (const [key, value] of Object.entries(values ?? {})) {
    const field = fieldFor(entity, key);
    if (!field) {
      errors.push(
        `${entity.name} has no field "${key}". Fields: ${entity.fields.map((f) => f.id).join(", ")}`,
      );
      continue;
    }
    const result = one(bp, records, field, value);
    if ("error" in result) errors.push(`${field.name} (${field.id}) ${result.error}`);
    else data[field.id] = result.value;
  }
  return { data, errors };
}

import { isEmail, isPhone, normalizeUrl } from "@/lib/blueprint/contact";
import { recordTitle } from "@/lib/blueprint/lookup";
import type {
  Blueprint,
  DataRecord,
  Entity,
  Field,
  FieldOption,
  FieldValue,
  IconName,
  RecordData,
  System,
  View,
  WorkspaceData,
} from "@/lib/blueprint/types";
import { parseDuration, parseRating } from "@/lib/format";
import { at, dateKey, fromLocal, hhmm } from "@/lib/time";
import type { ChangeOp, ChangePlan, RecordOp } from "./changes";
import { newId } from "./ids";
import { validateRecord } from "./records";

/**
 * Bringing a spreadsheet into a record type: read the rows, match columns to fields, turn each cell into the field's
 * value, and build one change plan (options to add, linked records to create, then the rows) that applies as a single
 * History entry the owner can undo. Pure functions, used by the import dialog and its tests.
 */

/** Rows read from a CSV file, an Excel sheet or a Google Sheet: a header row, then text cells. */
export type Table = { headers: string[]; rows: string[][] };

/** Most rows one import takes: the whole save has to fit in one request. */
export const MAX_IMPORT_ROWS = 5000;

/** Fields an import can write: not computed ones, nor uploads (an import has no files). */
export const importable = (f: Field) =>
  !["formula", "rollup", "image", "file", "created_by", "edited_by"].includes(f.type);

/* ---------- Reading CSV ---------- */

/**
 * CSV text as a table (RFC 4180: quoted cells, doubled quotes, line breaks inside quotes). The separator is the one
 * the header line uses most: comma, semicolon (Excel in many locales) or tab. Blank lines are skipped, and a byte
 * order mark at the start is dropped.
 */
export function parseCsv(text: string): Table {
  const src = text.replace(/^\uFEFF/, "");
  const firstLine = src.slice(0, src.search(/\r?\n/) === -1 ? src.length : src.search(/\r?\n/));
  const count = (ch: string) => firstLine.split(ch).length - 1;
  const sep = [",", ";", "\t"].reduce((a, b) => (count(b) > count(a) ? b : a));
  const lines: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell === "") quoted = true;
    else if (ch === sep) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      lines.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    lines.push(row);
  }
  return tableOf(lines);
}

/** Lines as a table: the first non-empty line is the header; empty lines and trailing empty columns go. */
export function tableOf(lines: string[][]): Table {
  const kept = lines.map((l) => l.map((c) => c.trim())).filter((l) => l.some((c) => c !== ""));
  const [head = [], ...rest] = kept;
  let width = head.length;
  while (width > 0 && !head[width - 1] && !rest.some((r) => r[width - 1])) width--;
  const headers = head.slice(0, width).map((h, i) => h || `Column ${i + 1}`);
  return { headers, rows: rest.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? "")) };
}

/* ---------- Matching columns to fields ---------- */

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\b(no|num|nbr)\b/g, "number")
    .replace(/(ies)$/, "y")
    .replace(/([^s])s$/, "$1");

/** Words that name the same thing in spreadsheets (left) as in field names (right). */
const SYNONYMS: [RegExp, RegExp][] = [
  [/\b(mobile|cell|contact number|tel|telephone|phone number)\b/, /phone|mobile|contact/],
  [/\b(e ?mail|email address)\b/, /email/],
  [/\b(full name|customer name|client name|guest name|name)\b/, /name/],
  [/\b(item|product|description|particulars)\b/, /^(name|item|product)/],
  [/\b(price|amount|cost|rate|fee|total)\b/, /price|amount|cost|rate|fee|total/],
  [/\b(qty|quantity|count|stock|on hand)\b/, /qty|quantity|stock|count/],
  [/\b(website|url|link|site)\b/, /website|url|link/],
  [/\b(remarks|comment|comments|memo)\b/, /note/],
  [/\b(type|kind|category|group)\b/, /type|category|kind/],
  [/\b(state|stage)\b/, /status/],
  [/\b(dob|birthday|birth date)\b/, /birth/],
];

/**
 * Which field each column fills, by index (null: skip the column). A column takes the field whose name or id is the
 * same once case, punctuation and plurals are ignored; else one whose name contains the header (or the header the
 * name); else a field a known synonym points at. Each field takes one column at most, the best match first.
 */
export function suggestMapping(entity: Entity, headers: string[]): (string | null)[] {
  const fields = entity.fields.filter(importable);
  const taken = new Set<string>();
  const out: (string | null)[] = headers.map(() => null);
  const pass = (test: (h: string, f: Field) => boolean) => {
    headers.forEach((header, i) => {
      if (out[i]) return;
      const h = norm(header);
      if (!h) return;
      const field = fields.find((f) => !taken.has(f.id) && test(h, f));
      if (field) {
        out[i] = field.id;
        taken.add(field.id);
      }
    });
  };
  pass((h, f) => h === norm(f.name) || h === norm(f.id.replace(/_/g, " ")));
  pass((h, f) => {
    const n = norm(f.name);
    return h.length >= 3 && n.length >= 3 && (n.includes(h) || h.includes(n));
  });
  pass((h, f) => SYNONYMS.some(([col, field]) => col.test(h) && field.test(norm(f.name))));
  // A lone "Name" or "Title" column is the record's name when nothing above placed it.
  pass((h, f) => f.id === entity.primaryFieldId && /\b(name|title)\b/.test(h));
  return out;
}

/* ---------- Turning cells into values ---------- */

export type CellProblem =
  | { kind: "format"; message: string }
  | { kind: "option"; label: string }
  | { kind: "link"; title: string; entityId: string };

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const pad = (n: number) => String(n).padStart(2, "0");

/**
 * A date in the ways spreadsheets write them: 2026-10-16, 10/16/2026 (month first, as the Philippines writes it, unless
 * the first number can't be a month), 16-Oct-2026, Oct 16, 2026, and Excel day numbers (45946). Returns YYYY-MM-DD.
 */
export function parseDate(text: string): string | null {
  const t = text.trim();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(t);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/.exec(t);
  if (m) {
    const year = +m[3] < 100 ? 2000 + +m[3] : +m[3];
    return +m[1] > 12 ? valid(year, +m[2], +m[1]) : valid(year, +m[1], +m[2]);
  }
  m = /^(\d{1,2})[\s-]+([a-z]{3})[a-z]*\.?[\s,-]+(\d{4})/i.exec(t);
  if (m) return valid(+m[3], MONTHS.indexOf(m[2].toLowerCase()) + 1, +m[1]);
  m = /^([a-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/i.exec(t);
  if (m) return valid(+m[3], MONTHS.indexOf(m[1].toLowerCase()) + 1, +m[2]);
  if (/^\d{5}(\.\d+)?$/.test(t)) {
    const serial = Math.floor(Number(t));
    if (serial > 20000 && serial < 80000) {
      const d = new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000);
      return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    }
  }
  return null;
}

function valid(y: number, mo: number, d: number): string | null {
  if (mo < 1 || mo > 12 || d < 1 || y < 1900 || y > 2200) return null;
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCMonth() !== mo - 1) return null;
  return `${y}-${pad(mo)}-${pad(d)}`;
}

/** A time of day ("6 PM", "18:30", "6:30pm") as minutes after midnight. */
function parseTime(text: string): number | null {
  const m = /^(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*(am|pm|a\.m\.|p\.m\.)?$/i.exec(text.trim());
  if (!m) return null;
  let h = +m[1];
  const suffix = m[3]?.toLowerCase().replace(/\./g, "");
  if (suffix === "pm" && h < 12) h += 12;
  if (suffix === "am" && h === 12) h = 0;
  if (h > 23 || +(m[2] ?? 0) > 59) return null;
  return h * 60 + +(m[2] ?? 0);
}

/** A date and time on the workspace's clock, as an ISO instant. A date without a time is midnight. */
export function parseDateTime(text: string): string | null {
  const t = text.trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(t)) {
    if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(t)) return fromLocal(t);
    const ms = Date.parse(t);
    return Number.isNaN(ms) ? null : new Date(ms).toISOString();
  }
  const date = parseDate(t);
  if (!date) return null;
  const rest = t.replace(/^\S+(\s+\S+,?\s+\d{4})?/, "").replace(/^[\sT,]+/, "");
  const time = rest ? parseTime(rest) : 0;
  if (time === null) return null;
  return at(date, hhmm(time));
}

/** "₱1,250.50", "1 250", "(300)", "12%": the number in it, or null. */
export function parseNumber(text: string): number | null {
  let t = text
    .trim()
    .replace(/^(php|₱|p)\s*/i, "")
    .replace(/[₱,\s%]/g, "");
  const negative = /^\(.*\)$/.test(t);
  t = t.replace(/[()]/g, "");
  if (!/^-?\d*\.?\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? (negative ? -n : n) : null;
}

const YES = /^(yes|y|true|1|✓|✔|x|checked|active|paid|done)$/i;
const NO = /^(no|n|false|0|unchecked|inactive|)$/i;

/** What an import knows while converting cells: other records to link to, by title, per record type. */
export type ImportContext = {
  bp: Blueprint;
  /** Lower-cased title → record id, per record type. Filled in as linked records are planned. */
  titles: Map<string, Map<string, string>>;
};

export function contextOf(ws: WorkspaceData): ImportContext {
  const titles = new Map<string, Map<string, string>>();
  for (const e of ws.blueprint.entities) titles.set(e.id, new Map());
  for (const r of ws.records) {
    const e = ws.blueprint.entities.find((x) => x.id === r.entityId);
    if (e) titles.get(e.id)?.set(recordTitle(e, r).trim().toLowerCase(), r.id);
  }
  return { bp: ws.blueprint, titles };
}

const optionFor = (field: Field, text: string): FieldOption | undefined => {
  const t = text.trim().toLowerCase();
  return field.options?.find(
    (o) => o.label.toLowerCase() === t || o.id === t || o.id === norm(t).replace(/ /g, "_"),
  );
};

/** A cell as the field's value: { value } when it fits, { problem } when it doesn't. Empty cells are null. */
export function convertCell(
  ctx: ImportContext,
  field: Field,
  text: string,
): { value: FieldValue } | { problem: CellProblem } {
  const t = text.trim();
  if (t === "") return { value: null };
  const bad = (message: string) => ({ problem: { kind: "format" as const, message } });
  switch (field.type) {
    case "number":
    case "money":
    case "percent": {
      const n = parseNumber(t);
      if (n === null) return bad(`"${t}" isn't a number`);
      // "12%" in a percent field is 12; a spreadsheet's 0.12 stays 0.12 (the field shows it as 0.12%).
      return { value: n };
    }
    case "rating": {
      const n = parseRating(t);
      return n === null ? bad(`"${t}" isn't 1 to 5 stars`) : { value: n };
    }
    case "duration": {
      const n = parseDuration(t);
      return n === null ? bad(`"${t}" isn't a length of time like 1:30`) : { value: n };
    }
    case "checkbox":
      if (YES.test(t)) return { value: true };
      if (NO.test(t)) return { value: false };
      return bad(`"${t}" isn't yes or no`);
    case "date": {
      const d = parseDate(t);
      return d ? { value: d } : bad(`"${t}" isn't a date`);
    }
    case "datetime": {
      const d = parseDateTime(t);
      return d ? { value: d } : bad(`"${t}" isn't a date and time`);
    }
    case "time_range": {
      const [a, b] = t.split(/\s+(?:to|–|—|-)\s+|\//).map((s) => s.trim());
      if (!a || !b) return bad(`"${t}" needs a start and an end`);
      if (field.range === "dates") {
        const start = parseDate(a);
        const end = parseDate(b);
        return start && end ? { value: { start, end } } : bad(`"${t}" isn't two dates`);
      }
      const start = parseDateTime(a);
      // "Oct 16, 2026 6 PM - 8 PM": the end may be only a time on the same day.
      const endTime = parseTime(b);
      const end = endTime !== null && start ? at(dateKey(start), hhmm(endTime)) : parseDateTime(b);
      return start && end ? { value: { start, end } } : bad(`"${t}" isn't a start and end time`);
    }
    case "select":
    case "status": {
      const option = optionFor(field, t);
      return option ? { value: option.id } : { problem: { kind: "option", label: t } };
    }
    case "multi_select": {
      const parts = t.split(/\s*[,;|]\s*/).filter(Boolean);
      const ids: string[] = [];
      for (const p of parts) {
        const option = optionFor(field, p);
        if (!option) return { problem: { kind: "option", label: p } };
        ids.push(option.id);
      }
      return { value: ids };
    }
    case "relation": {
      const target = field.relation?.entityId ?? "";
      const id = ctx.titles.get(target)?.get(t.toLowerCase());
      return id ? { value: id } : { problem: { kind: "link", title: t, entityId: target } };
    }
    case "email":
      return isEmail(t) ? { value: t } : bad(`"${t}" isn't an email address`);
    case "phone":
      return isPhone(t) ? { value: t } : bad(`"${t}" isn't a phone number`);
    case "url": {
      const url = normalizeUrl(t);
      return url ? { value: url } : bad(`"${t}" isn't a web address`);
    }
    default:
      return { value: t };
  }
}

/* ---------- Building the import ---------- */

export type ImportOptions = {
  /** Which field each column fills, by column index. */
  mapping: (string | null)[];
  /** Match rows to existing records by this field (often the name or a code); null adds every row. */
  matchFieldId: string | null;
  /** What a row that matches an existing record does. */
  onMatch: "update" | "skip";
  /** Add choices the sheet uses that the field doesn't have yet (owners and admins). */
  addOptions: boolean;
  /** Create linked records the sheet names that don't exist yet (a new category), by their name. */
  createLinked: boolean;
  /**
   * A value for every row, by field id, typed the way a cell would be ("0", "Snacks"): for fields the sheet doesn't
   * have, such as a required cost, so the rows can still come in. A mapped column's cell wins when it isn't empty.
   */
  defaults?: Record<string, string>;
};

export type RowResult = {
  /** Row number as the owner sees it in the sheet (the header is row 1). */
  row: number;
  action: "create" | "update" | "skip" | "error";
  problems: string[];
  data: RecordData;
};

export type ImportPreview = {
  plan: ChangePlan;
  rows: RowResult[];
  counts: { create: number; update: number; skip: number; error: number };
  /** Choices the sheet uses that a field doesn't have, by field id. */
  newOptions: Record<string, string[]>;
  /** Linked records the sheet names that don't exist, by record type id. */
  missingLinks: Record<string, string[]>;
};

const TONES = ["neutral", "accent", "success", "warning", "danger"] as const;
const optionId = (label: string, taken: Set<string>) => {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "option";
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}_${n}`;
  taken.add(id);
  return id;
};

/**
 * Everything an import will do, row by row, and the plan that does it. Rows are checked against the record type the
 * way a save checks them (required fields, a valid choice, a free booking slot), against the records already there
 * and the ones before them in the sheet. Nothing is applied here.
 */
export function previewImport(
  ws: WorkspaceData,
  entityId: string,
  table: Table,
  options: ImportOptions,
  now: Date = new Date(),
): ImportPreview {
  const bp = ws.blueprint;
  const entity = bp.entities.find((e) => e.id === entityId);
  if (!entity) throw new Error(`No record type ${entityId}`);
  const ctx = contextOf(ws);
  const fieldOf = (id: string | null) => (id ? entity.fields.find((f) => f.id === id) : undefined);
  const columns = options.mapping.map((id, i) => ({ i, field: fieldOf(id) })).filter((c) => c.field) as {
    i: number;
    field: Field;
  }[];

  // First pass: what the sheet names that the workspace doesn't have yet.
  const newOptions: Record<string, string[]> = {};
  const missingLinks: Record<string, string[]> = {};
  const seen = new Set<string>();
  for (const row of table.rows.slice(0, MAX_IMPORT_ROWS))
    for (const { i, field } of columns) {
      const result = convertCell(ctx, field, row[i] ?? "");
      if (!("problem" in result)) continue;
      const p = result.problem;
      if (p.kind === "option") {
        const key = `o${field.id}\u0000${p.label.toLowerCase()}`;
        if (!seen.has(key)) {
          newOptions[field.id] ??= [];
          newOptions[field.id].push(p.label);
        }
        seen.add(key);
      } else if (p.kind === "link") {
        const key = `l${p.entityId}\u0000${p.title.toLowerCase()}`;
        if (!seen.has(key)) {
          missingLinks[p.entityId] ??= [];
          missingLinks[p.entityId].push(p.title);
        }
        seen.add(key);
      }
    }

  // The design changes the owner chose: new choices on fields, new linked records by name.
  const ops: ChangeOp[] = [];
  const recordOps: RecordOp[] = [];
  let working = bp;
  if (options.addOptions)
    for (const [fieldId, labels] of Object.entries(newOptions)) {
      const field = entity.fields.find((f) => f.id === fieldId);
      if (!field) continue;
      const taken = new Set((field.options ?? []).map((o) => o.id));
      const added = labels.map((label, n) => ({
        id: optionId(label, taken),
        label,
        tone: TONES[((field.options?.length ?? 0) + n) % TONES.length],
      }));
      const merged = [...(field.options ?? []), ...added];
      ops.push({ op: "update_field", entityId, fieldId, patch: { options: merged } });
      working = {
        ...working,
        entities: working.entities.map((e) =>
          e.id === entityId
            ? { ...e, fields: e.fields.map((f) => (f.id === fieldId ? { ...f, options: merged } : f)) }
            : e,
        ),
      };
    }
  const linkedCreated: DataRecord[] = [];
  if (options.createLinked)
    for (const [targetId, titles] of Object.entries(missingLinks)) {
      const target = bp.entities.find((e) => e.id === targetId);
      const primary = target?.fields.find((f) => f.id === target.primaryFieldId);
      // Only record types named by plain text, and that a name alone can make (no other required fields).
      if (!target || primary?.type !== "text" || target.parent) continue;
      const others = target.fields.filter((f) => f.required && f.id !== primary.id && importable(f));
      if (others.length) continue;
      for (const title of titles) {
        const id = newId(target.id);
        recordOps.push({ op: "create_record", id, entityId: target.id, data: { [primary.id]: title } });
        ctx.titles.get(target.id)?.set(title.toLowerCase(), id);
        const stamp = now.toISOString();
        linkedCreated.push({
          id,
          entityId: target.id,
          data: { [primary.id]: title },
          createdAt: stamp,
          updatedAt: stamp,
        });
      }
    }
  const liveEntity = working.entities.find((e) => e.id === entityId) ?? entity;
  ctx.bp = working;

  // Existing records by the match field's value, to update or skip.
  const matchField = fieldOf(options.matchFieldId);
  const keyOf = (v: FieldValue | undefined) =>
    v === undefined || v === null || v === "" ? "" : JSON.stringify(v).toLowerCase();
  const existing = new Map<string, DataRecord>();
  if (matchField)
    for (const r of ws.records)
      if (r.entityId === entityId) {
        const k = keyOf(r.data[matchField.id]);
        if (k && !existing.has(k)) existing.set(k, r);
      }

  const rows: RowResult[] = [];
  let records = [...ws.records, ...linkedCreated];
  const defaults = Object.entries(options.defaults ?? {})
    .map(([id, text]) => ({ field: liveEntity.fields.find((f) => f.id === id), text }))
    .filter(
      (d): d is { field: Field; text: string } => !!d.field && importable(d.field) && d.text.trim() !== "",
    );
  for (const [index, row] of table.rows.slice(0, MAX_IMPORT_ROWS).entries()) {
    const data: RecordData = {};
    const problems: string[] = [];
    /** Fields this row got from a value for every row, not from its own cells. */
    const filled = new Set<string>();
    for (const { field, text } of defaults) {
      const result = convertCell(ctx, field, text);
      if ("value" in result && result.value !== null) {
        data[field.id] = result.value;
        filled.add(field.id);
      } else if ("problem" in result && index === 0)
        problems.push(`${field.name}: "${text}" doesn't fit this field`);
    }
    for (const { i, field } of columns) {
      const live = liveEntity.fields.find((f) => f.id === field.id) ?? field;
      const result = convertCell(ctx, live, row[i] ?? "");
      if ("value" in result) {
        if (result.value !== null) {
          data[field.id] = result.value;
          filled.delete(field.id);
        }
        continue;
      }
      const p = result.problem;
      problems.push(
        p.kind === "format"
          ? `${field.name}: ${p.message}`
          : p.kind === "option"
            ? `${field.name}: "${p.label}" isn't one of its choices`
            : `${field.name}: no ${bp.entities.find((e) => e.id === p.entityId)?.name.toLowerCase() ?? "record"} named "${p.title}"`,
      );
    }
    const match = matchField ? existing.get(keyOf(data[matchField.id])) : undefined;
    // A value for every row fills gaps: an existing record keeps what it already has there.
    if (match)
      for (const id of filled) {
        const had = match.data[id];
        if (had !== undefined && had !== null && had !== "") delete data[id];
      }
    if (match && options.onMatch === "skip") {
      rows.push({ row: index + 2, action: "skip", problems: [], data });
      continue;
    }
    if (!problems.length) {
      const merged = match ? { ...match.data, ...data } : data;
      const errors = validateRecord(working, liveEntity, merged, records, match?.id);
      problems.push(...errors.map((e) => e.message));
    }
    if (problems.length) {
      rows.push({ row: index + 2, action: "error", problems, data });
      continue;
    }
    if (match) {
      recordOps.push({ op: "update_record", recordId: match.id, patch: data });
      records = records.map((r) => (r.id === match.id ? { ...r, data: { ...r.data, ...data } } : r));
      rows.push({ row: index + 2, action: "update", problems: [], data });
    } else {
      const id = newId(entityId);
      recordOps.push({ op: "create_record", id, entityId, data });
      const stamp = now.toISOString();
      const created = { id, entityId, data, createdAt: stamp, updatedAt: stamp };
      records.push(created);
      if (matchField) {
        const k = keyOf(data[matchField.id]);
        if (k && !existing.has(k)) existing.set(k, created);
      }
      rows.push({ row: index + 2, action: "create", problems: [], data });
    }
  }

  const counts = { create: 0, update: 0, skip: 0, error: 0 };
  for (const r of rows) counts[r.action]++;
  const plural = entity.pluralName.toLowerCase();
  const steps: ChangePlan["steps"] = [];
  if (counts.create)
    steps.push({ kind: "add", label: entity.pluralName, detail: `${counts.create} new from the sheet` });
  if (counts.update)
    steps.push({ kind: "change", label: entity.pluralName, detail: `${counts.update} updated` });
  for (const op of ops)
    if (op.op === "update_field") {
      const f = entity.fields.find((x) => x.id === op.fieldId);
      steps.push({
        kind: "change",
        label: `${f?.name ?? op.fieldId} choices`,
        detail: (newOptions[op.fieldId] ?? []).join(", "),
      });
    }
  const linkedBy = new Map<string, number>();
  for (const r of linkedCreated) linkedBy.set(r.entityId, (linkedBy.get(r.entityId) ?? 0) + 1);
  for (const [id, n] of linkedBy)
    steps.push({
      kind: "add",
      label: bp.entities.find((e) => e.id === id)?.pluralName ?? "Linked records",
      detail: `${n} new by name, for the sheet's links`,
    });
  const plan: ChangePlan = {
    request: `Import ${plural} from a spreadsheet`,
    title: `Import ${counts.create + counts.update} ${plural}`,
    facts: [],
    steps,
    ops,
    recordOps,
    source: "import",
    ...(ops.length ? { baseVersion: bp.version } : {}),
  };
  return { plan, rows, counts, newOptions, missingLinks };
}

/* ---------- A new record type from a sheet ---------- */

/**
 * The field type a column's values suggest: a number or money, a date or date-time, yes/no, an email, phone or web
 * address, a handful of repeated words (a choice), long text, or text. Empty cells don't count.
 */
export function sniffType(header: string, values: string[]): { type: Field["type"]; options?: string[] } {
  const vs = values.map((v) => v.trim()).filter(Boolean);
  if (!vs.length) return { type: "text" };
  const all = (test: (v: string) => boolean) => vs.every(test);
  const h = header.toLowerCase();
  if (
    all((v) => YES.test(v) || NO.test(v)) &&
    new Set(vs.map((v) => v.toLowerCase())).size <= 2 &&
    !all((v) => /^\d+$/.test(v))
  )
    return { type: "checkbox" };
  if (all((v) => parseNumber(v) !== null) && !/phone|mobile|contact|tel/.test(h)) {
    if (
      vs.some((v) => /₱|php/i.test(v)) ||
      /price|amount|cost|rate|fee|total|salary|balance|paid|payment/.test(h)
    )
      return { type: "money" };
    if (vs.some((v) => v.includes("%"))) return { type: "percent" };
    if (!/date|day/.test(h) || !all((v) => parseDate(v) !== null)) return { type: "number" };
  }
  if (all((v) => parseDate(v) !== null && !/\d{1,2}:\d{2}/.test(v))) return { type: "date" };
  if (all(isEmail)) return { type: "email" };
  if (all((v) => isPhone(v) && v.replace(/\D/g, "").length >= 7)) return { type: "phone" };
  if (all((v) => /^(https?:\/\/|www\.)/i.test(v))) return { type: "url" };
  if (all((v) => parseDateTime(v) !== null)) return { type: "datetime" };
  const distinct = [...new Set(vs.map((v) => v))];
  if (
    vs.length >= 4 &&
    distinct.length <= 12 &&
    distinct.length <= vs.length / 2 &&
    distinct.every((v) => v.length <= 30)
  )
    return { type: /status|stage/.test(h) ? "status" : "select", options: distinct };
  if (vs.some((v) => v.length > 120)) return { type: "long_text" };
  return { type: "text" };
}

const fieldId = (name: string, taken: Set<string>) => optionId(name, taken);

/**
 * A record type made from a sheet's columns: each column a field of the type its values suggest, the first plain text
 * column (a name, if one is called that) as the record's name. With the mapping to fill it.
 */
export function entityFromTable(
  name: string,
  table: Table,
  taken: Set<string>,
): { entity: Entity; mapping: (string | null)[] } {
  const ids = new Set<string>();
  const fields: Field[] = table.headers.map((header, i) => {
    const sniffed = sniffType(
      header,
      table.rows.slice(0, 500).map((r) => r[i] ?? ""),
    );
    const optTaken = new Set<string>();
    return {
      id: fieldId(header, ids),
      name: header.trim().slice(0, 60) || `Column ${i + 1}`,
      type: sniffed.type,
      ...(sniffed.options
        ? {
            options: sniffed.options.map((label, n) => ({
              id: optionId(label, optTaken),
              label,
              tone: TONES[n % TONES.length],
            })),
          }
        : {}),
    };
  });
  const textual = fields.filter((f) => f.type === "text");
  const primary = textual.find((f) => /name|title/i.test(f.name)) ?? textual[0];
  if (!primary) fields.unshift({ id: fieldId("name", ids), name: "Name", type: "text" });
  const primaryId = primary?.id ?? fields[0].id;
  // The record's name goes first, so tables and forms open on it.
  const ordered = [
    fields.find((f) => f.id === primaryId) as Field,
    ...fields.filter((f) => f.id !== primaryId),
  ];
  const plural = name.trim() || "Records";
  const singular = plural.replace(/ies$/i, "y").replace(/([^s])s$/i, "$1");
  const entity: Entity = {
    id: optionId(singular, taken),
    name: singular,
    pluralName: plural,
    primaryFieldId: primaryId,
    fields: ordered.map((f) => (f.id === primaryId ? { ...f, required: true } : f)),
  };
  const mapping = table.headers.map((_, i) => fields[primary ? i : i + 1]?.id ?? null);
  return { entity, mapping };
}

const ICONS: [RegExp, IconName][] = [
  [/member|customer|client|guest|player|student|patient|staff|employee|people|contact|lead/i, "users"],
  [/product|item|inventory|stock|menu|supplies/i, "package"],
  [/booking|reservation|appointment|schedule|event|session/i, "calendar"],
  [/sale|order|invoice|receipt|payment|expense|transaction/i, "receipt"],
  [/room|unit|property|house/i, "house"],
];

/**
 * The design a new record type from a sheet needs: the record type, a sidebar page named after it with a table of
 * every column, added in front of the import's own changes. The page's id is returned so the dialog can open it.
 */
export function withNewType(
  bp: Blueprint,
  entity: Entity,
): { blueprint: Blueprint; ops: ChangeOp[]; systemId: string } {
  const taken = new Set([...bp.systems.map((s) => s.id), ...bp.views.map((v) => v.id)]);
  const systemId = optionId(entity.pluralName, taken);
  const view: View = {
    id: optionId(`${entity.id}_all`, taken),
    entityId: entity.id,
    name: `All ${entity.pluralName.toLowerCase()}`,
    type: "table",
    fieldIds: entity.fields
      .filter((f) => f.type !== "long_text")
      .slice(0, 8)
      .map((f) => f.id),
  };
  const system: System = {
    id: systemId,
    name: entity.pluralName,
    icon: ICONS.find(([re]) => re.test(entity.pluralName))?.[1] ?? "briefcase",
    viewIds: [],
    widgetIds: [],
  };
  const ops: ChangeOp[] = [
    { op: "add_entity", entity },
    { op: "add_system", system },
    { op: "add_view", systemId, view },
  ];
  return {
    blueprint: {
      ...bp,
      entities: [...bp.entities, entity],
      systems: [...bp.systems, { ...system, viewIds: [view.id] }],
      views: [...bp.views, view],
    },
    ops,
    systemId,
  };
}

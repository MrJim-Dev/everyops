import { findRecord } from "@/lib/blueprint/lookup";
import { walkPath } from "@/lib/blueprint/paths";
import type {
  Blueprint,
  DataRecord,
  Entity,
  Field,
  FieldValue,
  RecordData,
  Rule,
} from "@/lib/blueprint/types";
import {
  formatDate,
  formatDateTime,
  formatMoney,
  formatNumber,
  formatPercent,
  formatRange,
  isTimeRange,
} from "@/lib/format";
import { addDays, dateKey, minutesOf, todayKey, zonedParts } from "@/lib/time";
import { recordContext } from "./context";
import { run, truthy } from "./expr";
import { newId } from "./ids";
import { completeAction } from "./rule-repair";

/**
 * Automations: what a rule does when it fires, which rules fire on a save, and which timed rules are due. The
 * browser, public bookings and the server's runner all use these, so an automation does the same thing wherever
 * it runs. Emails are only collected here; the server sends them.
 */

export type Email = { to: string; subject: string; body: string };

export type RuleOutcome = {
  records: DataRecord[];
  notices: string[];
  emails: Email[];
  /** Ids of records added by create_record and link_record actions. */
  created: string[];
};

/** Automations that create records can set off each other; past this depth they stop. */
export const MAX_DEPTH = 3;

const SAVE_EVENTS = new Set(["created", "updated", "status_changed"]);
export const isOn = (rule: Rule) => rule.enabled !== false;
export const isTimed = (rule: Rule) =>
  rule.trigger.event === "schedule" || rule.trigger.event === "date_reached";
export const sendsEmail = (rule: Rule) => rule.actions.some((a) => a.type === "send_email");

const entityOf = (bp: Blueprint, id: string) => bp.entities.find((e) => e.id === id);

/** A value as people read it: ₱1,200.00, Oct 16, the option's label, the linked record's name. */
function readable(bp: Blueprint, field: Field | undefined, value: FieldValue, records: DataRecord[]): string {
  if (Array.isArray(value))
    return value.map((v) => field?.options?.find((o) => o.id === v)?.label ?? v).join(", ");
  if (isTimeRange(value)) return `${formatDate(value.start)} · ${formatRange(value)}`;
  if (!field) return String(value);
  const type = field.type === "formula" ? field.formula?.resultType : field.type;
  const option = field.options?.find((o) => o.id === value);
  if (option) return option.label;
  if (typeof value === "number") {
    if (type === "money") return formatMoney(value);
    if (type === "percent") return formatPercent(value);
    return formatNumber(value);
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (type === "date" && typeof value === "string") return formatDate(value, { withYear: true });
  if (type === "datetime" && typeof value === "string") return formatDateTime(value);
  if (type === "relation" && typeof value === "string") {
    const target = entityOf(bp, field.relation?.entityId ?? "");
    const linked = findRecord(records, value);
    if (target && linked) return String(linked.data[target.primaryFieldId] ?? "");
  }
  return String(value ?? "");
}

/** {{field}} and {{link.field}} placeholders filled from the record (and the records it links to), formatted. */
export function fillTemplate(
  text: string,
  bp: Blueprint,
  entity: Entity,
  data: RecordData,
  records: DataRecord[],
  now: Date,
): string {
  const ctx = recordContext(bp, entity, data, records, now);
  return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path: string) => {
    const parts = path.split(".");
    const value = ctx.get(parts);
    if (value === undefined || value === null) return "";
    const steps = walkPath(bp, entity, parts).steps;
    return readable(bp, steps[steps.length - 1]?.field, value as FieldValue, records);
  });
}

export function matchesSave(
  rule: Rule,
  record: DataRecord,
  event: "created" | "updated",
  changed: readonly string[],
): boolean {
  const t = rule.trigger;
  if (!isOn(rule) || t.entityId !== record.entityId || !SAVE_EVENTS.has(t.event)) return false;
  if (t.event === "created") return event === "created";
  if (t.event === "updated") return event === "updated";
  return (
    event === "updated" &&
    !!t.fieldId &&
    changed.includes(t.fieldId) &&
    (t.to === undefined || record.data[t.fieldId] === t.to)
  );
}

/** Runs one rule's actions for one record (its when is checked by the caller). */
export function applyActions(
  bp: Blueprint,
  rows: DataRecord[],
  rule: Rule,
  record: DataRecord,
  now: Date,
  depth = 0,
): RuleOutcome {
  const out: RuleOutcome = { records: rows, notices: [], emails: [], created: [] };
  const entity = entityOf(bp, record.entityId);
  if (!entity) return out;
  for (const raw of rule.actions) {
    // Saved automations with the stock field or amount left blank still do what their name says.
    const action = completeAction(bp, rule, raw);
    if (!action) continue;
    const current = out.records.find((r) => r.id === record.id) ?? record;
    const ctx = recordContext(bp, entity, current.data, out.records, now);
    if (action.type === "notify") {
      out.notices.push(fillTemplate(action.message, bp, entity, current.data, out.records, now));
      continue;
    }
    if (action.type === "send_email") {
      const to = fillTemplate(action.to, bp, entity, current.data, out.records, now).trim();
      out.emails.push({
        to,
        subject: fillTemplate(action.subject, bp, entity, current.data, out.records, now),
        body: fillTemplate(action.body, bp, entity, current.data, out.records, now),
      });
      continue;
    }
    if (action.type === "link_record") {
      const linked = linkFromRule(bp, out.records, action, entity, current, now, depth);
      if (!linked) continue;
      out.records = linked.records;
      out.notices.push(...linked.notices);
      out.emails.push(...linked.emails);
      out.created.push(...linked.created);
      continue;
    }
    if (action.type === "create_record") {
      if (depth >= MAX_DEPTH) {
        out.notices.push(`${rule.name} stopped: automations were creating records from each other.`);
        continue;
      }
      const made = createFromRule(bp, out.records, action, entity, current, now);
      if (!made) continue;
      out.records = [...out.records, made];
      out.created.push(made.id);
      // The new record's own "when created" automations run too, one level deeper.
      const next = runSaveRules(bp, out.records, made, "created", [], now, depth + 1);
      out.records = next.records;
      out.notices.push(...next.notices);
      out.emails.push(...next.emails);
      out.created.push(...next.created);
      continue;
    }
    const targetId = action.target.kind === "self" ? current.id : current.data[action.target.fieldId];
    if (typeof targetId !== "string") continue;
    out.records = out.records.map((row) => {
      if (row.id !== targetId) return row;
      const was = row.data[action.fieldId];
      const value =
        action.type === "set_field"
          ? run(action.value, ctx)
          : (Number(was) || 0) + (Number(run(action.delta, ctx)) || 0);
      return { ...row, data: { ...row.data, [action.fieldId]: value }, updatedAt: now.toISOString() };
    });
  }
  return out;
}

function createFromRule(
  bp: Blueprint,
  rows: DataRecord[],
  action: Extract<Rule["actions"][number], { type: "create_record" }>,
  source: Entity,
  record: DataRecord,
  now: Date,
): DataRecord | undefined {
  const target = entityOf(bp, action.entityId);
  if (!target) return undefined;
  const ctx = recordContext(bp, source, record.data, rows, now);
  const data: RecordData = {};
  for (const [fieldId, expr] of Object.entries(action.values)) {
    const field = target.fields.find((f) => f.id === fieldId);
    if (!field || field.type === "formula" || field.type === "rollup" || !expr.trim()) continue;
    const value = run(expr, ctx);
    if (value !== undefined && value !== null) data[fieldId] = value as FieldValue;
  }
  // The link back to what made it (an invoice's booking), unless the rule set it.
  const back = target.fields.find((f) => f.type === "relation" && f.relation?.entityId === source.id);
  if (back && data[back.id] === undefined) data[back.id] = record.id;
  const stamp = now.toISOString();
  return { id: newId(target.id), entityId: target.id, data, createdAt: stamp, updatedAt: stamp };
}

/** A value as a date field keeps it: dates stay, date-times and time ranges become their Manila day. */
function asDate(value: unknown): string | undefined {
  if (isTimeRange(value as FieldValue)) return asDate((value as { start: string }).start);
  if (typeof value !== "string" || !value.trim() || Number.isNaN(Date.parse(value))) return undefined;
  return dateKey(value);
}

/** The value a link_record looks for, as the matched field stores it, or undefined when there's nothing to match. */
function matchValue(field: Field, value: unknown): FieldValue | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  if (field.type === "date") return asDate(value);
  if (field.type === "number" || field.type === "money" || field.type === "percent") {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  if (typeof value === "object") return undefined;
  return String(value).trim() || undefined;
}

const sameValue = (a: FieldValue | undefined, b: FieldValue) =>
  typeof a === "string" && typeof b === "string"
    ? a.trim().toLowerCase() === b.trim().toLowerCase()
    : a === b;

/**
 * Files a record under the matching record of another type (link_record): the first record whose field equals the
 * value, else a new one holding it (its name filled from the value when it has none), whose own "when created"
 * automations run one level deeper. Then the record's link points at it. Nothing changes when there's no value.
 */
function linkFromRule(
  bp: Blueprint,
  rows: DataRecord[],
  action: Extract<Rule["actions"][number], { type: "link_record" }>,
  source: Entity,
  record: DataRecord,
  now: Date,
  depth: number,
): RuleOutcome | undefined {
  const link = source.fields.find((f) => f.id === action.target.fieldId && f.type === "relation");
  const target = entityOf(bp, link?.relation?.entityId ?? "");
  const field = target?.fields.find((f) => f.id === action.fieldId);
  if (!link || !target || !field) return undefined;
  const value = matchValue(field, run(action.value, recordContext(bp, source, record.data, rows, now)));
  if (value === undefined) return undefined;
  const out: RuleOutcome = { records: rows, notices: [], emails: [], created: [] };
  let match = rows.find((r) => r.entityId === target.id && sameValue(r.data[field.id], value));
  if (!match) {
    if (depth >= MAX_DEPTH) return undefined;
    const stamp = now.toISOString();
    const data: RecordData = { [field.id]: value };
    if (target.primaryFieldId !== field.id) data[target.primaryFieldId] = readable(bp, field, value, rows);
    match = { id: newId(target.id), entityId: target.id, data, createdAt: stamp, updatedAt: stamp };
    out.records = [...out.records, match];
    out.created.push(match.id);
    const next = runSaveRules(bp, out.records, match, "created", [], now, depth + 1);
    out.records = next.records;
    out.notices.push(...next.notices);
    out.emails.push(...next.emails);
    out.created.push(...next.created);
  }
  const id = match.id;
  out.records = out.records.map((r) =>
    r.id === record.id && r.data[link.id] !== id
      ? { ...r, data: { ...r.data, [link.id]: id }, updatedAt: now.toISOString() }
      : r,
  );
  return out;
}

/** The automations a save sets off for one record, in order, each seeing what the ones before it changed. */
export function runSaveRules(
  bp: Blueprint,
  records: DataRecord[],
  record: DataRecord,
  event: "created" | "updated",
  changed: readonly string[],
  now: Date,
  depth = 0,
): RuleOutcome {
  const out: RuleOutcome = { records, notices: [], emails: [], created: [] };
  const entity = entityOf(bp, record.entityId);
  if (!entity) return out;
  for (const rule of bp.rules) {
    const fires = matchesSave(rule, record, event, changed);
    // Filing a record under its match (link_record) is kept up to date on every save while the rule's when holds,
    // whatever its trigger: a log logged after it was created is filed then, and one whose date changes moves.
    const keepsFiled =
      !fires &&
      isOn(rule) &&
      rule.trigger.entityId === record.entityId &&
      SAVE_EVENTS.has(rule.trigger.event) &&
      rule.actions.some((a) => a.type === "link_record");
    if (!fires && !keepsFiled) continue;
    const current = out.records.find((r) => r.id === record.id) ?? record;
    const ctx = recordContext(bp, entity, current.data, out.records, now);
    if (rule.when && !truthy(run(rule.when, ctx))) continue;
    const only = keepsFiled
      ? { ...rule, actions: rule.actions.filter((a) => a.type === "link_record") }
      : rule;
    const done = applyActions(bp, out.records, only, current, now, depth);
    out.records = done.records;
    out.notices.push(...done.notices);
    out.emails.push(...done.emails);
    out.created.push(...done.created);
  }
  return out;
}

/** A save as the server sees it: the record before (missing when new) and after. */
export type SavedChange = { before?: DataRecord; after: DataRecord };

export type SaveRun = { rule: Rule; record: DataRecord; emails: Email[] };

/**
 * What the server does after a save: for each saved record, the automations that fired on it, with the emails
 * they send. Field changes made by those automations are already in the saved records (the browser or the public
 * form ran them), so only emails are worked out here.
 */
export function saveRuns(bp: Blueprint, changes: SavedChange[], records: DataRecord[], now: Date): SaveRun[] {
  const runs: SaveRun[] = [];
  if (!bp.rules.some((r) => isOn(r) && SAVE_EVENTS.has(r.trigger.event))) return runs;
  for (const { before, after } of changes) {
    const entity = entityOf(bp, after.entityId);
    if (!entity) continue;
    const event = before ? "updated" : "created";
    const changed = before
      ? Object.keys({ ...before.data, ...after.data }).filter(
          (k) => JSON.stringify(before.data[k]) !== JSON.stringify(after.data[k]),
        )
      : [];
    if (before && !changed.length) continue;
    for (const rule of bp.rules) {
      if (!matchesSave(rule, after, event, changed)) continue;
      const ctx = recordContext(bp, entity, after.data, records, now);
      if (rule.when && !truthy(run(rule.when, ctx))) continue;
      const emails = rule.actions.flatMap((a) =>
        a.type === "send_email"
          ? [
              {
                to: fillTemplate(a.to, bp, entity, after.data, records, now).trim(),
                subject: fillTemplate(a.subject, bp, entity, after.data, records, now),
                body: fillTemplate(a.body, bp, entity, after.data, records, now),
              },
            ]
          : [],
      );
      runs.push({ rule, record: after, emails });
    }
  }
  return runs;
}

/* ---------- Timed automations ---------- */

/** The Manila day a date, date-time or time range falls on. */
function dayOf(value: FieldValue | undefined): string | undefined {
  if (typeof value === "string" && value) return Number.isNaN(Date.parse(value)) ? undefined : dateKey(value);
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const start = (value as { start?: unknown }).start;
    return typeof start === "string" && start ? dateKey(start) : undefined;
  }
  return undefined;
}

const reached = (now: Date, hhmm: string) => {
  const p = zonedParts(now);
  return p.hour * 60 + p.minute >= minutesOf(/^\d{1,2}:\d{2}$/.test(hhmm) ? hhmm : "08:00");
};

/** Whether a schedule runs today (Manila) and its time has come. */
export function scheduleDue(schedule: Rule["trigger"]["schedule"], now: Date): boolean {
  if (!schedule) return false;
  const p = zonedParts(now);
  if (schedule.every === "week" && (schedule.weekday ?? 1) !== p.weekday) return false;
  if (schedule.every === "month" && (schedule.monthDay ?? 1) !== p.day) return false;
  return reached(now, schedule.at);
}

export type DueRun = { rule: Rule; record: DataRecord; key: string };

/**
 * Timed automations due now, one per rule and record. key names the run (rule, record and the day it's for) so
 * the runner does each once, however often it checks. force runs a schedule now regardless of the time (Run now).
 */
export function dueRuns(
  bp: Blueprint,
  records: DataRecord[],
  now: Date,
  options: { ruleId?: string; force?: boolean } = {},
): DueRun[] {
  const today = todayKey(now);
  const due: DueRun[] = [];
  for (const rule of bp.rules) {
    if (!isOn(rule) || !isTimed(rule) || (options.ruleId && rule.id !== options.ruleId)) continue;
    const t = rule.trigger;
    const entity = entityOf(bp, t.entityId);
    if (!entity) continue;
    if (t.event === "schedule" && !options.force && !scheduleDue(t.schedule, now)) continue;
    if (t.event === "date_reached" && !options.force && !reached(now, t.at ?? "08:00")) continue;
    for (const record of records) {
      if (record.entityId !== entity.id) continue;
      let day = today;
      if (t.event === "date_reached") {
        const date = t.fieldId ? dayOf(record.data[t.fieldId]) : undefined;
        if (!date || addDays(date, t.offsetDays ?? 0) !== today) continue;
        day = date;
      }
      const ctx = recordContext(bp, entity, record.data, records, now);
      if (rule.when && !truthy(run(rule.when, ctx))) continue;
      due.push({ rule, record, key: `${rule.id}:${record.id}:${day}` });
    }
  }
  return due;
}

/* ---------- Plain words ---------- */

const DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const clockText = (h: string, m: string) => `${h.padStart(2, "0")}:${m}`;

/**
 * Reads the short schedule text the assistant writes: "daily 08:00", "weekly mon 09:00", "monthly 1 08:00" for a
 * schedule, "-1 08:00" (days from the date, then the time) for date_reached. Undefined when it doesn't read.
 */
export function parseScheduleText(
  event: "schedule" | "date_reached",
  text: string | undefined,
): Pick<Rule["trigger"], "schedule" | "offsetDays" | "at"> | undefined {
  const s = (text ?? "").trim().toLowerCase();
  if (event === "date_reached") {
    const m = /^([+-]?\d{1,3})(?:\s*days?)?(?:\s+(?:at\s+)?(\d{1,2}):(\d{2}))?$/.exec(s);
    if (!m) return s ? undefined : { offsetDays: 0, at: "08:00" };
    return { offsetDays: Number(m[1]), at: m[2] ? clockText(m[2], m[3]) : "08:00" };
  }
  const time = /(\d{1,2}):(\d{2})\s*$/.exec(s);
  const at = time ? clockText(time[1], time[2]) : "08:00";
  if (/^(daily|every day|day)\b/.test(s)) return { schedule: { every: "day", at } };
  const week = /^(?:weekly|every week)\s+([a-z]{3})/.exec(s);
  if (week && DAY_NAMES.includes(week[1]))
    return { schedule: { every: "week", at, weekday: DAY_NAMES.indexOf(week[1]) } };
  const month = /^(?:monthly|every month)\s+(\d{1,2})\b/.exec(s);
  if (month)
    return { schedule: { every: "month", at, monthDay: Math.min(28, Math.max(1, Number(month[1]))) } };
  return undefined;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function clock(hhmm: string | undefined) {
  const m = minutesOf(/^\d{1,2}:\d{2}$/.test(hhmm ?? "") ? (hhmm as string) : "08:00");
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${h % 12 || 12}:${String(min).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

const nameOf = (entity: Entity | undefined, id: string | undefined) =>
  entity?.fields.find((f) => f.id === id)?.name ?? id ?? "";

/** "When a booking is created", "Every day at 8:00 AM, for each invoice", "1 day before a booking's date". */
export function describeTrigger(bp: Blueprint, rule: Rule): string {
  const t = rule.trigger;
  const entity = entityOf(bp, t.entityId);
  const one = (entity?.name ?? t.entityId).toLowerCase();
  switch (t.event) {
    case "created":
      return `When a ${one} is added`;
    case "updated":
      return `When a ${one} is changed`;
    case "status_changed": {
      const field = entity?.fields.find((f) => f.id === t.fieldId);
      const to = field?.options?.find((o) => o.id === t.to)?.label;
      return `When a ${one}'s ${(field?.name ?? "status").toLowerCase()} ${to ? `becomes ${to}` : "changes"}`;
    }
    case "schedule": {
      const s = t.schedule;
      const when =
        s?.every === "week"
          ? `Every ${WEEKDAYS[s.weekday ?? 1]}`
          : s?.every === "month"
            ? `On day ${s.monthDay ?? 1} of every month`
            : "Every day";
      return `${when} at ${clock(s?.at)}, for each ${one}`;
    }
    case "date_reached": {
      const n = t.offsetDays ?? 0;
      const field = nameOf(entity, t.fieldId).toLowerCase();
      const rel =
        n === 0
          ? `On a ${one}'s ${field}`
          : `${Math.abs(n)} ${Math.abs(n) === 1 ? "day" : "days"} ${n < 0 ? "before" : "after"} a ${one}'s ${field}`;
      return `${rel}, at ${clock(t.at)}`;
    }
  }
}

/** One line per action: "Email {{email}}: Your booking is tomorrow", "Set Status to …". */
export function describeActions(bp: Blueprint, rule: Rule): string[] {
  const source = entityOf(bp, rule.trigger.entityId);
  return rule.actions.map((a) => {
    switch (a.type) {
      case "notify":
        return `Show a notice: ${a.message}`;
      case "send_email":
        return `Email ${a.to}: ${a.subject}`;
      case "create_record":
        return `Add a ${(entityOf(bp, a.entityId)?.name ?? a.entityId).toLowerCase()}`;
      case "link_record": {
        const linked = entityOf(
          bp,
          source?.fields.find((f) => f.id === a.target.fieldId)?.relation?.entityId ?? "",
        );
        const name = (linked?.name ?? "record").toLowerCase();
        return `File it under the ${name} with the same ${nameOf(linked, a.fieldId).toLowerCase()}, on every save (adding one if there's none)`;
      }
      default: {
        const linked =
          a.target.kind === "relation"
            ? entityOf(
                bp,
                source?.fields.find((f) => f.id === (a.target as { fieldId: string }).fieldId)?.relation
                  ?.entityId ?? "",
              )
            : source;
        const field = nameOf(linked, a.fieldId);
        const where =
          a.target.kind === "relation" ? ` on the linked ${(linked?.name ?? "record").toLowerCase()}` : "";
        return a.type === "set_field"
          ? `Set ${field}${where} to ${a.value}`
          : `Add ${a.delta} to ${field}${where}`;
      }
    }
  });
}

/** The record's title for run history. */
export function recordLabel(bp: Blueprint, record: DataRecord, records: DataRecord[] = []): string {
  const entity = entityOf(bp, record.entityId);
  const value = entity ? record.data[entity.primaryFieldId] : undefined;
  if (typeof value === "string" && value.trim()) return value.trim();
  const linked = typeof value === "string" ? findRecord(records, value) : undefined;
  return linked ? String(linked.id) : `${entity?.name ?? "Record"} ${record.id.slice(-6)}`;
}

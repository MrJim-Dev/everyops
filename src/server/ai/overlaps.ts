import type { Blueprint } from "@/lib/blueprint/types";
import { splitToolName } from "@/lib/connections";
import type { LookupCall } from "./lookup-result";

/**
 * Exact overlaps between records with a time range (bookings) and outside calendar events fetched in the same lookup,
 * so "do any bookings clash with my calendar?" is answered from arithmetic, not from the model's reading of times.
 */

type Span = { label: string; start: number; end: number };

/** A time as epoch ms; zone-less local times ("2026-10-25T20:00") are Manila. */
function at(value: unknown): number {
  const v =
    value && typeof value === "object"
      ? ((value as { dateTime?: string; date?: string }).dateTime ?? (value as { date?: string }).date)
      : value;
  if (typeof v !== "string") return Number.NaN;
  return Date.parse(/T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(v) ? `${v}+08:00` : v);
}

function eventSpans(value: unknown, out: Span[] = [], depth = 0): Span[] {
  if (!value || typeof value !== "object" || depth > 4) return out;
  if (Array.isArray(value)) {
    for (const v of value) eventSpans(v, out, depth + 1);
    return out;
  }
  const o = value as Record<string, unknown>;
  const start = at(o.start);
  const end = at(o.end);
  if (Number.isFinite(start) && Number.isFinite(end) && end > start)
    out.push({ label: String(o.summary ?? o.title ?? "Untitled event"), start, end });
  else for (const v of Object.values(o)) eventSpans(v, out, depth + 1);
  return out;
}

function recordSpans(bp: Blueprint, call: LookupCall): Span[] {
  const id = String(call.args.entityId ?? "");
  const entity = bp.entities.find((e) => e.id === id || e.pluralName.toLowerCase() === id.toLowerCase());
  const records = (call.result as { records?: Record<string, unknown>[] })?.records;
  if (!entity || !Array.isArray(records)) return [];
  const ranges = entity.fields.filter((f) => f.type === "time_range");
  return records.flatMap((r) =>
    ranges.flatMap((f) => {
      const v = r[f.id] as { start?: unknown; end?: unknown } | undefined;
      const start = at(v?.start);
      const end = at(v?.end);
      if (!Number.isFinite(start) || !Number.isFinite(end)) return [];
      return [{ label: `${entity.name} ${String(r[entity.primaryFieldId] ?? r.id)}`, start, end }];
    }),
  );
}

const manila = (ms: number, withDay: boolean) =>
  new Date(ms).toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    ...(withDay ? { weekday: "short", month: "short", day: "numeric" } : {}),
    hour: "numeric",
    minute: "2-digit",
  });

/** A line for the assistant about overlaps, or null when the lookup didn't fetch both records and calendar events. */
export function overlapNote(bp: Blueprint, calls: LookupCall[]): string | null {
  const events = calls.flatMap((c) => {
    if (!splitToolName(c.name)) return [];
    const text = (c.result as { result?: unknown })?.result;
    try {
      return eventSpans(typeof text === "string" ? JSON.parse(text) : text);
    } catch {
      return [];
    }
  });
  const records = calls.filter((c) => c.name === "search_records").flatMap((c) => recordSpans(bp, c));
  if (!events.length || !records.length) return null;
  const clashes = records.flatMap((r) =>
    events
      .filter((e) => e.start < r.end && r.start < e.end)
      .map((e) => {
        const minutes = Math.round((Math.min(r.end, e.end) - Math.max(r.start, e.start)) / 60_000);
        return `- ${r.label} (${manila(r.start, true)}–${manila(r.end, false)}) overlaps "${e.label}" (${manila(e.start, true)}–${manila(e.end, false)}) by ${minutes} min`;
      }),
  );
  return clashes.length
    ? `Clashes, computed exactly from the records and calendar events above (any overlap is a clash; report every one):\n${clashes.join("\n")}`
    : `No record overlaps any of the ${events.length} calendar events fetched (checked exactly).`;
}

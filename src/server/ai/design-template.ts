import "server-only";
import type { Blueprint, DataRecord, Entity, Field, FieldValue, FormView } from "@/lib/blueprint/types";
import { shiftRecords } from "@/lib/catalog/shift";
import type { CommunitySystem } from "@/server/community";
import type { Design, DesignPatch } from "./design-prompt";

/**
 * Setup's template route: a community system that is the owner's kind of business becomes the design Gemini starts
 * from, and Gemini returns only the changes (a patch) instead of a design written from scratch. The system's
 * blueprint and sample records are turned into the designer's shape here, so the patch, the checks and the repairs
 * run on it exactly as they run on a design Gemini wrote.
 */

/** A stored value as the designer writes sample values: text, in the formats toFieldValue reads back. */
export function sampleText(field: Field, value: FieldValue | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  switch (field.type) {
    case "formula":
    case "rollup":
      return undefined;
    case "checkbox":
      return value ? "true" : "false";
    case "multi_select":
      return Array.isArray(value) ? value.join(",") : String(value);
    case "time_range":
      return value && typeof value === "object" && !Array.isArray(value)
        ? `${value.start}/${value.end}`
        : undefined;
    case "number":
    case "money":
    case "percent":
      return typeof value === "number" ? String(value) : undefined;
    default:
      return Array.isArray(value) ? value.join(",") : String(value);
  }
}

/** A system's records as the designer's sample records; each record's id is its ref, so links keep working. */
export function samplesOf(bp: Blueprint, records: DataRecord[]): Design["samples"] {
  const entities = new Map(bp.entities.map((e) => [e.id, e]));
  return records.flatMap((r) => {
    const entity = entities.get(r.entityId);
    if (!entity) return [];
    const values = entity.fields.flatMap((f) => {
      const value = sampleText(f, r.data[f.id]);
      return value === undefined || value === "" ? [] : [{ fieldId: f.id, value }];
    });
    return [{ ref: r.id, entityId: r.entityId, values }];
  });
}

export type TemplateSeed = {
  design: Design;
  /** Form settings the designer's shape doesn't carry (how visitors pick a slot), put back on the built form. */
  forms: Map<string, Pick<FormView, "bookingLayout" | "multipleSlots">>;
  /** The record types whose sample records are this business's configuration and must be written from the brief. */
  master: string[];
};

/**
 * A community system as a design to start from: its blueprint (without layout pages, which setup arranges itself at
 * the end) and its sample records brought up to today. The workspace takes the interview's name.
 */
export function seedDesign(
  system: Pick<CommunitySystem, "name" | "blueprint" | "sample">,
  workspaceName: string,
  now: Date,
): TemplateSeed {
  const bp = system.blueprint;
  const records = system.sample ? shiftRecords(bp, system.sample.records, system.sample.builtOn, now) : [];
  const forms = new Map<string, Pick<FormView, "bookingLayout" | "multipleSlots">>();
  for (const v of bp.views)
    if (v.type === "form" && (v.bookingLayout || v.multipleSlots !== undefined))
      forms.set(v.id, {
        ...(v.bookingLayout ? { bookingLayout: v.bookingLayout } : {}),
        ...(v.multipleSlots !== undefined ? { multipleSlots: v.multipleSlots } : {}),
      });
  const views = bp.views.filter((v) => v.type !== "layout");
  const design: Design = {
    workspaceName: workspaceName || bp.workspaceName,
    summary: system.name,
    systems: bp.systems,
    entities: designEntities(bp.entities),
    views: views as unknown as Design["views"],
    widgets: bp.widgets as unknown as Design["widgets"],
    rules: bp.rules as unknown as Design["rules"],
    samples: samplesOf(bp, records),
  };
  return { design, forms, master: masterTypes(bp, design.samples) };
}

/**
 * The record types whose samples are the business itself rather than illustration: what is booked (courts, rooms,
 * units), what is sold or rented and its categories, rates and plans, and how customers pay. A template's are
 * another business's, so the patch has to write this owner's; bookings, orders and people can stay as samples.
 */
export function masterTypes(bp: Blueprint, samples: Design["samples"]): string[] {
  const withSamples = new Set(samples.map((s) => s.entityId));
  const resources = new Set<string>();
  for (const e of bp.entities) {
    if (e.resource) resources.add(e.id);
    const field = e.booking && e.fields.find((f) => f.id === e.booking?.resourceFieldId);
    if (field?.relation) resources.add(field.relation.entityId);
  }
  const CONFIG =
    /product|item|service|add.?on|extra|rate|price|plan|package|payment|categor|type|menu|room|unit|court|table/i;
  return bp.entities
    .filter((e) => !e.parent && !e.booking && withSamples.has(e.id))
    .filter((e) => resources.has(e.id) || CONFIG.test(`${e.id} ${e.name} ${e.pluralName}`))
    .map((e) => e.id);
}

/**
 * The problems a template patch leaves when it keeps the starting system's configuration: a record type on the
 * master list whose samples are still, record for record, the template's. Each is a repair the patch call is asked
 * for by name, with the records it kept, so the next patch can't miss it.
 */
export function templateChecks(seed: TemplateSeed, design: Design): string[] {
  const key = (s: Design["samples"][number]) =>
    `${s.ref}|${s.values.map((v) => `${v.fieldId}=${v.value}`).join(",")}`;
  const errors: string[] = [];
  for (const id of seed.master) {
    const entity = design.entities.find((e) => e.id === id);
    if (!entity) continue;
    const before = seed.design.samples.filter((s) => s.entityId === id).map(key);
    const after = design.samples.filter((s) => s.entityId === id).map(key);
    if (!before.length || before.length !== after.length || before.some((k, i) => k !== after[i])) continue;
    const names = seed.design.samples
      .filter((s) => s.entityId === id)
      .map((s) => s.values.find((v) => v.fieldId === entity.primaryFieldId)?.value)
      .filter(Boolean)
      .slice(0, 4);
    errors.push(
      `${entity.pluralName} (${id}): the sample records are still the starting system's (${names.map((n) => `'${n}'`).join(", ")}); return this business's complete set from the brief, with its real names, prices and counts.`,
    );
  }
  return errors;
}

/**
 * The seed as the prompt shows it: the whole design with a few sample records per record type. A template's samples
 * run to hundreds of records (a POS with months of sales); Gemini needs their shape and the names in them, not all.
 */
export function seedForPrompt(design: Design, perEntity = 3): Design {
  return { ...design, samples: fewSamples(design.samples, perEntity) };
}

/** The first few samples of each record type: enough to show their shape and the names in them. */
export function fewSamples(samples: Design["samples"], perEntity = 3): Design["samples"] {
  const seen = new Map<string, number>();
  return samples.filter((s) => {
    const n = (seen.get(s.entityId) ?? 0) + 1;
    seen.set(s.entityId, n);
    return n <= perEntity;
  });
}

/**
 * After a template patch is applied: the samples Gemini returned for a record type replace all of that type's
 * starting samples (the owner's six courts, not the template's four plus six), and samples of other types that
 * linked to a replaced one are linked to the new ones in turn, so bookings still have a court.
 */
export function rebindTemplateSamples(seed: Design, patched: Design, patch: DesignPatch): Design {
  const replaced = new Set((patch.samples ?? []).map((s) => s.entityId));
  if (!replaced.size) return patched;
  const patchRefs = new Set((patch.samples ?? []).map((s) => s.ref));
  const dropped = new Set(
    seed.samples.filter((s) => replaced.has(s.entityId) && !patchRefs.has(s.ref)).map((s) => s.ref),
  );
  const samples = patched.samples.filter((s) => !dropped.has(s.ref));
  const fresh = new Map<string, string[]>();
  for (const s of samples)
    if (replaced.has(s.entityId)) fresh.set(s.entityId, [...(fresh.get(s.entityId) ?? []), s.ref]);
  const links = new Map(
    patched.entities.map((e) => [
      e.id,
      new Map(
        e.fields
          .filter((f) => f.type === "relation" && f.relation && replaced.has(f.relation.entityId))
          .map((f) => [f.id, f.relation?.entityId ?? ""]),
      ),
    ]),
  );
  const turn = new Map<string, number>();
  return {
    ...patched,
    samples: samples.map((s) => {
      const fields = links.get(s.entityId);
      if (!fields?.size) return s;
      return {
        ...s,
        values: s.values.map((v) => {
          const target = fields.get(v.fieldId);
          if (!target || !dropped.has(v.value)) return v;
          const refs = fresh.get(target) ?? [];
          if (!refs.length) return v;
          const i = turn.get(target) ?? 0;
          turn.set(target, i + 1);
          return { ...v, value: refs[i % refs.length] };
        }),
      };
    }),
  };
}

/** Puts a template form's slot picking back on the built form when the design kept the form. */
export function withTemplateForms(bp: Blueprint, forms: TemplateSeed["forms"]): Blueprint {
  if (!forms.size) return bp;
  return {
    ...bp,
    views: bp.views.map((v) => (v.type === "form" && forms.has(v.id) ? { ...v, ...forms.get(v.id) } : v)),
  };
}

/**
 * Opening hours and slot length as the brief states them ("open 6:00 AM to 11:00 PM daily, 60-minute slots",
 * "7am–10pm", "from 8 AM until 9 PM, 30-minute slots"), or null when it doesn't. A range counts only when one side
 * carries am/pm, midnight or noon, so "4-6 courts" and dates aren't read as hours.
 */
export function hoursFromBrief(
  brief: string,
): { opensAt: string; closesAt: string; slotMinutes?: 15 | 30 | 60 | 90 | 120 } | null {
  const time = String.raw`(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.|mn|midnight|noon)?`;
  const range = new RegExp(`${time}\\s*(?:to|until|till|-|–|—)\\s*${time}`, "gi");
  const minutesOf = (h: string, m: string | undefined, suffix: string | undefined, late: boolean) => {
    let hour = Number(h);
    const s = suffix?.toLowerCase().replace(/\./g, "");
    if (s === "mn" || s === "midnight") return 24 * 60;
    if (s === "noon") return 12 * 60;
    if (s === "pm" && hour < 12) hour += 12;
    if (s === "am" && hour === 12) hour = 0;
    // "6 to 11 PM": the first side borrows the second's half of the day when it has none and would otherwise be
    // later than the closing time.
    if (!s && late && hour < 12) hour += 12;
    return hour * 60 + Number(m ?? 0);
  };
  for (const match of brief.matchAll(range)) {
    const [, h1, m1, s1, h2, m2, s2] = match;
    if (!s1 && !s2) continue;
    const close = minutesOf(h2, m2, s2, false);
    let open = minutesOf(h1, m1, s1, false);
    if (!s1 && open >= close) open = minutesOf(h1, m1, s1, true);
    if (open >= close || close > 24 * 60) continue;
    const pad = (n: number) => String(n).padStart(2, "0");
    const hhmm = (mins: number) => `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;
    const slot =
      /(\d{2,3})\s*-?\s*min(?:ute)?s?\b|(\d)\s*-?\s*h(?:ou)?r\s*(?:slots?|blocks?|bookings?)|\bhourly\b/i.exec(
        brief,
      );
    const want = slot ? (slot[1] ? Number(slot[1]) : slot[2] ? Number(slot[2]) * 60 : 60) : undefined;
    const slotMinutes = want
      ? ([15, 30, 60, 90, 120] as const).reduce((a, b) => (Math.abs(b - want) < Math.abs(a - want) ? b : a))
      : undefined;
    return { opensAt: hhmm(open), closesAt: hhmm(close), ...(slotMinutes ? { slotMinutes } : {}) };
  }
  return null;
}

/**
 * The brief's hours on every bookable record type the patch left with the template's hours: a patch that returns
 * nothing for the courts (one run in three) would otherwise hand over another business's closing time.
 */
export function withBriefHours(seed: Design, design: Design, brief: string): Design {
  const hours = hoursFromBrief(brief);
  if (!hours) return design;
  const before = new Map(seed.entities.map((e) => [e.id, JSON.stringify(e.resource ?? null)]));
  return {
    ...design,
    entities: design.entities.map((e) =>
      e.resource && before.get(e.id) === JSON.stringify(e.resource)
        ? { ...e, resource: { ...e.resource, ...hours } }
        : e,
    ),
  };
}

/**
 * Whether a repair round got anywhere: it did not when every problem it was given is still there (word for word
 * for the validator's, in substance for the brief check's, which is reworded every round) and nothing was fixed.
 * One more round then costs 5–50 s and tends to come back the same; the design is handed over with its gaps instead.
 */
export function noProgress(before: string[], after: string[]): boolean {
  if (!before.length || after.length < before.length) return false;
  const bag = (s: string) => new Set(s.toLowerCase().match(/[a-z][a-z0-9_']{3,}/g) ?? []);
  const alike = (a: string, b: string) => {
    if (a === b) return true;
    if (!a.startsWith("Brief coverage:") || !b.startsWith("Brief coverage:")) return false;
    const x = bag(a);
    const y = bag(b);
    let shared = 0;
    for (const w of x) if (y.has(w)) shared++;
    return shared / Math.max(1, Math.min(x.size, y.size)) >= 0.6;
  };
  return before.every((b) => after.some((a) => alike(a, b)));
}
/**
 * Record types as the designer's schema can carry them. It has no signature type (the schema is near Gemini's limit),
 * so a signature field goes as a file field; toEntity turns a file field named Signature back into one.
 */
export function designEntities(entities: Entity[]): Design["entities"] {
  return entities.map((e) => ({
    ...e,
    fields: e.fields.map((f) =>
      f.type === "signature" ? { ...f, type: "file" as const } : { ...f, type: f.type },
    ),
  })) as Design["entities"];
}

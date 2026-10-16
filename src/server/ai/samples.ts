import "server-only";
import { z } from "zod";
import type { Blueprint, Entity, Field } from "@/lib/blueprint/types";
import { todayKey } from "@/lib/time";
import type { Design } from "./design-prompt";
import { generateJsonHedged } from "./gemini";

type Sample = Design["samples"][number];

/** Fields a sample can't hold a value for: computed ones and pictures. */
const SKIP: Field["type"][] = ["formula", "rollup", "image"];

/**
 * Record types the designer gave no samples, most useful first: line items (a payroll run without payslips shows ₱0),
 * then day-to-day records with a status or a date (attendance, orders), then the rest. At most 8.
 */
export function emptyTypes(bp: Blueprint, samples: Sample[]): Entity[] {
  const has = new Set(samples.map((s) => s.entityId));
  const rank = (e: Entity) =>
    e.parent
      ? 0
      : e.fields.some((f) => ["status", "date", "datetime", "time_range"].includes(f.type))
        ? 1
        : 2;
  return bp.entities
    .filter((e) => !has.has(e.id))
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, 8);
}

/** Each record type's fields as prompt lines, with the sample records a link can point at. */
function typeBlocks(
  bp: Blueprint,
  samples: Sample[],
  types: Entity[],
  how: (e: Entity, parent: Entity | undefined) => string,
): string[] {
  const filling = new Set(types.map((e) => e.id));
  const titleOf = (s: Sample) => {
    const entity = bp.entities.find((e) => e.id === s.entityId);
    return s.values.find((v) => v.fieldId === entity?.primaryFieldId)?.value ?? s.ref;
  };
  const refsOf = (entityId: string) =>
    samples
      .filter((s) => s.entityId === entityId)
      .slice(0, 8)
      .map((s) => `${s.ref} "${titleOf(s)}"`)
      .join(", ");
  const describe = (f: Field) => {
    const req = f.required ? ", required" : "";
    if (f.type === "relation") {
      const to = f.relation?.entityId ?? "";
      const refs = refsOf(to);
      const where = filling.has(to) ? `refs you write for ${to}` : refs || "none yet, leave empty";
      return `- ${f.id} (link to ${to}${req}): ${where}`;
    }
    if (f.options?.length) return `- ${f.id} (${f.type}${req}): ${f.options.map((o) => o.id).join(" | ")}`;
    if (f.type === "time_range")
      return `- ${f.id} (time_range ${f.range === "dates" ? "of dates" : "of date-times"}${req})`;
    return `- ${f.id} (${f.type}${req})`;
  };
  return types.map((e) => {
    const parent = e.parent ? bp.entities.find((x) => x.id === e.parent?.entityId) : undefined;
    const fields = e.fields.filter((f) => !SKIP.includes(f.type)).map(describe);
    return `${e.id} "${e.pluralName}" (${how(e, parent)}):\n${fields.join("\n")}`;
  });
}

/** What Gemini needs to write them: each record type's fields, and the sample records they can link to. */
export function samplesPrompt(bp: Blueprint, samples: Sample[], empty: Entity[], now: Date): string {
  const blocks = typeBlocks(bp, samples, empty, (e, parent) =>
    parent
      ? `line items of ${parent.name}: 2 to 3 under each of the first 3 ${parent.pluralName.toLowerCase()} listed in ${e.parent?.fieldId}`
      : "3 records",
  );
  return `Today in Manila: ${todayKey(now)}\nWorkspace: ${bp.workspaceName}\n\nWrite sample records for these record types, which have none yet:\n\n${blocks.join("\n\n")}`;
}

/**
 * The template route: the records that are this business's configuration (its courts, products and categories,
 * payment methods, rates), written from the brief to replace the template's. Each type's whole set, every one the
 * brief names, counts or prices.
 */
export function templateSamplesPrompt(
  bp: Blueprint,
  samples: Sample[],
  types: Entity[],
  brief: string,
  now: Date,
): string {
  const blocks = typeBlocks(
    bp,
    samples.filter((s) => !types.some((t) => t.id === s.entityId)),
    types,
    () => "the complete set this business has, from the brief",
  );
  return `Today in Manila: ${todayKey(now)}\nWorkspace: ${bp.workspaceName}\n\nBrief (the owner's own words and answers):\n${brief}\n\nThis workspace starts from a template built for another business. Write this business's own records for these record types, replacing the template's: every court, room, unit, product, service, add-on, category, rate or payment method the brief names, counts or prices (a brief that says "4 courts" gets 4 courts; "paddle rental ₱100, balls ₱150" gets those two products with those prices; "GCash" gets a GCash payment method with the account details the brief gives, and none it doesn't). Use the brief's real names; where it gives only a count, number them (Court 1, Court 2…). Set rates, prices, hours and active flags from the brief.\n\n${blocks.join("\n\n")}`;
}

/**
 * Writes the configuration records for a template's master record types from the brief, in one small call beside
 * the structural patch. Returns null when the call fails; the template check then sends the design back for a repair.
 */
export async function writeTemplateSamples(
  bp: Blueprint,
  samples: Sample[],
  typeIds: string[],
  brief: string,
  now: Date,
  signal?: AbortSignal,
): Promise<Sample[] | null> {
  const types = bp.entities.filter((e) => typeIds.includes(e.id));
  if (!types.length) return [];
  const started = Date.now();
  const result = await generateJsonHedged(
    answer,
    {
      system: SAMPLES_SYSTEM,
      prompt: templateSamplesPrompt(bp, samples, types, brief, now),
      task: "design-template-samples",
      timeoutMs: 60_000,
      idleMs: 12_000,
      firstPartMs: 20_000,
      thinking: "LOW",
      maxOutputTokens: 8_000,
      signal,
    },
    { hedgeMs: 10_000, attempts: 3, afterSilence: true },
  );
  if (!result.ok) {
    console.warn(
      JSON.stringify({ event: "design_template_samples_failed", types: typeIds, error: result.error }),
    );
    return null;
  }
  const allowed = new Set(typeIds);
  const written = result.data.samples.filter((s) => allowed.has(s.entityId) && s.values.length).slice(0, 60);
  console.info(
    JSON.stringify({
      event: "design_template_samples",
      types: [...new Set(written.map((s) => s.entityId))],
      records: written.length,
      ms: Date.now() - started,
    }),
  );
  return written;
}

const SAMPLES_SYSTEM = `You write realistic sample records for a Filipino small business's workspace, so its screens and totals aren't empty on day one.
- Only the record types and fields listed. A link's value is the ref of a listed record; never invent refs for other record types.
- Each record gets a short unique ref of its own starting with n_ (n_slip1), used when another record you write links to it.
- Values as text: number/money as digits; checkbox true/false; select/status the option id; date YYYY-MM-DD; datetime YYYY-MM-DDTHH:MM; time_range start/end with the same formats. Money is PHP.
- Dates around today, mostly the past two weeks and the coming week. Fill required fields.`;

const answer = z.object({
  samples: z.array(
    z.object({
      ref: z.string(),
      entityId: z.string(),
      values: z.array(z.object({ fieldId: z.string(), value: z.string() })),
    }),
  ),
});

/**
 * Samples for the record types the design left empty, from one small Gemini call (about 2k tokens out), not a repair
 * of the whole design. Best effort: when it fails, the workspace is built with the samples it has.
 */
export async function fillEmptySamples(bp: Blueprint, samples: Sample[], now: Date): Promise<Sample[]> {
  const empty = emptyTypes(bp, samples);
  if (!empty.length) return samples;
  const started = Date.now();
  const result = await generateJsonHedged(
    answer,
    {
      system: SAMPLES_SYSTEM,
      prompt: samplesPrompt(bp, samples, empty, now),
      task: "design-samples",
      // Like the Overview layout: a stalled call gets a twin after 10 s of silence, not 30.
      timeoutMs: 60_000,
      idleMs: 12_000,
      firstPartMs: 20_000,
      thinking: "LOW",
      maxOutputTokens: 8_000,
    },
    { hedgeMs: 10_000, attempts: 3, afterSilence: true },
  );
  if (!result.ok) {
    console.warn(
      JSON.stringify({
        event: "design_samples_fill_failed",
        types: empty.map((e) => e.id),
        error: result.error,
      }),
    );
    return samples;
  }
  return mergeSamples(bp, samples, result.data.samples, new Set(empty.map((e) => e.id)), started);
}

/** New samples for the empty types only, with refs that can't clash with the design's own. */
export function mergeSamples(
  bp: Blueprint,
  samples: Sample[],
  extra: Sample[],
  allowed: Set<string>,
  started = Date.now(),
): Sample[] {
  const taken = new Set(samples.map((s) => s.ref));
  const kept = extra.filter((s) => allowed.has(s.entityId) && s.values.length).slice(0, 40);
  const rename = new Map<string, string>();
  for (const s of kept) {
    let ref = s.ref || "n";
    while (taken.has(ref)) ref = `${ref}_n`;
    taken.add(ref);
    rename.set(s.ref, ref);
  }
  /** Only links to the record types written here point at the new refs; the rest point at the design's samples. */
  const toNew = (entityId: string, fieldId: string) => {
    const f = bp.entities.find((e) => e.id === entityId)?.fields.find((x) => x.id === fieldId);
    return f?.type === "relation" && allowed.has(f.relation?.entityId ?? "");
  };
  const added = kept.map((s) => ({
    ...s,
    ref: rename.get(s.ref) ?? s.ref,
    values: s.values.map((v) =>
      toNew(s.entityId, v.fieldId) ? { ...v, value: rename.get(v.value) ?? v.value } : v,
    ),
  }));
  console.info(
    JSON.stringify({
      event: "design_samples_filled",
      types: [...new Set(added.map((s) => s.entityId))],
      records: added.length,
      ms: Date.now() - started,
    }),
  );
  return [...samples, ...added];
}

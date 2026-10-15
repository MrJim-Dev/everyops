import "server-only";
import { z } from "zod";
import type { Blueprint, DataRecord } from "@/lib/blueprint/types";
import { THEMES } from "@/lib/public/custom-site";
import { REFERENCES, SECTION_STYLES, type SectionKind, type SiteDesign } from "@/lib/public/site-sections";
import { mainForm, offeringOf, paymentsOf } from "@/lib/public/site-template";
import { generateJsonHedged } from "./gemini";

const KINDS = Object.keys(SECTION_STYLES) as SectionKind[];
const ids = (kind: SectionKind) => SECTION_STYLES[kind].map((s) => s.id) as [string, ...string[]];

/** Gemini's answer: a reference to start from, a theme and a style for every section, all from the library. */
const answer = z.object({
  reference: z.enum(REFERENCES.map((r) => r.id) as [string, ...string[]]),
  theme: z.enum(THEMES.map((t) => t.id) as [string, ...string[]]),
  ...Object.fromEntries(KINDS.map((k) => [k, z.enum(ids(k))])),
}) as unknown as z.ZodType<{ reference: string; theme: string } & Record<SectionKind, string>>;

export const SITE_DESIGN_SYSTEM = `You choose the design of a small business's public website from a fixed library of section styles.
- Start from the reference site closest to the business, then change a section only when another style clearly suits
  this business and its data better. Keep the result coherent: one strong idea, not a different gimmick per section.
- Fit the data: a gallery needs pictures to shine (without them it shows colored panels); a price table or menu suits
  many items with prices; pricing cards suit two to four items; a featured-first offer suits one star item.
- Pick the theme that matches what the business is (courts green, salons plum, stays blue, food clay, wellness sage,
  shops and workshops ember) unless the brief names colors.
- Only ids from the lists below.`;

function prompt(bp: Blueprint, records: DataRecord[], name: string, brief: string): string {
  const offer = offeringOf(bp);
  const items = offer ? records.filter((r) => r.entityId === offer.id) : [];
  const pictures = !!offer?.fields.some((f) => f.type === "image" && items.some((r) => r.data[f.id]));
  const facts = [
    `Business: ${name}`,
    offer
      ? `What it offers: ${items.length} ${offer.pluralName.toLowerCase()}${pictures ? " with pictures" : ", no pictures"}`
      : "No list of offers",
    paymentsOf(bp) ? "Has payment methods" : "",
    mainForm(bp) ? "Customers book or order online" : "",
  ].filter(Boolean);
  const refs = REFERENCES.map(
    (r) => `- ${r.id} (${r.label}, ${r.kind}): ${KINDS.map((k) => `${k}=${r.design[k]}`).join(" ")}`,
  ).join("\n");
  const styles = KINDS.map(
    (k) => `${k}:\n${SECTION_STYLES[k].map((s) => `  - ${s.id}: ${s.about}`).join("\n")}`,
  ).join("\n");
  return `${facts.join("\n")}\n\nBrief:\n${brief.slice(0, 4000)}\n\nReference sites:\n${refs}\n\nThemes: ${THEMES.map((t) => t.id).join(", ")}\n\nSection styles:\n${styles}`;
}

/**
 * The website design for a new workspace, chosen by Gemini from the section library. Best effort and quick: when it
 * fails, setup uses the business's reference design.
 */
export async function chooseSiteDesign(
  bp: Blueprint,
  records: DataRecord[],
  name: string,
  brief: string,
): Promise<Partial<SiteDesign> | undefined> {
  if (!mainForm(bp)) return undefined;
  const started = Date.now();
  const result = await generateJsonHedged(
    answer,
    {
      system: SITE_DESIGN_SYSTEM,
      prompt: prompt(bp, records, name, brief),
      task: "design-site",
      timeoutMs: 30_000,
      idleMs: 10_000,
      firstPartMs: 15_000,
      thinking: "LOW",
      maxOutputTokens: 1000,
      enumLiterals: true,
    },
    { hedgeMs: 10_000, attempts: 2, afterSilence: true },
  ).catch((e) => ({ ok: false as const, error: String(e) }));
  if (!result.ok) {
    console.warn(JSON.stringify({ event: "site_design_skipped", reason: result.error }));
    return undefined;
  }
  const { reference, ...design } = result.data;
  console.info(JSON.stringify({ event: "site_design", ms: Date.now() - started, reference, design }));
  return design;
}

import "server-only";
import { z } from "zod";
import type { Blueprint, DataRecord } from "@/lib/blueprint/types";
import { SITE_TOKEN } from "@/lib/public/custom-site";
import { resolveBlocks } from "@/lib/public/resolve";
import {
  BODY_SECTIONS,
  LOOKS,
  type LookKind,
  REFERENCES,
  SECTION_STYLES,
  type SectionKind,
  type SiteDesign,
  type SiteFacts,
  siteFacts,
} from "@/lib/public/site-sections";
import { mainForm } from "@/lib/public/site-template";
import { generateJsonHedged } from "./gemini";

const KINDS = Object.keys(SECTION_STYLES) as SectionKind[];
const LOOK_KINDS = Object.keys(LOOKS) as LookKind[];
const ids = (list: { id: string }[]) => list.map((s) => s.id) as [string, ...string[]];

/** Gemini's answer: a reference to start from, a style per section, every part of the look and the section order. */
const answer = z.object({
  reference: z.enum(ids(REFERENCES)),
  ...Object.fromEntries(KINDS.map((k) => [k, z.enum(ids(SECTION_STYLES[k]))])),
  ...Object.fromEntries(LOOK_KINDS.map((k) => [k, z.enum(ids(LOOKS[k]))])),
  order: z
    .array(z.enum(BODY_SECTIONS))
    .describe(
      "The body sections top to bottom; leave one out to hide it (never offer or payments when they have data)",
    ),
}) as unknown as z.ZodType<{ reference: string; order: string[] } & Record<SectionKind | LookKind, string>>;

export const SITE_DESIGN_SYSTEM = `You design a small business's public website by choosing from a fixed library: a style for every
section, every part of the look, and the order of the sections. You never write markup; every combination renders.
- Start from the reference site closest to the business (its kind and mood), then change what the business and its
  data call for. Each option says when to use it and when to avoid it: follow those, and the data facts above them.
- Keep one coherent idea: a calm site stays calm (airy spacing, serif headings, soft colors), a bold one stays bold
  (strong colors, compact spacing, sharp corners). Don't mix a gimmick per section.
- Pick the theme by what the business is, unless the brief names colors. Heading font, body font, corners and
  buttons should suit each other (serif headings with a sans body; square buttons with sharp corners).
- Order the sections the way a customer decides: usually what's offered early, then why choose us, how it works, ways
  to pay, questions and contact. Leave out a section only when it adds nothing for this business.
- Only ids from the lists.`;

function lines(list: { id: string; use: string; avoid?: string; about?: string }[]) {
  return list
    .map(
      (s) =>
        `  - ${s.id}: ${s.about ? `${s.about}. ` : ""}Use for ${s.use}.${s.avoid && s.avoid !== "nothing" ? ` Avoid with ${s.avoid}.` : ""}`,
    )
    .join("\n");
}

function factsText(name: string, f: SiteFacts, offerName?: string): string {
  return [
    `Business: ${name} (${f.name} characters)`,
    `Headline: ${f.headline} words`,
    f.items
      ? `What it offers: ${f.items} ${offerName ?? "items"}, ${f.pictures} with pictures, ${f.descriptions} with descriptions, up to ${f.prices} prices each`
      : "No list of offers",
    `Hero facts (hours, starting price, how to pay): ${f.facts}`,
    `Highlights: ${f.highlights}, steps: ${f.steps}, payment methods: ${f.payments}, FAQs: ${f.faqs}, contact details: ${f.contact}`,
    f.calendar
      ? `Booking calendar: ${f.calendar === "grid" ? "courts side by side (needs a wide page)" : f.calendar}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function prompt(name: string, brief: string, facts: SiteFacts, offerName?: string): string {
  const refs = REFERENCES.map(
    (r) =>
      `- ${r.id} (${r.label}, for ${r.kind} businesses): ${[...KINDS, ...LOOK_KINDS]
        .filter((k) => r.design[k])
        .map((k) => `${k}=${r.design[k]}`)
        .join(" ")}${r.design.order ? ` order=${r.design.order.join(",")}` : ""}`,
  ).join("\n");
  const styles = KINDS.map((k) => `${k}:\n${lines(SECTION_STYLES[k])}`).join("\n");
  const looks = LOOK_KINDS.map((k) => `${k}:\n${lines(LOOKS[k])}`).join("\n");
  return `Data facts:\n${factsText(name, facts, offerName)}\n\nBrief:\n${brief.slice(0, 4000)}\n\nReference sites:\n${refs}\n\nSection styles:\n${styles}\n\nLook:\n${looks}\n\nBody sections (default order): ${BODY_SECTIONS.join(", ")}`;
}

/**
 * The website design for a new workspace, chosen by Gemini from the section library with what the site has to show.
 * Best effort and quick: when it fails, setup uses the business's reference design. withCustomSite then corrects
 * anything that doesn't fit the data (fitDesign).
 */
export async function chooseSiteDesign(
  bp: Blueprint,
  records: DataRecord[],
  name: string,
  brief: string,
): Promise<Partial<SiteDesign> | undefined> {
  const form = mainForm(bp);
  if (!form) return undefined;
  const landing = bp.views.find((v) => v.type === "landing" && v.layout === "standard");
  const blocks =
    landing?.type === "landing" ? resolveBlocks(bp, records, {}, SITE_TOKEN, landing, new Date()) : [];
  const facts = siteFacts(name, blocks, form.bookingLayout);
  const offer = blocks.find((b) => b.type === "records" && b.id === "offer");
  const started = Date.now();
  const result = await generateJsonHedged(
    answer,
    {
      system: SITE_DESIGN_SYSTEM,
      prompt: prompt(name, brief, facts, offer?.type === "records" ? offer.title : undefined),
      task: "design-site",
      timeoutMs: 30_000,
      idleMs: 10_000,
      firstPartMs: 15_000,
      thinking: "LOW",
      maxOutputTokens: 1500,
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
  return design as Partial<SiteDesign>;
}

import { z } from "zod";
import { FINDING_KINDS, type Finding } from "@/lib/assistant/checkup";

export const CHECKUP_SYSTEM = `You review one small business's EveryOps workspace against what the assistant knows about the
business (its memory) and report what the owner should fix. You get the memory, the blueprint (record types, fields
and formulas, pages and tabs, forms, dashboard cards, automations), where each field is used, the text of written
pages and a digest of the records.

Report only real problems you can point to, at most 5, most important first:
- mismatch: the workspace contradicts the memory. A price, rate, hours, branch, payment method, name or policy the
  memory states is different or absent where it's used (a formula charging ₱400 when peak is ₱500, a form without
  a payment method the business takes, opening hours that differ).
- missing: something the business clearly needs from its memory or goals that the workspace lacks (a second branch
  planned and no way to tell branches apart; coaches hired and nowhere to track them).
- stale_page: a written page, website section or form intro says something the memory or the data contradicts.
- data: records that are clearly inconsistent or need attention (past bookings still pending, totals that can't be
  right). Use the digest's numbers.
For each: a short title (under 60 characters), one or two plain sentences of detail, the evidence (quote both sides
briefly: "Memory: peak rate ₱500/hr · Rate per hour formula: 400 for every slot"), and fix: the request the owner
would send to the assistant to fix it, one sentence in their words ("Charge ₱500 per hour from 5 to 9 PM").
Never report taste, style, nice-to-haves or generic advice, and never guess. When nothing is wrong, return none.
Write everything in the owner's words: no setting names, JSON keys, field ids or formula code ("the courts close at
11 PM", never closesAt: "23:00"; "every hour is charged ₱400", never expr: "400"). Money is PHP (₱1,250); times
like 10 PM. Say pages, tabs, forms, cards, record types.`;

export const checkupAnswer = z.object({
  findings: z.array(
    z.object({
      kind: z.enum(FINDING_KINDS),
      title: z.string(),
      detail: z.string(),
      evidence: z.string(),
      fix: z.string(),
    }),
  ),
});
export type CheckupAnswer = z.infer<typeof checkupAnswer>;

/** A stable id from the title, so a finding the owner hid stays hidden when the same check runs again. */
export function findingId(title: string) {
  let h = 0;
  for (const ch of title.toLowerCase().replace(/[^a-z0-9]/g, "")) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return `fix_${(h >>> 0).toString(36)}`;
}

/** Gemini's findings, cleaned: every part filled in, no repeats, at most five. */
export function toFindings(answer: CheckupAnswer): Finding[] {
  const out: Finding[] = [];
  for (const f of answer.findings) {
    const title = f.title.trim().slice(0, 80);
    const fixText = f.fix.trim().slice(0, 300);
    if (!title || !fixText || !f.detail.trim()) continue;
    const id = findingId(title);
    if (out.some((x) => x.id === id)) continue;
    out.push({
      id,
      kind: f.kind,
      title,
      detail: f.detail.trim().slice(0, 400),
      evidence: f.evidence.trim().slice(0, 300),
      fix: fixText,
    });
  }
  return out.slice(0, 5);
}

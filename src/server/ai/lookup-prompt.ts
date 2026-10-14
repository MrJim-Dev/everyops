import { z } from "zod";
import type { Blueprint } from "@/lib/blueprint/types";

/** The lookup step's answer: a line on what it found. The tool results themselves are what the assistant uses. */
export const lookupAnswer = z.object({
  note: z.string().describe("One short line: what you looked up, or why nothing was needed"),
});

export const LOOKUP_SYSTEM = `You fetch data for the EveryOps assistant, which runs a small business's records (bookings, sales,
staff and more). You get the record types, a digest of the data (counts and totals per record type, plus some
records), what the person is looking at, and the conversation. Another step writes the reply; your job is only to
call the tools so it has exact facts for the latest message.

- Call tools when the latest message needs numbers or records the digest doesn't already give exactly: filtered or
  grouped counts and totals ("GCash sales", "this week", "per court", "best seller": aggregate grouped by the line
  item's product field, sum of the quantity), specific records by name, code or date (search_records), or one record
  with its linked records such as an order's lines (get_record).
- Changes to records ("mark order #1002 as held", "delete Ana's booking") need the record's id: search for it.
- Make independent calls in the same round. Two or three calls are usually enough.
- Use field ids and option ids from the record types. Dates are YYYY-MM-DD in Manila time.
- Call nothing for greetings, design changes (new fields, pages, cards), navigation, or questions the digest answers.
Then return the note.`;

/** Record types with their fields, options and links: what the tools take as ids. */
export function describeTypes(bp: Blueprint): string {
  return bp.entities
    .map((e) => {
      const fields = e.fields.map((f) => {
        const extra = f.options?.length
          ? ` [${f.options.map((o) => (o.id === o.label ? o.id : `${o.id}=${o.label}`)).join(", ")}]`
          : f.relation
            ? ` → ${f.relation.entityId}`
            : f.formula
              ? ` = ${f.formula.resultType}`
              : "";
        return `${f.id} (${f.type}${extra})`;
      });
      return `- ${e.pluralName} (${e.id}), named by ${e.primaryFieldId}: ${fields.join("; ")}`;
    })
    .join("\n");
}

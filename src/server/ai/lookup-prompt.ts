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

- Always call tools for filtered numbers, date-scoped numbers and record edits, even if you can infer the answer from the digest. A zero option tally is not a substitute for checking the requested filters. Use tools for filtered or
  grouped counts and totals ("GCash sales", "this week", "per court", "best seller": aggregate grouped by the line
  item's product field, sum of the quantity), specific records by name, code or date (search_records), or one record
  with its linked records such as an order's lines (get_record).
- Changes to records ("mark order #1002 as held", "delete Ana's booking") need the record's id: search for it.
- When a named person or record has no matches, try one relevant spelling or relation lookup if needed, then stop. Never fetch an unfiltered list to replace a missing named record.
- Make independent calls in the same round. Two or three calls are usually enough.
- Use field ids and option ids from the record types. Dates are YYYY-MM-DD in Manila time.
- Never search a record type that does not exist in the supplied blueprint. Adding a new area to track coaches, clinics or another new kind of work is a design request, not a search for existing records.
- Call nothing for greetings, design changes (new fields, pages, cards), navigation, or general descriptions the digest answers.
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

const GREETING =
  /^(hi|hello|hey|yo|good (morning|afternoon|evening)|thanks|thank you|salamat|ok(ay)?|cool|great|nice|got it)\b[\s!.,]*$/i;
/** "Open the courts page", "take me to settings": navigation only. */
const NAVIGATE =
  /^(please\s+)?(open|go to|take me to|bring me to|show me)\s+(the\s+|my\s+)?[\w\s'&-]{1,40}?\s+(page|tab|settings|history)[\s.!]*$|^(please\s+)?(open|go to|take me to)\s+(settings|history|team|publish)[\s.!]*$/i;
/** A change to the design: fields, pages, tabs, cards, forms, the website. */
const DESIGN =
  /\b(add|create|make|rename|remove|delete|hide|show|move|reorder|put|change|turn)\b[^.?!]*\b(fields?|columns?|pages?|tabs?|cards?|charts?|forms?|automations?|sections?|website|landing page|headline|button|steps?|layout|dashboard|record types?|sidebar|a way to (track|manage))\b/i;
/** Telling the assistant something about the business ("heads up: we now close at 11"). */
const STATEMENT = /^(heads up|fyi|just so you know|for your info|note)\b[^?]*$/i;
/** Advice about the workspace ("what should I set up next?", "how do I share the booking page?"). */
const ADVICE =
  /^(what should|what else should|what can|how (do|can|should) (i|we)|can you (explain|help)|what('s| is) the best way|any (ideas|suggestions)|explain|help me)\b/i;
/** Something that points at particular records, amounts or dates. */
const DATA =
  /₱|\d|\b(today|yesterday|tomorrow|tonight|this (week|month|year)|last (week|month)|next (week|month)|unpaid|paid|overdue|pending|records?(?! types?))\b|\b[A-Z][a-z]+'s\b/;

/**
 * Whether a message can need looked-up data. Greetings, navigation, statements about the business and changes to the
 * design that don't point at particular records answer from the blueprint and digest alone; skipping the lookup there
 * saves a Gemini round (2 to 9 s). Anything else, or anything unclear, still gets the lookup.
 */
export function needsLookup(message: string): boolean {
  const text = message.trim();
  if (!text) return false;
  if (GREETING.test(text) || NAVIGATE.test(text) || STATEMENT.test(text)) return false;
  if (ADVICE.test(text) && !DATA.test(text)) return false;
  if (DESIGN.test(text) && !DATA.test(text)) return false;
  return true;
}

/** Scoped facts need fresh query evidence, even when the digest appears to imply zero. */
export function requiresLookupEvidence(message: string): boolean {
  return (
    needsLookup(message) &&
    (DATA.test(message) || /how (many|much)|total|revenue|collected|magkano|ilan|gcash|maya/i.test(message))
  );
}

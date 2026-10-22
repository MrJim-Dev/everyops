import { z } from "zod";
import type { Blueprint } from "@/lib/blueprint/types";

/** The lookup step's answer: a line on what it found. The tool results themselves are what the assistant uses. */
export const lookupAnswer = z.object({
  note: z.string().describe("One short line: what you looked up, or why nothing was needed"),
});

/** The answer when outside servers are connected: their writes can only be proposed, never called. */
export const lookupAnswerWithActions = lookupAnswer.extend({
  actions: z
    .array(
      z.object({
        tool: z.string().describe("A proposable outside write tool name, e.g. calendar__create_event"),
        arguments: z.string().describe("The tool's arguments as a JSON object string"),
        summary: z
          .string()
          .describe(
            "One line the person reads before approving, e.g. 'Add Court 3 hold to your calendar, Fri 6-7 PM'",
          ),
      }),
    )
    .max(3)
    .optional()
    .describe(
      "Outside changes the person asked for, for them to approve; leave out unless they asked for one",
    ),
});

/** What the lookup is told about connected outside services. */
export function outsideSystem(providers: string[], proposable: string[], notes: string[]): string {
  return `

Connected outside services: ${providers.join(", ") || "none reachable"}.${notes.length ? ` ${notes.join(" ")}` : ""}
- Their read tools (named like calendar__list_events) are yours to call when the message needs outside facts, e.g.
  checking bookings against the calendar: fetch the bookings (search_records) and the calendar events for the same
  dates in the same round. EveryOps times are on the workspace's clock (the time zone and UTC offset given with
  Today); pass RFC 3339 times with that offset.
- You never change anything outside EveryOps. When the person asks for an outside change (add an event, draft an
  email), put it in actions with the tool's name, its arguments as a JSON object string and a one-line summary; the
  person approves it before it runs. Proposable tools:
${proposable.join("\n") || "- none"}`;
}

/** Messages that point at a connected outside service; with one connected, they always get a lookup. */
export const OUTSIDE_WORDS =
  /\b(calendar|gcal|gmail|e-?mails?|inbox|mail|events?|meetings?|appointments?|free time|busy|clash(es)?|conflicts?|drafts?)\b/i;

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
- Use field ids and option ids from the record types. Dates are YYYY-MM-DD on the workspace's clock.
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
  /\b(add|create|make|rename|remove|delete|hide|show|move|reorder|put|change|turn)\b[^.?!]*\b(fields?|columns?|pages?|tabs?|cards?|charts?|forms?|automations?|sections?|website|landing page|headline|button|steps?|layout|dashboard|record types?|sidebar|a way to (track|manage)|phone|e-?mail|file|contract|rollup|count)\b/i;
/** Telling the assistant something about the business ("heads up: we now close at 11"). */
const STATEMENT = /^(heads up|fyi|just so you know|for your info|note)\b[^?]*$/i;
/**
 * How the workspace should behave, often as a bug report: "the stock doesn't go up and the received qty stays 0, make
 * it add…", "stock movements must never change a job order's quantity". Its numbers and names describe the behavior,
 * not records to check, so a lookup that rightly finds nothing to fetch isn't a failure. Two such reports on
 * production were refused with "I couldn't verify the records" before anything was planned.
 */
const BEHAVIOR =
  /\b(fix|should(n't| not)?|must( not)?|never|always|instead|automatically|doesn'?t|does not|don'?t|do not|isn'?t|is not|aren'?t|won'?t|wrong|broken|not working|stays|keeps)\b/i;
/**
 * Setting up an automation describes what happens later ("every Monday at 8 AM, email players with unpaid
 * bookings"): its times, days and statuses are settings, not facts to check, so it needs no lookup unless it also
 * asks for a number or ends as a question.
 */
const AUTOMATION =
  /\b(automations?|automatically|every (day|morning|afternoon|evening|night|week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|each (morning|day|week|month)|daily|weekly|monthly|(the )?(day|days|week|hours?) (before|after)|send (an? )?(email|reminder)|email (each|every|all|them|the)|remind (each|every|all|them|the|players?|customers?|clients?|guests?|members?))\b/i;
const ASKS = /how (many|much)|\btotal\b|revenue|collected|magkano|ilan|\?\s*$/i;
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
  if (AUTOMATION.test(text) && !ASKS.test(text)) return false;
  if (ADVICE.test(text) && !DATA.test(text)) return false;
  if (DESIGN.test(text) && !DATA.test(text)) return false;
  return true;
}

/**
 * Scoped facts need fresh query evidence, even when the digest appears to imply zero. A change to the design ("add a
 * count of paid bookings to players") still gets a lookup but doesn't need one: its statuses and numbers are
 * settings, and Gemini rightly calls nothing for it.
 */
export function requiresLookupEvidence(message: string): boolean {
  if (DESIGN.test(message) && !/how (many|much)|\?\s*$/i.test(message)) return false;
  if (BEHAVIOR.test(message) && !/how (many|much)|\?\s*$/i.test(message)) return false;
  return (
    needsLookup(message) &&
    (DATA.test(message) || /how (many|much)|total|revenue|collected|magkano|ilan|gcash|maya/i.test(message))
  );
}

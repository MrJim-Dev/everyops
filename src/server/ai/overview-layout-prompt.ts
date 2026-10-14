import { z } from "zod";
import { displayKind } from "@/lib/blueprint/field-kind";
import type { Blueprint } from "@/lib/blueprint/types";
import { COMPONENTS, catalogText } from "@/lib/components/registry";
import { FUNCTIONS } from "@/lib/engine/expr";

/**
 * Setup's last step: the new workspace's Overview page as a layout of library components. A small schema on purpose:
 * each component's settings come back as JSON text (parseLayout reads them), so the schema stays far from Gemini's
 * structural limit however many components the library grows to.
 */
export const overviewRequest = z.object({
  sections: z
    .array(
      z.object({
        title: z.string(),
        columns: z.number().describe("1 to 4"),
        items: z.array(
          z.object({
            component: z.enum(
              COMPONENTS.filter((c) => c.id !== "form").map((c) => c.id) as [string, ...string[]],
            ),
            span: z.number().describe("1 to 4; 0 for the default"),
            props: z.string().describe("The component's settings as a JSON object"),
          }),
        ),
      }),
    )
    .describe("3 to 5 sections"),
});
export type OverviewRequest = z.infer<typeof overviewRequest>;

export const OVERVIEW_SYSTEM = `You arrange the Overview page of a new EveryOps workspace: the page the owner opens every morning. You pick components
from EveryOps's library and fill in their settings; you never write code or invent ids.

What makes a good Overview:
- First section "Today" (or "This week" for businesses that don't run day by day): stat_cards with 3 or 4 key numbers
  the owner checks first (bookings or orders today, revenue this week or month, unpaid or pending items). Give stats a
  compare {dateFieldId, period} by the main date field when there is one.
- Then how the business is going: chart_interactive of the main money total over time (sum of the money field, by the
  main date field, only paid or completed records), next to a breakdown (chart_pie or leaderboard by a category or
  resource link, or status_overview of the main workflow's status).
- Then what needs attention: a list or table of pending, unpaid or upcoming records (filtered), and the workspace's
  existing agenda or heatmap cards with the widget component (widgetId) when they exist.
- 3 to 5 sections with short titles. columns 1 to 4; wide components (stat_cards, tables, chart_interactive) fill the row.
- Only record type ids, field ids, option ids and card ids listed below. Sums and averages use number or money fields;
  dates use date, datetime or time range fields; status_overview uses a status field; groupBy uses select, status or
  link fields.
- Filters use EveryOps formulas: field ids, 'strings', == != < > && || !, option ids for status and select values
  (status == 'paid'), and functions: ${Object.keys(FUNCTIONS).join(", ")}. is_today(slot), is_this_month(date),
  is_upcoming(start) test dates.
- props is the component's settings as JSON text, e.g. {"title":"Revenue","entityId":"booking","op":"sum",
  "fieldId":"amount","filter":"status == 'paid'","dateFieldId":"slot"}.

Components (settings marked ? are optional):
${catalogText()}`;

/** The workspace as the layout step reads it: record types with their fields, and the cards and tabs it has. */
export function overviewContext(bp: Blueprint, name: string, brief: string, today: string): string {
  const entities = bp.entities
    .map((e) => {
      const fields = e.fields
        .map((f) => {
          const kind = displayKind(bp, f);
          const link = f.relation ? ` → ${f.relation.entityId}` : "";
          const options = f.options?.length ? ` [${f.options.map((o) => o.id).join(", ")}]` : "";
          return `${f.id} (${kind}${link}${options})`;
        })
        .join(", ");
      return `- ${e.id} "${e.pluralName}"${e.parent ? " (line items)" : ""}: ${fields}`;
    })
    .join("\n");
  const cards = bp.widgets.map((w) => `- ${w.id}: ${w.type} "${w.title}"`).join("\n");
  const tabs = bp.views
    .filter((v) => v.type !== "landing" && v.type !== "html" && v.type !== "document" && v.type !== "canvas")
    .map((v) => `- ${v.id}: ${v.type}${v.entityId ? ` of ${v.entityId}` : ""} "${v.name}"`)
    .join("\n");
  return `Business: ${name}
Today in Manila: ${today}

What the owner asked for:
${brief.slice(0, 2500)}

Record types (field id (kind → linked type [option ids])):
${entities}

Existing dashboard cards (widget component):
${cards || "none"}

Tabs (for button and table viewId):
${tabs || "none"}`;
}

import { displayKind } from "@/lib/blueprint/field-kind";
import type { Blueprint, Widget } from "@/lib/blueprint/types";

/** The colours a dashboard widget can wear, one per chart token (see docs/system-color-design.md). */
export type LookTone = "teal" | "violet" | "amber" | "blue" | "rose";
export type LookIcon =
  | "money"
  | "alert"
  | "expense"
  | "calendar"
  | "people"
  | "orders"
  | "stock"
  | "percent"
  | "clock"
  | "check"
  | "star"
  | "trend"
  | "count";

export type WidgetLook = { icon: LookIcon; tone: LookTone };

/** Read in order: the first match wins, so "Unpaid bookings" is a warning before it is a booking. */
const RULES: [RegExp, WidgetLook][] = [
  [
    /unpaid|overdue|\blate\b|\bdue\b|\bowed\b|balance|outstanding|low.?stock|out of stock|pending|waiting|awaiting|unassigned|open tickets?/i,
    { icon: "alert", tone: "amber" },
  ],
  [/expense|cost|spend|payroll|salar|bills?\b|refund|cancel|declin|lost/i, { icon: "expense", tone: "rose" }],
  [
    /revenue|sales|income|collected|earn|paid|payments?|deposit|profit|cash|gcash|amount|total/i,
    { icon: "money", tone: "teal" },
  ],
  [/occupan|utili[sz]|rate\b|ratio|percent|share|conversion|%/i, { icon: "percent", tone: "violet" }],
  [/hours?|minutes?|duration|time\b|shift|attendance/i, { icon: "clock", tone: "blue" }],
  [
    /booking|reservation|appointment|schedule|check.?ins?|stays?|sessions?|classes|visits?|today|upcoming|this week/i,
    { icon: "calendar", tone: "blue" },
  ],
  [
    /customer|guest|client|member|player|patient|student|employee|staff|people|visitor|leads?|contacts?|team/i,
    { icon: "people", tone: "violet" },
  ],
  [
    /order|ticket|sold|transaction|receipt|invoice|jobs?\b|projects?|tasks?/i,
    { icon: "orders", tone: "teal" },
  ],
  [/stock|inventory|items?|products?|supplies|materials?|units?/i, { icon: "stock", tone: "amber" }],
  [/done|complete|approved|confirmed|finished|closed/i, { icon: "check", tone: "teal" }],
  [/rating|review|score|satisf|top|best/i, { icon: "star", tone: "amber" }],
];

const ROTATION: LookTone[] = ["teal", "blue", "violet", "amber", "rose"];

/**
 * An icon and colour for a dashboard widget, from what it measures: its title first, then the field it adds up.
 * Money reads teal, things needing attention amber, costs rose, schedules blue and people violet; anything else
 * takes a colour by its place on the dashboard so neighbours differ.
 */
export function widgetLook(bp: Blueprint, widget: Widget, index?: number): WidgetLook {
  let at = index ?? 0;
  if (index === undefined) for (const c of widget.id) at = (at * 31 + c.charCodeAt(0)) >>> 0;
  const field = widget.metric.fieldId
    ? bp.entities.find((e) => e.id === widget.entityId)?.fields.find((f) => f.id === widget.metric.fieldId)
    : undefined;
  const entity = bp.entities.find((e) => e.id === widget.entityId);
  for (const text of [widget.title, field?.name ?? "", entity?.pluralName ?? ""]) {
    const hit = RULES.find(([re]) => re.test(text));
    if (hit) return hit[1];
  }
  if (field && displayKind(bp, field) === "money") return { icon: "money", tone: "teal" };
  if (widget.type === "chart") return { icon: "trend", tone: ROTATION[at % ROTATION.length] };
  return { icon: "count", tone: ROTATION[at % ROTATION.length] };
}

/** The CSS colour for a tone. */
export const TONE_COLOR: Record<LookTone, string> = {
  teal: "var(--chart-1)",
  violet: "var(--chart-2)",
  amber: "var(--chart-3)",
  blue: "var(--chart-4)",
  rose: "var(--chart-5)",
};

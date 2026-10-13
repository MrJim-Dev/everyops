import "server-only";
import { z } from "zod";
import { FUNCTIONS } from "@/lib/engine/expr";

const TONES = ["neutral", "accent", "warning", "danger", "success"] as const;
const ICONS = [
  "calendar",
  "court",
  "users",
  "user",
  "receipt",
  "storefront",
  "package",
  "chart",
  "wallet",
  "megaphone",
  "image",
  "briefcase",
  "airplane",
  "house",
  "key",
  "gauge",
] as const;
const FIELD_TYPES = [
  "text",
  "long_text",
  "number",
  "money",
  "percent",
  "date",
  "datetime",
  "time_range",
  "select",
  "multi_select",
  "status",
  "person",
  "relation",
  "checkbox",
  "formula",
  "rollup",
] as const;

const option = z.object({ id: z.string(), label: z.string(), tone: z.enum(TONES) });
const sort = z.object({ fieldId: z.string(), dir: z.enum(["asc", "desc"]) });

const field = z.object({
  id: z.string().describe("snake_case, unique within the record type"),
  name: z.string(),
  type: z.enum(FIELD_TYPES),
  required: z.boolean().optional(),
  description: z.string().optional(),
  options: z.array(option).optional().describe("Required for select, multi_select and status"),
  range: z
    .enum(["dates", "times"])
    .optional()
    .describe("time_range only: whole days (stays, leave) or clock times (bookings)"),
  relation: z.object({ entityId: z.string() }).optional().describe("relation only: the linked record type"),
  formula: z
    .object({
      expr: z.string(),
      resultType: z.enum(["number", "money", "text", "checkbox", "date"]),
      freezeWhen: z.string().optional(),
    })
    .optional()
    .describe("formula only"),
  rollup: z
    .object({
      childEntityId: z.string(),
      viaFieldId: z.string().describe("the relation field on the child that points back here"),
      op: z.enum(["sum", "count", "min", "max", "avg"]),
      fieldId: z.string().optional(),
    })
    .optional()
    .describe("rollup only"),
});

const entity = z.object({
  id: z.string().describe("snake_case singular, e.g. task"),
  name: z.string(),
  pluralName: z.string(),
  primaryFieldId: z.string().describe("the field that names a record, usually 'name' or 'title'"),
  fields: z.array(field),
  parent: z
    .object({ entityId: z.string(), fieldId: z.string() })
    .optional()
    .describe("Line items: the parent record type and the relation field to it"),
  booking: z
    .object({
      resourceFieldId: z.string(),
      timeFieldId: z.string(),
      statusFieldId: z.string(),
      blockingStatuses: z.array(z.string()),
    })
    .optional()
    .describe(
      "Bookings only: relation to the bookable resource, its time_range field, status, and statuses that block a slot",
    ),
  resource: z
    .object({ opensAt: z.string(), closesAt: z.string(), slotMinutes: z.number() })
    .optional()
    .describe("Bookable resources only (courts, rooms): opening hours HH:MM and slot length 15/30/60/90/120"),
});

const view = z.object({
  id: z.string(),
  entityId: z.string(),
  name: z.string(),
  type: z.enum(["table", "kanban", "calendar", "slot_grid", "checkout", "approval_queue"]),
  fieldIds: z.array(z.string()).optional().describe("table: columns"),
  filter: z.string().optional().describe("table, kanban, calendar: formula that keeps matching records"),
  sort: z.array(sort).optional().describe("table"),
  statusFieldId: z.string().optional().describe("kanban, approval_queue: a status field"),
  cardFieldIds: z.array(z.string()).optional().describe("kanban: fields shown on cards"),
  dateFieldId: z.string().optional().describe("calendar: date, datetime or time_range field"),
  titleFieldId: z.string().optional().describe("calendar"),
  productEntityId: z.string().optional().describe("checkout: products; the view's entity is the order"),
  lineEntityId: z.string().optional().describe("checkout: order line items"),
  paymentFieldId: z.string().optional().describe("checkout: payment method field on the order"),
  pending: z.string().optional().describe("approval_queue: option id waiting for a decision"),
  approve: z.string().optional().describe("approval_queue: option id when approved"),
  reject: z.string().optional().describe("approval_queue: option id when declined"),
  approveLabel: z.string().optional(),
  rejectLabel: z.string().optional(),
  detailFieldIds: z.array(z.string()).optional().describe("approval_queue"),
});

const widget = z.object({
  id: z.string(),
  title: z.string(),
  entityId: z.string(),
  filter: z.string().optional(),
  type: z.enum(["stat", "chart", "progress", "list"]),
  metric: z.object({ op: z.enum(["count", "sum", "avg"]), fieldId: z.string().optional() }),
  chart: z
    .object({
      kind: z.enum(["line", "bar"]),
      dateFieldId: z.string(),
      bucket: z.enum(["day", "week", "month"]),
    })
    .optional(),
  target: z.number().optional().describe("progress only"),
  list: z
    .object({
      fieldIds: z.array(z.string()),
      limit: z.number(),
      viewId: z.string().optional(),
      sort: z.array(sort).optional(),
    })
    .optional(),
  span: z.enum(["main", "side"]).optional(),
});

const target = z.object({ kind: z.enum(["self", "relation"]), fieldId: z.string().optional() });
const rule = z.object({
  id: z.string(),
  name: z.string(),
  trigger: z.object({
    entityId: z.string(),
    event: z.enum(["created", "updated", "status_changed"]),
    fieldId: z.string().optional(),
    to: z.string().optional().describe("status_changed: the option id it changed to"),
  }),
  when: z.string().optional(),
  actions: z.array(
    z.object({
      type: z.enum(["set_field", "adjust_number", "notify"]),
      target: target.optional(),
      fieldId: z.string().optional(),
      value: z.string().optional().describe("set_field: formula for the new value"),
      delta: z.string().optional().describe("adjust_number: formula, e.g. -qty"),
      message: z.string().optional().describe("notify"),
    }),
  ),
});

const system = z.object({
  id: z.string(),
  name: z.string(),
  icon: z.enum(ICONS),
  viewIds: z.array(z.string()),
  widgetIds: z.array(z.string()),
});

export const design = z.object({
  workspaceName: z.string(),
  summary: z.string().describe("3 to 6 words for the workspace list, e.g. 'Projects and tasks'"),
  systems: z
    .array(system)
    .describe("Sidebar sections. Start with an Overview system holding the dashboard widgets."),
  entities: z.array(entity),
  views: z.array(view),
  widgets: z.array(widget),
  rules: z.array(rule),
  samples: z
    .array(
      z.object({
        ref: z.string().describe("short unique id for this sample record, used by relation values"),
        entityId: z.string(),
        values: z.array(
          z.object({
            fieldId: z.string(),
            value: z
              .string()
              .describe(
                "number/money as digits; checkbox true/false; select/status the option id; multi_select ids joined by commas; relation the ref of the linked sample; date YYYY-MM-DD; datetime YYYY-MM-DDTHH:MM; time_range start/end with the same formats",
              ),
          }),
        ),
      }),
    )
    .describe(
      "3 to 5 realistic sample records for each main record type (up to 24 in total). Never give values for formula or rollup fields.",
    ),
});
export type Design = z.infer<typeof design>;

export const DESIGN_SYSTEM = `You design EveryOps workspaces. A workspace is a JSON blueprint that one generic engine renders,
so you only describe data, screens, dashboards and rules; you never write code. You get a brief from the setup interview
and return the complete blueprint plus sample records.

Formula language (formula.expr, freezeWhen, filters, rule conditions and values):
- Field references by id on the same record (rate, qty); through a relation field: player.member, product.price.
- Numbers, 'strings', true, false, null. Operators: + - * / % == != < <= > >= && || ! and cond ? a : b.
- Functions: ${Object.keys(FUNCTIONS).join(", ")}. hour/weekday read Asia/Manila time (weekday 0 = Sunday);
  duration_hours(range) and days(range) measure time ranges; is_today, is_this_month, is_upcoming test dates.
- Status and select values compare against option ids: status == 'done'.

Rules for a valid blueprint:
- Every id referenced (fields, entities, views, widgets, options) must exist. Ids are snake_case.
- Each record type has a primary field (a text field) and only the fields it needs.
- select, multi_select and status fields need options. Use status for workflows (kanban boards, approvals).
- relation fields set relation.entityId. rollup fields sum/count child records through the child's relation field.
- Kanban boards use a status field. Calendars use a date, datetime or time_range field.
- A booking schedule (slot_grid) needs a bookable resource type (with resource hours) and a booking type with
  booking.resourceFieldId (relation to the resource), booking.timeFieldId (time_range with range "times") and
  booking.statusFieldId. Only use it for bookings of courts, rooms or similar.
- checkout needs product, order and line-item types (line items have parent set to the order). Only for selling.
- Every system lists at least one view or widget. Put an Overview system first with 3 to 6 widgets.
- Money is PHP. Use realistic Filipino business details in samples, dated around today.

The two examples below are valid blueprints from EveryOps's template library. Follow their conventions.`;

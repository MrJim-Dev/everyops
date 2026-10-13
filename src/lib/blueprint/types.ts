/**
 * Blueprint: the typed description of every system inside a workspace.
 * One generic engine and one set of views render any blueprint, so a client
 * "system" is configuration only. Shapes follow the EveryOps design spec §4.
 */

export type IconName =
  | "calendar"
  | "court"
  | "users"
  | "user"
  | "receipt"
  | "storefront"
  | "package"
  | "chart"
  | "wallet"
  | "megaphone"
  | "image"
  | "briefcase"
  | "airplane"
  | "house"
  | "key"
  | "gauge";

export type Tone = "neutral" | "accent" | "warning" | "danger" | "success";

export type FieldType =
  | "text"
  | "long_text"
  | "number"
  | "money"
  | "percent"
  | "date"
  | "datetime"
  | "time_range"
  | "select"
  | "multi_select"
  | "status"
  | "person"
  | "relation"
  | "checkbox"
  | "formula"
  | "rollup";

export type FieldOption = { id: string; label: string; tone: Tone };

export type Field = {
  id: string;
  name: string;
  type: FieldType;
  required?: boolean;
  description?: string;
  options?: FieldOption[];
  /** For time_range fields: whole days (stays, leave) or clock times (bookings). Defaults to "times". */
  range?: "dates" | "times";
  relation?: { entityId: string };
  formula?: {
    expr: string;
    resultType: "number" | "money" | "text" | "checkbox" | "date";
    /** When true for a record, its stored value is kept as is (e.g. paid bookings). */
    freezeWhen?: string;
  };
  rollup?: {
    childEntityId: string;
    viaFieldId: string;
    op: "sum" | "count" | "min" | "max" | "avg";
    fieldId?: string;
  };
};

export type Entity = {
  id: string;
  name: string;
  pluralName: string;
  primaryFieldId: string;
  fields: Field[];
  parent?: { entityId: string; fieldId: string };
  booking?: {
    resourceFieldId: string;
    timeFieldId: string;
    statusFieldId: string;
    blockingStatuses: string[];
  };
  resource?: {
    opensAt: string;
    closesAt: string;
    slotMinutes: 15 | 30 | 60 | 90 | 120;
  };
};

export type Sort = { fieldId: string; dir: "asc" | "desc" };

type ViewBase = { id: string; entityId: string; name: string };

export type TableView = ViewBase & {
  type: "table";
  fieldIds: string[];
  filter?: string;
  sort?: Sort[];
};
export type KanbanView = ViewBase & {
  type: "kanban";
  statusFieldId: string;
  cardFieldIds: string[];
  filter?: string;
};
export type CalendarView = ViewBase & {
  type: "calendar";
  dateFieldId: string;
  titleFieldId: string;
  filter?: string;
};
export type SlotGridView = ViewBase & { type: "slot_grid" };
export type CheckoutView = ViewBase & {
  type: "checkout";
  productEntityId: string;
  lineEntityId: string;
  paymentFieldId: string;
};
export type ApprovalQueueView = ViewBase & {
  type: "approval_queue";
  statusFieldId: string;
  pending: string;
  approve: string;
  reject: string;
  /** Button verbs, e.g. "Approve" and "Decline". */
  approveLabel: string;
  rejectLabel: string;
  detailFieldIds: string[];
};

export type View = TableView | KanbanView | CalendarView | SlotGridView | CheckoutView | ApprovalQueueView;

export type ViewType = View["type"];

export type Widget = {
  id: string;
  title: string;
  entityId: string;
  filter?: string;
  type: "stat" | "chart" | "progress" | "list";
  metric: { op: "count" | "sum" | "avg"; fieldId?: string };
  chart?: {
    kind: "line" | "bar";
    dateFieldId: string;
    bucket: "day" | "week" | "month";
    /** Optional second series, e.g. expenses next to revenue. */
    splitByFieldId?: string;
  };
  target?: number;
  /** For list widgets: which fields to show, their order, and where "View all" goes. */
  list?: { fieldIds: string[]; limit: number; viewId?: string; sort?: Sort[] };
  /** Layout hint for dashboards. Defaults: charts in the main column, lists and progress at the side. */
  span?: "main" | "side";
};

export type Target = { kind: "self" } | { kind: "relation"; fieldId: string };

export type Action =
  | { type: "set_field"; target: Target; fieldId: string; value: string }
  | { type: "adjust_number"; target: Target; fieldId: string; delta: string }
  | { type: "notify"; message: string };

export type Rule = {
  id: string;
  name: string;
  trigger: {
    entityId: string;
    event: "created" | "updated" | "status_changed";
    fieldId?: string;
    to?: string;
  };
  when?: string;
  actions: Action[];
};

export type System = {
  id: string;
  name: string;
  icon: IconName;
  viewIds: string[];
  widgetIds: string[];
};

export type Blueprint = {
  version: number;
  workspaceName: string;
  systems: System[];
  entities: Entity[];
  views: View[];
  widgets: Widget[];
  rules: Rule[];
};

/* ---------- Records ---------- */

export type TimeRange = { start: string; end: string };

export type FieldValue = string | number | boolean | null | string[] | TimeRange;

export type RecordData = Record<string, FieldValue>;

export type DataRecord = {
  id: string;
  entityId: string;
  data: RecordData;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceData = {
  blueprint: Blueprint;
  records: DataRecord[];
};

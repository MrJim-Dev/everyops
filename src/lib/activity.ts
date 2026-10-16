/**
 * The activity log's shared vocabulary: who can act (actor types), what they did (actions), how it went (results),
 * and how an entry reads in the app and in a CSV export. The server writes entries (src/server/activity.ts).
 */

export const ACTOR_TYPES = [
  "person",
  "api_key",
  "mcp_client",
  "automation",
  "public_form",
  "booking_link",
] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

export const ACTOR_LABELS: Record<ActorType, string> = {
  person: "Person",
  api_key: "API key",
  mcp_client: "AI agent (MCP)",
  automation: "Automation",
  public_form: "Public form",
  booking_link: "Booking link",
};

export const RESULTS = ["ok", "denied", "conflict", "error"] as const;
export type ActivityResult = (typeof RESULTS)[number];

/** Actions, with the verb an entry reads with ("Added 2 bookings"). */
export const ACTIONS = {
  "record.create": "Added",
  "record.update": "Changed",
  "record.delete": "Deleted",
  "page.update": "Edited page",
  "design.version": "Changed the design",
  "change.propose": "Proposed a change",
  "automation.run": "Ran automation",
  "mcp.tool_call": "Used tool",
  "api.denied": "Was refused",
  "key.create": "Created API key",
  "key.revoke": "Revoked API key",
  "connection.create": "Connected",
  "connection.revoke": "Disconnected",
  "outside.read": "Looked up",
  "outside.action": "Ran outside action",
} as const;
export type Action = keyof typeof ACTIONS;

export type ActivityItem = {
  id: number;
  at: string;
  workspaceId: string | null;
  actorType: ActorType;
  actorId: string | null;
  actorName: string | null;
  keyId: string | null;
  action: Action;
  target: string | null;
  ids: string[];
  count: number;
  result: ActivityResult;
  detail: string | null;
  ip: string | null;
  userAgent: string | null;
};

/** What a refused or failed record write was trying to do. */
const TRIED: Partial<Record<Action, string>> = {
  "record.create": "Tried to add",
  "record.update": "Tried to change",
  "record.delete": "Tried to delete",
};

/**
 * What an entry did, in a few words: "Added 2 bookings", "Changed booking BO-1001", "Tried to add booking",
 * "Used tool search_records". title names one record when the caller still has it.
 */
export function describeActivity(
  item: ActivityItem,
  typeName?: (id: string, many: boolean) => string,
  title?: (id: string) => string | undefined,
): string {
  const verb = (item.result !== "ok" && TRIED[item.action]) || ACTIONS[item.action] || item.action;
  const n = item.count || item.ids.length;
  if (item.action.startsWith("record.") && item.target) {
    const name = typeName ? typeName(item.target, n !== 1) : item.target;
    const one = n === 1 && item.ids[0] ? title?.(item.ids[0]) : undefined;
    return `${verb} ${n > 1 ? `${n} ` : ""}${name}${one ? ` ${one}` : ""}`;
  }
  if (item.action === "api.denied") return `${verb}${item.detail ? `: ${item.detail}` : ""}`;
  return item.target ? `${verb} ${item.target}` : verb;
}

const cell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  // Quote anything with a delimiter, quote or line break; neutralise spreadsheet formulas (=, +, -, @).
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
};

/** The log as CSV, one row per entry, times in ISO 8601 (UTC). */
export function activityCsv(items: ActivityItem[]): string {
  const head = [
    "time",
    "actor_type",
    "actor",
    "key_id",
    "action",
    "target",
    "records",
    "count",
    "result",
    "detail",
    "ip",
  ];
  const rows = items.map((i) =>
    [
      i.at,
      i.actorType,
      i.actorName,
      i.keyId,
      i.action,
      i.target,
      i.ids.join(" "),
      i.count,
      i.result,
      i.detail,
      i.ip,
    ]
      .map(cell)
      .join(","),
  );
  return `${[head.join(","), ...rows].join("\r\n")}\r\n`;
}

/** How long entries are kept. */
export const RETENTION_DAYS = 180;

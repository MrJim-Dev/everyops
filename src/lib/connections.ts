/**
 * Outside MCP servers a workspace can connect (the reverse of the EveryOps MCP server): a short, vetted list, each
 * with the Google OAuth scopes it needs, the read tools Ask EveryOps may call while looking things up, and the write
 * tools it may only propose (they run after an owner or admin presses Apply). Tools a server offers that aren't
 * listed here are never used, so a server adding a new tool can't widen what EveryOps does.
 */

export const PROVIDERS = {
  google_calendar: {
    name: "Google Calendar",
    short: "calendar",
    description:
      "Check bookings against your calendar, find free time, and propose events for you to approve.",
    mcpUrl: "https://calendarmcp.googleapis.com/mcp/v1",
    scopes: [
      "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
      "https://www.googleapis.com/auth/calendar.events.freebusy",
      "https://www.googleapis.com/auth/calendar.events.readonly",
      "https://www.googleapis.com/auth/calendar.events",
    ],
    readTools: ["list_calendars", "list_events", "get_event", "search_events", "suggest_time"],
    writeTools: ["create_event", "update_event", "delete_event"],
  },
  gmail: {
    name: "Gmail",
    short: "gmail",
    description:
      "Find customer emails about a booking or order, and draft replies for you to review in Gmail.",
    mcpUrl: "https://gmailmcp.googleapis.com/mcp/v1",
    scopes: [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.compose",
    ],
    readTools: ["search_threads", "get_thread", "get_message", "list_labels", "list_drafts"],
    writeTools: ["create_draft"],
  },
} as const;

export type ProviderId = keyof typeof PROVIDERS;
export const PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderId[];

export const isProvider = (v: unknown): v is ProviderId => typeof v === "string" && v in PROVIDERS;

/** The name Gemini sees for an outside tool: "calendar__list_events". */
export const toolName = (provider: ProviderId, tool: string) => `${PROVIDERS[provider].short}__${tool}`;

/** The provider and tool behind a Gemini tool name, or null when it isn't a connected outside tool. */
export function splitToolName(name: string): { provider: ProviderId; tool: string } | null {
  const [short, tool] = name.split("__");
  const provider = PROVIDER_IDS.find((p) => PROVIDERS[p].short === short);
  return provider && tool ? { provider, tool } : null;
}

export const canRead = (provider: ProviderId, tool: string) =>
  (PROVIDERS[provider].readTools as readonly string[]).includes(tool);
export const canPropose = (provider: ProviderId, tool: string) =>
  (PROVIDERS[provider].writeTools as readonly string[]).includes(tool);

const KEEP = new Set([
  "type",
  "description",
  "properties",
  "required",
  "items",
  "enum",
  "format",
  "minimum",
  "maximum",
  "minItems",
  "maxItems",
  "nullable",
  "anyOf",
  "default",
]);

/**
 * An MCP tool's input schema in the subset Gemini's function declarations accept: no $schema, $ref, $defs,
 * additionalProperties or oneOf; nested objects and arrays kept; depth capped so a huge schema can't blow the request.
 */
export function geminiSchema(schema: unknown, depth = 0): Record<string, unknown> {
  if (!schema || typeof schema !== "object" || Array.isArray(schema) || depth > 6) return { type: "object" };
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
    if (!KEEP.has(key)) continue;
    if (key === "properties" && value && typeof value === "object")
      out.properties = Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, geminiSchema(v, depth + 1)]),
      );
    else if (key === "items") out.items = geminiSchema(value, depth + 1);
    else if (key === "anyOf" && Array.isArray(value))
      out.anyOf = value.map((v) => geminiSchema(v, depth + 1));
    else if (key === "type" && Array.isArray(value)) {
      // ["string", "null"] → string, nullable
      const types = value.filter((t) => t !== "null");
      out.type = types[0] ?? "string";
      if (types.length < value.length) out.nullable = true;
    } else out[key] = value;
  }
  if (!out.type && !out.anyOf) out.type = out.properties ? "object" : "string";
  return out;
}

/** An outside write waiting for approval, as the chat and settings show it. */
export type OutsideAction = {
  id: number;
  provider: ProviderId;
  tool: string;
  summary: string;
  args: Record<string, unknown>;
  status: "proposed" | "applied" | "dismissed" | "failed";
  result?: string | null;
};

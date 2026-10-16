/**
 * A stand-in for Google's Calendar MCP server (calendarmcp.googleapis.com) for checking Connections locally: the same
 * tool names, Streamable HTTP with a session id, tool results as server-sent events. It logs every call, so a check can
 * prove a write ran only after Apply.
 *
 *   node scripts/fake-calendar-mcp.mts [port]      # then OUTSIDE_MCP_URL_GOOGLE_CALENDAR=http://localhost:4010/mcp
 */
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

type Event = { id: string; summary: string; start: string; end: string; location?: string };

const events: Event[] = [
  {
    id: "ev1",
    summary: "Supplier meeting (Yonex rep)",
    start: "2026-10-14T17:30:00+08:00",
    end: "2026-10-14T18:30:00+08:00",
  },
  { id: "ev2", summary: "Dentist", start: "2026-10-16T15:00:00+08:00", end: "2026-10-16T16:00:00+08:00" },
  {
    id: "ev3",
    summary: "Barangay permit renewal",
    start: "2026-10-19T09:00:00+08:00",
    end: "2026-10-19T10:00:00+08:00",
  },
];

const time = { type: "string", description: "RFC 3339 time, e.g. 2026-10-12T00:00:00+08:00" };
const TOOLS = [
  {
    name: "list_calendars",
    description: "Lists the user's calendars.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_events",
    description: "Lists events on a calendar between two times.",
    inputSchema: {
      type: "object",
      properties: {
        calendarId: { type: "string", default: "primary" },
        timeMin: time,
        timeMax: time,
        q: { type: "string" },
      },
      required: ["timeMin", "timeMax"],
    },
  },
  {
    name: "get_event",
    description: "Gets one event.",
    inputSchema: { type: "object", properties: { eventId: { type: "string" } }, required: ["eventId"] },
  },
  {
    name: "create_event",
    description: "Creates an event on a calendar.",
    inputSchema: {
      type: "object",
      properties: {
        calendarId: { type: "string" },
        summary: { type: "string" },
        start: time,
        end: time,
        location: { type: "string" },
      },
      required: ["summary", "start", "end"],
    },
  },
  {
    name: "delete_event",
    description: "Deletes an event.",
    inputSchema: { type: "object", properties: { eventId: { type: "string" } } },
  },
  {
    name: "send_invites_to_everyone",
    description: "Not vetted: EveryOps must never call this.",
    inputSchema: { type: "object" },
  },
];

function call(name: string, args: Record<string, unknown>) {
  if (name === "list_calendars") return { calendars: [{ id: "primary", summary: "Owner's calendar" }] };
  if (name === "list_events") {
    const from = Date.parse(String(args.timeMin));
    const to = Date.parse(String(args.timeMax));
    return { events: events.filter((e) => Date.parse(e.end) > from && Date.parse(e.start) < to) };
  }
  if (name === "get_event") return events.find((e) => e.id === args.eventId) ?? { error: "not found" };
  if (name === "create_event") {
    const e = {
      id: `ev${events.length + 1}`,
      summary: String(args.summary),
      start: String(args.start),
      end: String(args.end),
    };
    events.push(e);
    return { created: e };
  }
  return { error: `${name} isn't available` };
}

const port = Number(process.argv[2] ?? 4010);
createServer((req, res) => {
  let body = "";
  req.on("data", (c) => {
    body += c;
  });
  req.on("end", () => {
    if (req.method !== "POST") return res.writeHead(405).end();
    const msg = JSON.parse(body || "{}");
    const at = new Date().toISOString().slice(11, 19);
    console.log(
      `[${at}] ${msg.method}${msg.params?.name ? ` ${msg.params.name} ${JSON.stringify(msg.params.arguments)}` : ""}`,
    );
    if (msg.id === undefined) return res.writeHead(202).end();
    let result: unknown;
    if (msg.method === "initialize")
      result = {
        protocolVersion: "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "fake-calendar", version: "1" },
      };
    else if (msg.method === "tools/list") result = { tools: TOOLS };
    else if (msg.method === "tools/call")
      result = {
        content: [{ type: "text", text: JSON.stringify(call(msg.params.name, msg.params.arguments ?? {})) }],
      };
    else result = {};
    const answer = JSON.stringify({ jsonrpc: "2.0", id: msg.id, result });
    const headers: Record<string, string> = {
      "mcp-session-id": req.headers["mcp-session-id"]?.toString() ?? randomUUID(),
    };
    if (msg.method === "tools/call") {
      res.writeHead(200, { ...headers, "content-type": "text/event-stream" });
      res.end(`event: message\ndata: ${answer}\n\n`);
    } else {
      res.writeHead(200, { ...headers, "content-type": "application/json" });
      res.end(answer);
    }
  });
}).listen(port, () => console.log(`fake Calendar MCP on http://localhost:${port}/mcp`));

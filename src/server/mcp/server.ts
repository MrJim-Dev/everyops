import "server-only";
import { apiCaller } from "../api-auth";
import { callTool, type McpScope, ToolError, toolList } from "./tools";

/**
 * EveryOps's MCP server over Streamable HTTP, without sessions: each POST carries JSON-RPC messages and gets a JSON
 * answer (the transport allows plain JSON instead of an event stream). There's nothing to resume, so GET (a stream of
 * server messages) answers 405. Callers authenticate with an API key that has the "mcp" permission.
 */

const VERSIONS = ["2026-07-28", "2025-11-25", "2025-06-18", "2025-03-26"];
const LATEST = "2025-06-18";

type Message = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
};

const INSTRUCTIONS = `EveryOps holds a small business's records (bookings, sales, customers, staff, inventory…) in record
types the owner designed, shown on pages of tabs (tables, boards, calendars, schedules, forms, layouts, documents) and
dashboard cards. Start with describe_workspace to learn the record types, field ids, pages, tabs and cards; the other
tools take those ids. describe_view shows how a tab is set up and read_view what it shows right now (pageId for a
page's dashboard). Times are on the workspace's clock (get_schema's timeZone, Asia/Manila unless set) and money is in the workspace's currency (get_schema's currency, PHP unless set). Writes are checked like the app checks them and run the
workspace's automations, so prefer get_record before update_record and send its rev back. To change the design (fields,
pages, layouts, automations, websites) or make several record changes at once, use ask_everyops: show the person the
plan's steps, then apply_change; undo_change takes it back. Plans that must wait for an owner come back with
canApply false and are already saved for them.`;

const rpcError = (id: Message["id"], code: number, message: string) => ({
  jsonrpc: "2.0",
  id: id ?? null,
  error: { code, message },
});

/** The Origin header, when a browser sent the request, must be ours: a guard against DNS rebinding. */
function originOk(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function handleMcp(request: Request, scope: McpScope): Promise<Response> {
  if (request.method === "GET" || request.method === "DELETE")
    return new Response(null, { status: 405, headers: { allow: "POST" } });
  if (!originOk(request)) return Response.json(rpcError(null, -32600, "Forbidden origin"), { status: 403 });

  const { caller, error } = await apiCaller(request, "mcp");
  if (error) return error;
  if (!caller.key)
    return Response.json(
      {
        error: {
          code: "key_required",
          message: "Connect with an API key that has the MCP permission (Account → API keys).",
        },
      },
      { status: 401, headers: { "www-authenticate": 'Bearer realm="EveryOps MCP"' } },
    );
  if (!caller.key.permissions.includes("mcp"))
    return Response.json(
      { error: { code: "forbidden", message: "This API key doesn't have the MCP permission." } },
      { status: 403 },
    );

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(rpcError(null, -32700, "Parse error"), { status: 400 });
  }
  const batch = Array.isArray(body);
  const messages = (batch ? body : [body]) as Message[];
  const answers = [];
  for (const m of messages) {
    const answer = await handle(m);
    if (answer) answers.push(answer);
  }
  // Only notifications and responses: accepted, nothing to say.
  if (!answers.length) return new Response(null, { status: 202 });
  return Response.json(batch ? answers : answers[0], {
    headers: { "cache-control": "no-store" },
  });

  async function handle(m: Message) {
    if (!m || typeof m !== "object" || m.jsonrpc !== "2.0") return rpcError(m?.id, -32600, "Invalid request");
    if (m.method === undefined) return null; // a response to us; we never ask anything
    const notification = m.id === undefined || m.id === null;
    if (notification) return null;
    const id = m.id;
    switch (m.method) {
      case "initialize": {
        const asked = String(m.params?.protocolVersion ?? "");
        return {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: VERSIONS.includes(asked) ? asked : LATEST,
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: "everyops", title: "EveryOps", version: "1.0.0" },
            instructions: INSTRUCTIONS,
          },
        };
      }
      case "ping":
        return { jsonrpc: "2.0", id, result: {} };
      case "tools/list":
        return { jsonrpc: "2.0", id, result: { tools: toolList(scope) } };
      case "tools/call": {
        const name = String(m.params?.name ?? "");
        const args = (m.params?.arguments ?? {}) as Record<string, unknown>;
        const started = Date.now();
        try {
          const result = await callTool(caller as NonNullable<typeof caller>, scope, name, args);
          console.info(
            JSON.stringify({
              event: "mcp_tool",
              tool: name,
              key: caller?.key?.id,
              ok: true,
              ms: Date.now() - started,
            }),
          );
          const structured =
            result && typeof result === "object" && !Array.isArray(result) ? result : { result };
          return {
            jsonrpc: "2.0",
            id,
            result: {
              content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
              structuredContent: structured,
              isError: false,
            },
          };
        } catch (e) {
          const message = e instanceof ToolError ? e.message : "That didn't work. Try again.";
          if (!(e instanceof ToolError))
            console.error(JSON.stringify({ event: "mcp_tool_failed", tool: name, message: String(e) }));
          console.info(
            JSON.stringify({
              event: "mcp_tool",
              tool: name,
              key: caller?.key?.id,
              ok: false,
              ms: Date.now() - started,
            }),
          );
          // Tool errors go back as results so the agent can read them and correct itself.
          return {
            jsonrpc: "2.0",
            id,
            result: { content: [{ type: "text", text: message }], isError: true },
          };
        }
      }
      case "resources/list":
        return { jsonrpc: "2.0", id, result: { resources: [] } };
      case "prompts/list":
        return { jsonrpc: "2.0", id, result: { prompts: [] } };
      default:
        return rpcError(id, -32601, `Method not found: ${m.method}`);
    }
  }
}

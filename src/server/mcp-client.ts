import "server-only";

/**
 * A minimal client for remote MCP servers over Streamable HTTP: initialize (keeping the server's session id),
 * tools/list and tools/call. Answers may come back as JSON or as a server-sent event stream. Every request has a
 * timeout, and errors come back as messages rather than exceptions so a lookup can carry on without the server.
 */

const PROTOCOL = "2025-06-18";

type Rpc = { jsonrpc: "2.0"; id?: number; result?: unknown; error?: { code: number; message: string } };

/** The JSON-RPC answer with this id from a JSON or text/event-stream body. */
export function parseRpc(body: string, contentType: string | null, id: number): Rpc | null {
  const candidates: unknown[] = [];
  if (contentType?.includes("text/event-stream")) {
    for (const block of body.split(/\r?\n\r?\n/)) {
      const data = block
        .split(/\r?\n/)
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trimStart())
        .join("\n");
      if (data) candidates.push(JSON.parse(data));
    }
  } else if (body.trim()) candidates.push(JSON.parse(body));
  for (const c of candidates.flat()) if ((c as Rpc)?.id === id) return c as Rpc;
  return null;
}

export type McpTool = {
  name: string;
  description?: string;
  inputSchema?: unknown;
  annotations?: Record<string, unknown>;
};

export class McpClient {
  private session: string | null = null;
  private next = 1;
  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly timeoutMs = 15_000,
  ) {}

  private async send(method: string, params?: unknown, notify = false): Promise<unknown> {
    const id = this.next++;
    const res = await fetch(this.url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.token}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": PROTOCOL,
        ...(this.session ? { "mcp-session-id": this.session } : {}),
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        ...(notify ? {} : { id }),
        method,
        ...(params ? { params } : {}),
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
      redirect: "error",
    });
    const session = res.headers.get("mcp-session-id");
    if (session) this.session = session;
    const text = await res.text();
    if (!res.ok) throw new Error(`${method}: HTTP ${res.status} ${text.slice(0, 200)}`);
    if (notify) return null;
    const rpc = parseRpc(text, res.headers.get("content-type"), id);
    if (!rpc) throw new Error(`${method}: no answer`);
    if (rpc.error) throw new Error(`${method}: ${rpc.error.message}`);
    return rpc.result;
  }

  async connect() {
    await this.send("initialize", {
      protocolVersion: PROTOCOL,
      capabilities: {},
      clientInfo: { name: "EveryOps", version: "1.0" },
    });
    await this.send("notifications/initialized", undefined, true);
    return this;
  }

  async listTools(): Promise<McpTool[]> {
    const result = (await this.send("tools/list")) as { tools?: McpTool[] };
    return result.tools ?? [];
  }

  /** A tool's result as text (its text parts joined), and whether the server flagged it as an error. */
  async callTool(name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
    const result = (await this.send("tools/call", { name, arguments: args })) as {
      content?: { type: string; text?: string }[];
      structuredContent?: unknown;
      isError?: boolean;
    };
    const text =
      result.content
        ?.filter((c) => c.type === "text" && c.text)
        .map((c) => c.text)
        .join("\n") || (result.structuredContent ? JSON.stringify(result.structuredContent) : "");
    return { text, isError: !!result.isError };
  }
}

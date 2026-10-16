import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("../api-auth", () => ({ apiCaller: vi.fn() }));
vi.mock("./tools", async () => {
  class ToolError extends Error {}
  return {
    ToolError,
    toolList: vi.fn((scope: { kind: string }) =>
      scope.kind === "account"
        ? [{ name: "list_workspaces" }, { name: "search_records" }]
        : [{ name: "search_records" }],
    ),
    callTool: vi.fn(async (_caller: unknown, _scope: unknown, name: string) => {
      if (name === "boom") throw new ToolError('No record type "x".');
      return { records: [], total: 0 };
    }),
  };
});

import { apiCaller } from "../api-auth";
import { handleMcp } from "./server";

const key = (permissions: string[]) => ({
  caller: {
    user: { id: "u1", name: "Ana", email: "a@x.ph" },
    via: "key",
    key: { id: "k1", name: "Claude", permissions, workspaces: null },
  },
  error: null,
});
const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://localhost:3000/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", host: "localhost:3000", ...headers },
    body: JSON.stringify(body),
  });

describe("the MCP endpoint", () => {
  beforeEach(() => {
    vi.mocked(apiCaller).mockResolvedValue(key(["mcp", "records:read"]) as never);
  });

  it("answers initialize with the version asked for, when it speaks it", async () => {
    const res = await handleMcp(
      post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }),
      { kind: "account" },
    );
    const body = await res.json();
    expect(body.result.protocolVersion).toBe("2025-06-18");
    expect(body.result.capabilities.tools).toBeTruthy();
    expect(body.result.serverInfo.name).toBe("everyops");
    const other = await handleMcp(
      post({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "1999-01-01" } }),
      { kind: "account" },
    );
    expect((await other.json()).result.protocolVersion).toBe("2025-06-18");
  });

  it("lists the tools for its endpoint, and accepts notifications with 202", async () => {
    const list = await handleMcp(post({ jsonrpc: "2.0", id: 3, method: "tools/list" }), {
      kind: "workspace",
      workspaceId: "w",
    });
    expect((await list.json()).result.tools.map((t: { name: string }) => t.name)).toEqual(["search_records"]);
    const note = await handleMcp(post({ jsonrpc: "2.0", method: "notifications/initialized" }), {
      kind: "account",
    });
    expect(note.status).toBe(202);
  });

  it("returns a tool's result as text and structured content, and a tool's error as a result the agent can read", async () => {
    const ok = await (
      await handleMcp(
        post({
          jsonrpc: "2.0",
          id: 4,
          method: "tools/call",
          params: { name: "search_records", arguments: {} },
        }),
        { kind: "account" },
      )
    ).json();
    expect(ok.result.isError).toBe(false);
    expect(ok.result.structuredContent).toEqual({ records: [], total: 0 });
    const bad = await (
      await handleMcp(post({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "boom" } }), {
        kind: "account",
      })
    ).json();
    expect(bad.result).toEqual({ content: [{ type: "text", text: 'No record type "x".' }], isError: true });
  });

  it("needs an API key with the MCP permission", async () => {
    vi.mocked(apiCaller).mockResolvedValue({
      caller: { user: { id: "u1" }, via: "session", key: null },
      error: null,
    } as never);
    expect(
      (await handleMcp(post({ jsonrpc: "2.0", id: 6, method: "ping" }), { kind: "account" })).status,
    ).toBe(401);
    vi.mocked(apiCaller).mockResolvedValue(key(["records:read"]) as never);
    expect(
      (await handleMcp(post({ jsonrpc: "2.0", id: 7, method: "ping" }), { kind: "account" })).status,
    ).toBe(403);
  });

  it("refuses other origins, unknown methods and GET", async () => {
    expect(
      (
        await handleMcp(post({ jsonrpc: "2.0", id: 8, method: "ping" }, { origin: "https://evil.example" }), {
          kind: "account",
        })
      ).status,
    ).toBe(403);
    const unknown = await (
      await handleMcp(post({ jsonrpc: "2.0", id: 9, method: "sampling/createMessage" }), { kind: "account" })
    ).json();
    expect(unknown.error.code).toBe(-32601);
    expect((await handleMcp(new Request("http://localhost:3000/mcp"), { kind: "account" })).status).toBe(405);
  });
});

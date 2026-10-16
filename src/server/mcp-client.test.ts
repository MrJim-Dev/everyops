import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

describe("parseRpc", () => {
  it("reads JSON and event-stream answers, picking the matching id", async () => {
    const { parseRpc } = await import("./mcp-client");
    expect(parseRpc('{"jsonrpc":"2.0","id":2,"result":{"ok":true}}', "application/json", 2)?.result).toEqual({
      ok: true,
    });
    const sse =
      'event: message\ndata: {"jsonrpc":"2.0","method":"notifications/progress"}\n\nevent: message\ndata: {"jsonrpc":"2.0","id":3,"result":{"tools":[]}}\n\n';
    expect(parseRpc(sse, "text/event-stream", 3)?.result).toEqual({ tools: [] });
    expect(parseRpc(sse, "text/event-stream", 9)).toBeNull();
  });
});

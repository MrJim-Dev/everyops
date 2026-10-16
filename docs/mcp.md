# MCP server

EveryOps speaks the Model Context Protocol so AI agents (Claude Code, Claude Desktop, Cursor, ChatGPT connectors and others) can read and write workspace records with the same rules as the app.

- **Endpoints:** `https://everyops.app/mcp` covers every workspace the key reaches (tools take a `workspace` argument); `https://everyops.app/mcp/w/<workspaceId>` is fixed to one workspace.
- **Transport:** stateless Streamable HTTP. Each POST is one JSON-RPC message answered with JSON; GET answers 405 (no server-initiated messages). A browser Origin other than ours is refused (DNS rebinding guard).
- **Auth:** `Authorization: Bearer eo_live_…` from Account → API keys, with the `mcp` permission plus the permission each tool needs. Every call re-checks scope and the owner's current role (`workspaceAccess`).

## Tools

| Tool | Permission | What it does |
| --- | --- | --- |
| `list_workspaces` | mcp | Workspaces the key reaches (account endpoint only) |
| `describe_workspace` | records:read | Record types, fields, choices, links, pages |
| `search_records` | records:read | Filtered, sorted search (same SQL as Ask EveryOps lookups) |
| `get_record` | records:read | One record with its `rev` |
| `aggregate` | records:read | Count/sum/avg grouped by a field |
| `read_page` | pages:read | A page's records as the app shows them |
| `create_record` / `update_record` / `delete_record` | records:write | Writes under the workspace lock; validation, uniqueness, booking conflicts, reference numbers and automations all run as in the app |
| `propose_change` | design:propose | Files a design change request for a manager to review |

Values are plain JSON keyed by field id or name: choice labels, linked record names or ids, dates as `YYYY-MM-DD` in Asia/Manila (`src/lib/engine/coerce.ts`). `update_record` takes the `rev` from `get_record`; a stale rev returns a conflict with the current record so the agent can retry.

## Design change requests

Agents never edit the blueprint. `propose_change` stores an `agent_request` row; managers see it under History → **Requests from agents**, where **Draft with Ask EveryOps** puts the request into the composer so the normal preview-and-apply flow handles it, or **Dismiss** closes it.

## Connecting

```sh
claude mcp add --transport http everyops https://everyops.app/mcp --header "Authorization: Bearer eo_live_…"
```

```json
{ "mcpServers": { "everyops": { "type": "http", "url": "https://everyops.app/mcp", "headers": { "Authorization": "Bearer eo_live_…" } } } }
```

The key dialog shows both snippets once MCP is ticked. Test locally with `npx @modelcontextprotocol/inspector --cli http://localhost:3000/mcp --transport http --header "Authorization: Bearer …" --method tools/list`.

# MCP server

EveryOps speaks the Model Context Protocol so AI agents (Claude Code, Claude Desktop, Cursor, ChatGPT connectors and others) can work in a workspace the way its team does: read and write records, see every page as the app shows it, ask Ask EveryOps for changes and apply them, and look after the workspace, with the same rules as the app.

- **Endpoints:** `https://everyops.app/mcp` covers every workspace the key reaches (tools take a `workspace` argument); `https://everyops.app/mcp/w/<workspaceId>` is fixed to one workspace.
- **Transport:** stateless Streamable HTTP. Each POST is one JSON-RPC message answered with JSON; GET answers 405 (no server-initiated messages). A browser Origin other than ours is refused (DNS rebinding guard).
- **Auth:** `Authorization: Bearer eo_live_…` from Account → API keys, with the `mcp` permission plus the permission each tool needs. Every call re-checks scope and the owner's current role (`workspaceAccess`, `may` in `src/server/mcp/kit.ts`).

## Tools

| Tool | Permission | What it does |
| --- | --- | --- |
| `list_workspaces` | mcp | Workspaces the key reaches (account endpoint only) |
| `describe_workspace` | records:read | Record types and fields, pages with their tabs and dashboard cards, automations with trigger, conditions and actions |
| `search_records` / `get_record` / `aggregate` | records:read | Filtered, sorted search with `nextOffset`; one record with its `rev`; count/sum/avg grouped |
| `create_record` / `update_record` / `delete_record` | records:write | Writes under the workspace lock; validation, uniqueness, booking conflicts, reference numbers and automations all run as in the app |
| `describe_view` | pages:read | Every setting of a tab (columns, filter, sort, grouping, lanes, form steps, layout sections and parts, website blocks) or a dashboard card, with field names |
| `read_view` | records:read | What a tab shows now: table rows with its own filter/sort/columns/groups/totals, board lanes, calendar events, a schedule's bookings and free slots, approval queue, notes, register products, a layout page's worked-out parts, a website's blocks, page text, a drawing's shapes; with `pageId`, the page's dashboard cards and their numbers |
| `read_page` / `write_page` / `page_history` | pages:read / pages:write | Document markdown, custom HTML (owners and admins write it) and canvas JSON; replaced text is kept as a version |
| `check_availability` | records:read | Free and taken slots (or days) for a resource, as the booking form offers them |
| `ask_everyops` | records:read | Asks the workspace's assistant (`assistantTurn`). Questions get answers with evidence; changes come back as a checked plan with a `planId` |
| `apply_change` | design:apply for design, records:write / pages:write for data | Applies a plan like the Apply button: against the version it was made for, saved to History |
| `undo_change` / `list_changes` | as above / records:read | Undo newest first; History with who applied what |
| `propose_change` / `list_change_requests` | design:propose | Leave a request for a manager; see requests and plans with their status |
| `automation_runs` | records:read | Recent automation runs and their emails |
| `run_automation` | manage | Run a scheduled or date automation now |
| `read_memory` / `update_memory` | records:read / manage | Ask EveryOps's instructions and notes |
| `read_activity` / `list_team` | manage | The activity log (without IPs) and the team |

Values are plain JSON keyed by field id or name: choice labels, linked record names or ids, dates as `YYYY-MM-DD` in Asia/Manila (`src/lib/engine/coerce.ts`). `update_record` takes the `rev` from `get_record`; a stale rev returns a conflict with the current record so the agent can retry. Reads come from the same engine the app draws with (`src/server/mcp/views.ts`): dashboard numbers follow the cards (a card that compares periods shows this period's value), and layout pages go through `resolveLayout` in team mode, which keeps record ids and the team's own parts that visitors never get.

## Changes and approval

Agents change the design only through Ask EveryOps plans. `ask_everyops` stores each plan in `agent_request` (`plan`, `base_version`; migration 0020). `apply_change` applies a `planned` plan with `applyPlan` and saves it through `patchWorkspace`, the browser's own path, so role checks, revs, automations and webhooks are unchanged; the History entry names the key. A design plan made for an older version is refused (409), as in the app.

Some plans wait for a person and go to History → **Requests from agents** as `open` instead: team invites and role changes, removals while **Always ask before removing** is on (Settings → Assistant), and anything the key or role may not apply. **Read only** in Settings → Assistant drops plans as it does in the app. Design changes need the opt-in `design:apply` permission, which only owners and admins can use; `manage` (memory, activity, team, run automations) is the same. Everything an agent applies is undoable from History or with `undo_change`.

Left out on purpose: API keys, custom domains, webhooks, outside connections, sheet sync, team invites and deleting a workspace stay in the app, where a person signs in.

## Connecting

```sh
claude mcp add --transport http everyops https://everyops.app/mcp --header "Authorization: Bearer eo_live_…"
```

```json
{ "mcpServers": { "everyops": { "type": "http", "url": "https://everyops.app/mcp", "headers": { "Authorization": "Bearer eo_live_…" } } } }
```

The key dialog shows both snippets once MCP is ticked. Test locally with `npx @modelcontextprotocol/inspector --cli http://localhost:3000/mcp --transport http --header "Authorization: Bearer …" --method tools/list`.

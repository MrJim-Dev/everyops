# Outside connections (MCP client)

Owners and admins connect outside MCP servers to a workspace in Settings → Connections. Ask EveryOps can then read them while it looks things up, and propose changes there that run only when someone presses Apply. It's the reverse of the EveryOps MCP server (`docs/mcp.md`).

| Service | Server | Reads (lookup step) | Proposes (Apply required) |
| --- | --- | --- | --- |
| Google Calendar | `https://calendarmcp.googleapis.com/mcp/v1` | list_calendars, list_events, get_event, search_events, suggest_time | create_event, update_event, delete_event |
| Gmail | `https://gmailmcp.googleapis.com/mcp/v1` | search_threads, get_thread, get_message, list_labels, list_drafts | create_draft |

The vetted list lives in `src/lib/connections.ts`. Tools a server offers that aren't listed are ignored, so a server adding a tool can't widen what EveryOps does.

- **OAuth.** `/api/workspaces/[id]/connections/[provider]` sends an owner or admin to Google with a signed, 10-minute state plus a nonce cookie. `/api/connections/callback` checks that the same person is still an owner or admin, requires every scope, and stores the tokens sealed with AES-256-GCM (`src/server/secret-box.ts`, key from `CONNECTIONS_KEY`, else derived from `BETTER_AUTH_SECRET`). Better Auth's account linking isn't used: linking Google to an unverified account removes its password.
- **Lookup.** `outsideTools` lists each connected server's tools live, using `McpClient` (Streamable HTTP, JSON or SSE answers). The vetted read tools go to the lookup call next to `search_records`, named like `calendar__list_events`. They never go to the main assistant call, whose schema is at Gemini's limit. Only owners and admins get them, because it's the connecting person's own calendar or mail.
- **Clashes.** When a lookup fetched both bookings and calendar events, `overlapNote` (`src/server/ai/overlaps.ts`) computes every overlap exactly and adds it to the evidence. Any overlap counts as a clash.
- **Writes.** The lookup can only put write tools in `actions` with JSON arguments and a summary. They're saved to `connection_action` and shown under the reply and in Settings with Apply and Dismiss. `decideAction` is the only code that calls a write tool.
- **Revoking.** Disconnecting deletes the row first, so the tools are gone from the next message, then revokes the token at Google.
- **Activity log.** `connection.create`, `connection.revoke`, `outside.read` (each read) and `outside.action` (applied, failed or dismissed).

## Setup (once per Google project)

1. Enable `calendar-json.googleapis.com` and `calendarmcp.googleapis.com` (done for `everyops-prod`), plus `gmail.googleapis.com` and `gmailmcp.googleapis.com` for Gmail. Google's MCP servers are in the Workspace Developer Preview.
2. Add `https://everyops.app/api/connections/callback` and `http://localhost:3000/api/connections/callback` to the OAuth client's authorized redirect URIs.
3. Add the scopes in `PROVIDERS` to the consent screen's Data access list.

## Local checks

`node scripts/fake-calendar-mcp.mts` runs a stand-in Calendar server with Google's tool names. Start the app with `OUTSIDE_MCP_URL_GOOGLE_CALENDAR=http://localhost:4010/mcp` (ignored in production) and add a `workspace_connection` row for the workspace.

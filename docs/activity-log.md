# Activity log

`activity_log` (migration 0015) records who or what changed a workspace. Owners and admins read it in Settings → Activity (filter by who, what, result and Manila dates; Export CSV up to 5,000 rows). Staff and viewers get 403 from `/api/workspaces/[id]/activity` and don't see the tab.

| Actor type | Written by | Notes |
| --- | --- | --- |
| `person` | `saveWorkspacePatch` (records, pages, design version changes), `createKey`/`revokeKey` | Quick repeat edits to the same records or page within 2 minutes update one entry |
| `api_key` | `writeRecord` / `writePageText` via the REST API, `workspaceAccess` denials | IP and user agent kept |
| `mcp_client` | Same as API keys when called over `/mcp`, plus `mcp.tool_call` for each read tool | |
| `automation` | `runTimedAutomations` (`automation.run` per rule, then the records it changed) | Save-time automations run in the browser and log as the person who saved |
| `public_form` | `submitPublicForm` | No IP (visitors) |
| `booking_link` | `attachToBooking` (manage link) | |

- **Same transaction.** Writes call `logActivity(trx, actor, entries)` inside the transaction that changes data, so a change without its entry (or the reverse) can't happen. `recordEntries` groups a batch into one entry per action and record type (ids capped at 100, `count` keeps the total).
- **Results.** `ok`, `denied` (key outside its workspaces or missing a permission), `conflict` (stale rev), `error` (failed validation, e.g. a double booking).
- **Account-level entries** (`workspace_id` null): keys created or revoked, and keys refused on a workspace their owner isn't on. The account page shows each key's 30-day use from these rows (`keyUsage`).
- **Retention.** 180 days (`RETENTION_DAYS`); the 15-minute cron job deletes older rows (`trimActivity`).

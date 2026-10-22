# Server paging: large record types stay on the server

Large workspaces used to send every record to the browser. Now a large record type (more than 5,000 records) sends
a **recent window**: records dated in the last 200 days or later, plus any added or changed in that time. The rest
stays on the server (src/lib/engine/window.ts).

## When a type is windowed

Only when nothing the browser works out from every record would be wrong without its older records:

- Every dashboard card over it covers recent or upcoming days: a stat with a comparison, an agenda, a heatmap of
  up to 28 weeks, a dated chart (a month chart covers 6 months), or a filter with `is_today`, `is_this_week`,
  `is_this_month` or `is_upcoming` (not negated, not one side of an "or"). Calc cards' terms the same.
- No automation files records under it (`link_record` looks the match up among all of them).

`windowBlocker(bp, entityId)` says why not, otherwise null. Other types load in full, as before. Booking conflict
checks are unaffected: a new booking can only clash with recent or upcoming ones.

## How the pieces stay right

- **Totals:** rollups over a windowed type (a player's bookings and total spent) keep the server's value in the
  browser (`setPartialTypes` in compute.ts). On every save the server works totals out from every record
  (`settleTotals` in access.ts, shared with record-level access) and saves the ones that changed. A count query
  first, so small workspaces skip it.
- **Tables:** a windowed type's tables page on the server:
  `GET /api/workspaces/:id/views/:viewId/rows?offset&limit&q&sort&group` (src/server/view-rows.ts). It uses the same
  filter, search, sort and grouping as the browser (src/lib/engine/table-rows.ts) and the person's record-level
  access. It returns the page with revs, the count, column totals and group sizes and totals over every matching
  row. Rows read from the server join the browser's copy (`absorb` in the store), so they open and edit like
  any other. Exports read every matching row from the server.
- **The assistant, MCP, REST, automations and public pages** run on the server over every record, as before.

## Measured (local, 20,227 bookings)

| | Before | After |
| --- | --- | --- |
| Workspace load | 7.1 MB, every booking | 2.0 MB, 5,771 bookings (the window) |
| "Every booking" table | 20,227 rows in the browser | 100 rows from the server, "20,227 bookings", total ₱8,090,800 |
| Next page | 0.24 s | 0.14–0.2 s |
| Search "Kevin" (1,687 matches) | 0.3 s | 0.85 s (on the server) |
| Save on that workspace | | about 0.3 s, totals worked out from all 20,227 |

## Not covered

- Calendars, schedules and boards of a windowed type show the window: the last 200 days and everything upcoming.
  Older records are in its tables.
- A record's panel lists linked records the browser has. A player's panel shows their recent bookings, while
  their totals count all of them.
- Server pages read every record of the workspace per request (0.2–0.9 s at 20,000). Moving the query to SQL is
  the next step if it's needed.
- Windowing starts above 5,000 records of a type (`WINDOW_AT`). The window is 200 days (`WINDOW_DAYS`).

## QA

`tsx --conditions=react-server --env-file=.env.local scripts/qa-paging.mts [N]` (local databases only).


# Paging large tables

Tables used to draw every row. A court's 20,000-booking history crashed the browser tab. Tables now show 100 rows at
a time (`PAGE_SIZE` in src/components/views/table-view.tsx), with "1–100 of 20,227", Previous and Next below.

- Search, sorting, grouping, group totals, the grand total and select-all still cover every matching row. Only
  what's drawn is a page.
- The page goes back to the first when the search, sort or grouping changes, and when the tab changes.
- Grouped tables page over the rows of open groups. A page shows the headers of the groups with rows on it, and
  closed groups' headers, so they can be opened.
- Tables with 100 rows or fewer look as before.

## Measured (local, 20,227 bookings, "Every booking" table, no filter)

| | Before | After |
| --- | --- | --- |
| Table opens | Tab crashed | 0.6–1.0 s |
| Rows drawn | All of them | 100 |
| Next page | | 0.24 s |
| Search "Kevin" (1,687 matches) | | 0.25–0.30 s |
| Workspace load (server) | 7.1 MB JSON, gzipped, 0.2–0.8 s | Same |

## Not in this change: loading records page by page from the server

The browser still loads every record of a workspace, and at 20,000 bookings that's fine (7 MB, gzipped).
Leaving large record types on the server needs the parts that run in the browser over all records to run on the
server instead: formulas and rollups (a player's total), save automations, dashboards and search. Otherwise
they'd be wrong. The REST API and MCP already page on the server (`search_records` and `read_view` take
`offset` and `limit`).

## QA

`tsx --conditions=react-server --env-file=.env.local scripts/qa-paging.mts [N]` (local databases only) adds N past
bookings (default 20,000) and an "Every booking" table.


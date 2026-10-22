# Workspace time zone

Every workspace ran on Manila time. `src/lib/time.ts` used a fixed +08:00 offset, and dates were parsed and formatted with "+08:00" and "Asia/Manila" in about 40 places. A court in Tokyo or a salon in Sydney saw bookings an hour or more off, its "today" changed at the wrong midnight, and its 8 AM reminders went out at Manila's 8 AM.

## What owners get

**Settings → General → Time zone** picks the clock the workspace runs on, showing the current time there before saving ("Now there: Thu, 8:12 PM"). Twenty zones are listed, JAPAC first; daylight-saving zones are marked. Saving is a versioned change that History can undo.

The workspace then reads every date on that clock:

- tables, calendars, schedules, record panels, history and inputs
- "today" in filters and dashboards
- booking slots and opening hours
- timed automations (a daily 8:00 AM run at 8:00 AM there)
- the public site and booking page
- imports, Excel exports, MCP and REST, and Ask EveryOps (which is told "Today (time zone Asia/Tokyo, UTC+09:00)")

Stored times are instants and don't change; they read on the new clock.

## How it works

- `src/lib/time.ts` reads the zone from `zone()` and keeps an explicit `tz` parameter on every helper. Real zones use the platform's time zone database through `Intl`, so daylight saving is handled: a time in a spring-forward gap lands just after the jump, and a repeated fall-back hour takes the first. Manila keeps its fixed-offset fast path, so the default is as fast as before. New helpers are `fromLocal`, `toLocal`, `utcOffset`, `timeZoneOf` and `zoneName`; `manilaParts` is now `zonedParts`.
- **On the server,** `src/server/zone.ts` keeps the zone in an `AsyncLocalStorage`, so two workspaces handled at once never share one. Each entry point calls `enterZone(bp)` once it has the blueprint: saves, public pages and submissions, slots, booking management, timed automations (per workspace in the loop), REST/MCP writes and tools, sheet sync, the assistant and checkup routes, and the activity log. Anything not wired falls back to Manila, which is the old behavior.
- **In the browser,** `WorkspaceProvider` and `PublicSiteView` set the zone as they render. On the server the setter does nothing, so it can't leak between requests.
- **Calendar-day labels** (a day strip, a calendar heading) are read at noon UTC in UTC, so a day key shows as that day on every clock. The generated booking page does the same and takes the zone from the form data, so pages already written follow a zone changed later.
- `Blueprint.timeZone` is optional (older blueprints mean Asia/Manila), changed with `set_time_zone`, and checked by `validateBlueprint`.
- **Left on Manila on purpose:** AI-usage billing months and the hub greeting are per account, not per workspace, and the community preview images use fixed demo dates.

## Verification, 2026-10-22

Local dev server against an isolated PostgreSQL 17 with a synthetic workspace (`scripts/qa-time-zone.mts`: court bookings with the booking form public). Chrome through Playwright, no page errors. Screenshots are in `docs/pr-screenshots/workspace-time-zone/`.

- The bookings list read 5:00, 6:00, 7:00 PM in Manila. After switching to Asia/Tokyo it read 6:00, 7:00, 8:00 PM for the same bookings, and History listed "Time zone changed to Asia/Tokyo".
- The public booking page, at 8:12 PM in Tokyo, offered only 9, 10 and 11 PM for today.
- Real Vertex (`gemini-3.7-flash`): "What day and time is it right now here…" answered "Thursday, Oct 22, 2026 on the workspace's clock (Asia/Tokyo)", and the evidence label reads "Tokyo".
- Cron runner: a daily 8:00 PM automation ran for the Tokyo workspace's 4 courts at 20:13 Tokyo. An identical copy on Manila time ran none at the same moment (19:13 Manila).
- Unit tests (`src/lib/time-zone.test.ts`, `src/server/zone.test.ts`) cover New York summer and winter, the spring-forward gap and the fall-back repeat, Auckland +13, India +05:30, days around midnight, formatting, schedules and slots in Tokyo, the change op, and two concurrent requests in different zones.
- `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.

Not covered: the first server render of a public page can show Manila's "today" for a moment before the browser applies the workspace's zone, which matters only for zones far from Manila around midnight. Setup still designs new workspaces in Manila; change the zone afterwards. Not tested in a deployed environment.


# Rating and duration fields

Two common kinds of data had no field type of their own. A customer review or service score was a plain number with no limit (so 7 or 4.5 "stars" saved fine), and time spent on a job was a number of minutes nobody could read at a glance ("95"). Both now have their own type.

## What owners get

| Type | Stored as | Entered as | Shown as |
| --- | --- | --- | --- |
| `rating` | a whole number from 1 to 5 | five stars to click (radio buttons underneath, so arrow keys work; clicking the current star clears it) | stars in tables and panels, "★★★★☆" in emails, prints and public pages, "4/5" in CSV |
| `duration` | minutes | "1:30", "90", "1h 30m", "1 hr 30 mins", "1.5 h", "45 min" | "1 h 30 min" everywhere |

- **Checks:** a rating outside 1 to 5 or not whole is refused ("Rating must be 1 to 5 stars"). A duration that doesn't read as a time is refused ("Time spent needs a length of time, like 1:30 or 45 min"). While someone types a duration, what it understood shows at the right end of the field.
- **Totals and dashboards:** table totals add up durations as time ("12 h 5 min") and show the average rating ("4.3 avg"). Stat cards and rollups add up or average time as time ("10 h 20 min"). Charts of time read in hours on the axis ("4.3 h") and exactly in the tooltip.
- **Averages skip blanks:** a dashboard average now ignores records with no value, as spreadsheets do, so a job nobody has rated doesn't count as zero stars. This applies to every number field.
- **Public forms:** forms ask with the same star picker and time field. Custom HTML forms and the standalone booking page get a star select and a text field.
- **Everywhere else:** MCP, REST and spreadsheet imports accept "4/5", "★★★★", "2:15" or "1h 30m". Excel exports keep ratings as numbers and durations as text.

## AI

Ask EveryOps and setup's designer can use both types ("add a star rating", "track how long each job took"). The designer's field schema sits near Gemini's structural limit, so the two new type values are paid for by making `range` (dates or times, on time ranges) a described string instead of an enum, the same trade the email/phone/url/file types made with `resultType`. `toEntity` maps "days" or "whole days" to dates and "hours" to times, and `validateBlueprint` names any other value so the repair round fixes it.

Table cells also now announce their value the way it shows ("Time spent: 1 h 15 min", "Payment: Cash") instead of as stored (75, "cash"). Before, every field type was announced by its stored value.

## Verification, 2026-10-22

Local dev server against an isolated PostgreSQL 17 with a synthetic workspace (`scripts/qa-rating-duration.mts`: an aircon service business with jobs, visits and a public "Rate our service" form). Chrome through Playwright, no page errors. Screenshots are in `docs/pr-screenshots/rating-duration/`.

- The jobs table showed stars and "1 h 15 min"-style times, with totals "12 h 5 min" and "4.3 avg". The dashboard showed "Time on jobs 10 h 20 min" and a chart in hours.
- The record panel took "1h 45m" and four stars and saved them. "soon" was refused with the message under the field.
- The public form took four stars and "25 min". The new feedback appeared in the team's table with its stars and "25 min".
- Real Vertex (`gemini-3.7-flash`): "Add a Travel time field to jobs for how long getting to the customer took, and a Punctuality star rating." returned a plan in 13 s with a duration field and a rating field. Apply saved them, and the stored blueprint has `type: "duration"` and `type: "rating"`.
- Real Vertex setup design (`EVAL_ONLY=courts EVAL_REPEAT=1 pnpm eval:design`, gemini-3.5-flash) with the changed schema: valid on the first pass, no repairs, 40 s, 7 of 9 asks met (add-ons and players missed, unrelated to these types). One run shows Vertex accepts the schema; it is not a quality comparison.
- `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.

Not covered: a configurable maximum (ratings are always out of 5), seconds in durations, and a deployed environment.


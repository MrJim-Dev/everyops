# Recurring records

A booking every Tuesday at 7 PM, a membership fee every month, a weekly cleaning: any record type with a date, date-time
or time range can repeat. The new-record dialog has a **Repeat** control (does not repeat, every day, every week,
every 2 weeks, every month) and an end: after a number of times or on a last day. Up to 104 records per series.

## How a series is made

`src/lib/engine/recurrence.ts`. A series is ordinary records, one per day, each made by `createRecord`: the same
validation, conflict check, automations and formulas as one made by hand. The day steps through the type's booking
time, else its first date, date-time or time range field (`windowDateField`).

- **Times** keep their wall-clock time in the workspace's time zone, and a time range keeps its length.
- **Months** keep the day of the month, or the month's last day when it's shorter (Jan 31, Feb 28, Mar 31).
- **Clashes:** for bookings, the dialog previews every day and names the ones whose resource is taken. Those days are
  skipped; the rest are made. If the first day fails for another reason (a required field), nothing is made.

The records of a series share two keys in their data that no field can have, because field ids start with a letter:
`@series` (the series id) and `@repeat` (`week:1`, `week:2`, `month:1`, `day:1`). They need no migration and
travel with the record everywhere its data goes, including webhooks, MCP and REST reads.

## Changing a series

The record panel says "Repeats every week · 2 of 7".

- **Edit:** "Save changes to" offers this record only, or this and the ones after it. Other fields are copied as they
  are. A new date or time moves each later record by the same number of days, to the new time of day and length.
  Each update is checked like any edit; if one would clash, nothing is saved and the panel names the day.
- **Delete:** the menu offers "Delete this and the N after it" and "Delete the whole series". Both can be undone
  from the toast.

## Not covered

- Public booking forms, the assistant and the REST API make single records. A series is made in the app.
- A series doesn't extend itself: "every week, forever" is two years at most, then a new series.

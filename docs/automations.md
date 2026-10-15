# Automations

Automations used to run only at the moment a record was saved, and could only set a field, add to a number or show a toast. They now also run on a schedule or as a record's date comes up, send email, and add records. Owners see, pause and audit them in Settings → Automations.

## What an automation can do

| Trigger | When it runs |
| --- | --- |
| `created`, `updated`, `status_changed` | When a record is saved, in the app or from a public form (as before) |
| `schedule` | Every day, week (a weekday) or month (day 1–28) at a Manila time, for every record that matches `when` |
| `date_reached` | Once per record, `offsetDays` from its date, date-time or time-range field, at a Manila time |

| Action | What it does |
| --- | --- |
| `set_field`, `adjust_number`, `notify` | As before |
| `send_email` | Emails `to` with `subject` and `body`. `{{field}}` and `{{link.field}}` placeholders are filled and formatted (₱400, Fri, Oct 16, 2026, option labels) |
| `create_record` | Adds a record of another type with `values` (field id → formula on the triggering record). A link back to the triggering record's type is filled in by itself |

`enabled: false` pauses an automation without removing it. Automations that create records can set each other off up to `MAX_DEPTH` (3) levels; past that they stop with a notice.

## Where it runs

- `src/lib/engine/automations.ts` is the shared logic: which rules fire on a save, what their actions do, which timed rules are due (`dueRuns`), and the plain-language descriptions. The browser, public bookings and the server use the same code.
- Saves (`patchWorkspace`) and public bookings (`submitPublicForm`) log every automation that fired in `automation_run` inside the same transaction, with emails as `pending`. They're sent after the response (`after()`).
- `POST /api/cron/automations` (Bearer `CRON_SECRET`) runs due schedules and dates and retries pending emails. Each timed run claims a `run_key` (rule, record, day), so it happens once however often the runner is called or how many instances call it.
- Email safety: the shared demo account never sends; a workspace sends at most `AUTOMATION_EMAIL_DAILY_LIMIT` (100) automation emails a day; addresses are checked before sending; failures retry up to three times.

Production needs a Cloud Scheduler job, created at deploy time:

```sh
gcloud scheduler jobs create http everyops-automations --project everyops-prod --location asia-southeast1 \
  --schedule "*/15 * * * *" --time-zone "Asia/Manila" --http-method POST \
  --uri "https://everyops.app/api/cron/automations" --headers "Authorization=Bearer ${CRON_SECRET}"
```

## Ask EveryOps

The assistant's answer schema is close to Gemini's structural limit: adding fields for the new parts made Vertex refuse every request with `INVALID_ARGUMENT`. So `assistantRule` adds no fields. `event` and `type` become strings, and `trigger.to` carries the timing (`"weekly mon 08:00"`, `"-1 18:00"`). For `send_email`, `fieldId` is the recipient and `value` is the email (the subject on the first line). For `create_record`, `fieldId` is the record type and `value` is the JSON of its values. `toAssistantRule` converts these, and validation names anything that doesn't read. Setup's designer schema is unchanged.

Requests that set up automations ("every Monday at 8 AM, email players with unpaid bookings") used to trip the lookup gate: a digit or "unpaid" made them look like data questions, Gemini (correctly) made no lookup calls, and the assistant answered "I couldn't verify the records". `needsLookup` now treats automation set-up as a design change unless it also asks for a number or ends as a question.

## Verification, 2026-10-15

Local production build against an isolated PostgreSQL 17 (port 5547) with a synthetic workspace (`scripts/qa-automations.mts`: court bookings with player emails, a Follow-ups type and four automations). SMTP pointed at a local sink that records messages; nothing left the machine. Chromium through Playwright, no page errors.

- Cron: 8 timed runs (5 day-before reminders for tomorrow's bookings, 3 unpaid chases), 8 emails delivered to the sink with the right recipients, subjects and bodies. A second call ran nothing.
- Marking a booking paid in the record panel emailed the player (`save` run, Emailed). Cancelling one added a linked follow-up ("Call Paolo Reyes to rebook") and showed the notice.
- Run now on the daily chase ran for the one unpaid booking left. Turning the reminder off saved an undoable change and dimmed it.
- Ask EveryOps on real Vertex `gemini-3.7-flash`: "Every Monday at 8 AM, email each player with an unpaid booking a reminder to pay." returned a reviewed plan in 26 s; Apply added a weekly automation that Settings lists with Run now.
- `pnpm typecheck`, `pnpm lint`, `pnpm test` (457 tests in 76 files), `pnpm build`.

Not covered: real SMTP delivery, the Cloud Scheduler job, a deployed environment, and repeated Gemini runs across many phrasings (one request was verified end to end; the conversions are unit-tested).

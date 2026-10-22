# Automations that call outside services

Automations could only change records, add records and send email. Telling Slack about a new booking, starting a Zapier/Make/n8n flow or updating another system meant polling the webhooks or the API from outside, with no conditions, schedule or message of the owner's choosing.

## What owners get

A **Call** step (`call_api`) in an automation posts to one of the workspace's webhook endpoints:

- **Where to:** an endpoint added in **Settings → Webhooks** with "An automation calls it (its Call step)" ticked. The URL and its signing secret stay there. The automation only holds the endpoint's id, so exporting a blueprint or publishing it to Community never carries a URL or secret.
- **What it sends:** a JSON body with `{{field}}` placeholders inside its strings, e.g. `{"text": "Slot opened up: {{court.name}} at {{slot}} was cancelled."}` for Slack. Values are filled the way they read in the app and escaped for JSON, so a name with quotes or line breaks can't break the body. A body that still isn't JSON goes as `{"text": …}`. Without a body it sends the record, shaped like a webhook event: `{"automation", "recordType", "record": {"id", …stored values}}`.
- **When:** any automation trigger: when a record is added, changed or reaches a status, on a schedule, or as a date comes up, with the automation's own conditions.
- **How it's sent:** through the webhook outbox, queued in the same transaction as the save or run that made it, then posted after the response. That includes the endpoint's HMAC signature (`EveryOps-Signature`, `EveryOps-Event: automation.call`), the private-address checks, the retries for up to 24 hours, the delivery log with Resend, and turning the endpoint off after repeated failures.
- **Where it shows:** Settings → Automations says "Call Slack #front-desk with a custom message", and each run's result says "Called 1 webhook endpoint." or why not (the endpoint was deleted, turned off, doesn't accept automation calls, or the workspace reached its daily limit).
- **Limit:** a workspace makes at most `AUTOMATION_CALL_DAILY_LIMIT` (500) automation calls a day (Manila), so a schedule over many records can't flood a service.

Ask EveryOps plans these from a sentence ("When a booking is cancelled, post to the Slack front desk endpoint which court and time just opened up."). Owners and admins' messages include the workspace's endpoints by id and name (never URLs or secrets). The assistant uses only a listed endpoint that accepts automation calls; otherwise it says to add one first. Its answer schema stays the same size: `call_api` reuses `fieldId` (the endpoint) and `value` (the body), like `send_email`.

## How it works

- `Action` gains `{ type: "call_api"; endpointId; body? }`. `applyActions` and `saveRuns` collect `calls` next to `emails` (`callBody` builds each body), and `validateBlueprint` checks for an endpoint id, real placeholder fields and JSON.
- `queueCalls` (`src/server/webhooks.ts`) writes `webhook_delivery` rows with `event_type = 'automation.call'` and the body as the payload. `logSaveRuns` (app saves, public forms, REST/MCP writes) and `runTimedAutomations` call it inside their transactions and log the outcome on the run.
- `automation.call` is a new entry in `WEBHOOK_EVENTS`, so it appears in the endpoint form. Record events never go to an endpoint that didn't subscribe to them, and automation calls go only to the endpoint an automation names.

## Verification, 2026-10-22

Local dev server against an isolated PostgreSQL 17 with a synthetic workspace (`scripts/qa-call-api.mts`: court bookings, an endpoint at a public webhook.site test receiver, a save automation and a daily one). Chrome through Playwright, no page errors. Only synthetic data was sent. Screenshots are in `docs/pr-screenshots/automation-call-api/`.

- Adding the player "Rhea Santos" posted `{"text":"New player: Rhea Santos (0917 555 0199). Say hi at the front desk!"}`, received with `EveryOps-Event: automation.call` and a signature.
- Run now on the daily automation posted one delivery per court. One hit a TLS reset, waited, and went through on its retry from the cron runner (attempt 2, HTTP 200). The cron pass also ran the daily automation on its own schedule.
- Real Vertex (`gemini-3.7-flash`, 35 s): the cancellation request above became a `status_changed` → cancelled automation with `call_api` to the listed endpoint and a Slack body. After Apply, cancelling Bianca Reyes's booking delivered `{"text":"Slot opened up: Court 1 at Thu, Oct 22 · 2:00 PM – 3:00 PM was cancelled."}`.
- `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.

Not covered: custom headers (an Authorization token) on calls, reading the service's answer back into a record, and a deployed environment. Services that need a token in a header can take it in the URL's path or query, as the webhook form already suggests.


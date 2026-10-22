# Webhooks

Owners and admins add endpoints in Settings → Webhooks (up to 10 per workspace). Each gets a signed HTTPS POST when something it subscribes to happens.

| Event | Sent when | `data` |
| --- | --- | --- |
| `record.created` | A record is added (app, API, MCP, form, automation) | `recordType`, `record` |
| `record.updated` | A record's data changes | plus `changedFields` |
| `record.deleted` | A record is deleted | the record as it was |
| `record.status_changed` | A status field changes (also sends `record.updated`) | `field`, `from`/`to` (choice ids), `fromLabel`/`toLabel` |
| `public_form.submitted` | A public form is submitted | `form`, `formName`, `record` |
| `change.applied` | The design moves to another version | `fromVersion`, `toVersion` |
| `automation.call` | An automation's Call step names this endpoint (`docs/automation-call-api.md`) | the automation's body as written, not wrapped in the envelope |
| `webhook.test` | Send test is pressed | a message |

Body: `{ id: "evt_…", type, workspace, occurredAt, data }`. Endpoints can be limited to some record types.

## Delivery

- **Outbox.** Writes call `queueChanges` (`src/server/webhooks.ts`) inside their transaction, so a committed change always has its deliveries and a rolled-back one never does. `sendSoon` posts them right after the response (`after()`).
- **Retries.** Failures are retried after 1, 5, 15, 30, 60, 120, 240, 480 and 480 minutes (picked up by the 15-minute cron sweep, `deliverWebhooks`) and given up 24 hours after the event. After 15 failed deliveries in a row the endpoint turns off and the workspace owner is emailed; turning it back on resumes what's waiting.
- **Resend** inserts a new delivery with the same event id and body, so receivers de-duplicate on `id`.
- **Headers:** `EveryOps-Event`, `EveryOps-Event-Id`, `EveryOps-Delivery`, `EveryOps-Signature: t=<unix>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">`. Reject timestamps older than 5 minutes (`verifySignature` in `src/lib/webhook-signature.ts`).
- **Safety.** Only `https://` URLs without credentials; localhost, `.local`/`.internal` and private, loopback, link-local, carrier-NAT, multicast and metadata addresses are refused when saved (`urlProblem`) and again at connection time: the request resolves the hostname itself and refuses private answers (`publicLookup`), so DNS can't be switched after the check. Redirects aren't followed, 10-second timeout, at most 2 KB of the answer read.
- Delivered and failed rows are kept 30 days.

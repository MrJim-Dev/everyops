# Notifications

Automations can tell people that something happened: a new booking for the owner and the front desk, a
confirmation for the person who booked, a job for the staff member it's assigned to.

## The notify_people step

`{ type: "notify_people", to, title, body?, email? }`. `to` lists who, separated by commas:

| Recipient | Reaches |
| --- | --- |
| `owner` | The workspace owner |
| `admins` | The owner and admins |
| `staff` | Staff members |
| `team` | Everyone in the workspace |
| An email address, or a `{{field}}` holding one (`{{email}}`, `{{player.email}}`) | That address |

Who it reaches is worked out when it's sent (src/server/notifications.ts). Members get an in-app notification,
and an email too when `email` is true. An address that belongs to a member counts as that member; any other
address gets an email. Emails go out with the automation's other emails, under the same daily limit, retries
and run history. `title` and `body` take `{{field}}` placeholders.

It runs wherever automations run: saves in the app, public bookings and forms, the API/MCP, and timed
automations. The step that already existed, `notify`, still only shows a passing notice to whoever saved.

## The bell

Notifications sits under Search in the sidebar, with an unread count. The bell checks for new notifications when
the workspace opens, on focus and every 30 seconds. Clicking one opens its record and marks it read. "Mark all read"
clears them all. They're kept per person (`notification` table, migration 0023) and removed with the workspace or
the person. `GET /api/workspaces/:id/notifications` lists the latest 30; `POST` with `{ ids }` (or `{}` for all)
marks them read.

## Placeholders

Two fixes in `fillTemplate` came from testing this with the real assistant:

- A placeholder can be a formula: `{{guest_email ? guest_email : player.email}}`.
- A currency symbol written before a money placeholder (`₱{{amount}}`) is dropped, so it reads "₱400" and
  not "₱₱400".

## The assistant

`notify_people` uses the assistant's existing fields: `fieldId` is who, and `value` has the title on its first line
and the message after it. The prompt tells it to use `notify_people` to tell anyone anything, and to keep
`notify` for passing notices.

## QA

`tsx --conditions=react-server --env-file=.env.local scripts/qa-notifications.mts` (local databases only).


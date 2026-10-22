# Created by and Last edited by

Two field types show who added a record and who changed it last: `created_by` and `edited_by`. They read as a name
and nobody types into them.

## Where the names come from

The server stamps every record write in `workspace_record.created_by` and `updated_by` (migration 0022). The stamp
is `{ type, id, name }` and comes from whatever made the write:

| Write | Reads as |
| --- | --- |
| Someone in the app (owner, admin, staff) | Their name, or their email if they have none |
| Public form | Public form · <form name> |
| Timed automation | Automation · <rule name> (Automations when several ran in one pass) |
| MCP client or REST API key | The key's name |
| Google Sheets sync | Google Sheets sync |
| Visitor managing a booking | Booking link |

The browser never sets the stamps. It shows the signed-in person's name right after a save (`stampChanged`), and the
server stamps the same person when the save lands. Fields are filled from the stamps every time records are read
(`withActorValues`), so anything typed into them is ignored.

A save counts as an edit only when a field people fill in changes. A total, formula or rollup recalculating, such as a
player's spend after one of their bookings is paid, keeps the last editor (`editedBy`).

Records saved before this change have no stamps, and their fields read blank.

## Other places

- Forms, imports and the record editor leave these fields out. Validation skips them.
- Public pages and shared tables treat them as personal data.
- The AI's schemas have no type for them. A text field named "Created by", "Added by", "Submitted by", "Last edited
  by", "Edited by", "Updated by" or "Modified by" becomes the right type (`actorTypeFor`) in a new design or an
  assistant `add_field`.

## QA

`tsx --conditions=react-server --env-file=.env.local scripts/qa-created-edited-by.mts` (local databases only) builds a
court workspace with an owner (Ana Cruz), a staff member (Ben Lim), a public "Join the club" form and a "Welcome new
players" automation.


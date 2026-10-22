# Record-level access

A record type can be limited so staff and viewers see only their own records: the bookings assigned to them, the
jobs they added. Owners and admins always see everything.

## Setting it

Settings → Team → **What staff and viewers see**. For each record type, choose one of:

- **All <records>** (the default)
- **Only the <records> they added**: by the record's Created by stamp (docs/created-edited-by.md)
- **Only the <records> assigned to them (<field>)**: a person or email field holding the member's name or email,
  compared without regard to case or spaces

It's stored as `Entity.access = { by }` (`by` is the field id, or `created_by`) and saved with the `set_access`
change, so it shows in History and can be undone. Validation checks that the field exists and is a person, email or
text field.

## Where it applies

The rule is in src/lib/engine/access.ts (`canSee`, `visibleTo`, `guardWrites`). The server applies it, so records
a member can't see never reach their browser:

- **Loading a workspace** (`loadWorkspace`): records and revs are filtered. History entries lose the record copies
  they keep for undo. This one copy feeds the browser, the assistant and MCP plans.
- **Sync** (`/api/workspaces/:id/records`): only their records. One that stops being theirs (reassigned) comes back
  as deleted, so it leaves their screen.
- **Saving** (`patchWorkspace`): editing or deleting a record they can't see is refused (403). Their browser works
  totals out from the records it has, so changes that only move formulas and rollups are dropped, and totals are
  worked out on the server from every record. That includes rollups on other records, such as a player's
  booking count.
- **The assistant and MCP record tools** (src/server/ai/record-tools.ts): every SQL lookup gets the same limit
  (`accessScope` in src/server/access.ts). Search, get, aggregate, linked records and names of linked records
  are all covered.
- **MCP and REST writes** (`writeRecord`): a record they can't see is "No record".
- **MCP page, view and availability reads** use only their records.

Screens show it: a limited member's tables say "· only the ones assigned to you" (or "added").

## Not covered

- Totals in a limited member's own screens add up only the records they can see. Stored totals stay correct.
- Public pages, forms and booking pages are unaffected. They have their own field rules.
- Limited members can't undo record changes from History, because those entries no longer carry record copies.
- Automations, webhooks, emails and notifications run on every record, whoever the recipient is.


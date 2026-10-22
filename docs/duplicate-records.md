# Duplicate warnings and merging

The same customer often gets added twice: once at the front desk, once from a booking form, with the phone written
differently. EveryOps now notices and can merge them.

## Matching

`src/lib/engine/duplicates.ts`. Two records of a type match when they share an email or phone. The fields compared are
the type's email and phone fields, plus text fields named like one ("Phone", "Mobile no.", "Contact", "Email"). Emails
compare in lower case; phones by their last 10 digits, so `0995 238 6610`, `0995-238-6610` and `+63 995 238 6610`
are one number. Numbers shorter than 7 digits are ignored.

## Where it shows

- **New record dialog:** "Kevin Sy already has this phone" with **Use Kevin Sy instead**. On a page that opens the
  existing record; inside another form (a booking's "New player") it picks the existing one. It never blocks saving:
  two people can share a phone.
- **Record panel:** "Possible duplicate: Kevin Sy has the same phone", with **Merge…** for people who can edit.

## Merging

The dialog shows both records side by side (their fields and totals) and asks which to keep. Merging:

1. fills the kept record's empty fields from the other,
2. points every link to the other at the kept one (bookings, orders, line items), so totals add up,
3. removes the other.

Moving links isn't an edit to those records, so their save automations don't run again. In a live workspace the merge
runs on the server (`POST /api/workspaces/:id/records/merge`, editors only, through `writeRecord`) over every record,
so a player's older bookings move even when the browser has only recent ones. It's logged as `record.merge` and can't
be undone; a preview workspace merges in the browser with Undo.

## Not covered

- No list of every duplicate in a workspace yet; a duplicate shows when its record is opened or a matching one is added.
- Public forms don't merge on their own; a customer booking twice from a form still makes two records to merge.

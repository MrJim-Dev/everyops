# Spreadsheet import and export

Owners bring their existing lists in from a CSV file, an Excel workbook or a Google Sheet, and take any table out as CSV or Excel.

## Import

Every table view has **Import** for people who can edit records (owners, admins, staff) in a live workspace.

1. **Source.** Drop or choose a `.csv`/`.xlsx` file (up to 10 MB and 5,000 rows), or paste a Google Sheets link shared as "Anyone with the link can view" (the tab in the link is read). `POST /api/workspaces/[id]/import` reads it (`src/server/spreadsheet-import.ts`: CSV with `parseCsv`, Excel with `workbookSheets` in `office.ts`, Google Sheets through its CSV export, fetched only from docs.google.com) and returns each sheet's header and rows as text. Nothing is stored.
2. **Columns.** `suggestMapping` matches columns to fields by name, plurals and common spreadsheet words ("Mobile" is the phone, "Item" the name). Columns still unmatched go to `POST /api/ai/import-map`: Ask EveryOps suggests fields from the header and a few values ("Presyo" holding 95, 110 is the price), marked with a sparkle. Every match can be changed.
3. **Rows.** `previewImport` (`src/lib/engine/import.ts`) turns each cell into the field's value (peso amounts, Philippine month-first dates, Excel day numbers, yes/no, choices by label, links by the linked record's name), checks each row the way a save does (required fields, valid choices, free booking slots, including rows earlier in the sheet), and lists the rows that won't come in with the reason. Rows can update or skip records that match on a chosen field. Required fields the sheet doesn't have get one value for every row (it fills gaps; it doesn't overwrite existing values on update). Owners and admins can add the choices the sheet uses, and anyone can create linked records the sheet names that don't exist yet (a new category). Owners and admins can also import into **a new record type**: `entityFromTable` guesses each column's type from its values and `withNewType` adds the record type, its page and a table.
4. **Apply.** The import is one `ChangePlan` with `source: "import"`: one History entry, undone in one step. Its rows are added in one pass (`applyImportOps`) without the save automations, because imported rows are usually records that already happened: old bookings shouldn't email guests or move stock again. The server leaves the same records out of `logSaveRuns` (`importedIds`). When the record type has save automations the dialog offers **Run automations for these rows** (up to 1,000 rows), which applies the import through the normal save path and lets the server run and log them.

## Export

**Export** on a table view gives CSV (`toCsv`) or Excel. Excel goes through `POST /api/export/xlsx`: the browser sends the rows it shows (the view's filter and columns, `toSheet`), and the server writes a workbook with a bold, frozen header, numbers as numbers (money as `"₱"#,##0.00`), dates as dates in Manila time, and yes/no as true/false.

## Not yet

Automatic Google Sheets sync (a record type linked to a sheet and kept up to date) is a follow-up on #103.



## Google Sheets sync

After importing from a Google Sheets link into an existing record type, owners and admins can tick **Keep … in sync with this sheet**. It needs a match field (a name or code) set to update. From then on the cron job reads the sheet every 15 minutes (`runDueSyncs`, `src/server/sheet-sync.ts`):

- Each run previews the sheet as an import with the saved options (`previewImport` with update-on-match) and applies it with `applyImportOps` inside the workspace lock. Only records whose data changed are written, so a sheet that hasn't changed writes nothing.
- New rows are added and changed rows updated. Rows removed from the sheet stay, and rows with problems are left out and counted.
- The mapping is saved by header name (`src/lib/sheet-sync.ts`), so columns can move. A mapped column that disappears stops the sync with a plain reason.
- Like an import, a sync doesn't run save automations. It does log to the activity log (actor "Google Sheets") and send webhooks, since these are changes happening now. An import's own rows send no webhooks.
- The first run waits for the next pass, so it sees the rows the import is still saving from the browser instead of adding them again.
- The bar above the table shows the last run, with **Sync now** (which refreshes the tab) and **Stop syncing** (the records stay). One sync per record type is stored in `sheet_sync` (migration 0019).
- Two-way sync (writing back to the sheet) needs Google OAuth and isn't built. In development, an `http://localhost` CSV address can stand in for a sheet.

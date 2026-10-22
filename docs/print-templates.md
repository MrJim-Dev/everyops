# Print templates: invoices, quotes and agreements from any record

Records could only be printed from the Register (a sale receipt). An invoice, a quotation, a rental agreement or a payslip had to be retyped somewhere else.

## What owners get

- **Settings → Print templates** lists the workspace's templates. Owners and admins add, edit and remove them; each save is a versioned change that History can undo.
- A template belongs to one record type, has a paper size (A4, Letter or an 80 mm receipt) and is written in markdown with placeholders. The editor starts from a template built from the record type's fields, inserts placeholders from chips, previews against a real record (records with line items first) and points out placeholders that match nothing.
- Every record's **⋯** menu has **Print <template>** for each of its type's templates. A type with no templates gets one built from its fields, so every record can print from the start.
- **Print or save PDF** opens the filled-in document in its own window, sized for its paper, and opens the browser's print dialog once its pictures load. "Save as PDF" in that dialog makes the file. Nothing is generated on the server and no new service is used.

## Placeholders

| Placeholder | Becomes |
| --- | --- |
| `{{field}}` | The record's value as people read it: ₱1,200, Thu, Oct 22, 10:48 AM, an option's label, a linked record's name |
| `{{link.field}}` | A field of the record it links to (`{{customer.phone}}`), up to three links |
| `{{lines}}`, `{{lines:type}}` | A table of the record's line items (order lines of an order): the item first, then up to five filled columns, numbers right-aligned |
| `{{business}}`, `{{today}}` | The workspace name and today's date |

Picture fields print as the picture. File fields never print. A placeholder that doesn't resolve prints blank.

## How it works

- `Blueprint.printTemplates` (optional, so older blueprints are unchanged) holds `{ id, entityId, name, body, paper }`. Change ops `add_print_template` (adds or replaces by id) and `remove_print_template` edit it; `remove_entity` removes the templates of the type it removes. `validateBlueprint` checks ids, names and record types.
- `src/lib/engine/print.ts`: `renderPrint` fills a template for one record, `starterTemplate` builds the starting template, `placeholderOptions` and `unknownPlaceholders` drive the editor. Every value is escaped for markdown, so a record's text can't add formatting, links or HTML (and react-markdown never renders raw HTML).
- `src/components/print/print-dialog.tsx` renders the markdown on paper; the preview and the printed window share one stylesheet (`paperCss`) so they match.
- Values use the same formatting as email automations (`readable`). That formatter now reads a rollup of money as money: `{{total}}` of an order printed "70" instead of "₱70", in emails as well.
- Ask EveryOps doesn't write templates yet. Its answer schema is close to Gemini's structural limit, so templates are made in Settings for now.

## Verification, 2026-10-22

Local dev server against an isolated PostgreSQL 17 (port 5547) with a synthetic workspace (`scripts/qa-print-templates.mts`: the canteen POS sample with a "Sales invoice" template on orders). Chrome through Playwright, no page errors. Screenshots are in `docs/pr-screenshots/print-templates/`.

- Settings listed the template; the editor previewed it against an order with its line items; typing `{{po_number}}` showed the "doesn't match a field" warning.
- New template from the starter, saved as "Quotation": listed in Settings and in History as "Added print template Quotation" with Undo.
- Order #1420's ⋯ menu offered "Print sales invoice"; the preview showed three line items with right-aligned peso amounts and a ₱135 total; Print opened "Sales invoice #1420", which Chrome saved as a one-page A4 PDF (`09-saved-pdf.png`).
- A product (no templates) printed from the built-in template.
- `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.

Not covered: physical printers and Safari/Firefox print dialogs, and a deployed environment.


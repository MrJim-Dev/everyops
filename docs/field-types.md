# Field types: email, phone, link, file, and filtered rollups

Contact details and documents were stored as plain text or not at all: emails and phone numbers weren't checked or clickable, websites didn't open, and uploads took pictures only. Rollups added up every child record, so "paid so far" needed extra formula fields.

## What's new

| Type | Stored as | Checked | Shown as |
| --- | --- | --- | --- |
| `email` | text | name@domain.tld | a mailto: link |
| `phone` | text as typed | 7–15 digits with + ( ) - . and spaces | a tel: link |
| `url` | text; a bare domain gets https:// | http(s) with a real host | host and path, opens in a new tab |
| `file` | `/api/files/<workspace>/docs/<uuid>.<ext>?name=<original name>` | an upload of this workspace | a chip with the file name that downloads |

- **Files** accept PDF, Word, Excel, PowerPoint, CSV, text and pictures up to 10 MB, recognised by their bytes (`documentType`); HTML, SVG and binaries named .txt are refused. They're stored under the workspace's `docs/` and served only to people on its team, always as a download with the original name. Pictures in image fields stay public as before (QR codes on booking pages).
- **Public pages:** email, phone and file fields count as personal data (`personalField`), so public pages and shared tables never show them, and a record type with email or phone fields counts as being about people. Public forms still ask for email, phone and links with the right keyboard; a wrong value is refused with a message. File fields aren't offered on public forms.
- **Filtered rollups:** `rollup.filter` is a formula on the child records (`status == "paid"`); only children it's true for are counted. Validation checks it against the child's fields.
- Table cells edit email, phone and link values in place.

## AI

Setup's designer and the assistant share the field schema, which sits near Gemini's structural limit. The four new type values are paid for by turning `formula.resultType` and `rollup.op` into described strings; validation names a wrong value and the repair round fixes it. A text field Gemini still names exactly Email, Phone or Website becomes the matching type (`contactType`).

The lookup gate refused design requests that mention statuses or numbers ("a count of only their paid bookings"): Gemini rightly looked nothing up and the assistant answered "I couldn't verify the records". A change to the design now still gets a lookup but doesn't need one.

## Verification, 2026-10-16

Local production build against an isolated PostgreSQL 17, a synthetic workspace (`scripts/qa-field-types.mts`), Cloud Storage replaced by a local stand-in through `STORAGE_EMULATOR_HOST` (nothing written to the production bucket), Chromium through Playwright, no page errors.

- Players table: clickable emails and phones; paid-only rollup ₱2,400 next to ₱3,600 total spent.
- Uploading "Signed waiver - Rhea.pdf" in the record panel stored it; the download came back as `Signed waiver - Rhea.pdf` starting with `%PDF`; the same link signed out returned 404.
- `rhea@` was refused in the panel; a public submission with `visitor@` got a 422 with the message, a valid one was saved.
- Public "Join the club" form: email and tel inputs, no file input.
- Real Vertex: Ask EveryOps planned a phone field, a file field and a paid-only count rollup in 20 s, and Apply added them. Setup's repair-shop design eval passed 2 of 2 runs on this branch (48 s, 48 s); the unchanged design passed 1 of 2 in the same session.
- `pnpm typecheck`, `pnpm lint`, `pnpm test` (452 tests), `pnpm build`.

Not covered: the real Cloud Storage bucket, deployment, and created-by/edited-by, duration, rating and address types (follow-up).

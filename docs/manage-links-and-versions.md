# Custom pages: manage links, page versions and reusable pictures

Custom HTML pages already bind live data, refresh and have link previews (PR #87). Three gaps remained: after booking, a visitor couldn't come back to their booking or send a proof of payment later; saving a page overwrote it with no way back; and a picture uploaded for one page couldn't be found again for another.

## Manage links

A public booking now returns `manage`, a link to that one booking: `/b/TOKEN`. The standard form's thank-you and setup's custom booking page show it.

- `/b/TOKEN` shows the business name, the booking's title, reference and status, what the visitor gave and what it costs, and an upload for every picture field the form asks (proof of payment). Uploading saves into that record like any write: the workspace row locked, the record's rev bumped so open tabs merge it.
- Custom pages opened with `?manage=TOKEN` read the same through `EveryOps.mine()` and add a picture with `EveryOps.attach(fieldId, file)`; setup and the assistant know the contract (`html-capabilities.ts`).
- The token (`src/server/manage.ts`) is HMAC-signed with the app secret and names the workspace, the form and the record; it expires after 60 days. A changed token, another workspace's form, a field the form doesn't ask or anything but a real picture is refused, and reads and uploads are rate-limited per address. Nothing else about the booking can be read or changed.

## Page versions

`writePages` keeps the text a save replaces in `workspace_page_version` (migration `0011`) when the newest kept version is more than 3 minutes old (autosave runs every second or so), and always when a page is removed; the last 20 per page stay. A page saved for the first time keeps the text the design started it with (setup's website) as its first version. The HTML editor's **Versions** lists them; **Restore** puts that text back in the editor, which saves it like any edit (so it is kept in turn) and offers Undo.

## Pictures

**Picture** in the HTML editor is now a menu: upload a picture, or insert one already used in this workspace's pages. Pictures are hosted (`/api/files/...`) and don't count toward the 400 KB page limit.

## Verification, 2026-10-16

Local production build, isolated PostgreSQL 17, a synthetic workspace (`scripts/qa-html-pages.mts`: court bookings, setup's website, a booking form asking an optional proof of payment, and a public "My booking" page using `EveryOps.mine/attach`), Cloud Storage replaced by a local stand-in (nothing written to the production bucket), Chromium through Playwright, no page errors.

- A public booking returned `manage`. On a phone, `/b/TOKEN` showed Court 2, Sat Oct 17 11 AM–12 PM, GCash, ₱400, Unpaid; uploading a receipt marked Proof of payment received, and the record held the picture.
- The custom page with `?manage=` drew the same booking and "Received"; without a token it asked to open the booking link. A changed token showed "doesn't work any more".
- In the editor, the uploaded picture appeared in the Picture menu; Versions listed setup's original text (kept on the first save) and Restore brought it back with Undo.
- `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`. `manage.test.ts` covers changed, expired and wrongly signed tokens.

Not covered: the confirmation link inside setup's booking page and the standard form was not clicked through end to end (the API response carrying it was); real Cloud Storage; deployment.

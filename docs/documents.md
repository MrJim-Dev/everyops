# Documents

Documents (`/w/[workspace]/documents`, in the sidebar under Ask EveryOps) is every file a workspace keeps, in one list:
files the team uploads (contracts, photos, videos, audio, spreadsheets), exports kept from tables and Settings, and
files attached to records. It shows how much of the workspace's storage they take (WORKSPACE_STORAGE_MB, default 1 GB).

## Who can do what

Everyone on the team can open, preview and download. Staff and up can upload. Whoever added a file, or an owner or
admin, can rename it, move it to a folder or delete it. Files attached to records are removed from the record, never
from Documents, so a record never points at a missing file. Signed-out requests and other workspaces get a 404.

## The bucket (`UPLOAD_BUCKET`, everyops-prod-uploads)

One folder per workspace, and a folder per kind of file inside it:

| Path | What | Who can read it |
| --- | --- | --- |
| `<workspace>/files/<uuid>.<ext>` | uploaded in Documents | the team |
| `<workspace>/exports/<uuid>.<ext>` | exports kept from tables (CSV, Excel) and Settings (JSON) | the team |
| `<workspace>/docs/<uuid>.<ext>` | file fields on records | the team |
| `<workspace>/<uuid>.<ext>` | pictures on records and pages (QR codes, logos) | anyone with the link |
| `ai/<account>/<uuid>.<ext>` | files attached to Ask EveryOps | the account; deleted after 90 days |

Object names are random, the people-facing name is kept in the database (`file_upload.display_name`), so a rename never
moves an object. The bucket keeps deleted objects for 7 days (soft delete).

## How it works

- `file_upload` (migration `0024_documents.sql`) is the catalog: every stored file with its size, name, type, source
  (upload, export, record), folder and who added it. The team's uploads are checked against the workspace's limit
  (`assertStorageRoom` in `src/server/storage-usage.ts`) before anything is written; files visitors send on public pages
  (payment proofs, signatures) are counted but never refused. When plans arrive, the limit can come from the plan.
- Types are checked by their bytes against the name (`documentFileType`): pictures, PDF, Word/Excel/PowerPoint, CSV, text,
  Markdown, JSON, MP4/MOV/WebM video, MP3/M4A/WAV audio. HTML, SVG, archives and programs are refused. Files are served
  with `nosniff` and a sandbox CSP; only pictures, video and audio open in the page.
- Up to 25 MB a file goes through the app. Bigger files (up to 500 MB) go straight from the browser to storage in a
  resumable upload the server opens for that origin only (no signed URLs or bucket CORS needed); the server then reads
  the start of what arrived, checks its type, size and the room again, and deletes it if anything is off.
- Video and audio are streamed in byte ranges (`/api/files/...`), so they play and seek without loading whole and pass
  Cloud Run's 32 MiB response limit.
- Table exports (CSV, Excel) and Settings exports (blueprint, records) download as before and keep a copy in
  Documents → Exports, with a "Saved to Documents" notice.

## Release

1. `pnpm db:migrate` (`0024_documents.sql`). Optional: set `WORKSPACE_STORAGE_MB` (default 1000).
2. `tsx --conditions=react-server --env-file=.env.local scripts/backfill-documents.mts` lists files stored before
   Documents kept a catalog (dry run); add `--apply` to add them. It reads the bucket and writes `file_upload` only.

## Proof

Local dev server against an isolated PostgreSQL 17 and a local Cloud Storage stand-in (`scripts/storage-stand-in.mjs`
through `STORAGE_EMULATOR_HOST`; nothing was written to the production bucket), with `scripts/qa-documents.mts`. Chrome
through Playwright. Screenshots are in `docs/pr-screenshots/documents/`.

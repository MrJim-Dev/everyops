# EveryOps

Describe your business, and EveryOps builds the systems it needs (bookings, POS, content, finance, HR) inside one workspace. Built for the Google Cloud AI Builder Cup 2026.

Everything is stored in PostgreSQL (Cloud SQL): accounts and sessions (Better Auth), workspaces, teams, invites, community systems and starter templates. Gemini on Vertex AI runs the setup conversation, designs new workspaces, and plans changes; the app validates everything it produces before the owner sees it.

## Run it

```bash
pnpm install
pnpm env:pull     # writes .env.local from Google Secret Manager (gcloud signed in to everyops-prod)
pnpm db:proxy     # Cloud SQL Auth Proxy on 127.0.0.1:5433; keep it running in its own terminal
pnpm db:migrate   # creates or updates the auth tables
pnpm db:seed      # creates the demo account
pnpm dev          # http://localhost:3000
pnpm test         # engine tests (Vitest)
pnpm typecheck    # route types + TypeScript
pnpm lint         # Biome
pnpm build
```

The first visit seeds four demo workspaces: Court House PH, Tita Nena's Canteen, Kapé Ilaya and Sunrise Bakeshop.

## Data

| Table | Holds |
|---|---|
| `workspace` | One JSON document per workspace (blueprint versions, records, change history, setup conversation) and its owner |
| `workspace_member`, `workspace_invite` | Team access (admin, staff, viewer) and pending invite links |
| `published_system` | Community systems: official templates (`is_official`, with sample data) and systems people publish |
| `workspace_template` | The demo workspaces every new account starts with (`account_seed` records that it happened) |

Templates store the day their sample data was built; dates move forward to today whenever one is used (`src/lib/catalog/shift.ts`). `pnpm db:migrate` applies Better Auth's schema and `src/server/migrations/*.sql`; `pnpm db:seed` refreshes templates from `src/lib/catalog`. The API checks access on every request: owners and admins save whole workspaces and the team, staff save records only, viewers read.

## Deployment

**Live:** https://everyops-web-223724593768.asia-southeast1.run.app

EveryOps runs on Cloud Run as the service `everyops-web` (project `everyops-prod`, `asia-southeast1`). `pnpm deploy:run` builds the `Dockerfile` (Next.js standalone, Node 22) with Cloud Build and deploys it as `everyops-run`, attached to Cloud SQL, with `DATABASE_URL` and `BETTER_AUTH_SECRET` from Secret Manager and `BETTER_AUTH_URL` set to the service URL. It scales to zero by default; run `MIN_INSTANCES=1 pnpm deploy:run` to keep one warm instance during judging. Password reset links appear in Cloud Run logs until email is connected.

## Database and auth details

The database is `everyops` on the Cloud SQL instance `everyops-db` (PostgreSQL 17, project `everyops-prod`, `asia-southeast1`), reached as `everyops_runtime`, which owns the database. Connections are encrypted end to end: Cloud Run uses its built-in Cloud SQL socket and local development uses the Cloud SQL Auth Proxy, so no IP addresses are allowlisted. Credentials live in Google Secret Manager: `everyops-db-password`, `everyops-database-url` (the Cloud Run socket URL), `everyops-better-auth-secret` and `everyops-db-postgres-password` (admin, for operators only). See `.env.example` for every variable.

| File | Role |
|---|---|
| `src/server/db.ts` | The Kysely instance (one pool per process, opened lazily) |
| `src/server/auth.ts` | Better Auth: email and password, Google when `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` are set, 30-day sessions, rate limiting |
| `src/app/api/auth/[...all]/route.ts` | Better Auth's HTTP endpoints |
| `src/lib/auth/client.ts` | Browser client: `useCurrentUser`, `useAuthReady`, `signIn`, `signUp`, `signOut`, reset, profile and account actions |
| `src/proxy.ts` | First gate: private pages without a session cookie redirect to `/sign-in?next=…` |
| `src/components/auth/require-session.tsx` | Second gate: validates the session on the server before a private page renders |

Private pages are `/`, `/account` and everything under `/w/`. Sign-in pages, `/community`, `/preview/…`, invites and the legal pages are public.

## How it works

A client's system is a **blueprint**: a small JSON document that lists entities, fields, formulas, screens, widgets and rules (`src/lib/blueprint/types.ts`). One engine and one set of view components render any blueprint, so nothing is generated or deployed per client.

```
blueprint (JSON) ──► engine (src/lib/engine) ──► views (src/components/views, widgets)
        ▲                         │
  Ask EveryOps (src/lib/assistant)   └──► records (JSON fields per record)
```

| Folder | What lives there |
|---|---|
| `src/lib/blueprint` | Types, lookups and validation for blueprints |
| `src/lib/engine` | Formula language, compute, records and rules, availability, aggregates, change plans with undo |
| `src/lib/catalog` | Community systems (blueprint + sample data) and the demo workspaces |
| `src/lib/assistant` | Setup interview and change planner. **Gemini plugs in here.** |
| `src/lib/store` | Workspace model and the browser store, which loads from `/api/workspaces` and saves each changed workspace back (debounced) |
| `src/components/views` | One component per view type: table, kanban, calendar (month, week, day), schedule, checkout, approval queue, form, notes, document, landing and canvas |
| `src/components/editor` | Markdown rendering (`react-markdown` + GFM, no raw HTML) and the editor: [MDXEditor](https://mdxeditor.dev) (rich text with headings, lists, checklists, links, tables, code, uploaded pictures, and a markdown source view), loaded in the browser only |
| `src/components/canvas`, `src/lib/canvas` | Canvas pages (`type: "canvas"`), built with [Konva](https://konvajs.org) after its Canvas Editor demo: shapes, text, sticky notes, arrows and pictures; select, drag, resize, rotate; edit text in place; reorder, duplicate, undo/redo, zoom/pan and PNG export. The drawing is JSON in the workspace docs under the view id |
| `src/components/widgets` | Dashboard stats, charts, progress and lists |
| `src/components/records` | Shared field display/input, record panel, create dialog |
| `src/components/workspace` | Workspace context, used by saved workspaces and previews alike |

## AI (Gemini on Vertex AI)

Gemini runs only on the server, through Vertex AI in `asia-southeast1`, signed in as the Cloud Run service account (locally, gcloud's Application Default Credentials). There are no API keys.

| File | Role |
|---|---|
| `src/server/ai/gemini.ts` | Vertex AI client and `generateJson`: structured JSON checked against a Zod schema, a 25-second timeout, and token and latency logging |
| `src/server/ai/rate-limit.ts` | Per-user AI request limit (`AI_RATE_LIMIT` per 10 minutes, default 30) |
| `src/server/ai/plan-change-prompt.ts` | Instructions and output schema for planning workspace changes, including the formula language |
| `src/server/ai/plan-change.ts` | Turns Gemini's answer into `ChangeOp`s, rejects anything that doesn't fit the blueprint or fails `validateBlueprint`, and gives Gemini one repair attempt with the errors |
| `src/app/api/ai/plan-change/route.ts` | `POST` endpoint: signed-in users only, size-limited, rate-limited |
| `src/lib/assistant/ai-client.ts` | Browser helper used by Ask EveryOps; falls back to the built-in planner only if Gemini is unreachable |
| `src/server/ai/interview*.ts` | Setup conversation: asks short follow-up questions with tap-to-send suggestions, keeps a profile of the business, and decides when to design |
| `src/server/ai/design*.ts` | Designs the workspace (blueprint plus sample records) from the conversation's brief, with one sidebar page per area the owner manages; tidies small slips, gives any record type left without a screen its own page (`ensurePages`), validates it, and repairs up to twice |
| `src/app/api/ai/interview`, `src/app/api/ai/design` | The setup endpoints used by `src/components/setup/setup-interview.tsx` |
| `src/server/ai/assistant*.ts` | The workspace assistant: answers questions from the workspace's own data, asks one short question when a request is unclear, or returns a change plan (design ops plus record creates and updates), validated and rehearsed on a copy, with one repair attempt |
| `src/app/api/ai/assistant/route.ts` | `POST` endpoint: loads the workspace from the database with the caller's role. Owners and admins can change the design, staff can add and update records, viewers can only ask |
| `src/components/assistant/assistant-panel.tsx`, `src/lib/assistant/panel-store.ts` | The collapsible side panel (⌘J, the sidebar's Assistant entry, or Ask AI on any system page; a sheet on phones). Plans show as cards with Apply, Not now and Undo, and land in History |

The model is `gemini-3.5-flash` (`GEMINI_MODEL`). Conversation turns take 3–10 seconds and a design about 20. Leave temperature at its default and only lower thinking for the designer and the assistant: lowering them elsewhere made Gemini 3 models loop, and the `global` endpoint stalled often, which is why the regional endpoint is used.

## Public pages

A workspace can publish a landing page and forms at `/s/<workspace>/<view>` for people without an account.

| File | Role |
|---|---|
| `src/lib/public/resolve.ts` | Turns a public view into plain, pre-formatted data: only fields a block lists, only choices visitors may see (bookable resources, or record types a public block shows). Used by the public site and the in-app preview |
| `src/lib/public/slots.ts` | Free and taken slots of a resource on a day, for public booking forms |
| `src/server/public.ts`, `src/app/api/public/*` | Page data, slots, and submissions: accepted fields only, the same engine checks as the app (required fields, double bookings, rules), the workspace row locked while saving, and a per-address limit |
| `src/app/s/[workspace]/[[...view]]`, `src/components/public` | The public site: blocks (hero, markdown, live records as cards/list/table/FAQ, embedded forms, sandboxed HTML) and the booking form with a slot picker |
| `src/server/storage.ts`, `/api/uploads`, `/api/files/*` | Image fields (QR codes, logos) in the Cloud Storage bucket `everyops-prod-uploads`. Types are checked by their bytes; SVG is refused; names are random UUIDs |

Bookings made on a public page are written on the server. Saves from an open tab keep any record created after the tab last read the workspace (`syncedAt`), and open tabs pull new records every 30 seconds and on focus.

## Design rules

- Dark, compact, Linear-inspired. Tokens live in `src/app/globals.css` with one accent (#3FA796).
- Geist and Geist Mono. Numbers are tabular.
- Motion follows Emil Kowalski's rules. ⌘K opens with no animation. Panels use a 220 ms ease-out curve. Buttons scale to 0.97 when pressed. Reduced motion is respected.
- shadcn/ui on Base UI with Phosphor icons. Vendored components live in `src/components/ui` and are excluded from lint.
- Times are Asia/Manila. Money is PHP.

## Known limits of this build

- Saves are last-write-wins per workspace: two people editing the same workspace at the same moment can overwrite each other.
- The interviewer guides booking businesses. Other business types are pointed to a matching community system.
- The assistant can add fields, record types, views, dashboard widgets, pages and rules, move a tab onto its own page, rename pages and tabs, and create or update records. It doesn't delete fields, pages or records; it says so and points to Settings.
- Status badges in tables, kanban cards and the record panel are menus: click one to change the status in place (owners, admins and staff).
- Assistant conversations live in the browser tab's memory; the changes they make are saved with the workspace and listed in History.
- Official community systems keep their sample authors and usage counts. Invites are links; email isn't sent yet.

## Accounts

Workspaces need an account. Community systems and their previews stay public.

| Page | What it does |
|---|---|
| `/sign-in` | Email and password, a "Fill in the demo account" shortcut, and a return to the page you were on (`?next=`) |
| `/sign-up` | Name, email and password with a strength meter. Duplicate emails are rejected |
| `/forgot-password` | Always shows the same confirmation. Email isn't connected yet, so the reset link is written to the server log |
| `/reset-password` | Single-use link, valid for 30 minutes, with a confirmation field |

Demo account: `james@everyops.app` / `everyops2026`.

Each account has its own workspaces; the demo workspaces are created on an account's first sign-in.

| Page | What it does |
|---|---|
| `/account` | Change name and password; delete the account and its workspaces (password required) |
| `/w/[workspace]/settings` | Rename (versioned and undoable), export the blueprint and records as JSON, delete (type the name to confirm) |
| `/terms`, `/privacy` | Plain-language policies for the prototype |

Accounts live in PostgreSQL through Better Auth, with scrypt password hashes and HttpOnly session cookies. "Continue with Google" works once Google OAuth credentials are set; until then it explains that it's coming soon.

## Team and Community publishing

Both are tabs in workspace Settings, next to General. Publish only shows for owners and admins.

| Page | What it does |
|---|---|
| `/w/[workspace]/settings/team` | Invite by email with a role, copy or revoke invite links, change roles, remove people, or leave a shared workspace |
| `/invite/[token]` | Shows who invited you and the role, then joins after you sign in or create an account |
| `/w/[workspace]/settings/publish` | Publish the workspace design to Community, publish new versions, or unpublish. Records, team and history stay private |

| Role | Can do |
|---|---|
| Owner | Everything, including deleting the workspace |
| Admin | Ask EveryOps for changes, undo, rename, publish, manage the team |
| Staff | Add and edit records |
| Viewer | View only |

Shared workspaces show "Shared with you" on the home page. Roles live in `src/lib/store/workspaces.ts` (`roleOf`, `canManage`, `canEdit`); published systems live in `src/lib/community/published.ts`.

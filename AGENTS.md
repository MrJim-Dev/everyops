<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# EveryOps

Describe your business, and EveryOps builds the systems it needs (bookings, POS, HR, finance, content) inside one workspace. Built for the Google Cloud AI Builder Cup 2026 (submission deadline 2026-10-18). README.md has the full architecture; this file is the working rules.

## Commands

```bash
pnpm env:pull     # .env.local from Google Secret Manager (gcloud, project everyops-prod); never print or commit it
pnpm db:proxy     # Cloud SQL Auth Proxy on 127.0.0.1:5433; required for local dev, migrate and seed
pnpm db:migrate   # Better Auth tables; idempotent
pnpm db:seed      # demo account james@everyops.app / everyops2026; idempotent
pnpm dev
pnpm typecheck && pnpm lint && pnpm test && pnpm build   # all must pass before committing
```

Use pnpm only. `pnpm build` matters: `cacheComponents` errors (below) only show up there.

## Architecture boundaries

- A business's system is a **blueprint** (JSON) rendered by one generic engine (`src/lib/engine`) and one set of views. Never generate or run per-client code; AI output must be a validated blueprint or change plan (`src/lib/blueprint/validate.ts`).
- `src/lib/assistant` (interview, change planner) is where Gemini plugs in. Keep its input/output shapes so the UI doesn't change.
- Nothing is stored in localStorage. Workspaces live in Postgres (`workspace` JSON documents plus `workspace_member`/`workspace_invite`); the browser store (`src/lib/store/workspaces.ts`) loads them from `/api/workspaces` and saves changed workspaces back. Access rules are enforced in `src/server/workspaces.ts`, never only in the UI.
- Canvas pages (`type: "canvas"`, `entityId: ""`) store `{ version: 1, shapes }` JSON in `docs` by view id; always read it through `parseCanvas`. Konva and MDXEditor need the DOM: load them with `next/dynamic` and `ssr: false`, never import them from server code.
- Document pages (`type: "document"`, `entityId: ""`) store their markdown in the workspace doc's `docs` map by view id, saved through `saveDoc`; staff saves keep `records` and `docs`. Notes and form views are ordinary record views. `applyOps` copies its ops: a plan is applied once on the server to rehearse it and again in the browser, so never let an op object end up inside the blueprint.
- Starter templates (official community systems, demo workspaces) are database rows refreshed by `pnpm db:seed` from `src/lib/catalog`. Schema changes go in a new `src/server/migrations/NNNN_name.sql` applied by `pnpm db:migrate`.
- Ask EveryOps setup: `src/server/ai/interview*.ts` (conversation) and `src/server/ai/design*.ts` (blueprint + samples, tidied and validated, up to two repairs).
- Workspace assistant: `src/server/ai/assistant*.ts` → `/api/ai/assistant` → `src/components/assistant/assistant-panel.tsx`. It returns an answer, a question, or a `ChangePlan` (`ops` plus `recordOps`) that the browser applies through `applyChange` only after the person presses Apply. Role checks happen in the route (`canManage` for design ops, `canEdit` for record ops) and again on save in `src/server/workspaces.ts`. New plan op types go in `src/lib/engine/changes.ts` with undo support, then in the assistant schema and `toDesignOps`. Keep the Gemini schema flat: renames live in their own `renames` list because Gemini would not fill a name on rename ops inside `ops`. Measure assistant changes with a batch of real requests through `/api/ai/assistant`, not a single run.
- Everything the assistant does must be undoable. Plans apply through `applyPlan`/`undoPlan` (`src/lib/store/apply-plan.ts`): design changes are new blueprint versions, and the history entry keeps records it deleted (`removedRecords`), page text it replaced (`replacedDocs`) and the team before (`teamBefore`). Undo is newest first. Anything that can't be undone (removing a member, deleting the workspace or account, passwords) stays out of plans; the assistant links to the settings page instead. Staff saves may add data-only history entries (`mergeStaffChanges`).
- `/api/ai/assistant` streams JSON lines: `{ type: "status" }` while it works (from `onStatus` in `assistantTurn`), then `{ type: "result" }`. Answers carry `sources` (record, page or tab ids resolved by `resolveSources`). Conversations are saved per person and workspace in `assistant_thread` through `/api/ai/threads`.
- Gemini rejects the assistant's answer schema past a structural budget (properties, optional fields, enum values, union branches; descriptions don't count) with a bare 400 "invalid argument". Before adding to `assistantAnswer`, probe the full schema against Gemini; prefer one generic shape (like `remove`) or a plan-level list over repeating shapes inside `ops`.
- Server-only code lives in `src/server` (database, auth, session). Never import it from a `"use client"` file.

- Public pages: landing views (`entityId: ""`, blocks) and form views with `public: true` are served at `/s/[workspace]/[view]` from `src/lib/public/resolve.ts`. Never send a visitor anything that function doesn't produce, never expose relation choices for people-like record types, and keep statuses and prices off public forms. HTML blocks only render in the sandboxed iframe (`allow-scripts`, never `allow-same-origin`).
- The server writes records too (public submissions). Every save path merges with `mergeRecords(stored, incoming, syncedAt)` inside a transaction that locks the row (`lockedRecords`); don't add a save path that overwrites `records` blindly.
- Uploads go through `src/server/storage.ts` only (bucket `UPLOAD_BUCKET`, default `everyops-prod-uploads`; `everyops-run` has objectAdmin on it). Image values must pass `isImagePath`.

## Database and auth

- Postgres database `everyops` on Cloud SQL `everyops-db` (PostgreSQL 17, project `everyops-prod`, `asia-southeast1`, connection `everyops-prod:asia-southeast1:everyops-db`), login `everyops_runtime`. Secrets in Google Secret Manager: `everyops-db-password`, `everyops-database-url`, `everyops-better-auth-secret`. Check `gcloud config get project` is `everyops-prod` (account ocampojamesss@gmail.com) before any Google Cloud change.
- Cloud Run runs as `everyops-run@everyops-prod.iam.gserviceaccount.com` (Vertex AI user, Secret Manager accessor, Cloud SQL client). Never deploy as the default compute service account.
- Kysely is the only query layer (`src/server/db.ts`); add app tables to its `Database` type. No ORM. Never open the instance to public IPs; connect through the socket or the proxy.
- Better Auth (`src/server/auth.ts`) owns `user`, `session`, `account`, `verification`; change them through its config plus `pnpm db:migrate`, never by hand.
- Browser code uses `src/lib/auth/client.ts` only (`useCurrentUser`, `useAuthReady`, `signIn`, …). Keep its `AuthResult` messages: one message for unknown email and wrong password, same confirmation whether or not a reset email exists.
- Page protection has two layers, and both are required: `src/proxy.ts` (cookie presence only, private paths in `config.matcher`) and `<Suspense><RequireSession next=…>` in the page or layout (real session check). The client `RequireAuth` guard is for sign-out transitions, not security. Server functions and route handlers must check the session themselves.
- Private: `/workspaces`, `/account`, `/w/*`. Public: `/` (signed-in home; with no session cookie `proxy.ts` rewrites it to the `/welcome` landing page), sign-in/up/reset, `/community`, `/preview/*`, `/invite/*`, legal pages. Post-auth redirects go through `safeNext()`.
- Email isn't connected: reset links are logged by `sendResetPassword`. Google sign-in turns on when `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` are set.

## Next.js 16 specifics

## AI

- Gemini is called only from server code in `src/server/ai` (Vertex AI, `asia-southeast1`, model from `GEMINI_MODEL`, default `gemini-3.5-flash`). Never call it from the browser and never add API keys; Cloud Run uses the `everyops-run` service account and local dev uses gcloud ADC.
- Every AI feature returns structured JSON through `generateJson` with a Zod schema, and its output must pass the same validation the app already uses (`validateBlueprint`, op checks) before the user sees it. Nothing is applied without the owner's approval.
- AI routes check the session and `takeAiToken`. Keep prompts in a `*-prompt.ts` module next to the feature so they can be tested directly.
- Don't lower temperature on Gemini 3 models (they loop), and don't use the `global` location (it stalls). Only the designer and the assistant set `thinking: "LOW"`.


- `cacheComponents` is on: anything reading `headers()`, `cookies()` or awaited `params` on the server must sit inside `<Suspense>`.
- Use `proxy.ts`, not `middleware.ts`. Read `node_modules/next/dist/docs/` before using an API you haven't checked.

## Conventions

- TypeScript strict, Biome (2 spaces, 110 columns): run `pnpm exec biome check --write src scripts`. `src/components/ui` is vendored shadcn on Base UI; avoid editing it.
- UI: dark, compact, Linear-like. Tokens in `src/app/globals.css`, Geist fonts, Phosphor icons, motion per the README design rules. Times are Asia/Manila, money is PHP.
- Brand assets: `public/brand/` (SVG logos), `src/app/{favicon.ico,icon.svg,apple-icon.png,opengraph-image.png}`, `src/components/brand/logo.tsx` (stacked-bar "E"). Source files are in `../UI Mockups/branding/everyops`.
- Tests: Vitest, `src/**/*.test.ts`, for engine and logic. Test behavior, not implementation.

## Git

Deploy with `pnpm deploy:run` (Cloud Run service `everyops-web`, scripts/deploy.sh). Live URL: https://everyops-web-223724593768.asia-southeast1.run.app. After a deploy, verify the live URL (sign-in, protected redirects) and check `gcloud logging read` for errors; a successful build is not proof.

## Git workflow

- Repo `MrJim-Dev/ai-builder-cup-2026`. Work on `dev` (this checkout, `everyops-build`); `main` is the sibling worktree `../everyops` and is fast-forwarded to `dev` when releasing.
- Conventional commit messages (`feat(auth): …`, `fix(engine): …`). Never commit `.env.local` or secrets.

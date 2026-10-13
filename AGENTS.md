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
- Workspaces, versions, records and change history still live in the browser (Zustand + localStorage, `src/lib/store/workspaces.ts`), filed per account id. Bump `DATA_VERSION` when demo blueprints change.
- Server-only code lives in `src/server` (database, auth, session). Never import it from a `"use client"` file.

## Database and auth

- Postgres database `everyops` on Cloud SQL `everyops-db` (PostgreSQL 17, project `everyops-prod`, `asia-southeast1`, connection `everyops-prod:asia-southeast1:everyops-db`), login `everyops_runtime`. Secrets in Google Secret Manager: `everyops-db-password`, `everyops-database-url`, `everyops-better-auth-secret`. Check `gcloud config get project` is `everyops-prod` (account ocampojamesss@gmail.com) before any Google Cloud change.
- Cloud Run runs as `everyops-run@everyops-prod.iam.gserviceaccount.com` (Vertex AI user, Secret Manager accessor, Cloud SQL client). Never deploy as the default compute service account.
- Kysely is the only query layer (`src/server/db.ts`); add app tables to its `Database` type. No ORM. Never open the instance to public IPs; connect through the socket or the proxy.
- Better Auth (`src/server/auth.ts`) owns `user`, `session`, `account`, `verification`; change them through its config plus `pnpm db:migrate`, never by hand.
- Browser code uses `src/lib/auth/client.ts` only (`useCurrentUser`, `useAuthReady`, `signIn`, …). Keep its `AuthResult` messages: one message for unknown email and wrong password, same confirmation whether or not a reset email exists.
- Page protection has two layers, and both are required: `src/proxy.ts` (cookie presence only, private paths in `config.matcher`) and `<Suspense><RequireSession next=…>` in the page or layout (real session check). The client `RequireAuth` guard is for sign-out transitions, not security. Server functions and route handlers must check the session themselves.
- Private: `/`, `/account`, `/w/*`. Public: sign-in/up/reset, `/community`, `/preview/*`, `/invite/*`, legal pages. Post-auth redirects go through `safeNext()`.
- Email isn't connected: reset links are logged by `sendResetPassword`. Google sign-in turns on when `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` are set.

## Next.js 16 specifics

- `cacheComponents` is on: anything reading `headers()`, `cookies()` or awaited `params` on the server must sit inside `<Suspense>`.
- Use `proxy.ts`, not `middleware.ts`. Read `node_modules/next/dist/docs/` before using an API you haven't checked.

## Conventions

- TypeScript strict, Biome (2 spaces, 110 columns): run `pnpm exec biome check --write src scripts`. `src/components/ui` is vendored shadcn on Base UI; avoid editing it.
- UI: dark, compact, Linear-like. Tokens in `src/app/globals.css`, Geist fonts, Phosphor icons, motion per the README design rules. Times are Asia/Manila, money is PHP.
- Brand assets: `public/brand/` (SVG logos), `src/app/{favicon.ico,icon.svg,apple-icon.png,opengraph-image.png}`, `src/components/brand/logo.tsx` (stacked-bar "E"). Source files are in `../UI Mockups/branding/everyops`.
- Tests: Vitest, `src/**/*.test.ts`, for engine and logic. Test behavior, not implementation.

## Git

Deploy with `pnpm deploy` (Cloud Run service `everyops-web`, scripts/deploy.sh). Live URL: https://everyops-web-223724593768.asia-southeast1.run.app. After a deploy, verify the live URL (sign-in, protected redirects) and check `gcloud logging read` for errors; a successful build is not proof.

## Git workflow

- Repo `MrJim-Dev/ai-builder-cup-2026`. Work on `dev` (this checkout, `everyops-build`); `main` is the sibling worktree `../everyops` and is fast-forwarded to `dev` when releasing.
- Conventional commit messages (`feat(auth): …`, `fix(engine): …`). Never commit `.env.local` or secrets.

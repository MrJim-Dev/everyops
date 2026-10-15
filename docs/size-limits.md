# Size limits: shared rate limits, limits up front, AI budget, and how big a workspace can get

## Shared rate limits

Public form submissions (8 per address per 10 minutes), quotes, uploads and page-data reads were counted in each Cloud Run instance's memory: two instances let twice as much through, and a restart forgot everything. `allowSubmission` now uses the same Postgres sliding window as the AI limit (`takeToken`, keys prefixed `public:`), with any window length, and falls back to memory only if the database fails.

## Limits shown before trying

- Picture fields: "PNG, JPG, WebP, GIF or iPhone photo. Big photos are made smaller, to 5 MB at most." (public forms already said so).
- Ask EveryOps: the attach button says up to 5 files, 30 MB each; the mic button says up to 2 minutes, and the recording timer shows "0:12 / 2:00".

## AI use and budget

Every Gemini round adds its prompt, answer and thinking tokens to `ai_usage` (migration `0012`) for the workspace the request is about, or `account:USER` for setup and other calls before a workspace exists. Failed and retried rounds count too, since they cost the same. Each AI route counts a request and, when `AI_MONTHLY_TOKEN_BUDGET` is set, refuses with a clear message once the workspace has used it this month (it renews on the 1st). Settings → Assistant shows this month's tokens and requests, last month, the budget bar, and the person's own 30-per-10-minutes limit.

Implementation note: the scope is set with `AsyncLocalStorage.enterWith` in the route itself (`enterAiUsage`). Setting it inside an awaited helper doesn't reach the route, because Node restores the caller's context when the helper returns.

## Measurements, 2026-10-16

`scripts/measure-workspace-size.mts` seeds workspaces of 1k, 10k and 50k bookings (the court sample repeated back in time) in a local PostgreSQL 17 and times a production build on the same machine. Medians of 3.

| Bookings | Open (server) | Payload | Sent (gzip) | One save | Poll for changes | Browser: Overview | Browser: all-bookings list | JS heap |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1,000 | 13 ms | 0.38 MB | 0.02 MB | 3 ms | 1 ms | 1.1 s | 0.9 s | 28 MB |
| 10,000 | 95 ms | 3.7 MB | 0.22 MB | 2 ms | 2 ms | 1.1 s | 0.9 s | 35 MB |
| 50,000 | 485 ms | 18.7 MB | 1.06 MB | 3 ms | 1 ms | 1.5 s | 0.9 s | 79 MB |

What this shows:

- **Saves and polls don't grow with the workspace.** They're patches and indexed reads (`workspace_record_changed_idx`).
- **Opening grows linearly**, about 0.37 MB of JSON per 1,000 bookings. Route handlers weren't compressed (Next compresses pages only), so a 50k workspace sent 18.7 MB, and Cloud Run's 32 MiB response limit would have stopped workspaces from opening at roughly 85k records. Opening and polling now gzip when the browser accepts it (`jsonResponse`): 18.7 MB becomes 1.06 MB (×18), for about 70 ms of server time.
- **The browser copes at 50k** on a laptop: the dashboard and the full list render in about 1.5 s with 79 MB of JavaScript heap. Phones and slow networks will be slower; this was localhost.

So loading records per view (server paging and totals) isn't urgent for workspaces under about 50k records. It becomes the next step when a customer gets near that size, or when phone performance on large workspaces is measured and found wanting.

Run it again with `MEASURE_BASE=http://localhost:PORT tsx --conditions=react-server --env-file=.env.local scripts/measure-workspace-size.mts` (local databases only).

## Verification

- 8 public submissions from one address passed, the 9th got 429; after restarting the server the same address still got 429 and another address didn't. The counts are rows in `ai_rate_limit` (`public:203.0.113.7:qa-html-pages = 8`).
- A real Ask EveryOps answer in the 1k workspace counted 40,474 tokens (the lookup and answer calls in the log add up to it); Settings showed it as 2% of a 2,000,000-token budget. With the budget at 1,000, Ask EveryOps answered with the allowance message without calling Gemini, and Settings showed 100% and "paused until the 1st".
- `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.

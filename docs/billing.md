# Plans, usage limits and billing

Every account is on a plan. The plan sets how much AI it gets each month, how many workspaces, team members, records, files and automation emails it may have, and what its API keys may do. The numbers live in one place, `src/lib/billing/plans.ts`, and the same numbers are shown on `/pricing`, in Account → Plan & usage and on `/admin/accounts`, and enforced on the server.

Online payment isn't connected yet. Upgrading or buying credits records the request and emails the site admins, who arrange payment and assign the plan on `/admin/accounts`. Adding a provider later is one module (below).

## Plans

| | Free | Starter | Pro | Business |
|---|---|---|---|---|
| Price a month | ₱0 | ₱499 | ₱1,499 | ₱3,999 |
| AI credits a month | 1,000 | 3,000 | 8,000 | 20,000 |
| Workspaces (starter ones free) | 1 | 3 | 10 | 25 |
| Team members per workspace | 2 | 5 | 15 | 50 |
| Records per workspace | 2,000 | 10,000 | 50,000 | 100,000 |
| File storage | 200 MB | 2 GB | 10 GB | 50 GB |
| Automation emails a day | 20 | 100 | 500 | 2,000 |
| API, MCP, webhooks | none | read only | full | full |
| Custom domains | — | — | 1 | 3 |
| Workspace designs a day | 3 | 10 | 25 | 50 |

Yearly is ten months' price. Credit packs: 2,000 for ₱249 and 10,000 for ₱999, added for the current month. Two plans are never sold: **Internal** (site admins, by default) and **Demo** (the shared demo account). Accounts with no `account_plan` row are Free.

Prices are in centavos (`monthlyCentavos`), the unit payment providers take. `plans.test.ts` checks that limits only grow with the price and that the most AI a paid plan can use stays under about a third of its price.

## AI credits

A credit is a thousandth of a US dollar of Gemini cost, read from `ai_call.cost_micros` (1 credit = 1,000 micro-dollars, about ₱0.06). Counting cost prices every model and feature fairly: from production's log, a workspace design costs about 130 credits, a setup message about 25, an Ask EveryOps answer 10 to 60 (more in big workspaces).

The account that pays is the workspace's owner (`ai_call.billed_to`, filled in by `recordAiCall`); setup, voice and the change planner before a workspace exists are paid by the person. So a team member's questions in someone's workspace use that owner's credits.

## Abuse controls

Every AI route calls `startAiUsage(scope, { userId, feature })` before any Gemini call. Its first step, `checkAi` in `src/server/billing/limits.ts`, refuses with a `code` and a message, in this order:

1. **suspended** (403): the paying account or the person was suspended by an admin.
2. **verify_email** (403): the person hasn't verified their email. Sign-up sends a link (`emailVerification` in `src/server/auth.ts`); Google accounts arrive verified; Account → Plan & usage can send another. Sign-in never waits for it.
3. **safety_switch** (402): today's Gemini spending across EveryOps passed `AI_DAILY_SPEND_LIMIT_USD` (default \$25, in code so a deploy can't drop it). AI pauses on Free and Demo until midnight in Manila; paid plans keep working; the site admins are emailed once a day (`billing_event` kind `safety_switch`).
4. **credits** (402): fewer credits left than the feature usually takes (`FEATURE_RESERVE`: 150 for a design, 30 for a setup message, 20 for an answer), so an account at 990 of 1,000 can't start a design.
5. Plan rate limits: AI requests per 10 minutes (`aiPer10Min`) and per day the workspace designs (`designsPerDay`) and setup messages (`interviewTurnsPerDay`), the expensive steps.

The existing per-account limit (`AI_RATE_LIMIT`, 30 per 10 minutes) and per-workspace monthly token budget (`AI_MONTHLY_TOKEN_BUDGET`) still apply after these. A failure of the plan check itself is logged and lets the request through, so a bug here never takes AI down.

Also:

- **Throwaway inboxes** (`src/lib/auth/disposable.ts`) can't create accounts: each new account is a new Free allowance.
- **Automation email** is limited per owner across all their workspaces by plan (`emailRoom`), never above `AUTOMATION_EMAIL_DAILY_LIMIT` when that's set; a suspended account sends none. It goes out from notify@everyops.app, so this protects the domain's reputation.
- **API keys** follow the plan: none on Free, read-only on Starter (`apiAllows`). Keys made on a higher plan lose what the current plan doesn't allow on every request (`apiCaller`), and a suspended account's keys get 403.
- **Public forms** keep their limit of 8 submissions per address per 10 minutes. When the owner is over a plan limit, visitors see "This business can't take new entries online right now"; the owner's plan isn't the visitor's business.

## Counted limits

Each throws `PlanLimitError`, which write paths turn into a 403 with a message that names the plan and the way out:

| Limit | Checked in |
|---|---|
| Workspaces | `patchWorkspace` when creating (`assertWorkspaceRoom`). Starter workspaces (`workspace.starter`) don't count. |
| Team members | `patchWorkspace` team saves, members plus pending invites (`assertTeamRoom`) |
| Records | `insertRecords`, which every write path uses: browser saves, REST and MCP, public forms, imports, Sheets sync (`assertRecordRoom`). EveryOps' own seeding (`writeContent`) is exempt. |
| File storage | `saveImage` / `saveDocument` (`assertStorageRoom`), counted from `file_upload` |
| Custom domains | `addDomain` (`assertDomainRoom`), across the owner's workspaces |

Only adding is refused. An account over a limit after a downgrade keeps every workspace, record and file and can still edit and delete; it can't add more of that thing.

## Admin

`/admin/accounts` (site admins, `SITE_ADMIN_EMAILS`): every account with its plan, this month's credits, workspaces, records and files, who asked to upgrade, today's and this month's AI spending against the safety limit. Manage assigns a plan, adds credits for this month, notes how they paid, suspends with a reason or lifts a suspension. Every change is a `billing_event` row with the admin's email.

## Adding a payment provider

`src/server/billing/provider.ts` defines `PaymentProvider`: `checkout()` returns the provider's hosted checkout URL, and `parseWebhook()` verifies the signature and turns the callback into a `PaymentEvent` (`plan.activated`, `plan.past_due`, `plan.canceled`, `credits.purchased`), which `/api/billing/webhook` applies with `applyPaymentEvent`. Set `PAYMENT_PROVIDER` to pick it. Until then `manualProvider` is used and the webhook answers 501.

For PHP, PayMongo subscriptions take cards and Maya; GCash auto-debit isn't offered for subscriptions, so GCash fits prepaid plans (a yearly plan or a credit pack as one payment). Paddle suits USD customers as a merchant of record.

## Tables (migration 0024)

- `account_plan`: plan, status, this month's bonus credits, suspension, provider references, admin note.
- `billing_event`: everything that happened to an account's plan, plus the safety switch's daily marker.
- `ai_call.billed_to`: who pays for each call (backfilled from the workspace's owner).
- `workspace.starter`: the starter workspaces every account gets (backfilled from `account_seed`).
- `file_upload`: each uploaded file's size, for storage.

## Checking it

`pnpm test` covers the plan table and every decision (`src/lib/billing/plans.test.ts`, `src/lib/auth/disposable.test.ts`). The end-to-end run behind the PR screenshots signed up two accounts on a local database and checked each refusal through the real API: throwaway inbox, unverified email, credits used up, a second workspace, a third team member, record 2,001, an API key on Free, the safety switch, a suspension, a non-admin on the admin API, then Starter's read-only keys and extra workspace after an admin assigned it.


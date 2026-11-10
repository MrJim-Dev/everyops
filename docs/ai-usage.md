# AI use log

Every AI call EveryOps makes (Claude, and Gemini for sound and video) is written to the `ai_call` table (migration `0017_ai_calls.sql`), one row per call, whatever its outcome. Settings show it in two places:

- **Workspace → Settings → AI use**: totals, cost per day, and breakdowns by feature, step, person (owners and admins), model and where it ran, plus the latest calls. Other members see the totals and only their own calls.
- **Account → AI use**: everything the account started, in every workspace, while setting one up, and through voice input.

## What a row holds

| Column | Meaning |
|---|---|
| `user_id`, `workspace_id` | Who started it and for which workspace. Setup, voice input and the change planner have no workspace. |
| `request_id` | One user action. A single Ask EveryOps message usually makes 3–4 calls (answer, record lookup, memory), more with retries. |
| `feature`, `task` | The product feature (route) and the step inside it, labelled in `src/lib/ai-usage.ts`. |
| `model`, `location` | Model and where it ran (`global` for Claude; `global` or a region for Gemini on Vertex). |
| `attempt`, `outcome` | Which hedged attempt it was, and how it ended: `ok`, `cancelled` (a duplicate that lost the race), `runaway`, `stalled`, `timeout`, `schema`, `malformed`, `empty`, `rate-limited`, `error`. Anything but `ok` is counted as wasted. |
| `input_tokens` … `thinking_tokens` | As the model reported them (for Claude, input counts cached reads and cache writes too). A call stopped midway has its tokens estimated from the text (`estimated = true`); a call refused before the model started on it has none. |
| `cost_micros` | Estimated cost in millionths of a dollar, from the rates in `src/lib/ai-usage.ts`. Google's invoice is the bill; update the rates when Google changes them. |
| `origin` | `production` (Cloud Run), `local:HOST` (a dev server) or `script:NAME@HOST` (benchmarks and evals under `scripts/`). |

## Use from scripts and local runs

Local dev servers and scripts call Claude with the same API key as production (and the same Vertex project for sound and video), so their cost shows on the same bills. They are logged to whichever database `DATABASE_URL` points at, with no user, so they don't appear in anyone's settings. To see them:

```sql
select origin, feature, task, count(*) as calls, sum(cost_micros) / 1e6 as dollars
from ai_call
where at > now() - interval '7 days'
group by 1, 2, 3
order by dollars desc;
```

A script run without a database still prints each call (`{"event":"claude",…}`) to the console.

## Limits

The monthly token budget (`AI_MONTHLY_TOKEN_BUDGET`) still reads `ai_usage`, which now also counts the tokens of failed and cancelled calls. Per-account limits can sum `ai_call` by `user_id` over a period (the `ai_call_user` index covers it).

## Checking it locally

```bash
tsx --conditions=react-server --env-file=.env.local scripts/qa-ai-usage.mts                # owner, staff, sample workspace
tsx --conditions=react-server --env-file=.env.local scripts/qa-ai-usage.mts --script-call  # one tiny logged script call
```

Both refuse to run unless `DATABASE_URL` points at localhost.

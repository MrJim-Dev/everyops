# Setup design quality

`pnpm eval:design` measures setup's design stage on six fixed briefs (three template, two playbook, one custom: playbooks
match most businesses, so few briefs reach the custom route) and runs each several times so a change can be judged by
numbers instead of one lucky run. It calls `designWorkspace` in-process with real Gemini calls and saves nothing.

| Brief | Route | What it stresses |
|---|---|---|
| courts | template (court-bookings) | Hours and slots, rates, add-ons, payments, a removed field, an added page |
| stays | template (rental-operations) | Whole-day bookings, deposit, rates, extras |
| canteen | template (canteen-pos) | Menu samples, line items, checkout, stock that a rule takes down |
| salon | playbook | Appointments plus payroll, commission, deductions, attendance |
| fixwell | playbook (repairs) | A plain private tracker: statuses, board, Overview filter, nothing public |
| habits | custom | Many choice fields, rollups, a rule, heatmap; once failed three repairs in a row |

Each brief has checks for what its owner asked for in so many words (`scripts/fixtures/design-briefs.ts`). A check passes
for any reasonable naming: it tests that the request was met.

## Run

```sh
pnpm db:proxy                                    # in another terminal; community systems come from the database
pnpm eval:design                                 # every brief, 3 runs each, 3 at a time
EVAL_ONLY=courts,habits EVAL_REPEAT=2 pnpm eval:design
EVAL_LABEL=after EVAL_BASELINE=/tmp/design-eval-before.json pnpm eval:design
```

The report goes to `EVAL_REPORT` (default `<tmp>/design-eval-<label>.json`). Designs run on production's design model
(gemini-3.5-flash in asia-southeast1) unless `GEMINI_DESIGN_MODEL` is set. Keep `EVAL_CONCURRENCY` the same for runs you
compare, since running briefs side by side changes their times. `EVAL_KEEP_DESIGNS=1` saves every design next to the report.

## Reading it

Per brief: how often the design validates and validates on the first pass, the share of asks met, asks no run met and
asks only some runs met, how alike the runs' record types are, gaps, repairs, median and slowest time, and output
tokens. A second table shows each Gemini task's median time, time to first part and output, which is where speed work
should start.

## The gate

With `EVAL_BASELINE` the run fails (exit 1) when, for any brief in both reports, valid designs, first passes or asks met
drop by more than one run's worth (20 points at five runs, 10 at most), an ask stops being met by every run, or gaps grow
by more than 0.5 (`compare` in `src/lib/eval/design-score.ts`). Sameness, time and size are reported but don't fail.

The thresholds come from running the same code twice: it moved first passes by one run in five and sameness by about 25
points, so a tighter gate failed the code against itself. Time is noisier still (the same courts brief took 19 s in one
batch and 40 s in another), so compare speed only between runs made at the same time: run the old code in a separate
checkout (`git worktree add`, with its own `pnpm install` and `.env.local`) alongside the new one. Output tokens also
swing on their own, because Gemini sometimes pretty-prints its JSON: the same 17–22k-character design came back as 4k
tokens in one run and 9k in another. Use five runs per brief for a change you're unsure of. The eval can't judge whether
a design is a good system for the business: that stays a person's call.

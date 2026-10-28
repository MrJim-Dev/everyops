# Community usage

Community shows how much each system is really used, so people (and setup's AI) can tell a proven system from one
nobody runs.

## The numbers

Counted live from the workspaces whose `source` names the system (`USAGE` in `src/server/community.ts`):

- **Uses**: workspaces people built from it, with *Use in my workspace* (`via: "copy"`) or by asking setup to start
  from it (`via: "setup"`, recorded from the design's `basedOn` when the workspace is created).
- **Active**: of those, the ones whose records changed in the last 30 days, after their first day (so the sample
  records a copy starts with don't count).
- **New this month**: the ones made in the last 30 days.

The starter workspaces every new account gets (`via: "starter"`) don't count: nobody chose them. Starters made before
this mark existed are recognised by being written in the same transaction as the account's `account_seed` row. Before
this change a template's count was every workspace with its source, starters included, so the official templates'
numbers mostly counted sign-ups.

## Marks and sorting

`src/lib/community/usage.ts` turns the numbers into marks on the cards: **Most used** (the two systems with the most
active workspaces, at least two), **Trending** (at least two new this month, most of its uses new) and **New**
(published in the last two weeks, not used yet). *Most used* sorts by active, then uses, then new this month. The
detail sheet shows Built from it, In use and New this month.

## For the AI

Setup's references (`src/server/ai/references.ts`) describe each community system with a Usage line ("Used by 8
workspaces, 4 active in the last 30 days, 2 new this month"), put the more used of two equally good fits first, and
tell the designer to prefer the one more businesses actively use. `/api/community` returns `uses`, `active` and `recent`.

## Proof

`scripts/qa-community-usage.mts` builds every case against a local database (copies, active copies, marked and older
starters, a setup-built workspace, a system published three days ago). Screenshots are in
`docs/pr-screenshots/community-usage/`.

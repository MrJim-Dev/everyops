# If / else in automations

One automation can now do different things depending on the record. "When a booking is saved: if it's paid, thank
the player; else if it's cancelled, tell the front desk; otherwise show that it's still unpaid" is one rule instead
of three with opposite conditions.

## How a rule runs

`Rule.branches` is an optional list of `{ when?, actions }` (src/lib/engine/branches.ts):

1. The rule's trigger and `when` decide whether it runs at all, as before.
2. Its own `actions` always run.
3. The first branch whose `when` holds runs its actions too. A last branch without `when` is the otherwise and runs
   when none of the others did.

Branch conditions are formulas, like `when`, read on the record as it was saved, before the rule's own actions
change it. Every place a rule runs uses `actionsFor`: save automations in the browser, the emails and API calls
the server sends after a save, timed automations, and the stock and balance adjustments that stay in step with
records. Checks that look at what a rule can do without running it (validation, the assistant's lookups, coverage,
implied rules, the webhook endpoint list) use `allActions`.

Validation checks each branch's condition, that each branch has actions, and that only the last branch has no
condition.

## The assistant

The assistant's schema is near Gemini's structural limit, so it gets no new fields. It writes a branch as a step of
type `if` or `else_if` (condition in `value`) or `else` in its action list; `toAssistantRule` turns those
steps into branches. The setup designer doesn't write branches.

## Where it shows

Settings → Automations lists the rule's own steps, then each branch under "If …", "Else if …" and "Otherwise".
MCP `describe_workspace` includes `branches`.


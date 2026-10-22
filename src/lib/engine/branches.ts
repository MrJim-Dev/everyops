import type { Action, Rule, RuleBranch } from "@/lib/blueprint/types";
import { type EvalContext, run, truthy } from "./expr";

/**
 * If / else in automations. A rule's actions always run (once its when holds); then the first of its branches whose
 * condition holds runs too. A last branch without a condition is the "otherwise": it runs when none of the others
 * did. So "when a booking is saved: if it's paid, thank them; else if it's unpaid, remind them; otherwise note it".
 */

/** The actions a rule runs for one record: its own, then those of the first branch that holds. */
export function actionsFor(rule: Rule, ctx: EvalContext): Action[] {
  const branch = branchFor(rule, ctx);
  return branch ? [...rule.actions, ...branch.actions] : rule.actions;
}

/** The branch a record takes (the otherwise when none of the others hold), or none. */
export function branchFor(rule: Rule, ctx: EvalContext): RuleBranch | undefined {
  for (const branch of rule.branches ?? []) {
    if (!branch.when?.trim()) return branch;
    try {
      if (truthy(run(branch.when, ctx))) return branch;
    } catch {
      // A condition that doesn't read is skipped, like a when that doesn't read.
    }
  }
  return undefined;
}

/** Every action a rule can run, in any branch: for checks that look at what a rule does without running it. */
export const allActions = (rule: Rule): Action[] => [
  ...rule.actions,
  ...(rule.branches ?? []).flatMap((b) => b.actions),
];

/** The rule with fn applied to the actions of the rule and each branch. */
export function mapActions(rule: Rule, fn: (actions: Action[]) => Action[]): Rule {
  return {
    ...rule,
    actions: fn(rule.actions),
    ...(rule.branches ? { branches: rule.branches.map((b) => ({ ...b, actions: fn(b.actions) })) } : {}),
  };
}

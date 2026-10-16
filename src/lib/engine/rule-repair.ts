import type { Blueprint, Entity, Rule } from "@/lib/blueprint/types";
import { stockFieldOf } from "./register";

type Action = Rule["actions"][number];

const QTY = /qty|quantity|received|count|pcs|units/i;
const STOCK_IN = /restock|receiv|purchase|deliver|stock.?in|incoming|replenish/i;
const NUMERIC = new Set(["number", "money", "percent"]);

/**
 * Generated automations sometimes arrive with the field or amount left out, which the designer fills with "" and
 * "0": "Deduct stock on sale" or "Add stock on delivery" then does nothing. A stock change through a link is
 * unambiguous, so it's completed: the linked product's stock, minus the record's quantity, plus on deliveries and
 * restocks. Returns undefined when the action can't be completed (or doesn't point at real fields).
 */
export function completeAction(bp: Blueprint, rule: Rule, action: Action): Action | undefined {
  const entity = (id: string | undefined) => bp.entities.find((e) => e.id === id);
  const source = entity(rule.trigger.entityId);
  if (!source) return undefined;
  if (action.type === "notify") return action.message.trim() ? action : undefined;
  if (action.type === "send_email") return action.to.trim() && action.subject.trim() ? action : undefined;
  if (action.type === "create_record")
    return bp.entities.some((e) => e.id === action.entityId) ? action : undefined;
  let target = action.target;
  let targetEntity: Entity | undefined = source;
  if (target.kind === "relation") {
    const linkId = target.fieldId;
    let link = source.fields.find((f) => f.id === linkId && f.type === "relation");
    if (!link && action.type === "adjust_number") {
      const stocked = source.fields.filter(
        (f) => f.type === "relation" && stockFieldOf(entity(f.relation?.entityId) ?? source) !== undefined,
      );
      if (stocked.length === 1) link = stocked[0];
    }
    targetEntity = entity(link?.relation?.entityId);
    if (!link || !targetEntity) return undefined;
    target = { kind: "relation", fieldId: link.id };
  }
  if (action.type === "set_field")
    return targetEntity.fields.some((f) => f.id === action.fieldId) ? { ...action, target } : undefined;
  const field =
    targetEntity.fields.find((f) => f.id === action.fieldId && NUMERIC.has(f.type)) ??
    (action.fieldId ? undefined : stockFieldOf(targetEntity));
  if (!field) return undefined;
  let delta = action.delta.trim();
  if (!delta || delta === "0") {
    const qty = source.fields.find((f) => f.type === "number" && QTY.test(`${f.id} ${f.name}`));
    if (!qty) return undefined;
    delta = STOCK_IN.test(`${source.id} ${source.name} ${rule.name}`) ? qty.id : `-${qty.id}`;
  }
  return { ...action, target, fieldId: field.id, delta };
}

/**
 * A "status changed" automation without its status field ("Notify when Bill is Paid") watches the record's only
 * status field, or the one with the option it waits for. Left as it is when that isn't clear.
 */
export function completeTrigger(bp: Blueprint, rule: Rule): Rule["trigger"] {
  const t = rule.trigger;
  if (t.event !== "status_changed") return t;
  const source = bp.entities.find((e) => e.id === t.entityId);
  const choices = source?.fields.filter((f) => f.type === "status" || f.type === "select") ?? [];
  if (choices.some((f) => f.id === t.fieldId)) return t;
  const statuses = choices.filter((f) => f.type === "status");
  const fits = t.to ? choices.filter((f) => f.options?.some((o) => o.id === t.to)) : [];
  const field = fits.length === 1 ? fits[0] : statuses.length === 1 ? statuses[0] : undefined;
  return field ? { ...t, fieldId: field.id } : t;
}

/** The rule with every blank it can fill filled in. Actions it can't complete stay as they were, for validation to report. */
export function completeRule(bp: Blueprint, rule: Rule): Rule {
  return {
    ...rule,
    trigger: completeTrigger(bp, rule),
    actions: rule.actions.map((a) => completeAction(bp, rule, a) ?? a),
  };
}

/**
 * Completes every automation and drops what still can't run, so the preview never promises an automation that
 * does nothing.
 */
export function repairRules(bp: Blueprint): Rule[] {
  const out: Rule[] = [];
  for (const rule of bp.rules) {
    if (!bp.entities.some((e) => e.id === rule.trigger.entityId)) continue;
    const actions = rule.actions.flatMap((a) => completeAction(bp, rule, a) ?? []);
    if (actions.length) out.push({ ...rule, trigger: completeTrigger(bp, rule), actions });
  }
  return out;
}

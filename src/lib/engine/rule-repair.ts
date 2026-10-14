import type { Blueprint, Entity, Rule } from "@/lib/blueprint/types";
import { stockFieldOf } from "./register";

type Action = Rule["actions"][number];

const QTY = /qty|quantity|received|count|pcs|units/i;
const STOCK_IN = /restock|receiv|purchase|deliver|stock.?in|incoming|replenish/i;

/**
 * Generated automations sometimes arrive with the field or amount left out, which the designer fills with "" and
 * "0": "Deduct stock on sale" then does nothing. A stock change on a line item is unambiguous, so it's completed
 * (the product's stock, minus the line's quantity; plus on restocks). Anything still incomplete is dropped, so
 * the preview never promises an automation that can't run.
 */
export function repairRules(bp: Blueprint): Rule[] {
  const entity = (id: string | undefined) => bp.entities.find((e) => e.id === id);
  const out: Rule[] = [];
  for (const rule of bp.rules) {
    const source = entity(rule.trigger.entityId);
    if (!source) continue;
    const actions: Action[] = [];
    for (const action of rule.actions) {
      if (action.type === "notify") {
        if (action.message.trim()) actions.push(action);
        continue;
      }
      let target = action.target;
      let targetEntity: Entity | undefined = source;
      if (target.kind === "relation") {
        const linkId = target.fieldId;
        let link = source.fields.find((f) => f.id === linkId && f.type === "relation");
        if (!link && action.type === "adjust_number") {
          const stocked = source.fields.filter(
            (f) =>
              f.type === "relation" && stockFieldOf(entity(f.relation?.entityId) ?? source) !== undefined,
          );
          if (stocked.length === 1) link = stocked[0];
        }
        targetEntity = entity(link?.relation?.entityId);
        if (!link || !targetEntity) continue;
        target = { kind: "relation", fieldId: link.id };
      }
      if (action.type === "set_field") {
        if (targetEntity.fields.some((f) => f.id === action.fieldId)) actions.push({ ...action, target });
        continue;
      }
      const field =
        targetEntity.fields.find((f) => f.id === action.fieldId && f.type === "number") ??
        (action.fieldId ? undefined : stockFieldOf(targetEntity));
      if (!field) continue;
      let delta = action.delta.trim();
      if (!delta || delta === "0") {
        const qty = source.fields.find((f) => f.type === "number" && QTY.test(`${f.id} ${f.name}`));
        if (!qty) continue;
        delta = STOCK_IN.test(`${source.id} ${source.name} ${rule.name}`) ? qty.id : `-${qty.id}`;
      }
      actions.push({ ...action, target, fieldId: field.id, delta });
    }
    if (actions.length) out.push({ ...rule, actions });
  }
  return out;
}

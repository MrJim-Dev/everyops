import type { Blueprint, Entity, Rule } from "@/lib/blueprint/types";
import { stockFieldOf } from "./register";

type Action = Rule["actions"][number];

const QTY = /qty|quantity|received|count|pcs|units/i;
const STOCK_IN = /restock|receiv|purchase|deliver|stock.?in|incoming|replenish/i;
const NUMERIC = new Set(["number", "money", "percent", "rating", "duration"]);

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
  if (action.type === "call_api") return action.endpointId?.trim() ? action : undefined;
  if (action.type === "create_record")
    return bp.entities.some((e) => e.id === action.entityId) ? action : undefined;
  if (action.type === "link_record") {
    // The link may be named by its field or by the record type it points at ("daily_summary").
    const relations = source.fields.filter((f) => f.type === "relation");
    const link =
      relations.find((f) => f.id === action.target?.fieldId) ??
      relations.find((f) => f.relation?.entityId === action.target?.fieldId);
    const linked = entity(link?.relation?.entityId);
    if (!link || !linked || !action.value?.trim()) return undefined;
    // Matching on a date with the field left blank means the linked type's only date.
    const dates = linked.fields.filter((f) => f.type === "date");
    const field =
      linked.fields.find((f) => f.id === action.fieldId) ?? (dates.length === 1 ? dates[0] : undefined);
    if (!field) return undefined;
    // A value that names a field this record doesn't have (often the linked type's own: "date_str") is this
    // record's date when the match is on a date and the record has one clear date.
    let value = action.value.trim();
    if (
      /^[a-z_][a-z0-9_]*$/i.test(value) &&
      !source.fields.some((f) => f.id === value) &&
      field.type === "date"
    ) {
      const own = source.fields.filter((f) => ["date", "datetime", "time_range"].includes(f.type));
      const pick = own.length === 1 ? own[0] : own.find((f) => /date|day/i.test(`${f.id} ${f.name}`));
      if (pick) value = pick.id;
    }
    return { ...action, target: { kind: "relation", fieldId: link.id }, fieldId: field.id, value };
  }
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
  if (action.type === "set_field") {
    if (targetEntity.fields.some((f) => f.id === action.fieldId)) return { ...action, target };
    // A value that only picks options ("balance_due <= 0 ? 'paid' : 'partially_paid'") names its field: the one
    // status or select with all of them. Gemini left it out of a print shop's payment rule three times running.
    const picks = [...action.value.matchAll(/'([^']*)'/g)].map((m) => m[1]);
    const fits = picks.length
      ? targetEntity.fields.filter(
          (f) =>
            (f.type === "status" || f.type === "select") &&
            picks.every((p) => f.options?.some((o) => o.id === p)),
        )
      : [];
    return fits.length === 1 ? { ...action, target, fieldId: fits[0].id } : undefined;
  }
  // Through a link, a field the linked record doesn't have is the record's own quantity in the wrong place
  // ("fieldId": "qty" on a stock movement): the change goes to the linked record's stock. On a bakery's
  // "In movements add stock" every repair round then ran away arguing about fieldId and delta.
  const misplaced =
    !action.fieldId ||
    (target.kind === "relation" && !targetEntity.fields.some((f) => f.id === action.fieldId));
  const field =
    targetEntity.fields.find((f) => f.id === action.fieldId && NUMERIC.has(f.type)) ??
    (misplaced ? stockFieldOf(targetEntity) : undefined);
  if (!field) return undefined;
  let delta = action.delta.trim();
  if (!delta || delta === "0") {
    const qty = source.fields.find((f) => f.type === "number" && QTY.test(`${f.id} ${f.name}`));
    if (!qty) return undefined;
    // "when type == 'purchase' || type == 'in'" says it adds, like a name that does.
    const adds =
      STOCK_IN.test(`${source.id} ${source.name} ${rule.name} ${rule.when ?? ""}`) ||
      /'in'|'stock_in'/.test(rule.when ?? "");
    delta = adds ? qty.id : `-${qty.id}`;
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
  rule = qualifyLinked(bp, rule);
  return fullReceipt(bp, {
    ...rule,
    trigger: completeTrigger(bp, rule),
    actions: rule.actions.map((a) => completeAction(bp, rule, a) ?? a),
  });
}

const NAME = /(?<![.\w])([a-z_][a-z0-9_]*)(?![\w(])/gi;
const RESERVED = new Set(["true", "false", "null"]);

/**
 * A rule on a payment that reads its order's totals by their bare names ("balance_due <= 0") can't run: the formula
 * is worked out on the payment. Every setup of a print shop's "a confirmed payment marks the job Paid or Partially
 * paid" was rejected for it, twice, and the owner got it as "not added yet". A name the record doesn't have, that
 * exactly one of its links has, is read through that link (job_order.balance_due). Quoted text stays as it is.
 */
export function qualifyLinked(bp: Blueprint, rule: Rule): Rule {
  const source = bp.entities.find((e) => e.id === rule.trigger.entityId);
  if (!source) return rule;
  const links = source.fields.filter((f) => f.type === "relation" && f.relation?.entityId);
  const fix = (expr: string) =>
    expr
      .split(/('[^']*')/)
      .map((part, i) =>
        i % 2
          ? part
          : part.replace(NAME, (name: string) => {
              if (RESERVED.has(name.toLowerCase()) || source.fields.some((f) => f.id === name)) return name;
              const owners = links.filter((l) =>
                bp.entities.find((e) => e.id === l.relation?.entityId)?.fields.some((f) => f.id === name),
              );
              return owners.length === 1 ? `${owners[0].id}.${name}` : name;
            }),
      )
      .join("");
  const actions = rule.actions.map((a) =>
    a.type === "set_field"
      ? { ...a, value: fix(a.value) }
      : a.type === "adjust_number"
        ? { ...a, delta: fix(a.delta) }
        : a,
  );
  return { ...rule, ...(rule.when ? { when: fix(rule.when) } : {}), actions };
}

const RECEIVED = /receiv|delivered|arrived/i;
const ORDERED = /order|qty|quantity/i;

/**
 * A purchase order line that adds its received quantity to stock once the order is received adds nothing when
 * nobody types a received quantity, and the order's "Mark as received" button doesn't. On a production ERP that
 * left stock unchanged after every delivery. When the line also has the quantity ordered, a blank received quantity
 * means everything ordered arrived: the stock goes up by what was received, else by what was ordered. Only rules
 * that wait for the parent's status (when purchase_order.status == 'received') change, at design time.
 */
export function fullReceipt(bp: Blueprint, rule: Rule): Rule {
  const line = bp.entities.find((e) => e.id === rule.trigger.entityId);
  const parentLink = line?.parent?.fieldId;
  if (!line || !parentLink || !rule.when?.includes(`${parentLink}.`)) return rule;
  const numbers = line.fields.filter((f) => f.type === "number" && !f.formula && !f.rollup);
  const ordered = numbers.find(
    (f) => !RECEIVED.test(`${f.id} ${f.name}`) && ORDERED.test(`${f.id} ${f.name}`),
  );
  if (!ordered) return rule;
  return {
    ...rule,
    actions: rule.actions.map((a) => {
      if (a.type !== "adjust_number") return a;
      const received = numbers.find((f) => f.id === a.delta.trim() && RECEIVED.test(`${f.id} ${f.name}`));
      return received ? { ...a, delta: `${received.id} > 0 ? ${received.id} : ${ordered.id}` } : a;
    }),
  };
}

/**
 * Automations that move a record's workflow backwards: while it's Preparing (and paid), set it to Confirmed. Status
 * options are written in lifecycle order, so the earlier option undoes the step the owner just took; a catering
 * ERP's paid bookings bounced back to Confirmed every time they were moved to Preparing. Returns their ids.
 */
export function backwardsRules(bp: Blueprint): string[] {
  return bp.rules
    .filter((rule) => {
      const entity = bp.entities.find((e) => e.id === rule.trigger.entityId);
      return rule.actions.some((a) => {
        if (a.type !== "set_field" || a.target.kind !== "self") return false;
        const field = entity?.fields.find((f) => f.id === a.fieldId && f.type === "status");
        const order = field?.options?.map((o) => o.id) ?? [];
        const from = [
          ...(rule.when ?? "").matchAll(new RegExp(`\\b${a.fieldId}\\s*==\\s*'([^']+)'`, "g")),
        ].map((m) => order.indexOf(m[1]));
        const to = [...a.value.matchAll(/'([^']+)'/g)].map((m) => order.indexOf(m[1])).filter((i) => i >= 0);
        return from.length === 1 && from[0] >= 0 && to.some((i) => i < from[0]);
      });
    })
    .map((rule) => rule.id);
}

/**
 * Fields an automation fills in when a record is added (a line's unit price from its product) can't also be required:
 * the form refuses to save without them, so the automation never runs. On production a plan added such an automation
 * and the owner needed a second request to make the field optional. Returns the blueprint with those fields optional.
 */
export function unrequireFilled(bp: Blueprint): Blueprint {
  const filled = new Set<string>();
  for (const rule of bp.rules)
    if (rule.enabled !== false && rule.trigger.event === "created")
      for (const a of rule.actions)
        if (a.type === "set_field" && a.target.kind === "self")
          filled.add(`${rule.trigger.entityId}.${a.fieldId}`);
  if (!filled.size) return bp;
  return {
    ...bp,
    entities: bp.entities.map((e) =>
      e.fields.some((f) => f.required && filled.has(`${e.id}.${f.id}`) && f.id !== e.primaryFieldId)
        ? {
            ...e,
            fields: e.fields.map((f) =>
              f.required && filled.has(`${e.id}.${f.id}`) && f.id !== e.primaryFieldId
                ? { ...f, required: false }
                : f,
            ),
          }
        : e,
    ),
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
    const qualified = qualifyLinked(bp, rule);
    const actions = qualified.actions.flatMap((a) => completeAction(bp, qualified, a) ?? []);
    if (actions.length)
      out.push(fullReceipt(bp, { ...qualified, trigger: completeTrigger(bp, qualified), actions }));
  }
  return out;
}

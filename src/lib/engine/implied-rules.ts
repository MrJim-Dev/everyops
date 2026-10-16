import type { Blueprint, Entity, Field, Rule } from "@/lib/blueprint/types";
import { validateBlueprint } from "@/lib/blueprint/validate";
import { stockFieldOf } from "./register";

/**
 * The automations a request implies but didn't spell out. "Add stock management" means receiving stock raises the
 * product's stock and selling lowers it; "track leave balances" means an approved leave takes its days off the
 * employee's balance. Whatever the assistant or designer wrote, a record type that moves a running total on a
 * linked record (stock, on hand, balance, credits, points) gets the automation that keeps that total in sync.
 *
 * Only pairs this change touched count (a new record type, link, amount or total), so a workspace's existing setup
 * never sprouts automations nobody asked about, and nothing is added where an automation already does the job.
 */

const computed = (f: Field) => f.type === "formula" || f.type === "rollup";
const text = (...parts: (string | undefined)[]) => parts.filter(Boolean).join(" ");
const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");

const IN =
  /receiv|deliver|restock|re-?stock|purchase|stock.?in|incoming|replenish|return|refill|top.?up|reload|deposit|earn|load\b|add(ed|s)? stock/i;
const OUT =
  /sale|sold|order.?line|order.?item|line.?item|usage|used|consum|spoil|wast|damage|expir|issue|stock.?out|pull.?out|loss|lost|redeem|withdraw|payment|repay|leave.?request|leave\b|absence|deduct/i;
const MOVEMENT = /movement|adjust|transaction|ledger|stock.?log|inventory.?log/i;
const IN_OPTION =
  /^(in|stock.?in|receiv|deliver|restock|purchase|return|add|incoming|found|top.?up|deposit)|[_\s-]in$/i;
// "Production Out", "Scrap" and "Consumed" take stock off too; a garment ERP's fabric never went down when it was
// issued to production.
const OUT_OPTION =
  /^(out|stock.?out|sale|sold|used|usage|spoil|waste|damage|expire|issue|pull.?out|loss|lost|remove|deduct|withdraw|scrap|consum|reject|defect)|[_\s-]out$/i;
const ADJUST_OPTION = /^(adjust|correction|count|recount|manual)/i;
const DONE = /^(received|delivered|completed?|approved|paid|confirmed|posted|done|closed)$/i;
const CANCELLED = /cancel|void|declin|reject|refund|return/i;

/** The running total on a record that other records move: stock on hand, a balance, credits or points. */
function totalOf(entity: Entity): { field: Field; kind: "stock" | "balance" } | undefined {
  const stock = stockFieldOf(entity);
  if (stock && !computed(stock)) return { field: stock, kind: "stock" };
  const balance = entity.fields.find(
    (f) =>
      (f.type === "number" || f.type === "money") &&
      !computed(f) &&
      /balance|credits?\b|points|remaining|outstanding|on.?hand/i.test(text(f.id, f.name)) &&
      !/min|max|threshold|limit|reorder|low|initial|opening|starting/i.test(text(f.id, f.name)),
  );
  return balance ? { field: balance, kind: "balance" } : undefined;
}

/** How much a record moves: its quantity (received quantity first on receipts), days, hours or amount. */
function amountOf(entity: Entity, kind: "stock" | "balance", into: Field): Field | undefined {
  const numbers = entity.fields.filter((f) => (f.type === "number" || f.type === "money") && !computed(f));
  const named = (re: RegExp) => numbers.find((f) => re.test(text(f.id, f.name)));
  if (kind === "stock")
    return named(/received/i) ?? named(/qty|quantity|count|pcs|units|pieces/i) ?? undefined;
  // A balance in days takes days; a money balance takes an amount.
  return into.type === "money"
    ? (named(/amount|paid|payment|total|value/i) ?? numbers.find((f) => f.type === "money"))
    : (named(/days|hours|qty|quantity|points|credits|count|amount/i) ??
        numbers.find((f) => f.type === "number"));
}

/** The formula a record adds to the total and how it reads, or undefined when its name doesn't say which way. */
function deltaOf(source: Entity, amount: Field): { delta: string; says?: string } | undefined {
  const kind = source.fields.find(
    (f) =>
      (f.type === "select" || f.type === "status") &&
      /type|kind|direction|movement/i.test(text(f.id, f.name)),
  );
  if (kind?.options?.length) {
    const options = kind.options;
    const is = (re: RegExp) => options.filter((o) => re.test(o.id) || re.test(o.label));
    const ins = is(IN_OPTION);
    const outs = is(OUT_OPTION);
    if (ins.length || outs.length) {
      const any = (os: typeof ins) => os.map((o) => `${kind.id} == '${o.id}'`).join(" || ");
      const labels = (os: typeof ins) => os.map((o) => o.label).join(" and ");
      // An adjustment is signed: -3 takes three away. Any other type moves nothing.
      const branches: [typeof ins, string, string][] = [
        [ins, amount.id, "add"],
        [outs, `-${amount.id}`, "take off"],
        [is(ADJUST_OPTION), amount.id, "count as entered (negative takes off)"],
      ];
      const used = branches.filter(([os]) => os.length);
      return {
        delta: used.reduceRight(
          (rest, [os, value]) => `${any(os)} ? ${value} : ${rest === "0" ? "0" : `(${rest})`}`,
          "0",
        ),
        says: `by ${kind.name.toLowerCase()}: ${used.map(([os, , verb]) => `${labels(os)} ${verb}`).join("; ")}`,
      };
    }
  }
  const name = text(source.id, source.name, source.pluralName);
  // Receiving words win: "purchase order lines" and "sale returns" add stock.
  if (IN.test(name)) return { delta: amount.id };
  if (OUT.test(name)) return { delta: `-${amount.id}` };
  if (MOVEMENT.test(name)) return { delta: amount.id, says: "as entered (negative takes off)" };
  return undefined;
}

/** A status condition on a record (or, through prefix, on its parent): once done, or while not cancelled. */
function statusCondition(
  entity: Entity,
  prefix: string,
  owner?: string,
): { expr: string; says: string } | undefined {
  const status = entity.fields.find((f) => f.type === "status" && !computed(f));
  const options = status?.options ?? [];
  if (!status || !options.length) return undefined;
  const who = owner ? `its ${owner.toLowerCase()} is` : "it's";
  const words = (os: typeof options) => os.map((o) => o.label.toLowerCase()).join(" or ");
  const done = options.filter((o) => DONE.test(o.id) || DONE.test(o.label));
  if (done.length)
    return {
      expr: done.map((o) => `${prefix}${status.id} == '${o.id}'`).join(" || "),
      says: `once ${who} ${words(done)}`,
    };
  const off = options.filter((o) => CANCELLED.test(o.id) || CANCELLED.test(o.label));
  if (off.length)
    return {
      expr: off.map((o) => `${prefix}${status.id} != '${o.id}'`).join(" && "),
      says: `unless ${who} ${words(off)}`,
    };
  return undefined;
}

/**
 * When the record counts: its own done status (received, approved, paid), or for a line item its parent's, so a
 * purchase order's lines add stock once the order is received and an order's lines give it back when it's cancelled.
 */
function whenOf(bp: Blueprint, source: Entity): { expr: string; says: string } | undefined {
  const own = statusCondition(source, "");
  if (own) return own;
  const parent = source.parent ? bp.entities.find((e) => e.id === source.parent?.entityId) : undefined;
  return parent && source.parent
    ? statusCondition(parent, `${source.parent.fieldId}.`, parent.name)
    : undefined;
}

const has = (bp: Blueprint, entityId: string, fieldId?: string) => {
  const e = bp.entities.find((x) => x.id === entityId);
  return !!e && (fieldId === undefined || e.fields.some((f) => f.id === fieldId));
};

/** Automations the change implies, for pairs it touched, with a short line for the plan card. */
export function impliedRules(
  before: Blueprint,
  after: Blueprint,
): { rule: Rule; label: string; detail: string }[] {
  const out: { rule: Rule; label: string; detail: string }[] = [];
  const ids = new Set(after.rules.map((r) => r.id));
  for (const source of after.entities) {
    for (const link of source.fields) {
      if (link.type !== "relation" || computed(link) || link.id === source.parent?.fieldId) continue;
      const target = after.entities.find((e) => e.id === link.relation?.entityId);
      if (!target || target.id === source.id) continue;
      const total = totalOf(target);
      if (!total) continue;
      const amount = amountOf(source, total.kind, total.field);
      if (!amount) continue;
      const touched =
        !has(before, source.id, link.id) ||
        !has(before, source.id, amount.id) ||
        !has(before, target.id, total.field.id);
      if (!touched) continue;
      // Something already moves this total from this record type (any link, any event): leave it to that.
      const covered = after.rules.some(
        (r) =>
          r.trigger.entityId === source.id &&
          r.actions.some(
            (a) => a.type === "adjust_number" && (a.fieldId === total.field.id || a.fieldId === ""),
          ),
      );
      if (covered) continue;
      const move = deltaOf(source, amount);
      if (!move) continue;
      const { delta } = move;
      const when = whenOf(after, source);
      let id = slug(`sync_${target.id}_${total.field.id}_from_${source.id}`);
      while (ids.has(id)) id = `${id}_2`;
      ids.add(id);
      const verb = delta.startsWith("-") ? "take from" : delta.includes("?") || move.says ? "move" : "add to";
      const name = `${source.pluralName} ${verb} ${target.name} ${total.field.name.toLowerCase()}`;
      const sign = delta.startsWith("-") ? "−" : "+";
      out.push({
        rule: {
          id,
          name,
          trigger: { entityId: source.id, event: "created" },
          ...(when ? { when: when.expr } : {}),
          actions: [
            {
              type: "adjust_number",
              target: { kind: "relation", fieldId: link.id },
              fieldId: total.field.id,
              delta,
            },
          ],
        },
        label: name.charAt(0).toUpperCase() + name.slice(1),
        detail: `${target.name} ${total.field.name} ${move.says ? `changes ${move.says}` : `${sign} ${source.name} ${amount.name}`}${when ? `, ${when.says}` : ""}. Kept in step when edited or deleted`,
      });
    }
  }
  return out;
}

/**
 * Automations this change added that can't run (the quantity named where the stock field belongs) and that an
 * implied automation will do correctly instead. Dropping them beats sending the whole plan back over a detail
 * EveryOps can work out itself.
 */
export function replaceableRules(before: Blueprint, after: Blueprint, added: string[]): string[] {
  const bad = new Set<string>();
  for (const e of validateBlueprint(after)) {
    const at = /^rules\.(\d+)$/.exec(e.path);
    const id = at ? after.rules[Number(at[1])]?.id : undefined;
    if (id && added.includes(id) && e.message.startsWith("Automation")) bad.add(id);
  }
  if (!bad.size) return [];
  const trial = { ...after, rules: after.rules.filter((r) => !bad.has(r.id)) };
  const sources = new Set(impliedRules(before, trial).map((x) => x.rule.trigger.entityId));
  return after.rules.filter((r) => bad.has(r.id) && sources.has(r.trigger.entityId)).map((r) => r.id);
}

/**
 * Where stock belongs. In a workspace that sells things (order lines or a register link to them), "add stock
 * management" means stock on what's sold, synced with sales; a separate list of inventory items only makes sense
 * for ingredients, supplies or raw materials. Returns why a plan put stock somewhere else, or undefined.
 */
export function misplacedStock(before: Blueprint, after: Blueprint, request: string): string | undefined {
  if (
    !/stock|inventory|imbentaryo/i.test(request) ||
    /ingredient|raw|material|suppl(y|ies)|sangkap|component/i.test(request)
  )
    return undefined;
  const sold = new Map<string, Entity>();
  for (const v of after.views)
    if (v.type === "checkout") {
      const e = after.entities.find((x) => x.id === v.productEntityId);
      if (e) sold.set(e.id, e);
    }
  for (const line of after.entities)
    if (line.parent && /order|sale|invoice|receipt|transaction/i.test(text(line.parent.entityId, line.name)))
      for (const f of line.fields) {
        const e =
          f.relation && f.id !== line.parent.fieldId
            ? after.entities.find((x) => x.id === f.relation?.entityId)
            : undefined;
        if (e && before.entities.some((x) => x.id === e.id)) sold.set(e.id, e);
      }
  if (!sold.size || [...sold.values()].some((e) => stockFieldOf(e))) return undefined;
  const added = after.entities.find((e) => !before.entities.some((x) => x.id === e.id) && stockFieldOf(e));
  if (!added) return undefined;
  const items = [...sold.values()].map((e) => e.pluralName).join(" and ");
  return `Stock here belongs on ${items}: that's what this business sells (its order lines link to them), so "${request.trim().slice(0, 60)}" means stock on them, taken off by sales. Add the stock fields (stock on hand, reorder level) to ${[...sold.keys()].join(", ")} and link deliveries, purchase lines and stock movements to it instead of the new ${added.name}. A separate inventory of ingredients or supplies is only for when the person asks for one.`;
}

const PRICE_WORD = /price|rate|cost/i;

/**
 * A stock movement automation written for one direction only: "when type is spoilage or out, take qty off" leaves
 * every Purchase and In movement adding nothing, so a bakery that logs a fresh batch as a movement never sees its
 * stock go up (and impliedRules counts the one-way rule as covering the movements). A rule whose condition only
 * picks movement types on one side, when the type also has the other side, becomes the full movement: ins add,
 * outs take off, adjustments count as entered, for every type.
 */
export function widenMovements(bp: Blueprint): Rule[] {
  return bp.rules.map((rule) => {
    const source = bp.entities.find((e) => e.id === rule.trigger.entityId);
    if (!source || rule.trigger.event !== "created" || rule.actions.length !== 1) return rule;
    const [action] = rule.actions;
    if (action.type !== "adjust_number" || action.target.kind !== "relation") return rule;
    const amount = /^\s*-?\s*([a-z_][a-z0-9_]*)\s*$/i.exec(action.delta)?.[1];
    const amountField = source.fields.find((f) => f.id === amount);
    if (!amountField) return rule;
    const kind = source.fields.find(
      (f) =>
        (f.type === "select" || f.type === "status") &&
        /type|kind|direction|movement/i.test(text(f.id, f.name)),
    );
    const options = kind?.options ?? [];
    if (!kind || !rule.when) return rule;
    const picked = [...rule.when.matchAll(new RegExp(`\\b${kind.id}\\s*==\\s*'([^']+)'`, "g"))].map(
      (m) => m[1],
    );
    // Only a condition that is nothing but a choice of types: "type == 'spoilage' || type == 'out'".
    const rest = rule.when
      .replace(new RegExp(`\\b${kind.id}\\s*==\\s*'[^']+'`, "g"), "")
      .replace(/[()|\s]/g, "");
    if (!picked.length || rest) return rule;
    const side = (re: RegExp) => options.filter((o) => re.test(o.id) || re.test(o.label)).map((o) => o.id);
    const ins = side(IN_OPTION);
    const outs = side(OUT_OPTION);
    const oneSide = picked.every((p) => outs.includes(p))
      ? ins
      : picked.every((p) => ins.includes(p))
        ? outs
        : [];
    if (!oneSide.length || oneSide.some((o) => picked.includes(o))) return rule;
    const move = deltaOf(source, amountField);
    if (!move?.says) return rule;
    const linkId = action.target.fieldId;
    const link = source.fields.find((f) => f.id === linkId);
    const target = bp.entities.find((e) => e.id === link?.relation?.entityId);
    const total = target?.fields.find((f) => f.id === action.fieldId);
    const widened: Rule = {
      ...rule,
      ...(target && total
        ? { name: `${source.pluralName} move ${target.name} ${total.name.toLowerCase()}` }
        : {}),
      actions: [{ ...action, delta: move.delta }],
    };
    delete widened.when;
    return widened;
  });
}
const NOT_UNIT = /total|amount|subtotal|line|sum|discount|tax/i;

/**
 * A line item's unit price (or unit cost on a purchase line) comes from what it links to: an order line for a
 * Dining Table starts at the table's price. Without it the owner types every price by hand; a production ERP's
 * order lines saved at ₱0. For each line-item type with a price field nobody fills, an automation copies the linked
 * product's matching price when the line is added with the price left blank, so a price typed in stays.
 */
export function linePriceRules(bp: Blueprint): Rule[] {
  const out: Rule[] = [];
  const ids = new Set(bp.rules.map((r) => r.id));
  for (const line of bp.entities) {
    if (!line.parent) continue;
    const prices = line.fields.filter(
      (f) =>
        (f.type === "money" || f.type === "number") &&
        !computed(f) &&
        PRICE_WORD.test(text(f.id, f.name)) &&
        !NOT_UNIT.test(text(f.id, f.name)),
    );
    for (const price of prices) {
      const filled = bp.rules.some(
        (r) =>
          r.trigger.entityId === line.id &&
          r.actions.some((a) => a.type === "set_field" && a.target.kind === "self" && a.fieldId === price.id),
      );
      if (filled) continue;
      const word = (PRICE_WORD.exec(text(price.id, price.name))?.[0] ?? "price").toLowerCase();
      const source = line.fields
        .filter((f) => f.type === "relation" && !computed(f) && f.id !== line.parent?.fieldId)
        .flatMap((link) => {
          const item = bp.entities.find((e) => e.id === link.relation?.entityId);
          const money = (item?.fields ?? []).filter((f) => f.type === "money" || f.type === "number");
          const match =
            money.find((f) => f.id === price.id) ??
            money.find(
              (f) => new RegExp(word, "i").test(text(f.id, f.name)) && !NOT_UNIT.test(text(f.id, f.name)),
            );
          return match ? [{ link, match }] : [];
        })[0];
      if (!source) continue;
      let id = slug(`fill_${line.id}_${price.id}`);
      while (ids.has(id)) id = `${id}_2`;
      ids.add(id);
      out.push({
        id,
        name: `${line.name} ${price.name.toLowerCase()} from ${source.link.name.toLowerCase()}`,
        trigger: { entityId: line.id, event: "created" },
        when: `!${price.id}`,
        actions: [
          {
            type: "set_field",
            target: { kind: "self" },
            fieldId: price.id,
            value: `${source.link.id}.${source.match.id}`,
          },
        ],
      });
    }
  }
  return out;
}

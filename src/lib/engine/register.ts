import { editableFields } from "@/lib/blueprint/field-kind";
import { recordTitle } from "@/lib/blueprint/lookup";
import type {
  Blueprint,
  CheckoutView,
  DataRecord,
  Entity,
  Field,
  FieldType,
  FieldValue,
  RecordData,
} from "@/lib/blueprint/types";
import { todayKey } from "@/lib/time";

/**
 * How the Register reads and writes a POS blueprint. Generated blueprints name their fields freely
 * ("quantity", "unit_price", "cashier") and mark them required, so the Register finds them by type and
 * name instead of assuming the canteen template's ids, and fills everything a sale can know.
 */

const computed = (f: Field) => f.type === "formula" || f.type === "rollup";

function find(
  entity: Entity,
  types: FieldType[],
  opts: { ids?: string[]; name?: RegExp; not?: RegExp; skip?: Set<string> } = {},
): Field | undefined {
  const usable = entity.fields.filter(
    (f) =>
      types.includes(f.type) &&
      !computed(f) &&
      !opts.skip?.has(f.id) &&
      !(opts.not && (opts.not.test(f.name) || opts.not.test(f.id))),
  );
  if (!opts.ids && !opts.name) return usable[0];
  return (
    usable.find((f) => opts.ids?.includes(f.id)) ??
    (opts.name ? usable.find((f) => opts.name?.test(f.name) || opts.name?.test(f.id)) : undefined)
  );
}

/**
 * Any field (computed ones too) that holds a product's stock on hand; thresholds and planned or ordered amounts
 * ("Qty to Produce" on a job order, "Qty Ordered") don't count. A job order's quantity to produce once read as its
 * stock, and receiving lumber raised it from 1 to 21.
 */
export function stockFieldOf(product: Entity): Field | undefined {
  const not =
    /low|threshold|reorder|min|alert|max|to.?produce|to.?make|ordered|required|needed|planned|target|per.?batch|yield/i;
  const numbers = product.fields.filter((f) => f.type === "number" && !not.test(f.name) && !not.test(f.id));
  return (
    numbers.find((f) => f.id === "stock") ??
    numbers.find((f) => /stock|on.?hand|inventory|qty|quantity/i.test(`${f.id} ${f.name}`))
  );
}

export function priceFieldOf(product: Entity): Field | undefined {
  const money = product.fields.filter((f) => f.type === "money");
  return (
    money.find((f) => f.id === "price") ??
    money.find((f) => /price|srp|retail|selling/i.test(`${f.id} ${f.name}`)) ??
    money.find((f) => !/cost|capital|puhunan/i.test(`${f.id} ${f.name}`))
  );
}

export function costFieldOf(entity: Entity): Field | undefined {
  return entity.fields.find((f) => f.type === "money" && /cost|capital|puhunan/i.test(`${f.id} ${f.name}`));
}

/** A product's own low-stock level, when the blueprint keeps one. */
export function lowStockFieldOf(product: Entity): Field | undefined {
  return product.fields.find(
    (f) => f.type === "number" && /low|threshold|reorder|min/i.test(`${f.id} ${f.name}`),
  );
}

/** The order's link to who bought (a customer, client or suki), when it has one. */
export function customerFieldOf(order: Entity, productEntityId: string): Field | undefined {
  const links = order.fields.filter(
    (f) => f.type === "relation" && !computed(f) && f.relation?.entityId !== productEntityId,
  );
  // Only a link that names who bought: an order's other links (payment methods, tables) aren't customers.
  return links.find((f) => /customer|client|buyer|suki|member|patron/i.test(`${f.id} ${f.name}`));
}

/** Credit sales (utang, charge to account) must say who owes the money. Takes the method's id and label. */
export function isCreditMethod(method: string): boolean {
  return /utang|credit|charge|lista|on.?tab/i.test(method);
}

/**
 * The ways to pay a sale: a select's options, or the records of a linked list (a "Payment Methods" table with
 * GCash and Maya accounts), leaving out ones marked inactive.
 */
export function paymentChoices(
  payment: Field,
  records: DataRecord[],
  methods: Entity | undefined,
): { id: string; label: string }[] {
  if (payment.type !== "relation" || !methods)
    return (payment.options ?? []).map(({ id, label }) => ({ id, label }));
  const active = methods.fields.find(
    (f) => f.type === "checkbox" && /active|enabled|available/i.test(`${f.id} ${f.name}`),
  );
  return records
    .filter((r) => r.entityId === methods.id && (!active || r.data[active.id] !== false))
    .map((r) => ({ id: r.id, label: recordTitle(methods, r) }));
}

/** The option a completed (or held) sale gets in a generated status field. */
export function saleStatus(field: Field | undefined, wanted: "completed" | "held"): string | undefined {
  const options = field?.options ?? [];
  if (!options.length) return undefined;
  const match =
    wanted === "held" ? /held|hold|park|pending|open/i : /complet|paid|done|closed|success|fulfil/i;
  return (
    options.find((o) => o.id === wanted)?.id ??
    options.find((o) => match.test(o.id) || match.test(o.label))?.id ??
    (wanted === "completed" ? options[0].id : undefined)
  );
}

export type SaleInput = {
  product: Entity;
  order: Entity;
  line: Entity;
  paymentFieldId: string;
  items: { product: DataRecord; qty: number }[];
  code: string;
  method: string;
  /** Cash handed over, when the method is cash and the cashier typed it. */
  cash?: number;
  status: "completed" | "held";
  /** The signed-in person ringing up the sale. */
  cashier?: string;
  /** The customer record, for credit sales or when the cashier picked one. */
  customer?: string;
  /**
   * What the cashier answered for the fields the Register asks (registerFields): a branch, a table, a note.
   * Keyed by field id; order fields go on the order, line fields on every line.
   */
  answers?: RecordData;
  now?: Date;
};

export function saleRecords(input: SaleInput): { order: RecordData; lines: RecordData[] } {
  const { product, order, line, items, now = new Date() } = input;
  const price = priceFieldOf(product);
  const productCost = costFieldOf(product);
  const priceOf = (p: DataRecord) => Number(p.data[price?.id ?? ""] ?? 0) || 0;
  const total = items.reduce((sum, i) => sum + priceOf(i.product) * i.qty, 0);

  const used = new Set<string>([input.paymentFieldId]);
  const set = (data: RecordData, field: Field | undefined, value: FieldValue | undefined) => {
    if (!field || computed(field) || value === undefined) return;
    data[field.id] = value;
    used.add(field.id);
  };

  const orderData: RecordData = { [input.paymentFieldId]: input.method };
  const primary = order.fields.find((f) => f.id === order.primaryFieldId);
  if (primary && !computed(primary) && (primary.type === "text" || primary.type === "long_text"))
    set(orderData, primary, input.code);
  set(orderData, find(order, ["datetime"], { skip: used }), now.toISOString());
  for (const f of order.fields)
    if (f.type === "date" && f.required && !used.has(f.id)) set(orderData, f, todayKey(now));
  const status = order.fields.find((f) => f.type === "status" && !computed(f));
  set(orderData, status, saleStatus(status, input.status));
  const cash = input.cash;
  if (cash) {
    set(
      orderData,
      find(order, ["money", "number"], { ids: ["cash_received"], name: /cash|tender|received/i, skip: used }),
      cash,
    );
    set(
      orderData,
      find(order, ["money"], { ids: ["change_due", "change"], name: /change/i, skip: used }),
      Math.max(0, cash - total),
    );
  }
  set(
    orderData,
    find(order, ["money"], {
      ids: ["total"],
      name: /total|amount|grand/i,
      not: /paid|cash|change|tender/i,
      skip: used,
    }),
    total,
  );
  // People fields on a sale are who rang it up.
  if (input.cashier)
    for (const f of order.fields)
      if (f.type === "person" && !used.has(f.id)) set(orderData, f, input.cashier);
  if (input.customer) set(orderData, customerFieldOf(order, product.id), input.customer);
  const answers = input.answers ?? {};
  for (const f of order.fields) if (!used.has(f.id)) set(orderData, f, answers[f.id] ?? undefined);

  const lineProduct = line.fields.find((f) => f.type === "relation" && f.relation?.entityId === product.id);
  const lines = items.map(({ product: p, qty }) => {
    const data: RecordData = {};
    used.clear();
    if (line.parent) used.add(line.parent.fieldId);
    set(data, lineProduct, p.id);
    const unit = priceOf(p);
    set(
      data,
      find(line, ["number"], { ids: ["qty", "quantity"], name: /qty|quantity|count|pcs/i, skip: used }) ??
        find(line, ["number"], { skip: used }),
      qty,
    );
    set(
      data,
      find(line, ["money"], {
        ids: ["price", "unit_price"],
        name: /price|srp|rate/i,
        not: /cost|total/i,
        skip: used,
      }),
      unit,
    );
    const cost = find(line, ["money"], { name: /cost|capital|puhunan/i, skip: used });
    if (cost) set(data, cost, Number(p.data[productCost?.id ?? ""] ?? 0) || 0);
    set(
      data,
      find(line, ["money"], {
        ids: ["line_total", "subtotal", "amount"],
        name: /total|subtotal|amount/i,
        skip: used,
      }),
      unit * qty,
    );
    const title = line.fields.find((f) => f.id === line.primaryFieldId);
    if (
      title &&
      !computed(title) &&
      !used.has(title.id) &&
      (title.type === "text" || title.type === "long_text")
    )
      set(data, title, recordTitle(product, p));
    // A line that also keeps the branch (or anything the order was asked) gets the order's answer.
    for (const f of line.fields) {
      if (used.has(f.id) || computed(f)) continue;
      const twin = f.relation
        ? order.fields.find((o) => o.relation?.entityId === f.relation?.entityId && orderData[o.id] != null)
        : f.required
          ? order.fields.find((o) => o.id === f.id && o.type === f.type)
          : undefined;
      set(data, f, answers[f.id] ?? (twin ? orderData[twin.id] : undefined) ?? undefined);
    }
    return data;
  });
  return { order: orderData, lines };
}

const empty = (v: FieldValue | undefined) =>
  v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

export type RegisterField = { field: Field; on: "order" | "line" };

/**
 * The fields the Register asks the cashier, besides products, payment method, customer and cash: every required
 * field a sale can't fill by itself (a Branch, a Table, a Shift) plus the optional ones the view lists in
 * fieldIds. Found by ringing up a pretend sale, so whatever saleRecords learns to fill stops being asked.
 * Without this a blueprint with one extra required field has a Register that can never complete a sale.
 */
export function registerFields(bp: Blueprint, view: CheckoutView): RegisterField[] {
  const product = bp.entities.find((e) => e.id === view.productEntityId);
  const order = bp.entities.find((e) => e.id === view.entityId);
  const line = bp.entities.find((e) => e.id === view.lineEntityId);
  if (!product || !order || !line) return [];
  const customer = customerFieldOf(order, product.id);
  const probe = saleRecords({
    product,
    order,
    line,
    paymentFieldId: view.paymentFieldId,
    items: [
      { product: { id: "probe", entityId: product.id, data: {}, createdAt: "", updatedAt: "" }, qty: 1 },
    ],
    code: "#1",
    method: "probe",
    cash: 1,
    status: "completed",
    cashier: "probe",
    customer: "probe",
  });
  const extra = view.fieldIds ?? [];
  const asked = (f: Field) => f.required || extra.includes(f.id);
  const orderFields = editableFields(order).filter(
    (f) => f.id !== view.paymentFieldId && f.id !== customer?.id && empty(probe.order[f.id]) && asked(f),
  );
  // Required line fields nothing fills, and that the order doesn't ask under the same id, are asked once for
  // the whole sale.
  const lineFields = editableFields(line).filter(
    (f) =>
      f.required &&
      !(f.type === "relation" && f.relation?.entityId === product.id) &&
      probe.lines.every((l) => empty(l[f.id])) &&
      !orderFields.some((o) => o.id === f.id || (f.relation && o.relation?.entityId === f.relation.entityId)),
  );
  const rank = (f: Field) => (extra.includes(f.id) ? extra.indexOf(f.id) : extra.length);
  return [
    ...orderFields.sort((a, b) => rank(a) - rank(b)).map((field) => ({ field, on: "order" as const })),
    ...lineFields.map((field) => ({ field, on: "line" as const })),
  ];
}

/** Answers that stay put between sales: which branch, till or shift the register is ringing up for. */
export const stickyField = (f: Field) =>
  f.type === "relation" ||
  f.type === "select" ||
  f.type === "multi_select" ||
  f.type === "person" ||
  f.type === "checkbox";

/**
 * Starting answers: what this register used last (when it still exists), otherwise the only possible choice, so a
 * one-branch store never has to pick. Everything else starts empty and the cashier chooses.
 */
export function registerDefaults(
  fields: RegisterField[],
  records: DataRecord[],
  saved: RecordData = {},
): RecordData {
  const out: RecordData = {};
  for (const { field } of fields) {
    const last = saved[field.id];
    const targets = field.relation ? records.filter((r) => r.entityId === field.relation?.entityId) : [];
    const options = field.options ?? [];
    const valid =
      !empty(last) &&
      stickyField(field) &&
      (field.type === "relation"
        ? targets.some((r) => r.id === last)
        : field.type === "select" || field.type === "status"
          ? options.some((o) => o.id === last)
          : true);
    if (valid) out[field.id] = last;
    else if (field.type === "relation" && targets.length === 1) out[field.id] = targets[0].id;
    else if ((field.type === "select" || field.type === "status") && options.length === 1)
      out[field.id] = options[0].id;
  }
  return out;
}

/** Required answers still missing, in the order the Register shows them. */
export function missingAnswers(fields: RegisterField[], answers: RecordData): Field[] {
  return fields.filter(({ field }) => field.required && empty(answers[field.id])).map(({ field }) => field);
}

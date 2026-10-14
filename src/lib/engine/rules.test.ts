import { describe, expect, it } from "vitest";
import type { Action, Blueprint, DataRecord, Entity, Rule, WorkspaceData } from "@/lib/blueprint/types";
import { validateBlueprint } from "@/lib/blueprint/validate";
import { posSample } from "@/lib/catalog/canteen-pos";
import { f } from "@/lib/catalog/define";
import { applyOps } from "./changes";
import { recordContext } from "./context";
import { run } from "./expr";
import { applyRecordOps, createRecord, createWithLines, deleteRecord, updateRecord } from "./records";

const NOW = new Date("2026-10-14T06:00:00Z");

// The Menu Manager from the bug report: products with stock, and a Stock Manager that receives deliveries.
const supplier: Entity = {
  id: "suppliers",
  name: "Supplier",
  pluralName: "Suppliers",
  primaryFieldId: "name",
  fields: [f.text("name", "Name", { required: true }), f.number("lead_days", "Lead days")],
};
const product: Entity = {
  id: "products",
  name: "Product",
  pluralName: "Products",
  primaryFieldId: "name",
  fields: [
    f.text("name", "Name", { required: true }),
    f.money("price", "Price"),
    f.number("stock", "Stock"),
    f.number("pack_size", "Pack size"),
    f.number("low_stock", "Low stock"),
    f.relation("supplier", "Supplier", "suppliers"),
  ],
};
const delivery: Entity = {
  id: "stock_deliveries",
  name: "Stock Delivery",
  pluralName: "Stock Deliveries",
  primaryFieldId: "reference",
  fields: [
    f.text("reference", "Reference", { required: true }),
    f.relation("product", "Product", "products", { required: true }),
    f.number("quantity", "Quantity", { required: true }),
    f.status("status", "Status", [
      ["pending", "Pending"],
      ["received", "Received"],
    ]),
  ],
};
const rec = (id: string, entityId: string, data: DataRecord["data"]): DataRecord => ({
  id,
  entityId,
  data,
  createdAt: NOW.toISOString(),
  updatedAt: NOW.toISOString(),
});
const base = (): WorkspaceData => {
  const ws = posSample(NOW);
  return {
    ...ws,
    blueprint: {
      ...ws.blueprint,
      entities: [supplier, product, delivery],
      views: [],
      widgets: [],
      rules: [],
      systems: [],
    },
    records: [
      rec("sup1", "suppliers", { name: "Cebu Poultry", lead_days: 3 }),
      rec("wings", "products", {
        name: "Garlic Parmesan Wings",
        price: 180,
        stock: 25,
        pack_size: 12,
        supplier: "sup1",
      }),
      rec("latte", "products", { name: "Iced Latte", price: 120, stock: 100, pack_size: 1 }),
    ],
  };
};
const ADJUST: Extract<Action, { type: "adjust_number" }> = {
  type: "adjust_number",
  target: { kind: "relation", fieldId: "product" },
  fieldId: "",
  delta: "quantity",
};
// What the assistant saved: the stock field left blank.
const blankRule: Rule = {
  id: "add_stock_on_delivery",
  name: "Add stock on delivery",
  trigger: { entityId: "stock_deliveries", event: "created" },
  actions: [
    {
      type: "adjust_number",
      target: { kind: "relation", fieldId: "product" },
      fieldId: "",
      delta: "quantity",
    },
  ],
};
const withRule = (rule: Rule): WorkspaceData => {
  const ws = base();
  return { ...ws, blueprint: applyOps(ws.blueprint, [{ op: "add_rule", rule }]) };
};
const stock = (ws: WorkspaceData, id: string) => ws.records.find((r) => r.id === id)?.data.stock;
const receive = (ws: WorkspaceData, data: DataRecord["data"]) => {
  const result = createRecord(ws, "stock_deliveries", { reference: "DR-1", ...data }, NOW);
  if (!result.ok) throw new Error(result.errors.map((e) => e.message).join("; "));
  return result;
};

describe("stock automations", () => {
  it("fills in the stock field the assistant left blank, so receiving 100 wings adds 100", () => {
    const ws = withRule(blankRule);
    expect(ws.blueprint.rules[0].actions[0]).toMatchObject({ fieldId: "stock", delta: "quantity" });
    expect(validateBlueprint(ws.blueprint)).toEqual([]);
    expect(stock(receive(ws, { product: "wings", quantity: 100 }).data, "wings")).toBe(125);
  });

  it("still runs a saved rule with a blank field", () => {
    const ws = base();
    ws.blueprint = { ...ws.blueprint, rules: [blankRule] };
    expect(stock(receive(ws, { product: "wings", quantity: 100 }).data, "wings")).toBe(125);
  });

  it("keeps stock in step when a delivery is edited, moved to another product or deleted", () => {
    const ws = withRule(blankRule);
    const received = receive(ws, { product: "wings", quantity: 100 });
    const id = received.record.id;

    const more = updateRecord(received.data, id, { quantity: 120 }, NOW);
    if (!more.ok) throw new Error("edit failed");
    expect(stock(more.data, "wings")).toBe(145);

    const moved = updateRecord(more.data, id, { product: "latte" }, NOW);
    if (!moved.ok) throw new Error("move failed");
    expect(stock(moved.data, "wings")).toBe(25);
    expect(stock(moved.data, "latte")).toBe(220);

    const gone = deleteRecord(moved.data, id, NOW);
    expect(stock(gone, "latte")).toBe(100);
  });

  it("computes the amount from related records, and counts only while a condition holds", () => {
    const ws = withRule({
      ...blankRule,
      when: "status == 'received'",
      actions: [
        {
          type: "adjust_number",
          target: { kind: "relation", fieldId: "product" },
          fieldId: "stock",
          delta: "quantity * product.pack_size",
        },
      ],
    });
    const pending = receive(ws, { product: "wings", quantity: 2, status: "pending" });
    expect(stock(pending.data, "wings")).toBe(25);
    const arrived = updateRecord(pending.data, pending.record.id, { status: "received" }, NOW);
    if (!arrived.ok) throw new Error("update failed");
    expect(stock(arrived.data, "wings")).toBe(25 + 24);
  });

  it("replaces an automation added again with the same id (how the assistant fixes one)", () => {
    const ws = withRule(blankRule);
    const fixed = applyOps(ws.blueprint, [
      {
        op: "add_rule",
        rule: {
          ...blankRule,
          name: "Receive stock",
          actions: [{ ...ADJUST, delta: "quantity * 2" }],
        },
      },
    ]);
    expect(fixed.rules).toHaveLength(1);
    expect(fixed.rules[0]).toMatchObject({
      name: "Receive stock",
      actions: [{ fieldId: "stock", delta: "quantity * 2" }],
    });
  });

  it("rejects automations that can't do anything, with a reason the assistant can act on", () => {
    const bad = (rule: Rule) => {
      const bp: Blueprint = { ...base().blueprint, rules: [rule] };
      return validateBlueprint(bp).map((e) => e.message);
    };
    expect(bad({ ...blankRule, actions: [{ ...ADJUST, fieldId: "price_typo" }] })[0]).toMatch(
      /fieldId "price_typo" isn't a field of Product/,
    );
    expect(bad({ ...blankRule, actions: [{ ...ADJUST, fieldId: "stock", delta: "0" }] })[0]).toMatch(
      /adds nothing/,
    );
    expect(bad({ ...blankRule, actions: [{ ...ADJUST, fieldId: "stock", delta: "qty" }] })[0]).toMatch(
      /"qty" is not a field on Stock Delivery/,
    );
    expect(
      bad({
        ...blankRule,
        actions: [{ ...ADJUST, target: { kind: "relation", fieldId: "item" }, fieldId: "stock" }],
      })[0],
    ).toMatch(/isn't a link on Stock Delivery/);
    expect(
      bad({
        ...blankRule,
        trigger: { entityId: "stock_deliveries", event: "updated" },
        actions: [{ ...ADJUST, fieldId: "stock" }],
      })[0],
    ).toMatch(/counts it again each time/);
  });

  it("puts stock back when a sale is deleted", () => {
    const ws = posSample(NOW);
    const turon = ws.records.find((r) => r.data.name === "Turon") as DataRecord;
    const sale = createWithLines(
      ws,
      "order",
      { code: "#9001", placed_at: NOW.toISOString(), payment: "cash", status: "completed" },
      "order_line",
      [{ product: turon.id, qty: 2, price: 20 }],
      NOW,
    );
    if (!sale.ok) throw new Error("sale failed");
    expect(stock(sale.data, turon.id)).toBe(Number(turon.data.stock) - 2);
    expect(stock(deleteRecord(sale.data, sale.record.id, NOW), turon.id)).toBe(turon.data.stock);
  });

  it("lets an assistant plan's stock changes be undone", () => {
    const ws = withRule(blankRule);
    const plan = applyRecordOps(
      ws,
      [
        {
          op: "create_record",
          entityId: "stock_deliveries",
          id: "dr1",
          data: { reference: "DR-1", product: "wings", quantity: 100 },
        },
      ],
      NOW,
    );
    expect(stock(plan.data, "wings")).toBe(125);
    expect(plan.replaced.find((r) => r.id === "wings")?.data.stock).toBe(25);
  });
});

describe("formulas through several links", () => {
  const line: Entity = {
    id: "delivery_lines",
    name: "Delivery line",
    pluralName: "Delivery lines",
    primaryFieldId: "product",
    fields: [f.relation("product", "Product", "products"), f.number("qty", "Qty")],
  };
  const bp = (): Blueprint => ({ ...base().blueprint, entities: [supplier, product, delivery, line] });

  it("reads a value two links away", () => {
    const ws = base();
    const ctx = recordContext(bp(), line, { product: "wings", qty: 3 }, ws.records, NOW);
    expect(run("product.supplier.lead_days + qty", ctx)).toBe(6);
    expect(run("product.supplier.name", ctx)).toBe("Cebu Poultry");
  });

  it("validates every link along the way", () => {
    const withFormula = (expr: string) => {
      const b = bp();
      b.entities = b.entities.map((e) =>
        e.id === "delivery_lines"
          ? {
              ...e,
              fields: [
                ...e.fields,
                {
                  id: "eta",
                  name: "ETA",
                  type: "formula" as const,
                  formula: { expr, resultType: "number" as const },
                },
              ],
            }
          : e,
      );
      return validateBlueprint(b).map((e) => e.message);
    };
    expect(withFormula("product.supplier.lead_days")).toEqual([]);
    expect(withFormula("product.supplier.phone")[0]).toMatch(/Supplier has no field "phone"/);
    expect(withFormula("qty.supplier")[0]).toMatch(/isn't a link/);
  });
});

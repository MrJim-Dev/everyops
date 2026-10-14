import { describe, expect, it } from "vitest";
import type { CheckoutView, DataRecord, Entity, WorkspaceData } from "@/lib/blueprint/types";
import { CATALOG } from "@/lib/catalog";
import { posSample } from "@/lib/catalog/canteen-pos";
import { f } from "@/lib/catalog/define";
import { DEMO_WORKSPACES } from "@/lib/catalog/demo-workspaces";
import { createWithLines } from "./records";
import {
  customerFieldOf,
  isCreditMethod,
  lowStockFieldOf,
  missingAnswers,
  paymentChoices,
  registerDefaults,
  registerFields,
  saleRecords,
  stockFieldOf,
} from "./register";

const NOW = new Date("2026-10-14T06:00:00Z");

// Shaped like a blueprint Ask EveryOps generated for a sari-sari store: free field names, everything required.
const product: Entity = {
  id: "products",
  name: "Product",
  pluralName: "Products",
  primaryFieldId: "name",
  fields: [
    f.text("name", "Name", { required: true }),
    f.money("cost", "Cost"),
    f.money("selling_price", "Selling Price", { required: true }),
    f.number("low_stock_threshold", "Low stock threshold"),
  ],
};
const order: Entity = {
  id: "orders",
  name: "Order",
  pluralName: "Orders",
  primaryFieldId: "title",
  fields: [
    f.text("title", "Title", { required: true }),
    f.datetime("date_time", "Date-Time", { required: true }),
    f.person("cashier", "Cashier", { required: true }),
    f.select(
      "payment_method",
      "Payment Method",
      [
        ["cash", "Cash"],
        ["utang", "Utang"],
      ],
      { required: true },
    ),
    f.status(
      "status",
      "Status",
      [
        ["paid", "Paid", "success"],
        ["void", "Void", "danger"],
      ],
      { required: true },
    ),
    f.money("total", "Total"),
    f.money("amount_tendered", "Amount Tendered"),
    f.money("change", "Change"),
  ],
};
const line: Entity = {
  id: "order_lines",
  name: "Order line",
  pluralName: "Order lines",
  primaryFieldId: "title",
  parent: { entityId: "orders", fieldId: "order" },
  fields: [
    f.text("title", "Title", { required: true }),
    f.relation("order", "Order", "orders", { required: true }),
    f.relation("product", "Product", "products", { required: true }),
    f.number("quantity", "Quantity", { required: true }),
    f.money("unit_price", "Price", { required: true }),
    f.money("cost", "Cost", { required: true }),
  ],
};
const noodles: DataRecord = {
  id: "p1",
  entityId: "products",
  data: { name: "Lucky Me Noodles", cost: 11, selling_price: 15 },
  createdAt: NOW.toISOString(),
  updatedAt: NOW.toISOString(),
};

describe("register sale", () => {
  it("fills every field a generated POS blueprint requires", () => {
    const sale = saleRecords({
      product,
      order,
      line,
      paymentFieldId: "payment_method",
      items: [{ product: noodles, qty: 3 }],
      code: "#1003",
      method: "cash",
      cash: 100,
      status: "completed",
      cashier: "James Ocampo",
      now: NOW,
    });
    expect(sale.order).toMatchObject({
      title: "#1003",
      date_time: NOW.toISOString(),
      cashier: "James Ocampo",
      payment_method: "cash",
      status: "paid",
      total: 45,
      amount_tendered: 100,
      change: 55,
    });
    expect(sale.lines).toEqual([
      { product: "p1", quantity: 3, unit_price: 15, cost: 11, title: "Lucky Me Noodles" },
    ]);
    const base = posSample(NOW);
    const ws = {
      ...base,
      blueprint: { ...base.blueprint, entities: [product, order, line], rules: [] },
      records: [noodles],
    };
    const saved = createWithLines(ws, "orders", sale.order, "order_lines", sale.lines, NOW);
    expect(saved.ok).toBe(true);
  });

  it("treats a threshold as no stock count", () => {
    expect(stockFieldOf(product)).toBeUndefined();
    expect(lowStockFieldOf(product)?.id).toBe("low_stock_threshold");
  });

  it("links a credit sale to the customer who owes it", () => {
    const withCustomer: Entity = {
      ...order,
      fields: [...order.fields, f.relation("customer", "Customer", "customers")],
    };
    const payment = withCustomer.fields.find((x) => x.id === "payment_method");
    expect(payment && isCreditMethod("utang Utang")).toBe(true);
    expect(payment && isCreditMethod("cash Cash")).toBe(false);
    expect(customerFieldOf(withCustomer, "products")?.id).toBe("customer");
    expect(
      customerFieldOf({ ...order, fields: [f.relation("method", "Payment Method", "methods")] }, "products"),
    ).toBeUndefined();
    const sale = saleRecords({
      product,
      order: withCustomer,
      line,
      paymentFieldId: "payment_method",
      items: [{ product: noodles, qty: 1 }],
      code: "#1004",
      method: "utang",
      status: "completed",
      customer: "c1",
      now: NOW,
    });
    expect(sale.order.customer).toBe("c1");
    expect(sale.order.amount_tendered).toBeUndefined();
  });

  it("still writes the canteen template's fields", () => {
    const ws = posSample(NOW);
    const bp = ws.blueprint;
    const turon = ws.records.find((r) => r.data.name === "Turon") as DataRecord;
    const ent = (id: string) => bp.entities.find((e) => e.id === id) as Entity;
    const sale = saleRecords({
      product: ent("product"),
      order: ent("order"),
      line: ent("order_line"),
      paymentFieldId: "payment",
      items: [{ product: turon, qty: 2 }],
      code: "#9001",
      method: "cash",
      cash: 100,
      status: "completed",
      now: NOW,
    });
    const result = createWithLines(ws, "order", sale.order, "order_line", sale.lines, NOW);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.record.data.change_due).toBe(100 - Number(result.record.data.total));
  });

  it("offers a linked list of payment methods, leaving out inactive ones", () => {
    const methods: Entity = {
      id: "methods",
      name: "Payment Method",
      pluralName: "Payment Methods",
      primaryFieldId: "type",
      fields: [f.text("type", "Type"), f.checkbox("active", "Active")],
    };
    const rec = (id: string, type: string, active: boolean) => ({
      id,
      entityId: "methods",
      data: { type, active },
      createdAt: "",
      updatedAt: "",
    });
    const field = f.relation("payment_method", "Payment Method", "methods");
    expect(
      paymentChoices(
        field,
        [rec("m1", "Cash", true), rec("m2", "GCash", true), rec("m3", "Maya", false)],
        methods,
      ),
    ).toEqual([
      { id: "m1", label: "Cash" },
      { id: "m2", label: "GCash" },
    ]);
  });
});

// The Salo-Salo case: a generated multi-branch POS whose orders (and lines) must say which branch sold them.
describe("register questions", () => {
  const branch: Entity = {
    id: "branches",
    name: "Branch",
    pluralName: "Branches",
    primaryFieldId: "name",
    fields: [f.text("name", "Name", { required: true })],
  };
  const branchOrder: Entity = {
    ...order,
    fields: [
      ...order.fields,
      f.relation("branch", "Branch", "branches", { required: true }),
      f.longText("notes", "Notes"),
    ],
  };
  const branchLine: Entity = {
    ...line,
    fields: [...line.fields, f.relation("branch", "Branch", "branches", { required: true })],
  };
  const view: CheckoutView = {
    id: "register",
    name: "Register",
    type: "checkout",
    entityId: "orders",
    productEntityId: "products",
    lineEntityId: "order_lines",
    paymentFieldId: "payment_method",
  };
  const rec = (id: string, name: string): DataRecord => ({
    id,
    entityId: "branches",
    data: { name },
    createdAt: "",
    updatedAt: "",
  });
  const branches = [rec("b1", "Salo-Salo Makati"), rec("b2", "Salo-Salo QC")];
  const workspace = (records: DataRecord[]): WorkspaceData => {
    const base = posSample(NOW);
    return {
      ...base,
      blueprint: {
        ...base.blueprint,
        entities: [product, branchOrder, branchLine, branch],
        views: [view],
        rules: [],
      },
      records: [noodles, ...records],
    };
  };
  const sale = (answers: Record<string, string>) =>
    saleRecords({
      product,
      order: branchOrder,
      line: branchLine,
      paymentFieldId: "payment_method",
      items: [{ product: noodles, qty: 2 }],
      code: "#1005",
      method: "cash",
      cash: 50,
      status: "completed",
      cashier: "James Ocampo",
      answers,
      now: NOW,
    });

  it("asks for a required branch and puts it on the order and every line", () => {
    const ws = workspace(branches);
    const asked = registerFields(ws.blueprint, view);
    expect(asked.map((a) => a.field.id)).toEqual(["branch"]);
    expect(missingAnswers(asked, {}).map((x) => x.id)).toEqual(["branch"]);

    const without = createWithLines(ws, "orders", sale({}).order, "order_lines", sale({}).lines, NOW);
    expect(without.ok).toBe(false);

    const picked = sale({ branch: "b2" });
    expect(picked.order.branch).toBe("b2");
    expect(picked.lines.every((l) => l.branch === "b2")).toBe(true);
    expect(createWithLines(ws, "orders", picked.order, "order_lines", picked.lines, NOW).ok).toBe(true);
  });

  it("asks optional fields only when the view lists them, in that order", () => {
    const ws = workspace(branches);
    expect(registerFields(ws.blueprint, { ...view, fieldIds: ["notes"] }).map((a) => a.field.id)).toEqual([
      "notes",
      "branch",
    ]);
  });

  it("starts from the register's last branch, or the only one there is", () => {
    const ws = workspace(branches);
    const asked = registerFields(ws.blueprint, view);
    expect(registerDefaults(asked, ws.records, {})).toEqual({});
    expect(registerDefaults(asked, ws.records, { branch: "b2" })).toEqual({ branch: "b2" });
    // A branch that was deleted since isn't kept.
    expect(registerDefaults(asked, ws.records, { branch: "gone" })).toEqual({});
    expect(registerDefaults(asked, [rec("b9", "Only branch")], { branch: "gone" })).toEqual({ branch: "b9" });
  });

  it("asks a required line field the order doesn't have once for the whole sale", () => {
    const ws = workspace(branches);
    const lineOnly = {
      ...ws.blueprint,
      entities: [product, order, branchLine, branch],
    };
    expect(registerFields(lineOnly, view)).toEqual([
      { field: branchLine.fields.find((x) => x.id === "branch"), on: "line" },
    ]);
  });
});

// Every register EveryOps ships must be able to complete a sale once its questions are answered.
describe("built-in registers", () => {
  const samples = [
    ...CATALOG.map((c) => ({ name: c.id, ws: c.sample(NOW) })),
    ...DEMO_WORKSPACES.map((d) => ({ name: d.slug, ws: d.build(NOW) })),
  ];
  for (const { name, ws } of samples)
    for (const view of ws.blueprint.views)
      if (view.type === "checkout")
        it(`${name}: ${view.name} completes a sale`, () => {
          const bp = ws.blueprint;
          const ent = (id: string) => bp.entities.find((e) => e.id === id) as Entity;
          const product = ent(view.productEntityId);
          const item = ws.records.find((r) => r.entityId === product.id) as DataRecord;
          const asked = registerFields(bp, view);
          const answers = registerDefaults(asked, ws.records);
          for (const { field } of asked)
            if (answers[field.id] == null && field.required)
              answers[field.id] = field.relation
                ? (ws.records.find((r) => r.entityId === field.relation?.entityId)?.id ?? null)
                : (field.options?.[0]?.id ?? "answer");
          const payment = bp.entities
            .find((e) => e.id === view.entityId)
            ?.fields.find((x) => x.id === view.paymentFieldId);
          const sold = saleRecords({
            product,
            order: ent(view.entityId),
            line: ent(view.lineEntityId),
            paymentFieldId: view.paymentFieldId,
            items: [{ product: item, qty: 1 }],
            code: "#7001",
            method: payment?.options?.[0]?.id ?? "",
            status: "completed",
            cashier: "Test Cashier",
            answers,
            now: NOW,
          });
          const result = createWithLines(ws, view.entityId, sold.order, view.lineEntityId, sold.lines, NOW);
          expect(result.ok ? [] : result.errors).toEqual([]);
        });
});

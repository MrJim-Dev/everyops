import { describe, expect, it } from "vitest";
import type { DataRecord, Entity } from "@/lib/blueprint/types";
import { posSample } from "@/lib/catalog/canteen-pos";
import { f } from "@/lib/catalog/define";
import { createWithLines } from "./records";
import { saleRecords, stockFieldOf } from "./register";

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
});

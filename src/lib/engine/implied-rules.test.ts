import { describe, expect, it } from "vitest";
import type { Blueprint, DataRecord, Entity, WorkspaceData } from "@/lib/blueprint/types";
import { validateBlueprint } from "@/lib/blueprint/validate";
import { posSample } from "@/lib/catalog/canteen-pos";
import { f } from "@/lib/catalog/define";
import { requestGuide } from "@/lib/catalog/playbooks";
import { applyOps } from "./changes";
import { impliedRules, misplacedStock, replaceableRules } from "./implied-rules";
import { createRecord, updateRecord } from "./records";

const NOW = new Date("2026-10-14T06:00:00Z");
const bp = (entities: Entity[], rules: Blueprint["rules"] = []): Blueprint => ({
  version: 1,
  workspaceName: "Test",
  systems: [],
  entities,
  views: [],
  widgets: [],
  rules,
});
const entity = (id: string, name: string, fields: Entity["fields"], plural = `${name}s`): Entity => ({
  id,
  name,
  pluralName: plural,
  primaryFieldId: fields[0].id,
  fields,
});
const rec = (id: string, entityId: string, data: DataRecord["data"]): DataRecord => ({
  id,
  entityId,
  data,
  createdAt: NOW.toISOString(),
  updatedAt: NOW.toISOString(),
});

// A menu that sells but doesn't track stock yet, like the Menu Manager in the report.
const menu = entity("product", "Product", [f.text("name", "Name"), f.money("price", "Price")]);
const orderLine = entity("order_line", "Order line", [
  f.text("title", "Title"),
  f.relation("product", "Product", "product"),
  f.number("qty", "Qty"),
]);
const delivery = entity(
  "stock_delivery",
  "Stock Delivery",
  [
    f.text("reference", "Reference"),
    f.relation("product", "Product", "product"),
    f.number("quantity", "Quantity"),
  ],
  "Stock Deliveries",
);

describe("automations a request implies", () => {
  it("'add stock management' syncs stock from deliveries and from the sales that already exist", () => {
    const before = bp([menu, orderLine]);
    // What a plan for "add stock management" adds: a stock field on products and a delivery log.
    const after = applyOps(before, [
      { op: "add_field", entityId: "product", field: f.number("stock", "Stock") },
      { op: "add_entity", entity: delivery },
    ]);
    const implied = impliedRules(before, after);
    expect(implied.map((x) => [x.rule.trigger.entityId, x.rule.actions[0]])).toEqual([
      [
        "order_line",
        {
          type: "adjust_number",
          target: { kind: "relation", fieldId: "product" },
          fieldId: "stock",
          delta: "-qty",
        },
      ],
      [
        "stock_delivery",
        {
          type: "adjust_number",
          target: { kind: "relation", fieldId: "product" },
          fieldId: "stock",
          delta: "quantity",
        },
      ],
    ]);
    expect(implied.map((x) => x.label)).toEqual([
      "Order lines take from Product stock",
      "Stock Deliveries add to Product stock",
    ]);

    const withRules = applyOps(
      after,
      implied.map(({ rule }) => ({ op: "add_rule" as const, rule })),
    );
    expect(validateBlueprint(withRules)).toEqual([]);
    let ws: WorkspaceData = {
      ...posSample(NOW),
      blueprint: withRules,
      records: [rec("wings", "product", { name: "Wings", stock: 25 })],
    };
    const step = (entityId: string, data: DataRecord["data"]) => {
      const r = createRecord(ws, entityId, data, NOW);
      if (!r.ok) throw new Error(r.errors[0]?.message);
      ws = r.data;
    };
    step("stock_delivery", { reference: "DR-1", product: "wings", quantity: 100 });
    step("order_line", { title: "Wings", product: "wings", qty: 3 });
    expect(ws.records.find((r) => r.id === "wings")?.data.stock).toBe(122);
  });

  it("counts what a purchase order line received", () => {
    const stocked = entity("item", "Item", [f.text("name", "Name"), f.number("stock", "Stock on hand")]);
    const poLine = entity("po_line", "Purchase order line", [
      f.relation("item", "Item", "item"),
      f.number("qty_ordered", "Qty ordered"),
      f.number("qty_received", "Qty received"),
    ]);
    const [x] = impliedRules(bp([stocked]), bp([stocked, poLine]));
    expect(x.rule.actions[0]).toMatchObject({ fieldId: "stock", delta: "qty_received" });
  });

  it("moves stock either way by a movement's type", () => {
    const stocked = entity("item", "Item", [f.text("name", "Name"), f.number("stock", "Stock")]);
    const movement = entity("movement", "Stock movement", [
      f.relation("item", "Item", "item"),
      f.select("type", "Type", [
        ["in", "Stock in"],
        ["out", "Stock out"],
        ["spoilage", "Spoilage"],
      ]),
      f.number("qty", "Qty"),
    ]);
    const [x] = impliedRules(bp([stocked]), bp([stocked, movement]));
    expect(x.rule.actions[0]).toMatchObject({
      delta: "type == 'in' ? qty : (type == 'out' || type == 'spoilage' ? -qty : 0)",
    });
  });

  it("takes approved leave off the balance, and gives it back when cancelled", () => {
    const employee = entity("employee", "Employee", [
      f.text("name", "Name"),
      f.number("leave_balance", "Leave balance"),
    ]);
    const leave = entity("leave_request", "Leave request", [
      f.relation("employee", "Employee", "employee"),
      f.number("days", "Days"),
      f.status("status", "Status", [
        ["requested", "Requested"],
        ["approved", "Approved"],
        ["cancelled", "Cancelled"],
      ]),
    ]);
    const before = bp([employee]);
    const after = bp([employee, leave]);
    const [x] = impliedRules(before, after);
    expect(x.rule).toMatchObject({
      when: "status == 'approved'",
      actions: [{ fieldId: "leave_balance", delta: "-days" }],
    });

    let ws: WorkspaceData = {
      ...posSample(NOW),
      blueprint: { ...after, rules: [x.rule] },
      records: [rec("ana", "employee", { name: "Ana", leave_balance: 15 })],
    };
    const created = createRecord(ws, "leave_request", { employee: "ana", days: 2, status: "requested" }, NOW);
    if (!created.ok) throw new Error("create failed");
    const balance = () => ws.records.find((r) => r.id === "ana")?.data.leave_balance;
    ws = created.data;
    expect(balance()).toBe(15);
    for (const [status, left] of [
      ["approved", 13],
      ["cancelled", 15],
    ] as const) {
      const r = updateRecord(ws, created.record.id, { status }, NOW);
      if (!r.ok) throw new Error("update failed");
      ws = r.data;
      expect(balance()).toBe(left);
    }
  });

  it("adds nothing an automation already does, or for pairs the change didn't touch", () => {
    const ws = posSample(NOW);
    expect(impliedRules({ ...ws.blueprint, entities: [], rules: [] }, ws.blueprint)).toEqual([]);
    const stocked = bp([{ ...menu, fields: [...menu.fields, f.number("stock", "Stock")] }, orderLine]);
    expect(impliedRules(stocked, stocked)).toEqual([]);
  });
});

describe("what a request usually involves", () => {
  it("gives 'add a stock management' the inventory playbook", () => {
    expect(requestGuide("Add a stock management")).toMatch(/Inventory/);
    expect(requestGuide("rename the Orders tab to Sales")).toBe("");
  });
});

describe("plans Gemini half got right", () => {
  it("treats an adjustment movement as signed", () => {
    const stocked = entity("item", "Item", [f.text("name", "Name"), f.number("stock", "Stock")]);
    const movement = entity("movement", "Stock movement", [
      f.relation("item", "Item", "item"),
      f.select("type", "Type", [
        ["in", "Stock In / Delivery"],
        ["out", "Stock Out / Spoilage"],
        ["adjustment", "Adjustment"],
      ]),
      f.number("qty", "Quantity change"),
    ]);
    const [x] = impliedRules(bp([stocked]), bp([stocked, movement]));
    expect(x.rule.actions[0]).toMatchObject({
      delta: "type == 'in' ? qty : (type == 'out' ? -qty : (type == 'adjustment' ? qty : 0))",
    });
  });

  it("replaces an automation that names the quantity where the stock field belongs", () => {
    // What Gemini sent for "Add a stock management": fieldId qty on the product, which has no qty.
    const before = bp([menu]);
    const after = applyOps(before, [
      { op: "add_field", entityId: "product", field: f.number("stock", "Stock on hand") },
      { op: "add_entity", entity: delivery },
      {
        op: "add_rule",
        rule: {
          id: "adjust_stock",
          name: "Adjust stock on movement",
          trigger: { entityId: "stock_delivery", event: "created" },
          actions: [
            {
              type: "adjust_number",
              target: { kind: "relation", fieldId: "product" },
              fieldId: "qty",
              delta: "quantity",
            },
          ],
        },
      },
    ]);
    expect(replaceableRules(before, after, ["adjust_stock"])).toEqual(["adjust_stock"]);
  });
});

describe("line items follow their parent's status", () => {
  const item = entity("item", "Item", [f.text("name", "Name"), f.number("stock", "Stock on hand")]);
  const po = entity("purchase_order", "Purchase order", [
    f.text("code", "PO no."),
    f.status("status", "Status", [
      ["draft", "Draft"],
      ["ordered", "Ordered"],
      ["received", "Received"],
      ["cancelled", "Cancelled"],
    ]),
  ]);
  const poLine: Entity = {
    ...entity("purchase_line", "Purchase line", [
      f.text("title", "Item"),
      f.relation("purchase_order", "Purchase order", "purchase_order"),
      f.relation("item", "Item", "item"),
      f.number("qty", "Qty"),
    ]),
    parent: { entityId: "purchase_order", fieldId: "purchase_order" },
  };
  const order = entity("order", "Order", [
    f.text("code", "Order no."),
    f.status("status", "Status", [
      ["completed", "Completed"],
      ["cancelled", "Cancelled"],
    ]),
  ]);
  const saleLine: Entity = {
    ...entity("order_line", "Order line", [
      f.text("title", "Item"),
      f.relation("order", "Order", "order"),
      f.relation("item", "Item", "item"),
      f.number("qty", "Qty"),
    ]),
    parent: { entityId: "order", fieldId: "order" },
  };

  it("adds a purchase order's lines once it's received, and sales come back when an order is cancelled", () => {
    const before = bp([item]);
    const after = bp([item, po, poLine, order, saleLine]);
    const implied = impliedRules(before, after);
    expect(implied.map((x) => [x.rule.trigger.entityId, x.rule.when, x.detail])).toEqual([
      [
        "purchase_line",
        "purchase_order.status == 'received'",
        "Item Stock on hand + Purchase line Qty, once its purchase order is received. Kept in step when edited or deleted",
      ],
      [
        "order_line",
        "order.status == 'completed'",
        "Item Stock on hand − Order line Qty, once its order is completed. Kept in step when edited or deleted",
      ],
    ]);

    let ws: WorkspaceData = {
      ...posSample(NOW),
      blueprint: { ...after, rules: implied.map((x) => x.rule) },
      records: [rec("rice", "item", { name: "Rice", stock: 10 })],
    };
    const stock = () => ws.records.find((r) => r.id === "rice")?.data.stock;
    const create = (entityId: string, data: DataRecord["data"], id: string) => {
      const r = createRecord(ws, entityId, data, NOW, id);
      if (!r.ok) throw new Error(r.errors[0]?.message);
      ws = r.data;
    };
    const update = (id: string, patch: DataRecord["data"]) => {
      const r = updateRecord(ws, id, patch, NOW);
      if (!r.ok) throw new Error(r.errors[0]?.message);
      ws = r.data;
    };

    create("purchase_order", { code: "PO-1", status: "ordered" }, "po1");
    create("purchase_line", { title: "Rice", purchase_order: "po1", item: "rice", qty: 50 }, "pl1");
    expect(stock()).toBe(10);
    update("po1", { status: "received" });
    expect(stock()).toBe(60);

    create("order", { code: "#1", status: "completed" }, "o1");
    create("order_line", { title: "Rice", order: "o1", item: "rice", qty: 4 }, "ol1");
    expect(stock()).toBe(56);
    update("o1", { status: "cancelled" });
    expect(stock()).toBe(60);
    update("po1", { status: "cancelled" });
    expect(stock()).toBe(10);
  });
});

describe("where stock belongs", () => {
  it("sends back an ingredient inventory when the menu items are what's sold", () => {
    const order = entity("order", "Order", [f.text("code", "Order no.")]);
    const line: Entity = {
      ...orderLine,
      fields: [...orderLine.fields, f.relation("order", "Order", "order")],
      parent: { entityId: "order", fieldId: "order" },
    };
    const before = bp([menu, order, line]);
    const inventory = entity("inventory_item", "Inventory item", [
      f.text("name", "Name"),
      f.number("stock", "Stock on hand"),
    ]);
    expect(misplacedStock(before, bp([menu, order, line, inventory]), "Add a stock management.")).toMatch(
      /Stock here belongs on Products/,
    );
    expect(
      misplacedStock(before, bp([menu, order, line, inventory]), "Track our ingredient stock"),
    ).toBeUndefined();
    const stocked = { ...menu, fields: [...menu.fields, f.number("stock", "Stock")] };
    expect(
      misplacedStock(before, bp([stocked, order, line, delivery]), "Add a stock management."),
    ).toBeUndefined();
  });
});

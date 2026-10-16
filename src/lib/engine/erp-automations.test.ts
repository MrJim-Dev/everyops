import { describe, expect, it } from "vitest";
import type { Blueprint, DataRecord, Entity, Rule, WorkspaceData } from "@/lib/blueprint/types";
import { validateBlueprint } from "@/lib/blueprint/validate";
import { f } from "@/lib/catalog/define";
import { impliedRules, linePriceRules, widenMovements } from "./implied-rules";
import { createRecord, updateRecord } from "./records";
import { stockFieldOf } from "./register";
import { backwardsRules, completeRule, repairRules, unrequireFilled } from "./rule-repair";

// What a production furniture ERP got wrong on its first generation, each as the owner would hit it.
const NOW = new Date("2026-10-16T02:00:00Z");

const bpOf = (entities: Entity[], rules: Rule[]): Blueprint => ({
  version: 1,
  workspaceName: "Furniture ERP",
  systems: [],
  entities,
  views: [],
  widgets: [],
  rules,
});

const save = (ws: WorkspaceData, entityId: string, data: DataRecord["data"]) => {
  const made = createRecord(ws, entityId, data, NOW);
  if (!made.ok) throw new Error(made.errors.map((e) => e.message).join("; "));
  return made;
};
const byId = (ws: WorkspaceData, id: string) => ws.records.find((r) => r.id === id);

describe("a verified deposit", () => {
  const order: Entity = {
    id: "sales_order",
    name: "Sales Order",
    pluralName: "Sales Orders",
    primaryFieldId: "code",
    fields: [
      f.text("code", "Code"),
      f.money("total", "Total"),
      f.rollup("paid_amount", "Paid", {
        childEntityId: "payment",
        viaFieldId: "sales_order",
        op: "sum",
        fieldId: "amount",
        filter: "status == 'verified'",
      }),
      f.status("status", "Status", [
        ["quoted", "Quoted"],
        ["in_production", "In production"],
      ]),
    ],
  };
  const payment: Entity = {
    id: "payment",
    name: "Payment",
    pluralName: "Payments",
    primaryFieldId: "ref",
    fields: [
      f.text("ref", "Reference"),
      f.relation("sales_order", "Sales Order", "sales_order"),
      f.money("amount", "Amount"),
      f.status("status", "Status", [
        ["pending", "Pending"],
        ["verified", "Verified"],
      ]),
    ],
  };
  const advance: Rule = {
    id: "deposit_starts_production",
    name: "A paid deposit starts production",
    trigger: { entityId: "payment", event: "created" },
    when: "status == 'verified' && sales_order.paid_amount >= sales_order.total * 0.5",
    actions: [
      {
        type: "set_field",
        target: { kind: "relation", fieldId: "sales_order" },
        fieldId: "status",
        value: "'in_production'",
      },
    ],
  };
  const bp = bpOf([order, payment], [advance]);

  it("moves the order on, counting the payment being saved", () => {
    expect(validateBlueprint(bp)).toEqual([]);
    let ws: WorkspaceData = { blueprint: bp, records: [] };
    const so = save(ws, "sales_order", { code: "SO-1", total: 20000, status: "quoted" });
    ws = so.data;
    ws = save(ws, "payment", {
      ref: "GC-1",
      sales_order: so.record.id,
      amount: 10000,
      status: "verified",
    }).data;
    expect(byId(ws, so.record.id)?.data).toMatchObject({ paid_amount: 10000, status: "in_production" });
  });

  it("leaves it while the deposit is short", () => {
    let ws: WorkspaceData = { blueprint: bp, records: [] };
    const so = save(ws, "sales_order", { code: "SO-2", total: 20000, status: "quoted" });
    ws = so.data;
    ws = save(ws, "payment", {
      ref: "GC-2",
      sales_order: so.record.id,
      amount: 4000,
      status: "verified",
    }).data;
    expect(byId(ws, so.record.id)?.data.status).toBe("quoted");
  });
});

describe("receiving a purchase order", () => {
  const material: Entity = {
    id: "material",
    name: "Material",
    pluralName: "Materials",
    primaryFieldId: "name",
    fields: [f.text("name", "Name"), f.number("stock", "Stock on hand")],
  };
  const po: Entity = {
    id: "purchase_order",
    name: "Purchase Order",
    pluralName: "Purchase Orders",
    primaryFieldId: "code",
    fields: [
      f.text("code", "Code"),
      f.status("status", "Status", [
        ["ordered", "Ordered"],
        ["received", "Received"],
      ]),
    ],
  };
  const line: Entity = {
    id: "po_line",
    name: "PO Line",
    pluralName: "PO Lines",
    primaryFieldId: "title",
    parent: { entityId: "purchase_order", fieldId: "purchase_order" },
    fields: [
      f.text("title", "Title"),
      f.relation("purchase_order", "Purchase Order", "purchase_order"),
      f.relation("material", "Material", "material"),
      f.number("qty_ordered", "Qty Ordered"),
      f.number("qty_received", "Qty Received"),
    ],
  };
  // As the designer wrote it: add what was received, once the order is received.
  const written: Rule = {
    id: "receive_stock",
    name: "Received lines add stock",
    trigger: { entityId: "po_line", event: "created" },
    when: "purchase_order.status == 'received'",
    actions: [
      {
        type: "adjust_number",
        target: { kind: "relation", fieldId: "material" },
        fieldId: "stock",
        delta: "qty_received",
      },
    ],
  };

  const setup = () => {
    const base = bpOf([material, po, line], []);
    const bp = { ...base, rules: [completeRule(base, written)] };
    let ws: WorkspaceData = { blueprint: bp, records: [] };
    const narra = save(ws, "material", { name: "Narra plank", stock: 5 });
    ws = narra.data;
    const order = save(ws, "purchase_order", { code: "PO-1", status: "ordered" });
    ws = order.data;
    return { bp, ws, narra: narra.record.id, order: order.record.id };
  };

  it("counts everything ordered when nobody types a received quantity", () => {
    const { bp, narra, order, ...rest } = setup();
    expect(validateBlueprint(bp)).toEqual([]);
    let ws = save(rest.ws, "po_line", {
      title: "Narra",
      purchase_order: order,
      material: narra,
      qty_ordered: 20,
    }).data;
    expect(byId(ws, narra)?.data.stock).toBe(5);
    const received = updateRecord(ws, order, { status: "received" }, NOW);
    if (!received.ok) throw new Error("update failed");
    ws = received.data;
    expect(byId(ws, narra)?.data.stock).toBe(25);
  });

  it("counts the received quantity when one is typed", () => {
    const { narra, order, ...rest } = setup();
    let ws = save(rest.ws, "po_line", {
      title: "Narra",
      purchase_order: order,
      material: narra,
      qty_ordered: 20,
      qty_received: 18,
    }).data;
    const received = updateRecord(ws, order, { status: "received" }, NOW);
    if (!received.ok) throw new Error("update failed");
    ws = received.data;
    expect(byId(ws, narra)?.data.stock).toBe(23);
  });
});

describe("planned quantities", () => {
  it("are never read as stock on hand", () => {
    const job: Entity = {
      id: "job_order",
      name: "Job Order",
      pluralName: "Job Orders",
      primaryFieldId: "code",
      fields: [
        f.text("code", "Code"),
        f.number("qty_to_produce", "Qty to Produce"),
        f.number("qty_ordered", "Qty Ordered"),
      ],
    };
    expect(stockFieldOf(job)).toBeUndefined();
    expect(stockFieldOf({ ...job, fields: [...job.fields, f.number("on_hand", "On hand")] })?.id).toBe(
      "on_hand",
    );
  });
});

describe("a line's unit price", () => {
  const product: Entity = {
    id: "product",
    name: "Product",
    pluralName: "Products",
    primaryFieldId: "name",
    fields: [f.text("name", "Name"), f.money("cost", "Cost"), f.money("selling_price", "Selling Price")],
  };
  const order: Entity = {
    id: "sales_order",
    name: "Sales Order",
    pluralName: "Sales Orders",
    primaryFieldId: "code",
    fields: [f.text("code", "Code")],
  };
  const line: Entity = {
    id: "order_line",
    name: "Order Line",
    pluralName: "Order Lines",
    primaryFieldId: "title",
    parent: { entityId: "sales_order", fieldId: "sales_order" },
    fields: [
      f.text("title", "Title"),
      f.relation("sales_order", "Sales Order", "sales_order"),
      f.relation("product", "Product", "product"),
      f.number("qty", "Qty"),
      f.money("unit_price", "Unit Price", { required: true }),
      f.formula("line_total", "Line Total", "qty * unit_price", "money"),
    ],
  };
  const base = bpOf([product, order, line], []);
  const bp = unrequireFilled({ ...base, rules: linePriceRules(base) });

  it("comes from the product's price when left blank, and stops being required", () => {
    expect(bp.rules).toHaveLength(1);
    expect(bp.rules[0].actions[0]).toMatchObject({ fieldId: "unit_price", value: "product.selling_price" });
    expect(bp.entities[2].fields.find((x) => x.id === "unit_price")?.required).toBe(false);
    expect(validateBlueprint(bp)).toEqual([]);
    let ws: WorkspaceData = { blueprint: bp, records: [] };
    const table = save(ws, "product", { name: "Dining table", cost: 9000, selling_price: 15000 });
    ws = table.data;
    const so = save(ws, "sales_order", { code: "SO-1" });
    ws = so.data;
    const blank = save(ws, "order_line", {
      title: "Table",
      sales_order: so.record.id,
      product: table.record.id,
      qty: 2,
    });
    expect(blank.record.data).toMatchObject({ unit_price: 15000, line_total: 30000 });
    const typed = save(blank.data, "order_line", {
      title: "Table",
      sales_order: so.record.id,
      product: table.record.id,
      qty: 1,
      unit_price: 13500,
    });
    expect(typed.record.data.unit_price).toBe(13500);
  });

  it("is left alone when an automation already fills it", () => {
    const filled: Rule = {
      id: "price",
      name: "Price",
      trigger: { entityId: "order_line", event: "created" },
      actions: [
        { type: "set_field", target: { kind: "self" }, fieldId: "unit_price", value: "product.cost * 1.5" },
      ],
    };
    expect(linePriceRules({ ...base, rules: [filled] })).toEqual([]);
  });
});

describe("stock movements written one way", () => {
  const product: Entity = {
    id: "product",
    name: "Product",
    pluralName: "Products",
    primaryFieldId: "name",
    fields: [f.text("name", "Name"), f.number("stock", "Stock")],
  };
  const movement: Entity = {
    id: "stock_movement",
    name: "Stock Movement",
    pluralName: "Stock Movements",
    primaryFieldId: "movement_name",
    fields: [
      f.text("movement_name", "Movement"),
      f.relation("product", "Product", "product"),
      f.select("type", "Type", [
        ["purchase", "Purchase"],
        ["spoilage", "Spoilage"],
        ["adjustment", "Adjustment"],
        ["in", "In"],
        ["out", "Out"],
      ]),
      f.number("qty", "Qty"),
    ],
  };
  // As a bakery's setup wrote it: only spoilage and out move stock.
  const outOnly: Rule = {
    id: "adjust_stock_on_movement_out",
    name: "Adjust stock on negative movement",
    trigger: { entityId: "stock_movement", event: "created" },
    when: "type == 'spoilage' || type == 'out'",
    actions: [
      {
        type: "adjust_number",
        target: { kind: "relation", fieldId: "product" },
        fieldId: "stock",
        delta: "-qty",
      },
    ],
  };
  const base = bpOf([product, movement], [outOnly]);
  const bp = { ...base, rules: widenMovements(base) };

  it("add a fresh batch logged as In, take spoilage off and count adjustments as entered", () => {
    expect(bp.rules[0].when).toBeUndefined();
    expect(bp.rules[0].name).toBe("Stock Movements move Product stock");
    expect(validateBlueprint(bp)).toEqual([]);
    let ws: WorkspaceData = { blueprint: bp, records: [] };
    const pandesal = save(ws, "product", { name: "Pandesal", stock: 10 });
    ws = pandesal.data;
    const move = (type: string, qty: number, name: string) =>
      save(ws, "stock_movement", { movement_name: name, product: pandesal.record.id, type, qty }).data;
    ws = move("in", 100, "Morning batch");
    ws = move("purchase", 20, "Bought rolls");
    ws = move("spoilage", 7, "Burnt tray");
    ws = move("adjustment", -3, "Count");
    expect(byId(ws, pandesal.record.id)?.data.stock).toBe(120);
  });

  it("leave a condition that isn't only a choice of types alone", () => {
    const guarded = { ...outOnly, when: "type == 'out' && qty > 0" };
    expect(widenMovements(bpOf([product, movement], [guarded]))[0]).toEqual(guarded);
  });

  it("take off production issues and scrap", () => {
    const typed = {
      ...movement,
      fields: movement.fields.map((x) =>
        x.id === "type"
          ? f.select("type", "Type", [
              ["stock_in", "Stock In"],
              ["production_out", "Production Out"],
              ["adjustment", "Adjustment"],
              ["scrap", "Scrap"],
            ])
          : x,
      ),
    };
    const rule = impliedRules(bpOf([], []), bpOf([product, typed], []))[0]?.rule;
    expect(rule?.actions[0]).toMatchObject({
      delta:
        "type == 'stock_in' ? qty : (type == 'production_out' || type == 'scrap' ? -qty : (type == 'adjustment' ? qty : 0))",
    });
  });
});

describe("an automation naming the quantity as the field it changes", () => {
  it("changes the linked product's stock by that quantity", () => {
    const product: Entity = {
      id: "product",
      name: "Product",
      pluralName: "Products",
      primaryFieldId: "name",
      fields: [
        f.text("name", "Name"),
        f.number("stock", "Stock"),
        f.number("reorder_level", "Reorder Level"),
      ],
    };
    const movement: Entity = {
      id: "stock_movement",
      name: "Stock Movement",
      pluralName: "Stock Movements",
      primaryFieldId: "name",
      fields: [f.text("name", "Name"), f.relation("product", "Product", "product"), f.number("qty", "Qty")],
    };
    // What the assistant's plan became on a bakery: value "qty" read as the field it changes.
    const written: Rule = {
      id: "in",
      name: "Adjust stock on positive movement",
      trigger: { entityId: "stock_movement", event: "created" },
      actions: [
        {
          type: "adjust_number",
          target: { kind: "relation", fieldId: "product" },
          fieldId: "qty",
          delta: "qty",
        },
      ],
    };
    const bp = bpOf([product, movement], []);
    expect(completeRule(bp, written).actions[0]).toMatchObject({ fieldId: "stock", delta: "qty" });
  });
});

describe("a payment rule that reads its job's totals by their bare names", () => {
  const job: Entity = {
    id: "job_order",
    name: "Job Order",
    pluralName: "Job Orders",
    primaryFieldId: "ref",
    fields: [
      f.text("ref", "Reference"),
      f.money("total_amount", "Total"),
      f.rollup("paid_amount", "Paid", {
        childEntityId: "payment",
        viaFieldId: "job_order",
        op: "sum",
        fieldId: "amount",
        filter: "status == 'confirmed'",
      }),
      f.formula("balance_due", "Balance due", "total_amount - paid_amount", "money"),
      f.status("payment_status", "Payment status", [
        ["unpaid", "Unpaid"],
        ["partially_paid", "Partially paid"],
        ["paid", "Paid"],
      ]),
    ],
  };
  const payment: Entity = {
    id: "payment",
    name: "Payment",
    pluralName: "Payments",
    primaryFieldId: "ref",
    fields: [
      f.text("ref", "Reference"),
      f.relation("job_order", "Job Order", "job_order"),
      f.money("amount", "Amount"),
      f.status("status", "Status", [
        ["pending_verification", "Pending"],
        ["confirmed", "Confirmed"],
      ]),
    ],
  };
  // As a print shop's setup wrote it, rejected twice for "balance_due is not a field on Payment".
  const written: Rule = {
    id: "payment_status",
    name: "A confirmed payment updates the job's payment status",
    trigger: { entityId: "payment", event: "created" },
    when: "status == 'confirmed' && paid_amount > 0",
    actions: [
      {
        type: "set_field",
        target: { kind: "relation", fieldId: "job_order" },
        fieldId: "payment_status",
        value: "balance_due <= 0 ? 'paid' : 'partially_paid'",
      },
    ],
  };
  const base = bpOf([job, payment], [written]);
  const bp = { ...base, rules: repairRules(base) };

  it("reads them through the link, and marks the job as the payments come in", () => {
    expect(bp.rules[0].when).toBe("status == 'confirmed' && job_order.paid_amount > 0");
    expect(bp.rules[0].actions[0]).toMatchObject({
      value: "job_order.balance_due <= 0 ? 'paid' : 'partially_paid'",
    });
    expect(validateBlueprint(bp)).toEqual([]);
    let ws: WorkspaceData = { blueprint: bp, records: [] };
    const jo = save(ws, "job_order", { ref: "JO-1", total_amount: 3000, payment_status: "unpaid" });
    ws = jo.data;
    ws = save(ws, "payment", { ref: "DP", job_order: jo.record.id, amount: 1500, status: "confirmed" }).data;
    expect(byId(ws, jo.record.id)?.data.payment_status).toBe("partially_paid");
    ws = save(ws, "payment", {
      ref: "Balance",
      job_order: jo.record.id,
      amount: 1500,
      status: "confirmed",
    }).data;
    expect(byId(ws, jo.record.id)?.data.payment_status).toBe("paid");
  });
});

describe("a status automation without the field it sets", () => {
  it("sets the one status with every option it picks", () => {
    const job: Entity = {
      id: "job_order",
      name: "Job Order",
      pluralName: "Job Orders",
      primaryFieldId: "ref",
      fields: [
        f.text("ref", "Reference"),
        f.status("status", "Status", [
          ["quote", "Quote"],
          ["printing", "Printing"],
        ]),
        f.status("payment_status", "Payment status", [
          ["unpaid", "Unpaid"],
          ["partially_paid", "Partially paid"],
          ["paid", "Paid"],
        ]),
        f.money("balance_due", "Balance due"),
      ],
    };
    const payment: Entity = {
      id: "payment",
      name: "Payment",
      pluralName: "Payments",
      primaryFieldId: "ref",
      fields: [f.text("ref", "Reference"), f.relation("job_order", "Job Order", "job_order")],
    };
    // Gemini's plan, three times over: no fieldId.
    const written: Rule = {
      id: "paid",
      name: "Update payment status",
      trigger: { entityId: "payment", event: "created" },
      actions: [
        {
          type: "set_field",
          target: { kind: "relation", fieldId: "job_order" },
          fieldId: "",
          value: "job_order.balance_due <= 0 ? 'paid' : 'partially_paid'",
        },
      ],
    };
    const bp = bpOf([job, payment], []);
    expect(completeRule(bp, written).actions[0]).toMatchObject({ fieldId: "payment_status" });
  });
});

describe("an automation that moves a workflow backwards", () => {
  it("is found, and one that moves it forward isn't", () => {
    const booking: Entity = {
      id: "booking",
      name: "Booking",
      pluralName: "Bookings",
      primaryFieldId: "ref",
      fields: [
        f.text("ref", "Reference"),
        f.money("balance_due", "Balance due"),
        f.status("status", "Status", [
          ["inquiry", "Inquiry"],
          ["reserved", "Reserved"],
          ["confirmed", "Confirmed"],
          ["preparing", "Preparing"],
          ["completed", "Completed"],
        ]),
      ],
    };
    // As a catering ERP's setup wrote it.
    const back: Rule = {
      id: "back",
      name: "Auto complete event state when cleared",
      trigger: { entityId: "booking", event: "updated" },
      when: "status == 'preparing' && balance_due <= 0",
      actions: [
        {
          type: "set_field",
          target: { kind: "self" },
          fieldId: "status",
          value: "status == 'preparing' && balance_due <= 0 ? 'confirmed' : status",
        },
      ],
    };
    const forward: Rule = {
      ...back,
      id: "forward",
      when: "status == 'reserved' && balance_due <= 0",
      actions: [{ type: "set_field", target: { kind: "self" }, fieldId: "status", value: "'confirmed'" }],
    };
    expect(backwardsRules(bpOf([booking], [back, forward]))).toEqual(["back"]);
  });
});

describe("movement types named any way", () => {
  it("add stock on receiving and output, and take it off on issues and scrap", () => {
    const material: Entity = {
      id: "raw_material",
      name: "Raw Material",
      pluralName: "Raw Materials",
      primaryFieldId: "name",
      fields: [f.text("name", "Name"), f.number("stock_on_hand", "Stock on Hand")],
    };
    // A furniture ERP's movement types, which all moved nothing but scrap.
    const movement: Entity = {
      id: "stock_movement",
      name: "Stock Movement",
      pluralName: "Stock Movements",
      primaryFieldId: "ref",
      fields: [
        f.text("ref", "Reference"),
        f.select("movement_type", "Movement Type", [
          ["po_received", "PO Received"],
          ["production_issue", "Production Issue"],
          ["production_output", "Production Output"],
          ["manual_adjustment", "Manual Adjustment"],
          ["scrap_defect", "Scrap / Defect"],
        ]),
        f.relation("raw_material", "Raw Material", "raw_material"),
        f.number("quantity", "Quantity"),
      ],
    };
    const rule = impliedRules(bpOf([], []), bpOf([material, movement], []))[0]?.rule;
    expect(rule?.actions[0]).toMatchObject({
      delta:
        "movement_type == 'po_received' || movement_type == 'production_output' ? quantity : (movement_type == 'production_issue' || movement_type == 'scrap_defect' ? -quantity : (movement_type == 'manual_adjustment' ? quantity : 0))",
    });
  });
});

describe("a movement record with a material type before its movement type", () => {
  it("reads the direction from the movement type", () => {
    const goods: Entity = {
      id: "finished_product",
      name: "Finished Product",
      pluralName: "Finished Products",
      primaryFieldId: "name",
      fields: [f.text("name", "Name"), f.number("stock_on_hand", "Stock on Hand")],
    };
    // A furniture ERP's movements, where every type added its quantity.
    const movement: Entity = {
      id: "stock_movement",
      name: "Stock Movement",
      pluralName: "Stock Movements",
      primaryFieldId: "ref",
      fields: [
        f.text("ref", "Reference"),
        f.select("material_type", "Material Type", [
          ["raw_material", "Raw Material"],
          ["finished_product", "Finished Product"],
        ]),
        f.relation("finished_product", "Finished Product", "finished_product"),
        f.select("movement_type", "Movement Type", [
          ["purchase_in", "Purchase In"],
          ["production_in", "Production In"],
          ["production_out", "Production Out"],
          ["sales_delivery_out", "Sales Delivery Out"],
          ["scrap_waste", "Scrap / Waste"],
          ["inventory_adjustment", "Inventory Adjustment"],
        ]),
        f.number("quantity", "Quantity"),
      ],
    };
    const rule = impliedRules(bpOf([], []), bpOf([goods, movement], []))[0]?.rule;
    expect(rule?.actions[0]).toMatchObject({
      delta:
        "movement_type == 'purchase_in' || movement_type == 'production_in' ? quantity : (movement_type == 'production_out' || movement_type == 'sales_delivery_out' || movement_type == 'scrap_waste' ? -quantity : (movement_type == 'inventory_adjustment' ? quantity : 0))",
    });
  });
});

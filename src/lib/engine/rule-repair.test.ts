import { describe, expect, it } from "vitest";
import type { Blueprint, Rule } from "@/lib/blueprint/types";
import { posSample } from "@/lib/catalog/canteen-pos";
import { f } from "@/lib/catalog/define";
import { createWithLines } from "./records";
import { repairRules } from "./rule-repair";

const NOW = new Date("2026-10-14T06:00:00Z");

// Exactly what the designer saved for a generated sari-sari store: field and amount left out.
const empty = (id: string, name: string, entityId: string): Rule => ({
  id,
  name,
  trigger: { entityId, event: "created" },
  actions: [
    { type: "adjust_number", target: { kind: "relation", fieldId: "product" }, fieldId: "", delta: "0" },
  ],
});

function withRules(rules: Rule[]): Blueprint {
  const bp = structuredClone(posSample(NOW).blueprint);
  bp.entities.push({
    id: "restock_line",
    name: "Restock line",
    pluralName: "Restock lines",
    primaryFieldId: "product",
    fields: [f.relation("product", "Product", "product"), f.number("qty_received", "Qty Received")],
  });
  bp.rules = rules;
  return bp;
}

describe("repairing generated automations", () => {
  it("completes stock changes for sale lines and restock lines", () => {
    const bp = withRules([
      empty("deduct", "Deduct stock on order line", "order_line"),
      empty("add", "Add stock on restock line", "restock_line"),
    ]);
    const [deduct, add] = repairRules(bp);
    expect(deduct.actions[0]).toMatchObject({ fieldId: "stock", delta: "-qty" });
    expect(add.actions[0]).toMatchObject({ fieldId: "stock", delta: "qty_received" });
  });

  it("a repaired rule really deducts stock on a sale", () => {
    const ws = posSample(NOW);
    const bp = withRules([empty("deduct", "Deduct stock on order line", "order_line")]);
    bp.rules = repairRules(bp);
    const turon = ws.records.find((r) => r.data.name === "Turon");
    if (!turon) throw new Error("no turon");
    const sale = createWithLines(
      { ...ws, blueprint: bp },
      "order",
      { code: "#9001", placed_at: NOW.toISOString(), payment: "cash", status: "completed" },
      "order_line",
      [{ product: turon.id, qty: 2, price: 20 }],
      NOW,
    );
    expect(sale.ok).toBe(true);
    if (sale.ok)
      expect(sale.data.records.find((r) => r.id === turon.id)?.data.stock).toBe(Number(turon.data.stock) - 2);
  });

  it("drops an automation it can't complete instead of keeping a no-op", () => {
    const bp = withRules([
      {
        id: "x",
        name: "Mystery",
        trigger: { entityId: "order", event: "created" },
        actions: [{ type: "set_field", target: { kind: "self" }, fieldId: "", value: "null" }],
      },
    ]);
    expect(repairRules(bp)).toEqual([]);
  });
});

describe("status-changed automations without their field", () => {
  it("watch the record's only status field, or the one with the option they wait for", () => {
    const bp = withRules([]);
    bp.entities.push({
      id: "bill",
      name: "Bill",
      pluralName: "Bills",
      primaryFieldId: "title",
      fields: [
        f.text("title", "Title"),
        f.select("kind", "Kind", [["rent", "Rent"]]),
        f.status("status", "Status", [
          ["unpaid", "Unpaid"],
          ["paid", "Paid"],
        ]),
      ],
    });
    const notify = (id: string, to?: string): Rule => ({
      id,
      name: "Notify when Bill is Paid",
      trigger: { entityId: "bill", event: "status_changed", ...(to ? { to } : {}) },
      actions: [{ type: "notify", message: "Bill paid" }],
    });
    bp.rules = [notify("a", "paid"), notify("b"), notify("c", "rent")];
    expect(repairRules(bp).map((r) => r.trigger.fieldId)).toEqual(["status", "status", "kind"]);
  });
});

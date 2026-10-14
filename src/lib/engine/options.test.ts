import { describe, expect, it } from "vitest";
import type { Blueprint, DataRecord, Field } from "@/lib/blueprint/types";
import { applyOps } from "./changes";
import { optionUsage, strandedOptions } from "./options";

const category: Field = {
  id: "category",
  name: "Category",
  type: "select",
  options: [
    { id: "meals", label: "Meals", tone: "neutral" },
    { id: "snacks", label: "Snacks", tone: "neutral" },
    { id: "drinks", label: "Drinks", tone: "neutral" },
  ],
};
const bp = {
  version: 1,
  workspaceName: "Canteen",
  systems: [],
  entities: [
    {
      id: "product",
      name: "Product",
      pluralName: "Products",
      fields: [{ id: "name", name: "Name", type: "text" }, category],
    },
  ],
  views: [],
  widgets: [],
  rules: [],
} as unknown as Blueprint;
const product = (id: string, cat: string): DataRecord => ({
  id,
  entityId: "product",
  data: { name: id, category: cat },
  createdAt: "",
  updatedAt: "",
});
const records = [product("adobo", "meals"), product("sinigang", "meals"), product("turon", "snacks")];

const withOptions = (ids: [string, string][]) =>
  applyOps(bp, [
    {
      op: "update_field",
      entityId: "product",
      fieldId: "category",
      patch: { options: ids.map(([id, label]) => ({ id, label, tone: "neutral" as const })) },
    },
  ]);

describe("strandedOptions", () => {
  it("flags an option that records still use when a plan drops it", () => {
    // What Gemini planned for "use the categories in this CSV": Meals replaced by Ulam and Rice.
    const next = withOptions([
      ["ulam", "Ulam"],
      ["rice", "Rice"],
      ["snacks", "Snacks"],
      ["drinks", "Drinks"],
    ]);
    const problems = strandedOptions(bp, next, optionUsage(bp, records));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('"Meals"');
    expect(problems[0]).toContain("2 products");
  });

  it("allows renaming labels, adding options, and dropping options nobody uses", () => {
    const next = withOptions([
      ["meals", "Ulam"],
      ["snacks", "Snacks"],
      ["rice", "Rice"],
    ]);
    expect(strandedOptions(bp, next, optionUsage(bp, records))).toEqual([]);
  });

  it("allows dropping an option once the plan moves its records elsewhere", () => {
    const next = withOptions([
      ["snacks", "Snacks"],
      ["drinks", "Drinks"],
    ]);
    const moved = records.map((r) => (r.data.category === "meals" ? product(r.id, "snacks") : r));
    expect(strandedOptions(bp, next, optionUsage(bp, moved))).toEqual([]);
  });

  it("counts every value of multi-select fields", () => {
    const tags: Field = { ...category, id: "tags", type: "multi_select" };
    const multi = { ...bp, entities: [{ ...bp.entities[0], fields: [tags] }] } as Blueprint;
    const rows = [{ ...product("a", ""), data: { tags: ["meals", "drinks"] } }];
    expect(optionUsage(multi, rows)).toEqual({ "product.tags": { meals: 1, drinks: 1 } });
  });
});

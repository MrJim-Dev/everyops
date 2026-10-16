import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { Blueprint } from "@/lib/blueprint/types";
import { asGap, awaitingSamples, toRecords } from "./design";
import { emptyTypes, mergeSamples, samplesPrompt } from "./samples";

const bp = {
  workspaceName: "Cebu BPO HRIS",
  entities: [
    {
      id: "employee",
      name: "Employee",
      pluralName: "Employees",
      primaryFieldId: "name",
      fields: [{ id: "name", name: "Name", type: "text", required: true }],
    },
    {
      id: "payroll_run",
      name: "Payroll run",
      pluralName: "Payroll runs",
      primaryFieldId: "period",
      fields: [
        { id: "period", name: "Period", type: "text" },
        { id: "net_total", name: "Net total", type: "rollup" },
      ],
    },
    {
      id: "note",
      name: "Note",
      pluralName: "Notes",
      primaryFieldId: "title",
      fields: [{ id: "title", name: "Title", type: "text" }],
    },
    {
      id: "holiday",
      name: "Holiday",
      pluralName: "Holidays",
      primaryFieldId: "name",
      fields: [
        { id: "name", name: "Name", type: "text" },
        { id: "day", name: "Day", type: "date" },
      ],
    },
    {
      id: "payslip",
      name: "Payslip",
      pluralName: "Payslips",
      primaryFieldId: "label",
      parent: { entityId: "payroll_run", fieldId: "run" },
      fields: [
        { id: "label", name: "Label", type: "text" },
        { id: "run", name: "Run", type: "relation", relation: { entityId: "payroll_run" }, required: true },
        { id: "employee", name: "Employee", type: "relation", relation: { entityId: "employee" } },
        {
          id: "status",
          name: "Status",
          type: "status",
          options: [
            { id: "draft", label: "Draft" },
            { id: "paid", label: "Paid" },
          ],
        },
        { id: "gross", name: "Gross", type: "money" },
        { id: "net", name: "Net", type: "formula" },
      ],
    },
  ],
} as unknown as Blueprint;
const samples = [
  { ref: "e1", entityId: "employee", values: [{ fieldId: "name", value: "Juan dela Cruz" }] },
  { ref: "e2", entityId: "employee", values: [{ fieldId: "name", value: "Maria Santos" }] },
  { ref: "r1", entityId: "payroll_run", values: [{ fieldId: "period", value: "Oct 1-15, 2026" }] },
];

describe("record types the design left without samples", () => {
  it("come line items first, then day-to-day records, then the rest", () => {
    expect(emptyTypes(bp, samples).map((e) => e.id)).toEqual(["payslip", "holiday", "note"]);
  });

  it("are described with their fields and the records they can link to, without computed fields", () => {
    const text = samplesPrompt(bp, samples, emptyTypes(bp, samples), new Date("2026-10-14T03:00:00Z"));
    expect(text).toContain("Today in Manila: 2026-10-14");
    expect(text).toContain("line items of Payroll run: 2 to 3 under each of the first 3 payroll runs");
    expect(text).toContain('- employee (link to employee): e1 "Juan dela Cruz", e2 "Maria Santos"');
    expect(text).toContain('- run (link to payroll_run, required): r1 "Oct 1-15, 2026"');
    expect(text).toContain("- status (status): draft | paid");
    expect(text).not.toContain("- net ");
  });

  it("join the design's samples, only for those types, with refs that can't clash", () => {
    const extra = [
      {
        ref: "e1",
        entityId: "payslip",
        values: [
          { fieldId: "employee", value: "e1" },
          { fieldId: "run", value: "r1" },
        ],
      },
      { ref: "n_h1", entityId: "holiday", values: [{ fieldId: "name", value: "All Saints' Day" }] },
      { ref: "n_x", entityId: "employee", values: [{ fieldId: "name", value: "Not asked for" }] },
    ];
    const out = mergeSamples(bp, samples, extra, new Set(["payslip", "holiday"]));
    expect(out.slice(0, 3)).toEqual(samples);
    expect(out.slice(3)).toEqual([
      // Its own ref was taken, so it changes; its link still points at the design's employee e1.
      {
        ref: "e1_n",
        entityId: "payslip",
        values: [
          { fieldId: "employee", value: "e1" },
          { fieldId: "run", value: "r1" },
        ],
      },
      { ref: "n_h1", entityId: "holiday", values: [{ fieldId: "name", value: "All Saints' Day" }] },
    ]);
  });
});

describe("line items without a name of their own", () => {
  it("take the name of what they link to instead of being dropped", () => {
    const pos = {
      entities: [
        {
          id: "product",
          name: "Product",
          pluralName: "Products",
          primaryFieldId: "name",
          fields: [{ id: "name", name: "Name", type: "text" }],
        },
        {
          id: "order",
          name: "Order",
          pluralName: "Orders",
          primaryFieldId: "code",
          fields: [{ id: "code", name: "Code", type: "text" }],
        },
        {
          id: "order_line",
          name: "Order line",
          pluralName: "Order lines",
          primaryFieldId: "title",
          parent: { entityId: "order", fieldId: "order" },
          fields: [
            { id: "title", name: "Title", type: "text" },
            { id: "order", name: "Order", type: "relation", relation: { entityId: "order" } },
            { id: "product", name: "Product", type: "relation", relation: { entityId: "product" } },
            { id: "qty", name: "Qty", type: "number" },
          ],
        },
      ],
    } as unknown as Blueprint;
    const records = toRecords(
      pos,
      [
        { ref: "p1", entityId: "product", values: [{ fieldId: "name", value: "Wintermelon milk tea" }] },
        { ref: "o1", entityId: "order", values: [{ fieldId: "code", value: "#1001" }] },
        {
          ref: "l1",
          entityId: "order_line",
          values: [
            { fieldId: "order", value: "o1" },
            { fieldId: "product", value: "p1" },
            { fieldId: "qty", value: "2" },
          ],
        },
        {
          ref: "l2",
          entityId: "order_line",
          values: [
            { fieldId: "order", value: "o1" },
            { fieldId: "qty", value: "1" },
          ],
        },
      ],
      new Date("2026-10-14T03:00:00Z"),
    );
    const lines = records.filter((r) => r.entityId === "order_line");
    expect(lines.map((r) => r.data.title)).toEqual(["Wintermelon milk tea", "Order line 2"]);
    expect(lines[0].data).toMatchObject({ order: "order_2", product: "product_1", qty: 2 });
  });
});

describe("samples automations would misread", () => {
  it("leave out lines with no material and turn subtracted quantities positive", () => {
    const erp = {
      entities: [
        {
          id: "material",
          name: "Material",
          pluralName: "Materials",
          primaryFieldId: "name",
          fields: [
            { id: "name", name: "Name", type: "text" },
            { id: "stock", name: "Stock", type: "number" },
          ],
        },
        {
          id: "product",
          name: "Product",
          pluralName: "Products",
          primaryFieldId: "name",
          fields: [{ id: "name", name: "Name", type: "text" }],
        },
        {
          id: "bom_line",
          name: "BOM line",
          pluralName: "BOM lines",
          primaryFieldId: "title",
          parent: { entityId: "product", fieldId: "product" },
          fields: [
            { id: "title", name: "Title", type: "text" },
            { id: "product", name: "Product", type: "relation", relation: { entityId: "product" } },
            {
              id: "material",
              name: "Material",
              type: "relation",
              relation: { entityId: "material" },
              required: true,
            },
            { id: "qty", name: "Qty", type: "number" },
          ],
        },
        {
          id: "usage",
          name: "Usage",
          pluralName: "Usage",
          primaryFieldId: "title",
          fields: [
            { id: "title", name: "Title", type: "text" },
            { id: "material", name: "Material", type: "relation", relation: { entityId: "material" } },
            { id: "qty", name: "Qty", type: "number" },
          ],
        },
      ],
      rules: [
        {
          id: "use",
          name: "Usage takes stock",
          trigger: { entityId: "usage", event: "created" },
          actions: [
            {
              type: "adjust_number",
              target: { kind: "relation", fieldId: "material" },
              fieldId: "stock",
              delta: "-qty",
            },
          ],
        },
      ],
    } as unknown as Blueprint;
    const records = toRecords(
      erp,
      [
        { ref: "m1", entityId: "material", values: [{ fieldId: "name", value: "Narra plank" }] },
        { ref: "p1", entityId: "product", values: [{ fieldId: "name", value: "Dining table" }] },
        {
          ref: "b1",
          entityId: "bom_line",
          values: [
            { fieldId: "product", value: "p1" },
            { fieldId: "material", value: "m1" },
            { fieldId: "qty", value: "4" },
          ],
        },
        {
          ref: "b2",
          entityId: "bom_line",
          values: [
            { fieldId: "product", value: "p1" },
            { fieldId: "qty", value: "2" },
          ],
        },
        {
          ref: "b3",
          entityId: "bom_line",
          values: [
            { fieldId: "material", value: "m1" },
            { fieldId: "qty", value: "1" },
          ],
        },
        {
          ref: "u1",
          entityId: "usage",
          values: [
            { fieldId: "title", value: "Cut legs" },
            { fieldId: "material", value: "m1" },
            { fieldId: "qty", value: "-12" },
          ],
        },
      ],
      new Date("2026-10-14T03:00:00Z"),
    );
    expect(records.filter((r) => r.entityId === "bom_line").map((r) => r.data.qty)).toEqual([4]);
    expect(records.find((r) => r.entityId === "usage")?.data.qty).toBe(12);
  });
});

describe("review findings about samples still to come", () => {
  it("are set aside until the record type gets its samples", () => {
    const bp = {
      entities: [
        { id: "product", name: "Product", pluralName: "Products", primaryFieldId: "name", fields: [] },
        { id: "pre_order", name: "Pre-Order", pluralName: "Pre-Orders", primaryFieldId: "ref", fields: [] },
      ],
    } as unknown as Blueprint;
    const findings = [
      "Make 3 sample pre-orders matching requirements: No sample records for Pre-Orders are defined in the plan.",
      "Sample products with prices: Pandesal is missing.",
      "Pre-Orders page: a calendar of pickups.",
    ];
    const samples = [{ ref: "p1", entityId: "product", values: [] }];
    expect(awaitingSamples(bp, samples, findings)).toEqual(findings.slice(1));
  });
});

describe("gaps from the review", () => {
  it("keep a requirement's own colon", () => {
    const request =
      "Implement automatic rule: when a Piece-Rate Log is Approved, consume materials per the BOM";
    expect(asGap(`${request}: No rule creates the stock movements.`, [request])).toEqual({
      request,
      detail: "No rule creates the stock movements.",
    });
    expect(asGap("Pickup calendar: no calendar view.")).toEqual({
      request: "Pickup calendar",
      detail: "no calendar view.",
    });
  });
});

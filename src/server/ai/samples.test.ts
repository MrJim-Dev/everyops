import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { Blueprint } from "@/lib/blueprint/types";
import { toRecords } from "./design";
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

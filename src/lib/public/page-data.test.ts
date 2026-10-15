import { describe, expect, it } from "vitest";
import type { Blueprint, DataRecord } from "@/lib/blueprint/types";
import { htmlConnectionProblems } from "./html-connections";
import { publishedPageData, workspaceTableData } from "./page-data";

const bp = {
  entities: [
    {
      id: "product",
      name: "Product",
      pluralName: "Products",
      primaryFieldId: "name",
      fields: [
        { id: "name", name: "Name", type: "text" },
        { id: "cost", name: "Private cost", type: "money" },
        { id: "active", name: "Active", type: "checkbox" },
      ],
    },
  ],
  views: [
    {
      id: "stock",
      type: "table",
      entityId: "product",
      name: "Stock",
      fieldIds: ["name"],
      filter: "active == true",
      sort: [{ fieldId: "name", dir: "asc" }],
    },
    { id: "custom", type: "html", entityId: "", name: "Private page" },
    { id: "site", type: "html", entityId: "", name: "Public page", public: true },
    { id: "catalog", type: "layout", entityId: "", name: "Catalog", public: true, sections: [] },
    { id: "internal", type: "layout", entityId: "", name: "Internal", sections: [] },
    { id: "inquiry", type: "form", entityId: "product", name: "Inquiry", public: true, fieldIds: ["name"] },
    { id: "staff", type: "form", entityId: "product", name: "Staff", fieldIds: ["name"] },
  ],
  systems: [],
  rules: [],
  widgets: [],
} as unknown as Blueprint;
const record = (id: string, name: string, active = true): DataRecord => ({
  id,
  entityId: "product",
  data: { name, active, cost: 12345 },
  createdAt: "",
  updatedAt: "",
});

describe("HTML data sources", () => {
  it("uses only selected table columns, its filter and its sort", () => {
    const result = workspaceTableData(
      bp,
      [record("b", "Beta"), record("hidden", "Hidden", false), record("a", "Alpha")],
      "stock",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items.map((i) => i.cells[0].text)).toEqual(["Alpha", "Beta"]);
    expect(result.total).toBe(2);
    expect(JSON.stringify(result)).not.toContain("12345");
    expect(JSON.stringify(result)).not.toContain("Hidden");
  });
  it("reports truncation instead of disguising partial rows as a complete dataset", () => {
    const result = workspaceTableData(
      bp,
      Array.from({ length: 501 }, (_, i) => record(String(i), String(i))),
      "stock",
    );
    expect(result.ok && result.total).toBe(501);
    expect(result.ok && result.items.length).toBe(500);
    expect(result.ok && result.truncated).toBe(true);
  });
  it("refuses entity IDs and unsupported views", () => {
    expect(workspaceTableData(bp, [], "product").ok).toBe(false);
    expect(workspaceTableData(bp, [], "staff").ok).toBe(false);
  });
  it("does not turn HTML source or form definitions into a data endpoint", () => {
    expect(
      publishedPageData({ id: "site", name: "Site", type: "html", blocks: [], html: "secret source" }).ok,
    ).toBe(false);
    const data = publishedPageData({
      id: "catalog",
      name: "Catalog",
      type: "layout",
      blocks: [],
      layout: { sections: [] },
      html: "not data",
    });
    expect(
      publishedPageData({
        id: "home",
        name: "Home",
        type: "landing",
        blocks: [
          { id: "code", type: "html", html: "<script>not data</script>" },
          { id: "copy", type: "text", markdown: "Public copy" },
        ],
      }),
    ).toMatchObject({ blocks: [{ id: "copy", type: "text", markdown: "Public copy" }] });
    expect(data).toEqual({
      ok: true,
      viewId: "catalog",
      name: "Catalog",
      type: "layout",
      layout: { sections: [] },
    });
  });
});
describe("AI HTML connection checks", () => {
  it("allows private tables only for private HTML pages", () => {
    expect(htmlConnectionProblems(bp, "custom", 'EveryOps.data("stock")')).toEqual([]);
    expect(htmlConnectionProblems(bp, "site", 'EveryOps.data("stock")')).toHaveLength(1);
  });
  it("accepts published sources and actual public form IDs", () => {
    expect(
      htmlConnectionProblems(
        bp,
        "site",
        `EveryOps.data('catalog'); EveryOps.form('inquiry'); <form data-everyops-form="inquiry">`,
      ),
    ).toEqual([]);
  });
  it("rejects private layouts, private forms, and hallucinated IDs", () => {
    expect(
      htmlConnectionProblems(
        bp,
        "site",
        `EveryOps.data('internal'); EveryOps.submit('staff', {}); <div data-everyops-embed="missing">`,
      ),
    ).toHaveLength(3);
  });
  it("leaves variable references to runtime validation", () => {
    expect(
      htmlConnectionProblems(bp, "site", `EveryOps.form(formId); EveryOps.data(\`source_\${id}\`)`),
    ).toEqual([]);
  });
});

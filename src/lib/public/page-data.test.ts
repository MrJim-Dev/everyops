import { describe, expect, it } from "vitest";
import type { Blueprint, DataRecord } from "@/lib/blueprint/types";
import { validateBlueprint } from "@/lib/blueprint/validate";
import { courtBookingsSample } from "@/lib/catalog/court-bookings";
import { sharedTableProblems } from "@/lib/components/public-safety";
import { applyOps } from "@/lib/engine/changes";
import { htmlConnectionProblems } from "./html-connections";
import { listedText, publicTableData, publishedPageData, workspaceTableData } from "./page-data";
import { siteDetails, siteOf } from "./resolve";

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

describe("tables shared as public data", () => {
  const shared = {
    ...bp,
    entities: [
      ...bp.entities,
      {
        id: "customer",
        name: "Customer",
        pluralName: "Customers",
        primaryFieldId: "name",
        fields: [
          { id: "name", name: "Name", type: "text" },
          { id: "phone", name: "Phone", type: "text" },
        ],
      },
    ],
    views: [
      ...bp.views,
      {
        id: "menu",
        type: "table",
        entityId: "product",
        name: "Menu",
        fieldIds: ["name", "cost"],
        filter: "active == true",
        publicData: true,
      },
      {
        id: "regulars",
        type: "table",
        entityId: "customer",
        name: "Regulars",
        fieldIds: ["name"],
        publicData: true,
      },
    ],
  } as unknown as Blueprint;

  it("sends only fields visitors may see, with record ids for detail pages", () => {
    const result = publicTableData(shared, [record("a1", "Adobo"), record("off", "Old dish", false)], "menu");
    expect(result).toMatchObject({ ok: true, total: 1, columns: [{ id: "name", name: "Name" }] });
    expect(result.ok && result.items[0].id).toBe("a1");
    expect(JSON.stringify(result)).not.toContain("12345");
    expect(JSON.stringify(result)).not.toContain("Old dish");
  });
  it("refuses tables that weren't shared, and tables about people even when flagged", () => {
    expect(publicTableData(shared, [record("a1", "Adobo")], "stock").ok).toBe(false);
    expect(publicTableData(shared, [], "regulars").ok).toBe(false);
    const regulars = shared.views.find((v) => v.id === "regulars");
    expect(regulars?.type === "table" && sharedTableProblems(shared, regulars)).toHaveLength(1);
    expect(validateBlueprint(shared).some((e) => /about people/.test(e.message))).toBe(true);
  });
  it("lets public pages read shared tables and their bindings, and checks includes", () => {
    expect(htmlConnectionProblems(shared, "site", 'EveryOps.data("menu"); EveryOps.items("menu")')).toEqual(
      [],
    );
    expect(
      htmlConnectionProblems(
        shared,
        "site",
        '<template data-everyops-each="menu"></template><template data-everyops-each="@rows"></template><template data-everyops-each="site.pages"></template><div data-everyops-include="custom"></div>',
      ),
    ).toEqual([]);
    expect(
      htmlConnectionProblems(
        shared,
        "site",
        '<template data-everyops-each="stock"></template><div data-everyops-record="page"></div><div data-everyops-include="site"></div>',
      ),
    ).toHaveLength(3);
  });
  it("shares a table when it's made public, without making it a page of the site", () => {
    const next = applyOps(bp, [{ op: "update_view", viewId: "stock", patch: { public: true } }]);
    const stock = next.views.find((v) => v.id === "stock");
    expect(stock?.type === "table" && stock.publicData).toBe(true);
    expect(siteOf("shop", "Shop", next)?.pages.map((p) => p.id)).not.toContain("stock");
    const back = applyOps(next, [{ op: "update_view", viewId: "stock", patch: { public: false } }]);
    expect(back.views.find((v) => v.id === "stock")).not.toHaveProperty("publicData");
  });
});

describe("text for visitors without JavaScript", () => {
  it("lists the titles a public page's bindings will show, only from sources visitors may read", () => {
    const withMenu = {
      ...bp,
      views: [
        ...bp.views,
        {
          id: "menu",
          type: "table",
          entityId: "product",
          name: "Menu",
          fieldIds: ["name"],
          publicData: true,
        },
      ],
    } as unknown as Blueprint;
    const html =
      '<template data-everyops-each="menu"></template><template data-everyops-each="stock"></template><template data-everyops-each="@rows"></template>';
    const listed = listedText(withMenu, [record("a", "Adobo"), record("b", "Sinigang")], {
      id: "site",
      name: "Site",
      type: "html",
      blocks: [],
      html,
    });
    expect(listed).toEqual(["Adobo", "Sinigang"]);
  });
});

describe("sharing the court sample's tables", () => {
  it("shares courts, and refuses players and bookings (each booking belongs to a player)", () => {
    const { blueprint } = courtBookingsSample(new Date("2026-10-15T00:00:00Z"));
    const problems = (id: string) => {
      const v = blueprint.views.find((x) => x.id === id);
      return v?.type === "table" ? sharedTableProblems(blueprint, { ...v, publicData: true }) : ["missing"];
    };
    expect(problems("courts_table")).toEqual([]);
    expect(problems("players_table")[0]).toMatch(/about people/);
    expect(problems("all_bookings")[0]).toMatch(/belong to someone \(Player\)/);
  });
  it("leaves detail pages out of the site's menu", () => {
    const { blueprint, records } = courtBookingsSample(new Date("2026-10-15T00:00:00Z"));
    blueprint.views.push(
      {
        id: "courts_page",
        entityId: "",
        name: "Our courts",
        type: "html",
        public: true,
        html: "<h1>Courts</h1>",
      },
      {
        id: "court_detail",
        entityId: "",
        name: "Court details",
        type: "html",
        public: true,
        html: '<article data-everyops-record="courts_table"></article>',
      },
    );
    blueprint.systems[0].viewIds.push("courts_page", "court_detail");
    const pages = siteDetails(blueprint, records, {}, "Court House").pages.map((p) => p.id);
    expect(pages).toContain("courts_page");
    expect(pages).not.toContain("court_detail");
  });
});

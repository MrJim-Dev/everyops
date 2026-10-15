import { describe, expect, it } from "vitest";
import { parsePartialJson } from "@/lib/partial-json";
import { sketchOf } from "./design-sketch";

const design = {
  workspaceName: "Kapé Ilaya",
  summary: "Coffee shop",
  systems: [
    { id: "overview", name: "Overview", icon: "gauge", viewIds: [], widgetIds: ["sales_today"] },
    { id: "sales", name: "Sales", icon: "receipt", viewIds: ["orders", "register"], widgetIds: [] },
  ],
  entities: [{ id: "order", name: "Order", pluralName: "Orders", fields: [{ id: "a" }, { id: "b" }] }],
  views: [
    { id: "orders", name: "All orders", type: "table" },
    { id: "register", name: "Register", type: "checkout" },
  ],
  widgets: [{ id: "sales_today", title: "Sales today" }],
  rules: [],
  samples: [{ ref: "o1" }, { ref: "o2" }],
};

describe("sketchOf", () => {
  it("shows pages first, then record types, then each page's views as Gemini writes them", () => {
    const text = JSON.stringify(design);
    const atPages = sketchOf(parsePartialJson(text.slice(0, text.indexOf('"entities"'))));
    expect(atPages?.writing).toBe("pages");
    expect(atPages?.pages.map((p) => p.name)).toEqual(["Overview", "Sales"]);
    expect(atPages?.pages[1].views).toEqual([]);

    const midViews = sketchOf(parsePartialJson(text.slice(0, text.indexOf('{"id":"register"'))));
    expect(midViews?.writing).toBe("views");
    expect(midViews?.recordTypes).toEqual([{ id: "order", name: "Orders", fields: 2 }]);
    expect(midViews?.pages[1].views.map((v) => v.name)).toEqual(["All orders"]);
    expect(midViews?.active).toBe("sales");
  });

  it("describes a finished design", () => {
    const done = sketchOf(design, true);
    expect(done).toMatchObject({ name: "Kapé Ilaya", writing: "done", samples: 2 });
    expect(done?.pages[0].widgets).toBe(1);
    expect(done?.pages[1].views.map((v) => v.type)).toEqual(["table", "checkout"]);
  });

  it("waits for a name before showing an item", () => {
    expect(
      sketchOf(parsePartialJson('{"workspaceName":"X","systems":[{"id":"a","icon":"gauge"'))?.pages,
    ).toEqual([]);
    expect(sketchOf(undefined)).toBeUndefined();
  });
});

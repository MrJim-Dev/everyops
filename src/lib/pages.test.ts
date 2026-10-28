import { describe, expect, it } from "vitest";
import type { Blueprint } from "@/lib/blueprint/types";
import { isPagesSystem, pageSummary, pagesOf } from "./pages";

const bp = {
  entities: [],
  systems: [
    { id: "bookings", name: "Bookings", icon: "calendar", viewIds: ["all", "book"], widgetIds: [] },
    { id: "report", name: "October report", icon: "chart", viewIds: ["october"], widgetIds: [] },
    { id: "home", name: "Home", icon: "house", viewIds: ["site"], widgetIds: [] },
  ],
  views: [
    { id: "all", name: "All", type: "table", entityId: "booking", fieldIds: [] },
    { id: "book", name: "Book online", type: "html", entityId: "", public: true },
    { id: "october", name: "October at a glance", type: "html", entityId: "" },
    {
      id: "site",
      name: "Home",
      type: "landing",
      entityId: "",
      blocks: [{ id: "hero", type: "hero", heading: "Dink & Drop", subheading: "Courts open 6 AM to 11 PM" }],
    },
  ],
  widgets: [],
} as unknown as Blueprint;

describe("pages", () => {
  it("lists a sidebar entry under Pages only when every tab on it is a page", () => {
    expect(bp.systems.map((s) => isPagesSystem(bp, s))).toEqual([false, true, true]);
  });

  it("finds every page, including one that is a tab of a system, with who can open it", () => {
    const docs = {
      october: {
        body: "<h1>October</h1><p>Bookings, revenue and the busiest courts for October, read live.</p>",
        updatedAt: "2026-10-27T01:00:00.000Z",
      },
    };
    expect(
      pagesOf(bp, docs).map((p) => [p.view.id, p.system.id, p.audience, p.updatedAt ?? null, p.summary]),
    ).toEqual([
      ["book", "bookings", "anyone", null, ""],
      [
        "october",
        "report",
        "team",
        "2026-10-27T01:00:00.000Z",
        "Bookings, revenue and the busiest courts for October, read live.",
      ],
      ["site", "home", "anyone", null, "Courts open 6 AM to 11 PM"],
    ]);
    // A page alone on its sidebar entry goes by the sidebar's name; a tab among others by its own.
    expect(pagesOf(bp, docs).map((p) => p.title)).toEqual(["Book online", "October report", "Home"]);
  });

  it("summarises a page from its first real paragraph, skipping scripts, templates and markup", () => {
    const html = `<html><head><title>x</title><style>p{color:red}</style></head><body>
      <nav><p>Home · Book · Contact us today</p></nav><p>Hi</p>
      <template data-everyops-each="courts"><p data-field="@title">Row that only exists once filled in</p></template>
      <script>const p = "<p>not this one either, it's code</p>";</script>
      <p>Revenue is up <b>18%</b> on September &amp; Court 3 is the busiest.</p></body></html>`;
    expect(pageSummary(html)).toBe("Revenue is up 18% on September & Court 3 is the busiest.");
    expect(pageSummary(`<p>${"word ".repeat(60)}</p>`, 20)).toBe("word word word word…");
  });
});

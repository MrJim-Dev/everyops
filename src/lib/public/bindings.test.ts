import { describe, expect, it } from "vitest";
import { includedIds, itemsOf, pageMeta, sitePageItems, siteValues, withIncludes } from "./bindings";
import type { Cell } from "./resolve";

const cell = (fieldId: string, name: string, kind: Cell["kind"], text: string): Cell => ({
  fieldId,
  name,
  kind,
  text,
});

describe("itemsOf", () => {
  it("gives a table's rows their fields by id, name and role", () => {
    const list = itemsOf({
      ok: true,
      type: "table",
      total: 1,
      truncated: false,
      items: [
        {
          id: "court_1",
          cells: [
            cell("photo", "Photo", "image", "/u/court.jpg"),
            cell("name", "Name", "text", "Court 1"),
            cell("surface", "Surface", "tag", "Indoor"),
            cell("about", "About", "markdown", "**Bright** lights"),
            cell("minutes", "Duration Mins", "number", "60"),
            cell("rate", "Rate", "text", "₱400"),
          ],
        },
      ],
    });
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    const [court] = list.items;
    expect(court.fields).toMatchObject({
      "@id": "court_1",
      "@title": "Court 1",
      "@image": "/u/court.jpg",
      "@about": "Bright lights",
      "@price": "₱400",
      "@tags": "Indoor",
      name: "Court 1",
      surface: "Indoor",
      "@2": "Court 1",
    });
    expect(court.rows.map((r) => [r.fields["@name"], r.fields["@text"]])).toEqual([
      ["Duration", "60 min"],
      ["Rate", "₱400"],
    ]);
    expect(court.tags.map((t) => t.fields["@text"])).toEqual(["Indoor"]);
  });

  it("reads a landing page's parts: records by id, hero facts and contact", () => {
    const result = {
      ok: true,
      type: "landing",
      blocks: [
        { id: "hero", type: "hero", heading: "Hi", facts: [{ kind: "hours", text: "6 AM to 11 PM" }] },
        {
          id: "faq",
          type: "records",
          layout: "faq",
          columns: [],
          items: [
            {
              id: "q1",
              cells: [
                cell("q", "Question", "text", "Parking?"),
                cell("a", "Answer", "markdown", "Yes, *free*."),
              ],
            },
          ],
        },
        { id: "contact", type: "contact", phone: "0917 000 0000" },
      ],
    };
    const faq = itemsOf(result);
    expect(faq.ok && faq.items[0].fields).toMatchObject({ "@1": "Parking?", "@2": "Yes, free." });
    const facts = itemsOf(result, "hero");
    expect(facts.ok && facts.items[0].fields).toMatchObject({ "@kind": "hours", "@text": "6 AM to 11 PM" });
    const contact = itemsOf(result, "contact");
    expect(contact.ok && contact.items[0].fields.phone).toBe("0917 000 0000");
    expect(itemsOf(result, "missing").ok).toBe(false);
  });

  it("reads a public layout's list part and reports what was cut off", () => {
    const list = itemsOf({
      ok: true,
      type: "layout",
      layout: {
        sections: [
          {
            items: [
              { id: "stats", component: "stat", data: { stat: {} } },
              {
                id: "menu",
                component: "list",
                data: { total: 9, items: [{ title: "Adobo", description: "Pork", badge: "₱180" }] },
              },
            ],
          },
        ],
      },
    });
    expect(list).toMatchObject({ ok: true, total: 9, truncated: true });
    expect(list.ok && list.items[0].fields).toMatchObject({
      "@title": "Adobo",
      "@about": "Pork",
      "@badge": "₱180",
    });
  });

  it("passes failures through with their message", () => {
    expect(itemsOf({ ok: false, message: "This data source isn't shared." })).toEqual({
      ok: false,
      message: "This data source isn't shared.",
    });
    expect(itemsOf(null).ok).toBe(false);
  });
});

describe("site values", () => {
  const site = {
    name: "Court House",
    phone: "0917",
    pages: [
      { id: "home", name: "Home" },
      { id: "menu", name: "Menu" },
    ],
    book: { id: "book_online", label: "Book a court" },
  };
  it("links the home page at the site's root and marks the current page", () => {
    const list = sitePageItems(site, "court-house", "menu");
    expect(list.ok && list.items.map((i) => [i.fields.href, i.fields.current])).toEqual([
      ["/s/court-house", ""],
      ["/s/court-house/menu", "true"],
    ]);
  });
  it("flattens the details a page reads as site.*", () => {
    expect(siteValues(site, "court-house")).toMatchObject({
      name: "Court House",
      phone: "0917",
      email: "",
      contact: "yes",
      book: "/s/court-house/book_online",
      bookLabel: "Book a court",
    });
  });
});

describe("includes", () => {
  const header =
    '<!doctype html><html><head><style>.top{color:red}</style><script>alert(1)</script></head><body><header class="top">Shared <div data-everyops-include="other"></div></header></body></html>';
  it("puts another page's styles and body in place of the include, once", () => {
    const html = withIncludes(
      '<body><div data-everyops-include="header"></div><main>Page</main></body>',
      (id) => (id === "header" ? header : undefined),
    );
    expect(html).toContain(
      '<div data-everyops-included="header"><style>.top{color:red}</style><header class="top">Shared </header></div>',
    );
    expect(html).not.toContain("alert(1)");
    expect(html).toContain("<main>Page</main>");
  });
  it("leaves includes of unknown pages as they are", () => {
    const html = '<div data-everyops-include="nope"></div>';
    expect(withIncludes(html, () => undefined)).toBe(html);
    expect(includedIds(html)).toEqual(["nope"]);
  });
});

describe("pageMeta", () => {
  it("finds the title, description and share picture, and skips scripts and templates", () => {
    const meta = pageMeta(
      '<html><head><title>Court House · Cebu</title><meta name="description" content="Indoor courts &amp; lights"><meta property="og:image" content="https://x.test/og.png"></head><body><h1>Play tonight</h1><template><h2>Hidden</h2></template><script>var p="<p>no</p>"</script><p>Book a court in Cebu City in under a minute, any time.</p></body></html>',
    );
    expect(meta).toMatchObject({
      title: "Court House · Cebu",
      description: "Indoor courts & lights",
      image: "https://x.test/og.png",
      headings: ["Play tonight"],
    });
    expect(meta.paragraphs).toEqual(["Book a court in Cebu City in under a minute, any time."]);
  });
  it("falls back to the first real paragraph and refuses script URLs as pictures", () => {
    const meta = pageMeta(
      '<meta property="og:image" content="javascript:alert(1)"><p>Hi</p><p>We serve Cebuano breakfast all day long.</p>',
    );
    expect(meta.description).toBe("We serve Cebuano breakfast all day long.");
    expect(meta.image).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";
import { courtBookingsSample } from "@/lib/catalog/court-bookings";
import { customBookingHtml } from "./booking-page";
import { customSiteHtml, liveSiteHtml, withCustomSite } from "./custom-site";
import type { ResolvedBlock } from "./resolve";
import { cleanDesign, DEFAULT_DESIGN, REFERENCES, SECTION_STYLES, type SectionKind } from "./site-sections";
import { standardLanding } from "./site-template";

const cell = (name: string, text: string, kind = "text") => ({ id: name, name, text, kind }) as never;
/** A site with something in every section, so every style has data to draw. */
const blocks: ResolvedBlock[] = [
  {
    id: "hero",
    type: "hero",
    heading: "Play at Court House",
    subheading: "Indoor courts, open late.",
    ctaLabel: "Book a court",
    ctaHref: "/s/__everyops_site__/book_online",
    facts: [
      { kind: "offer", text: "3 courts" },
      { kind: "hours", text: "Open 6 AM to 11 PM" },
      { kind: "price", text: "From ₱350" },
      { kind: "pay", text: "Pay with GCash or Cash" },
    ],
  },
  {
    id: "highlights",
    type: "highlights",
    items: [
      { title: "Indoor", body: "Rain or shine." },
      { title: "Late", body: "Until 11 PM." },
    ],
  },
  {
    id: "offer",
    type: "records",
    title: "Our courts",
    layout: "cards",
    columns: [{ id: "name", name: "Name" }],
    items: [1, 2, 3].map((n) => ({
      id: String(n),
      cells: [
        cell("Name", `Court ${n}`),
        cell("Sport", "Pickleball", "tag"),
        cell("Peak rate", "₱500", "number"),
        cell("Duration mins", "60", "number"),
      ],
    })),
  },
  {
    id: "steps",
    type: "steps",
    items: [
      { title: "Pick a time", body: "See what's free." },
      { title: "Pay", body: "GCash or cash." },
    ],
  },
  {
    id: "payments",
    type: "records",
    title: "Ways to pay",
    layout: "cards",
    columns: [],
    items: [
      {
        id: "g",
        cells: [
          cell("Name", "GCash"),
          cell("How", "Send to 0917.", "markdown"),
          cell("Account number", "0917 000 0000"),
        ],
      },
    ],
  },
  {
    id: "faq",
    type: "records",
    title: "Questions",
    layout: "faq",
    columns: [],
    items: [
      {
        id: "q",
        cells: [cell("Question", "Can I cancel?"), cell("Answer", "Up to a day before.", "markdown")],
      },
    ],
  },
  { id: "contact", type: "contact", phone: "0917 000 0000", hours: "Daily" },
];

const css = (html: string) =>
  (html.match(/<style>[\s\S]*?<\/style>/)?.[0] ?? "").replace(/\/\*[\s\S]*?\*\//g, "");
/** The class each style's section carries in the page. */
const MARK: Record<Exclude<SectionKind, "booking">, (id: string) => string> = {
  nav: (id) => `class="nav-${id}"`,
  hero: (id) => `hero-${id}`,
  highlights: (id) => `hl-${id}`,
  offer: (id) => `of-${id}`,
  steps: (id) => `st-${id}`,
  payments: (id) => `pay-${id}`,
  faq: (id) => `faq-${id}`,
  contact: (id) => `ct-${id}`,
  closing: (id) => `close-${id}`,
  footer: (id) => `foot-${id}`,
};

describe("the website section library", () => {
  it("has 5 to 10 styles for every section", () => {
    for (const styles of Object.values(SECTION_STYLES)) {
      expect(styles.length).toBeGreaterThanOrEqual(5);
      expect(styles.length).toBeLessThanOrEqual(10);
    }
  });

  it("draws every style of every section with its data, and every one follows the motion rules", () => {
    for (const [kind, styles] of Object.entries(SECTION_STYLES) as [SectionKind, { id: string }[]][]) {
      if (kind === "booking") continue;
      for (const { id } of styles) {
        const html = customSiteHtml("Court House", blocks, "courts", { ...DEFAULT_DESIGN, [kind]: id });
        expect(html, `${kind} ${id}`).toContain(MARK[kind](id));
        if (kind === "offer") expect(html).toContain("Court 3");
        if (kind === "payments") expect(html).toContain("0917 000 0000");
        if (kind === "faq") expect(html).toContain("Can I cancel?");
        const rules = css(html);
        expect(rules).not.toMatch(/transition:\s*all/);
        expect(rules).not.toMatch(/\bease-in\b(?!-out)/);
        expect(rules).not.toContain("scale(0)");
        expect(rules).toContain("prefers-reduced-motion");
        expect(rules).toContain("(hover: hover) and (pointer: fine)");
      }
    }
  });

  it("lays the booking page out in each of its styles", () => {
    for (const { id } of SECTION_STYLES.booking) {
      const html = customBookingHtml({
        name: "Court House",
        formId: "book",
        homeHref: "/s/x",
        heading: "Book a court",
        palette: { bg: "#fff", ink: "#000", soft: "#555", accent: "#080", tint: "#efe" },
        layout: id,
      });
      expect(html).toContain(`layout-${id}`);
      expect(css(html)).toContain("grid-template-areas");
    }
  });

  it("keeps only styles that exist, and every reference site is made of them", () => {
    expect(cleanDesign({ hero: "nope", offer: "menu", theme: "plum" })).toMatchObject({
      hero: DEFAULT_DESIGN.hero,
      offer: "menu",
      theme: "plum",
    });
    for (const r of REFERENCES) expect(cleanDesign(r.design)).toEqual(r.design);
  });

  it("redraws a live site's data in the style its design picks", () => {
    const { blueprint, records } = courtBookingsSample(new Date("2026-10-13T09:30:00+08:00"));
    const form = blueprint.views.find((v) => v.type === "form");
    if (form?.type !== "form") throw new Error("no form");
    form.public = true;
    blueprint.views.push(standardLanding(blueprint, "Court House", {}, "home"));
    blueprint.systems[0].viewIds.push("home");
    withCustomSite(blueprint, records, "Court House", new Date(), { offer: "menu", hero: "stats" });
    const view = blueprint.views.find((v) => v.id === "home");
    if (view?.type !== "html") throw new Error("no site");
    expect(view.live?.design).toMatchObject({ offer: "menu", hero: "stats" });
    const html = liveSiteHtml(blueprint, records, {}, view, view.html ?? "");
    expect(html).toContain("of-menu");
    expect(html).toContain("Court 1");
    const booking = blueprint.views.find((v) => v.id === form.page);
    expect(booking?.type === "html" && booking.html).toContain(`layout-${view.live?.design?.booking}`);
  });
});

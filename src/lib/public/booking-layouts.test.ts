import { describe, expect, it } from "vitest";
import type { DataRecord, FormView } from "@/lib/blueprint/types";
import { courtBookingsSample } from "@/lib/catalog/court-bookings";
import { rentalSample } from "@/lib/catalog/rental-operations";
import { customBookingHtml } from "./booking-page";
import {
  customSiteHtml,
  defaultBookingLayout,
  paletteFor,
  SITE_TOKEN,
  withCustomSite,
  withSiteLinks,
} from "./custom-site";
import { formPageOf, htmlPage, publicForm, resolvePage, siteOf } from "./resolve";
import { standardLanding } from "./site-template";
import { dateRangeProblem, daysFor, nextRange, nextStay, type Slot } from "./slots";

const NOW = new Date("2026-10-13T09:30:00+08:00");
const slot = (h: number, free = true): Slot => ({
  start: `2026-10-15T${String(h).padStart(2, "0")}:00:00.000Z`,
  end: `2026-10-15T${String(h + 1).padStart(2, "0")}:00:00.000Z`,
  free,
});

describe("picking slots", () => {
  const day = [slot(8), slot(9), slot(10), slot(11, false), slot(12)];
  it("extends, shortens, clears and restarts", () => {
    const a = nextRange(null, day[0], day, true);
    const b = nextRange(a, day[2], day, true);
    expect(b).toEqual({ start: day[0].start, end: day[2].end });
    expect(nextRange(b, day[2], day, true)).toEqual({ start: day[0].start, end: day[1].end });
    expect(nextRange(a, day[0], day, true)).toBeNull();
    expect(nextRange(b, day[4], day, true)).toEqual({ start: day[4].start, end: day[4].end });
  });
  it("picks one slot at a time when the form allows one", () => {
    const a = nextRange(null, day[0], day, false);
    expect(nextRange(a, day[1], day, false)).toEqual({ start: day[1].start, end: day[1].end });
  });
});

describe("picking a stay", () => {
  const days = ["2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17"].map((day) => ({
    day,
    free: day !== "2026-10-16",
  }));
  it("takes check-in, then a later check-out over free nights", () => {
    const draft = nextStay(null, "2026-10-14", days);
    expect(draft).toEqual({ start: "2026-10-14", end: "" });
    expect(nextStay(draft, "2026-10-16", days)).toEqual({ start: "2026-10-14", end: "2026-10-16" });
  });
  it("won't stretch over a taken night", () => {
    expect(nextStay({ start: "2026-10-14", end: "" }, "2026-10-17", days)).toEqual({
      start: "2026-10-17",
      end: "",
    });
  });
  it("checks stays sent to the server", () => {
    expect(dateRangeProblem({ start: "2026-10-14", end: "2026-10-16" }, NOW)).toBeNull();
    expect(dateRangeProblem({ start: "2026-10-14", end: "2026-10-14" }, NOW)).toContain("after check-in");
    expect(dateRangeProblem({ start: "2026-10-01", end: "2026-10-03" }, NOW)).toContain("from today");
  });
});

describe("whole-day availability", () => {
  it("marks the nights a stay covers, not its check-out day", () => {
    const { blueprint, records } = rentalSample(NOW);
    const form: FormView = {
      id: "f",
      entityId: "stay",
      name: "Book",
      type: "form",
      fieldIds: ["unit", "dates"],
    };
    const unit = records.find((r) => r.entityId === "unit")?.id ?? "";
    const own = records.filter((r) => r.entityId !== "stay");
    own.push({
      id: "s1",
      entityId: "stay",
      data: { unit, status: "reserved", dates: { start: "2026-11-20", end: "2026-11-23" } },
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    });
    const days = daysFor(blueprint, own, form, unit, "2026-11-19", 6, NOW) ?? [];
    expect(days.map((d) => `${d.day.slice(8)}:${d.free ? "free" : "taken"}`)).toEqual([
      "19:free",
      "20:taken",
      "21:taken",
      "22:taken",
      "23:free",
      "24:free",
    ]);
  });
  it("gives stays the month calendar whatever the form says", () => {
    const { blueprint, records } = rentalSample(NOW);
    const form: FormView = {
      id: "f",
      entityId: "stay",
      name: "Book",
      type: "form",
      public: true,
      bookingLayout: "grid",
      fieldIds: ["unit", "dates"],
    };
    const out = publicForm({ ...blueprint, views: [...blueprint.views, form] }, records, form);
    expect(out?.booking).toMatchObject({ dates: true, layout: "month" });
  });
});

describe("setup's website", () => {
  it("builds a custom HTML landing page that opens a custom HTML booking page", () => {
    const { blueprint, records } = courtBookingsSample(NOW);
    const form = blueprint.views.find((v) => v.type === "form");
    if (form?.type !== "form") throw new Error("no form");
    form.public = true;
    const home = standardLanding(blueprint, "Court House", {}, "home");
    blueprint.views.push(home);
    blueprint.systems[0].viewIds.push("home");
    withCustomSite(blueprint, records, "Court House <PH>", NOW);
    const page = blueprint.views.find((v) => v.id === "home");
    expect(page?.type).toBe("html");
    const html = page?.type === "html" ? (page.html ?? "") : "";
    // The booking form is no longer what visitors see: the custom booking page stands in for it.
    const book = formPageOf(blueprint, form);
    expect(book).toBeTruthy();
    expect(html).toContain(`href="/s/${SITE_TOKEN}/${book}"`);
    expect(html).not.toContain(`href="/s/${SITE_TOKEN}/${form.id}"`);
    expect(html).toContain("Court House &lt;PH&gt;");
    expect(withSiteLinks(html, "court-house")).toContain(`href="/s/court-house/${book}"`);
    // The courts in the data, with the booking calendar that suits four of them.
    expect(html).toContain("Court 1");
    expect(form.bookingLayout).toBe("grid");

    // The booking page sits beside the landing page, sends to the form, and the site's Book button opens it.
    const bookPage = blueprint.views.find((v) => v.id === book);
    expect(bookPage?.type === "html" && bookPage.public).toBe(true);
    expect(blueprint.systems[0].viewIds.indexOf(book ?? "")).toBe(
      blueprint.systems[0].viewIds.indexOf("home") + 1,
    );
    const bookHtml = bookPage?.type === "html" ? (bookPage.html ?? "") : "";
    expect(bookHtml).toContain(`var FORM = "${form.id}"`);
    expect(bookHtml).not.toContain("data-everyops-form");
    const site = siteOf("court-house", "Court House", blueprint);
    expect(site?.book?.id).toBe(book);
    expect(site?.pages.map((p) => p.id)).not.toContain(form.id);
    // The page gets the form with its courts and payment methods to draw its own steps.
    const served = resolvePage(blueprint, records, {}, "court-house", book ?? "", NOW);
    const sent = served?.forms?.find((f) => f.viewId === form.id);
    expect(sent?.booking?.resources.length).toBeGreaterThan(1);
  });

  it("writes the booking page with the same motion rules and escapes the business name", () => {
    const html = customBookingHtml({
      name: "Kapé <Ilaya>",
      formId: "booking_form",
      homeHref: `/s/${SITE_TOKEN}`,
      heading: "Book a court",
      palette: paletteFor("Kapé"),
    });
    const css = html.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(css).not.toMatch(/transition:\s*all/);
    expect(css).not.toMatch(/\bease-in\b(?!-out)/);
    expect(html).toContain("prefers-reduced-motion");
    expect(html).toContain("(hover: hover) and (pointer: fine)");
    expect(html).toContain("Kapé &lt;Ilaya&gt;");
    expect(html).not.toContain("<Ilaya>");
  });

  it("follows the motion rules: exact properties, a strong ease-out, reduced motion, hover only with a pointer", () => {
    const html = customSiteHtml("Kapé", []);
    const css = html.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(css).not.toMatch(/transition:\s*all/);
    expect(css).not.toMatch(/\bease-in\b(?!-out)/);
    expect(css).not.toContain("scale(0)");
    expect(html).toContain("cubic-bezier(0.23, 1, 0.32, 1)");
    expect(html).toContain("prefers-reduced-motion");
    expect(html).toContain("(hover: hover) and (pointer: fine)");
  });

  it("starts single-resource businesses on the month calendar", () => {
    const { blueprint, records } = courtBookingsSample(NOW);
    const form = blueprint.views.find((v): v is FormView => v.type === "form");
    if (!form) throw new Error("no form");
    const one = records.filter(
      (r) => r.entityId !== "court" || r.id === records.find((x) => x.entityId === "court")?.id,
    );
    expect(defaultBookingLayout(blueprint, one, form)).toBe("month");
  });
});

describe("stay date fields", () => {
  it("fills check-in and check-out from the picked stay instead of asking them", () => {
    const { blueprint, records } = rentalSample(NOW);
    const stay = blueprint.entities.find((e) => e.id === "stay");
    stay?.fields.push(
      { id: "check_in", name: "Check-in", type: "date", required: true },
      { id: "check_out", name: "Check-out", type: "date", required: true },
    );
    const form: FormView = {
      id: "f",
      entityId: "stay",
      name: "Book",
      type: "form",
      public: true,
      fieldIds: ["unit", "dates", "check_in", "check_out"],
      steps: [{ id: "when", title: "When", fieldIds: ["unit", "dates", "check_in", "check_out"] }],
    };
    const out = publicForm({ ...blueprint, views: [...blueprint.views, form] }, records, form);
    expect(out?.booking).toMatchObject({ dayFieldIds: ["check_in"], endDayFieldIds: ["check_out"] });
    expect(out?.steps?.[0].fieldIds).toEqual(["unit", "dates"]);
  });
});

describe("setup's website shows live data", () => {
  function site() {
    const { blueprint, records } = courtBookingsSample(NOW);
    const form = blueprint.views.find((v) => v.type === "form");
    if (form?.type !== "form") throw new Error("no form");
    form.public = true;
    blueprint.views.push(standardLanding(blueprint, "Court House", {}, "home"));
    blueprint.systems[0].viewIds.push("home");
    withCustomSite(blueprint, records, "Court House", NOW);
    const view = blueprint.views.find((v) => v.id === "home");
    if (view?.type !== "html") throw new Error("no site");
    return { blueprint, records, view };
  }
  const court = (records: DataRecord[]) =>
    records.find((r) => r.entityId === "court" && r.data.name === "Court 1");

  it("draws its courts from the records each time it's shown, not from when setup ran", () => {
    const { blueprint, records, view } = site();
    expect(view.html).toContain("<!--everyops:live offer-->");
    const renamed = records.map((r) =>
      r === court(records) ? { ...r, data: { ...r.data, name: "Center Court" } } : r,
    );
    const html = htmlPage(blueprint, renamed, {}, view).html ?? "";
    expect(html).toContain("Center Court");
    expect(html).not.toMatch(/>Court 1</);
  });

  it("keeps the owner's own words around the live parts", () => {
    const { blueprint, records, view } = site();
    const edited = (view.html ?? "").replace(/<h1([^>]*)>[^<]*<\/h1>/, "<h1$1>Our own headline</h1>");
    const renamed = records.map((r) =>
      r === court(records) ? { ...r, data: { ...r.data, name: "Center Court" } } : r,
    );
    const html = htmlPage(blueprint, renamed, { home: { body: edited } }, view).html ?? "";
    expect(html).toContain("Our own headline");
    expect(html).toContain("Center Court");
  });

  it("brings live courts to a website made before live parts, and leaves an owner's own page alone", () => {
    const { blueprint, records, view } = site();
    const old =
      '<header class="hero"></header><section id="offer" class="section"><h2>Our courts</h2><p>Old Court</p></section><script>// Reveal each part once as it scrolls into view.</script>';
    const older = { ...view, html: old, live: undefined };
    const html = htmlPage(blueprint, records, {}, older).html ?? "";
    expect(html).not.toContain("Old Court");
    expect(html).toContain("Court 1");
    const own = { ...view, html: "<h1>My page</h1><p>Old Court</p>", live: undefined };
    expect(htmlPage(blueprint, records, {}, own).html).toBe("<h1>My page</h1><p>Old Court</p>");
  });
});

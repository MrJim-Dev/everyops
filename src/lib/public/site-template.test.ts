import { describe, expect, it } from "vitest";
import type { Blueprint, FormView } from "@/lib/blueprint/types";
import { validateBlueprint } from "@/lib/blueprint/validate";
import { courtBookingsSample } from "@/lib/catalog/court-bookings";
import { applyOps } from "@/lib/engine/changes";
import { paletteFor } from "./custom-site";
import { autoHomeId, resolvePage, siteOf } from "./resolve";
import { bookLabel, fitsBusiness, offeringOf, standardBlocks, standardLanding } from "./site-template";

const NOW = new Date("2026-10-13T09:30:00+08:00");

/** Court House with a public booking form and no landing page of its own. */
function formOnly() {
  const ws = courtBookingsSample(NOW);
  const form: FormView = {
    id: "book",
    entityId: "booking",
    name: "Book a court",
    type: "form",
    public: true,
    fieldIds: ["court", "slot"],
  };
  const bp: Blueprint = applyOps(ws.blueprint, [
    { op: "update_field", entityId: "booking", fieldId: "player", patch: { required: false } },
    { op: "add_system", system: { id: "site", name: "Site", icon: "house", viewIds: [], widgetIds: [] } },
    { op: "add_view", systemId: "site", view: form },
  ]);
  return { bp, records: ws.records };
}

describe("standard site", () => {
  it("builds the same sections from any business's data, in order, and they pass validation", () => {
    const { bp } = formOnly();
    const blocks = standardBlocks(bp, "Court House", {
      headline: "Courts ready when you are",
      highlights: [
        { title: "Open late", body: "Play until 11 PM." },
        { title: "Indoor courts", body: "Rain or shine." },
        { title: "Instant booking", body: "No calls needed." },
      ],
      contact: { phone: "0917 555 0101" },
    });
    expect(blocks.map((b) => b.type)).toEqual(["hero", "highlights", "records", "steps", "contact"]);
    const hero = blocks[0];
    expect(hero).toMatchObject({
      heading: "Courts ready when you are",
      ctaViewId: "book",
      ctaLabel: "Book a court",
    });
    const offer = blocks[2];
    expect(offer).toMatchObject({ entityId: "court", layout: "cards" });
    const page = standardLanding(bp, "Court House");
    expect(validateBlueprint({ ...bp, views: [...bp.views, page] })).toEqual([]);
  });

  it("leaves out sections with nothing true to say instead of inventing them", () => {
    const { bp } = formOnly();
    const types = standardBlocks(bp, "Court House").map((b) => b.type);
    expect(types).not.toContain("highlights");
    expect(types).not.toContain("contact");
  });

  it("gives a site with only forms a standard home page", () => {
    const { bp, records } = formOnly();
    const site = siteOf("court-house", "Court House", bp);
    expect(site?.pages[0]).toEqual({ id: autoHomeId(bp), name: "Home", type: "landing" });
    const home = resolvePage(bp, records, {}, "court-house", autoHomeId(bp), NOW, "Court House");
    expect(home?.blocks[0]).toMatchObject({
      type: "hero",
      heading: "Court House",
      ctaHref: "/s/court-house/book",
    });
    expect(home?.blocks.some((b) => b.type === "records" && b.items.length > 0)).toBe(true);
  });

  it("edits one section's words and can take a section off", () => {
    const { bp } = formOnly();
    const withHome = applyOps(bp, [
      { op: "add_view", systemId: "site", view: standardLanding(bp, "Court House") },
    ]);
    const edited = applyOps(withHome, [
      {
        op: "update_block",
        viewId: "home",
        blockId: "hero",
        patch: { heading: "Play tonight", markdown: "ignored" },
      },
      { op: "remove_block", viewId: "home", blockId: "steps" },
    ]);
    const home = edited.views.find((v) => v.id === "home");
    expect(home?.type === "landing" && home.blocks[0]).toMatchObject({
      type: "hero",
      heading: "Play tonight",
    });
    expect(home?.type === "landing" && home.blocks.some((b) => b.id === "steps")).toBe(false);
    expect(JSON.stringify(home)).not.toContain("ignored");
  });
});

describe("what the website offers and its button", () => {
  const field = (id: string, type: string, extra: object = {}) => ({
    id,
    name: id.replace(/_/g, " "),
    type,
    ...extra,
  });
  const entity = (id: string, name: string, plural: string, fields: object[], extra: object = {}) =>
    ({
      id,
      name,
      pluralName: plural,
      primaryFieldId: "name",
      fields: [field("name", "text"), ...fields],
      ...extra,
    }) as never;
  const salon = {
    workspaceName: "Glow Studio",
    systems: [],
    widgets: [],
    rules: [],
    entities: [
      entity("stylist", "Stylist", "Stylists", [field("active", "checkbox")], {
        resource: { opensAt: "10:00", closesAt: "20:00", slotMinutes: 60 },
      }),
      entity("service_category", "Service category", "Service categories", []),
      entity("service", "Service", "Services", [field("price", "money"), field("duration_mins", "number")]),
      entity(
        "appointment",
        "Appointment",
        "Appointments",
        [
          field("stylist", "relation", { relation: { entityId: "stylist" } }),
          field("service", "relation", { relation: { entityId: "service" } }),
        ],
        { booking: { resourceFieldId: "stylist", timeFieldId: "when" } },
      ),
    ],
    views: [{ id: "book", name: "Book", entityId: "appointment", type: "form", public: true, fieldIds: [] }],
  } as unknown as Blueprint;

  it("offers a salon's services, not the stylists it books, and books an appointment", () => {
    expect(offeringOf(salon)?.id).toBe("service");
    expect(bookLabel(salon, "book")).toBe("Book an appointment");
  });

  it("offers a rental's units, not the list that sorts them into types", () => {
    const stays = {
      ...salon,
      entities: [
        entity("unit_type", "Unit type", "Unit types", [field("active", "checkbox")]),
        entity("unit", "Unit", "Units", [
          field("nightly_rate", "money"),
          field("unit_type", "relation", { relation: { entityId: "unit_type" } }),
        ]),
        entity("guest", "Guest", "Guests", [field("phone", "text")]),
      ],
    } as unknown as Blueprint;
    expect(offeringOf(stays)?.id).toBe("unit");
  });

  it("keeps AI button words only when they name this business's things", () => {
    expect(fitsBusiness(salon, "Book a court")).toBe(false);
    expect(fitsBusiness(salon, "Book your service")).toBe(true);
    expect(fitsBusiness(salon, "Reserve a stylist now")).toBe(true);
    expect(fitsBusiness(salon, undefined)).toBe(false);
  });
});

describe("website looks", () => {
  it("match the kind of business, and fall back to the name", () => {
    expect(paletteFor("Glow Studio", "Stylists Services").name).toBe("plum");
    expect(paletteFor("Azure & Shore Staycations").name).toBe("tide");
    expect(paletteFor("The Paddle Co", "Courts Bookings").name).toBe("court");
    expect(paletteFor("Kapé Ilaya", "Menu items Orders").name).toBe("clay");
    expect(paletteFor("Zeta Holdings")).toBe(paletteFor("Zeta Holdings"));
  });
});

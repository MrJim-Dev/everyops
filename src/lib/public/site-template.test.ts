import { describe, expect, it } from "vitest";
import type { Blueprint, FormView } from "@/lib/blueprint/types";
import { validateBlueprint } from "@/lib/blueprint/validate";
import { courtBookingsSample } from "@/lib/catalog/court-bookings";
import { applyOps } from "@/lib/engine/changes";
import { autoHomeId, resolvePage, siteOf } from "./resolve";
import { standardBlocks, standardLanding } from "./site-template";

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

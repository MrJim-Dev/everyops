import { describe, expect, it } from "vitest";
import type { Blueprint, FormView, LandingView } from "@/lib/blueprint/types";
import { validateBlueprint } from "@/lib/blueprint/validate";
import { courtBookingsSample } from "@/lib/catalog/court-bookings";
import { applyOps } from "@/lib/engine/changes";
import { mergeRecords } from "@/lib/store/workspace-model";
import { at, todayKey } from "@/lib/time";
import { publicForm, resolvePage, siteOf } from "./resolve";
import { slotsFor } from "./slots";

const NOW = new Date("2026-10-13T09:30:00+08:00");

/** Court House with a guest name on bookings, a public booking form and a landing page. */
function site() {
  const ws = courtBookingsSample(NOW);
  const bookingForm: FormView = {
    id: "book",
    entityId: "booking",
    name: "Book a court",
    type: "form",
    public: true,
    fieldIds: ["court", "slot", "guest_name"],
  };
  const landing: LandingView = {
    id: "home",
    entityId: "",
    name: "Home",
    type: "landing",
    blocks: [
      { id: "hero", type: "hero", heading: "Play tonight", ctaLabel: "Book", ctaViewId: "book" },
      { id: "courts", type: "records", entityId: "court", fieldIds: ["name", "surface"], layout: "cards" },
    ],
  };
  const bp: Blueprint = applyOps(ws.blueprint, [
    { op: "update_field", entityId: "booking", fieldId: "player", patch: { required: false } },
    {
      op: "add_field",
      entityId: "booking",
      field: { id: "guest_name", name: "Guest name", type: "text", required: true },
    },
    { op: "add_system", system: { id: "site", name: "Site", icon: "house", viewIds: [], widgetIds: [] } },
    { op: "add_view", systemId: "site", view: bookingForm },
    { op: "add_view", systemId: "site", view: landing },
  ]);
  return { bp, records: ws.records };
}

describe("public pages", () => {
  it("lists only public pages, landing first", () => {
    const { bp } = site();
    expect(validateBlueprint(bp)).toEqual([]);
    expect(siteOf("court-house", "Court House", bp)?.pages.map((p) => p.id)).toEqual(["home", "book"]);
    const hidden = applyOps(bp, [{ op: "update_view", viewId: "book", patch: { public: false } }]);
    expect(siteOf("court-house", "Court House", hidden)?.pages.map((p) => p.id)).toEqual(["home"]);
    expect(resolvePage(hidden, [], {}, "court-house", "book")).toBeNull();
  });

  it("shows a record list with only the fields it names, and links the hero to the form", () => {
    const { bp, records } = site();
    const page = resolvePage(bp, records, {}, "court-house", "home");
    const hero = page?.blocks.find((b) => b.type === "hero");
    const courts = page?.blocks.find((b) => b.type === "records");
    expect(hero && hero.type === "hero" && hero.ctaHref).toBe("/s/court-house/book");
    expect(courts?.type === "records" && courts.items[0].cells.map((c) => c.fieldId)).toEqual([
      "name",
      "surface",
    ]);
  });

  it("never offers customer records as choices, and doesn't ask for the status", () => {
    const { bp, records } = site();
    const form = publicForm(bp, records, bp.views.find((v) => v.id === "book") as FormView);
    const ids = form?.fields.map((f) => f.id) ?? [];
    expect(ids).toContain("court");
    expect(ids).not.toContain("player");
    expect(ids).not.toContain("status");
    expect(form?.choices.court?.length).toBeGreaterThan(0);
    expect(form?.booking?.timeFieldId).toBe("slot");
  });

  it("marks slots held by bookings as taken", () => {
    const { bp, records } = site();
    const form = bp.views.find((v) => v.id === "book") as FormView;
    const booked = records.find(
      (r) =>
        r.entityId === "booking" &&
        r.data.status !== "cancelled" &&
        typeof r.data.slot === "object" &&
        r.data.slot,
    );
    const slot = booked?.data.slot as { start: string; end: string };
    const day = todayKey(new Date(slot.start));
    const slots =
      slotsFor(bp, records, form, String(booked?.data.court), day, new Date(`${day}T00:00:00+08:00`)) ?? [];
    expect(slots.find((s) => s.start === slot.start)?.free).toBe(false);
    expect(slots.some((s) => s.free)).toBe(true);
    expect(slots.every((s) => Date.parse(s.start) >= Date.parse(at(day, "00:00")))).toBe(true);
  });
});

describe("saving next to public bookings", () => {
  const rec = (id: string, createdAt: string) => ({
    id,
    entityId: "booking",
    data: {},
    createdAt,
    updatedAt: createdAt,
  });
  it("keeps bookings made after the browser last synced, and drops ones it deleted", () => {
    const stored = [
      rec("a", "2026-10-13T01:00:00Z"),
      rec("deleted", "2026-10-13T01:00:00Z"),
      rec("public", "2026-10-13T03:00:00Z"),
    ];
    const incoming = [rec("a", "2026-10-13T01:00:00Z")];
    expect(mergeRecords(stored, incoming, "2026-10-13T02:00:00Z").map((r) => r.id)).toEqual(["a", "public"]);
  });
});

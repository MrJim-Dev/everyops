import { describe, expect, it } from "vitest";
import { markersOf, stepsFromMarkers } from "@/lib/blueprint/form-steps";
import type { Blueprint, DataRecord, FormView } from "@/lib/blueprint/types";
import { validateBlueprint } from "@/lib/blueprint/validate";
import { courtBookingsSample } from "@/lib/catalog/court-bookings";
import { applyOps } from "@/lib/engine/changes";
import { createRecord } from "@/lib/engine/records";
import { publicForm, resolvePage } from "./resolve";

const NOW = new Date("2026-10-13T09:30:00+08:00");
const stamp = NOW.toISOString();

/** Court House with add-ons (paddle rental, balls) as line items under bookings, and a public booking form. */
function venue(form: Partial<FormView> = {}) {
  const ws = courtBookingsSample(NOW);
  const view: FormView = {
    id: "book",
    entityId: "booking",
    name: "Book a court",
    type: "form",
    public: true,
    fieldIds: ["court", "slot", "guest_name", "guest_phone"],
    ...form,
  };
  const bp: Blueprint = applyOps(ws.blueprint, [
    { op: "update_field", entityId: "booking", fieldId: "player", patch: { required: false } },
    {
      op: "add_field",
      entityId: "booking",
      field: { id: "guest_name", name: "Guest name", type: "text", required: true },
    },
    { op: "add_field", entityId: "booking", field: { id: "guest_phone", name: "Phone", type: "text" } },
    {
      op: "add_entity",
      entity: {
        id: "add_on",
        name: "Add-on",
        pluralName: "Add-ons",
        primaryFieldId: "name",
        fields: [
          { id: "name", name: "Name", type: "text", required: true },
          { id: "price", name: "Price", type: "money", required: true },
          { id: "active", name: "Active", type: "checkbox" },
          { id: "cost", name: "Supplier cost", type: "money" },
        ],
      },
    },
    {
      op: "add_entity",
      entity: {
        id: "booking_addon",
        name: "Booking add-on",
        pluralName: "Booking add-ons",
        primaryFieldId: "label",
        parent: { entityId: "booking", fieldId: "booking" },
        fields: [
          {
            id: "label",
            name: "Item",
            type: "formula",
            formula: { expr: "add_on.name", resultType: "text" },
          },
          {
            id: "booking",
            name: "Booking",
            type: "relation",
            relation: { entityId: "booking" },
            required: true,
          },
          {
            id: "add_on",
            name: "Add-on",
            type: "relation",
            relation: { entityId: "add_on" },
            required: true,
          },
          { id: "qty", name: "Quantity", type: "number", required: true },
        ],
      },
    },
    { op: "add_system", system: { id: "site", name: "Site", icon: "house", viewIds: [], widgetIds: [] } },
    { op: "add_view", systemId: "site", view },
  ]);
  const item = (id: string, name: string, price: number, active: boolean): DataRecord => ({
    id,
    entityId: "add_on",
    data: { name, price, active, cost: 40 },
    createdAt: stamp,
    updatedAt: stamp,
  });
  const records = [
    ...ws.records,
    item("paddle", "Paddle rental", 100, true),
    item("balls", "Balls (3 pcs)", 100, true),
    item("old", "Old towel", 20, false),
  ];
  return { bp, records };
}

describe("forms in steps", () => {
  it("shows each step's fields in order, puts required leftovers last and drops empty steps", () => {
    const { bp, records } = venue({
      steps: [
        { id: "when", title: "Court and time", fieldIds: ["court", "slot"] },
        { id: "private", title: "Nothing public", fieldIds: ["status"] },
        { id: "you", title: "Your details", fieldIds: ["guest_phone"] },
      ],
    });
    const form = publicForm(bp, records, bp.views.find((v) => v.id === "book") as FormView);
    expect(form?.steps?.map((s) => [s.title, s.fieldIds])).toEqual([
      ["Court and time", ["court", "slot"]],
      ["Your details", ["guest_phone", "guest_name"]],
    ]);
    expect(validateBlueprint(bp)).toEqual([]);
  });

  it("flags steps that name fields the record type doesn't have", () => {
    const { bp } = venue({ steps: [{ id: "oops", title: "Oops", fieldIds: ["nope"] }] });
    expect(validateBlueprint(bp).map((e) => e.message)).toContain('Field "nope" does not exist on Booking');
  });
});

describe("add-ons on a form", () => {
  it("offers only matching items, with name and price and nothing else", () => {
    const { bp, records } = venue({
      extras: {
        lineEntityId: "booking_addon",
        itemFieldId: "add_on",
        quantityFieldId: "qty",
        filter: "active",
      },
    });
    const form = publicForm(bp, records, bp.views.find((v) => v.id === "book") as FormView);
    expect(form?.extras).toEqual({
      title: "Add-ons",
      items: [
        { id: "paddle", title: "Paddle rental", price: 100, priceText: "₱100" },
        { id: "balls", title: "Balls (3 pcs)", price: 100, priceText: "₱100" },
      ],
    });
    expect(JSON.stringify(form)).not.toContain("Supplier cost");
    expect(validateBlueprint(bp)).toEqual([]);
  });

  it("gets its own step before the last one when the steps don't place it", () => {
    const { bp, records } = venue({
      steps: [
        { id: "when", title: "Court and time", fieldIds: ["court", "slot"] },
        { id: "you", title: "Your details", fieldIds: ["guest_name", "guest_phone"] },
      ],
      extras: {
        lineEntityId: "booking_addon",
        itemFieldId: "add_on",
        quantityFieldId: "qty",
        title: "Rentals and balls",
      },
    });
    const form = publicForm(bp, records, bp.views.find((v) => v.id === "book") as FormView);
    expect(form?.steps?.map((s) => s.title)).toEqual(["Court and time", "Rentals and balls", "Your details"]);
    expect(form?.steps?.[1].extras).toBe(true);
  });

  it("keeps a step that asks only for add-ons, and drops it when nothing is offered", () => {
    const steps = [
      { id: "when", title: "Court and time", fieldIds: ["court", "slot"] },
      { id: "extras", title: "Add-ons", fieldIds: [], extras: true },
      { id: "you", title: "Your details", fieldIds: ["guest_name", "guest_phone"] },
    ];
    const extras = { lineEntityId: "booking_addon", itemFieldId: "add_on", quantityFieldId: "qty" };
    const { bp, records } = venue({ steps, extras });
    const view = bp.views.find((v) => v.id === "book") as FormView;
    expect(publicForm(bp, records, view)?.steps?.map((s) => s.title)).toEqual([
      "Court and time",
      "Add-ons",
      "Your details",
    ]);
    expect(validateBlueprint(bp)).toEqual([]);
    const noItems = records.filter((r) => r.entityId !== "add_on");
    expect(publicForm(bp, noItems, view)?.steps?.map((s) => s.title)).toEqual([
      "Court and time",
      "Your details",
    ]);
  });

  it("are saved as line items under the booking, as the public form does", () => {
    const { bp, records } = venue({
      extras: { lineEntityId: "booking_addon", itemFieldId: "add_on", quantityFieldId: "qty" },
    });
    const court = records.find((r) => r.entityId === "court")?.id as string;
    const booking = createRecord(
      { blueprint: bp, records },
      "booking",
      {
        court,
        slot: { start: "2026-10-20T10:00:00.000Z", end: "2026-10-20T11:00:00.000Z" },
        guest_name: "Ana",
        status: "unpaid",
      },
      NOW,
    );
    if (!booking.ok) throw new Error(booking.errors[0]?.message);
    const line = createRecord(
      booking.data,
      "booking_addon",
      { booking: booking.record.id, add_on: "paddle", qty: 2 },
      NOW,
    );
    expect(line.ok).toBe(true);
    expect(validateBlueprint(bp)).toEqual([]);
  });

  it("explains add-ons that don't point at line items of the form's record type", () => {
    const { bp } = venue({ extras: { lineEntityId: "add_on", itemFieldId: "name" } });
    const messages = validateBlueprint(bp).map((e) => e.message);
    expect(messages).toContain("Add-on line items (Add-on) must have Booking as their parent");
    expect(messages.some((m) => m.includes('"name" to be a link'))).toBe(true);
  });
});

describe("steps the assistant writes as markers among a form's fields", () => {
  it("splits '# Step title' markers into steps and turns an existing form into a multi-step one", () => {
    const split = stepsFromMarkers([
      "# Court and time",
      "court",
      "slot",
      "# Your details",
      "guest_name",
      "guest_phone",
    ]);
    expect(split.fieldIds).toEqual(["court", "slot", "guest_name", "guest_phone"]);
    expect(split.steps).toEqual([
      { id: "court_and_time", title: "Court and time", fieldIds: ["court", "slot"] },
      { id: "your_details", title: "Your details", fieldIds: ["guest_name", "guest_phone"] },
    ]);
    expect(stepsFromMarkers(["court", "slot"])).toEqual({ fieldIds: ["court", "slot"] });
    expect(stepsFromMarkers(["# Only", "court"]).steps).toBeUndefined();

    const { bp } = venue();
    const next = applyOps(bp, [
      {
        op: "update_view",
        viewId: "book",
        patch: { fieldIds: split.fieldIds, steps: split.steps, review: true },
      },
    ]);
    const form = next.views.find((v) => v.id === "book") as FormView;
    expect(form.steps?.map((s) => s.title)).toEqual(["Court and time", "Your details"]);
    expect(validateBlueprint(next)).toEqual([]);
    const flat = applyOps(next, [{ op: "update_view", viewId: "book", patch: { steps: [] } }]);
    expect((flat.views.find((v) => v.id === "book") as FormView).steps).toBeUndefined();
  });
});

describe("blocks shown in a step", () => {
  it("moves a form's payment methods into the step that lists them", () => {
    const split = stepsFromMarkers([
      "# Court and time",
      "court",
      "slot",
      "# Payment",
      "@how_to_pay",
      "guest_name",
    ]);
    expect(split.steps?.[1]).toEqual({
      id: "payment",
      title: "Payment",
      fieldIds: ["guest_name"],
      blockIds: ["how_to_pay"],
    });
    const { bp, records } = venue({
      steps: split.steps,
      fieldIds: split.fieldIds,
      blocks: [
        { id: "how_to_pay", type: "text", markdown: "Send GCash to 0917 123 4567" },
        { id: "faqs", type: "text", markdown: "Bring your own paddle or rent one" },
      ],
    });
    expect(validateBlueprint(bp)).toEqual([]);
    const view = bp.views.find((v) => v.id === "book") as FormView;
    expect(markersOf(view)).toEqual([
      "# Court and time",
      "court",
      "slot",
      "# Payment",
      "@how_to_pay",
      "guest_name",
    ]);
    const page = resolvePage(bp, records, {}, "court-house", "book");
    expect(page?.blocks.map((b) => b.id)).toEqual(["faqs"]);
    expect(page?.form?.steps?.map((s) => s.blocks?.map((b) => b.id) ?? [])).toEqual([[], ["how_to_pay"]]);

    // A step can't show a block the form doesn't have, and removing the block takes it off the step.
    const typo = venue({
      steps: [
        { id: "a", title: "A", fieldIds: ["court", "slot"] },
        { id: "b", title: "B", fieldIds: ["guest_name"], blockIds: ["nope"] },
      ],
    });
    expect(
      validateBlueprint(typo.bp)
        .map((e) => e.message)
        .join(" "),
    ).toContain('shows block "nope"');
    const removed = applyOps(bp, [{ op: "remove_block", viewId: "book", blockId: "how_to_pay" }]);
    expect((removed.views.find((v) => v.id === "book") as FormView).steps?.[1].blockIds).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";
import type { Blueprint, FormView } from "@/lib/blueprint/types";
import { courtBookingsSample } from "@/lib/catalog/court-bookings";
import { applyOps } from "@/lib/engine/changes";
import { publicForm } from "./resolve";

const NOW = new Date("2026-10-13T09:30:00+08:00");

/** Court House's booking form the way the Pickleball workspace has it: a date field, payment step and proof upload. */
function bookingForm(extra: Partial<FormView> = {}) {
  const ws = courtBookingsSample(NOW);
  const form: FormView = {
    id: "book",
    entityId: "booking",
    name: "Book a court",
    type: "form",
    public: true,
    fieldIds: ["court", "date", "slot", "guest_name", "ref_no", "proof"],
    steps: [
      { id: "when", title: "Court & Time", fieldIds: ["court", "date", "slot"] },
      { id: "details", title: "Your details", fieldIds: ["guest_name"] },
      { id: "pay", title: "Upload Payment", fieldIds: ["ref_no", "proof"] },
    ],
    ...extra,
  };
  const bp: Blueprint = applyOps(ws.blueprint, [
    { op: "update_field", entityId: "booking", fieldId: "player", patch: { required: false } },
    ...(
      [
        { id: "guest_name", name: "Guest name", type: "text", required: true },
        { id: "date", name: "Date", type: "date", required: true },
        { id: "ref_no", name: "Reference no.", type: "text" },
        { id: "proof", name: "Proof of payment", type: "image", required: true },
      ] as const
    ).map((field) => ({ op: "add_field" as const, entityId: "booking", field: { ...field } })),
    { op: "add_view", systemId: "bookings", view: form },
  ]);
  const view = bp.views.find((v) => v.id === "book") as FormView;
  const out = publicForm(bp, ws.records, view);
  if (!out) throw new Error("no form");
  return out;
}

describe("public booking forms", () => {
  it("asks for the proof of payment picture on the payment step", () => {
    const form = bookingForm();
    expect(form.fields.find((f) => f.id === "proof")).toMatchObject({ type: "image", required: true });
    expect(form.steps?.find((s) => s.title === "Upload Payment")?.fieldIds).toEqual(["ref_no", "proof"]);
  });

  it("fills the booking's date from the picked slot instead of asking it", () => {
    const form = bookingForm();
    expect(form.booking?.dayFieldIds).toEqual(["date"]);
    expect(form.steps?.[0].fieldIds).toEqual(["court", "slot"]);
  });

  it("lets visitors book several hours unless the form is set to one slot", () => {
    expect(bookingForm().booking?.multiple).toBe(true);
    expect(bookingForm({ multipleSlots: false }).booking?.multiple).toBe(false);
  });
});

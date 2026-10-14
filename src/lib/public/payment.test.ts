import { describe, expect, it } from "vitest";
import type { Blueprint, DataRecord } from "@/lib/blueprint/types";
import { f } from "@/lib/catalog/define";
import { paymentBlock, resolvePage } from "./resolve";

const rec = (id: string, entityId: string, data: DataRecord["data"]): DataRecord => ({
  id,
  entityId,
  data,
  createdAt: "",
  updatedAt: "",
});

// Like Smash & Spin's design: the payment step links to payment methods, but no block on the page lists them.
const bp: Blueprint = {
  version: 1,
  workspaceName: "Smash & Spin",
  systems: [
    { id: "bookings", name: "Bookings", icon: "calendar", viewIds: ["public_booking"], widgetIds: [] },
  ],
  entities: [
    {
      id: "payment_method",
      name: "Payment method",
      pluralName: "Payment methods",
      primaryFieldId: "name",
      fields: [
        f.text("name", "Name"),
        f.text("account_number", "Account number"),
        { id: "qr_code", name: "QR code", type: "image" },
        f.checkbox("active", "Active"),
      ],
    },
    {
      id: "booking",
      name: "Booking",
      pluralName: "Bookings",
      primaryFieldId: "player_name",
      fields: [
        f.text("player_name", "Player Name"),
        f.text("player_phone", "Phone"),
        f.relation("payment_method", "Payment method", "payment_method"),
        f.text("payment_ref", "Payment Reference"),
      ],
    },
  ],
  views: [
    {
      id: "public_booking",
      entityId: "booking",
      name: "Book a court",
      type: "form",
      public: true,
      fieldIds: ["player_name", "player_phone", "payment_method", "payment_ref"],
      steps: [
        { id: "details", title: "Your details", fieldIds: ["player_name", "player_phone"] },
        { id: "payment", title: "Payment", fieldIds: ["payment_method", "payment_ref"] },
      ],
    },
  ],
  widgets: [],
  rules: [],
};
const records = [
  rec("gcash", "payment_method", { name: "GCash", account_number: "0917 000 0000", active: true }),
  rec("old_bank", "payment_method", { name: "Old bank", account_number: "123", active: false }),
];

describe("how to pay on public forms", () => {
  it("shows the active payment methods inside the payment step, and offers only those", () => {
    const view = bp.views[0];
    if (view.type !== "form") throw new Error("not a form");
    expect(paymentBlock(bp, view)?.entityId).toBe("payment_method");
    const page = resolvePage(bp, records, {}, "smash", "public_booking");
    const payment = page?.form?.steps?.find((s) => s.title === "Payment");
    const block = payment?.blocks?.[0];
    expect(block?.type === "records" && block.items.length).toBe(1);
    expect(page?.form?.fields.some((x) => x.id === "payment_method")).toBe(true);
    expect(page?.form?.choices.payment_method).toEqual([{ id: "gcash", title: "GCash" }]);
  });

  it("leaves a page alone that already lists its payment methods", () => {
    const view = bp.views[0];
    if (view.type !== "form") throw new Error("not a form");
    const listed = {
      ...view,
      blocks: [
        {
          id: "pay",
          type: "records" as const,
          entityId: "payment_method",
          fieldIds: ["account_number"],
          layout: "cards" as const,
        },
      ],
    };
    expect(paymentBlock(bp, listed)).toBeNull();
  });
});

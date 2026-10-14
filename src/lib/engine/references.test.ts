import { describe, expect, it } from "vitest";
import type { Entity } from "@/lib/blueprint/types";
import { f } from "@/lib/catalog/define";
import { autoReferenceFields, nextReference } from "./references";

const booking: Entity = {
  id: "booking",
  name: "Booking",
  pluralName: "Bookings",
  primaryFieldId: "player_name",
  fields: [
    f.text("player_name", "Player Name"),
    f.text("payment_ref", "Payment Reference"),
    f.text("ref_code", "Booking Reference", { required: true }),
    f.text("notes", "Special requests", { required: true }),
  ],
};

describe("issued references", () => {
  it("issues only required reference numbers, never the payment reference a visitor types", () => {
    expect(autoReferenceFields(booking).map((x) => x.id)).toEqual(["ref_code"]);
  });

  it("numbers after the highest reference in use", () => {
    const field = booking.fields[2];
    const rec = (ref: string) => ({
      id: ref,
      entityId: "booking",
      data: { ref_code: ref },
      createdAt: "",
      updatedAt: "",
    });
    expect(nextReference(booking, field, [])).toBe("BO-1001");
    expect(nextReference(booking, field, [rec("BO-1001"), rec("BO-1007")])).toBe("BO-1008");
  });
});

import { describe, expect, it } from "vitest";
import type { Blueprint, Widget } from "@/lib/blueprint/types";
import { widgetLook } from "./widget-look";

const bp = {
  entities: [
    {
      id: "booking",
      name: "Booking",
      pluralName: "Bookings",
      primaryFieldId: "name",
      fields: [{ id: "amount", name: "Amount", type: "money" }],
    },
  ],
} as unknown as Blueprint;
const stat = (title: string, extra: Partial<Widget> = {}): Widget => ({
  id: title.toLowerCase().replace(/\W+/g, "_"),
  title,
  entityId: "booking",
  type: "stat",
  metric: { op: "count" },
  ...extra,
});

describe("widgetLook", () => {
  it("reads what a widget measures from its title, warnings first", () => {
    expect(widgetLook(bp, stat("Unpaid bookings"))).toEqual({ icon: "alert", tone: "amber" });
    expect(widgetLook(bp, stat("Collected today"))).toEqual({ icon: "money", tone: "teal" });
    expect(widgetLook(bp, stat("Expenses this month"))).toEqual({ icon: "expense", tone: "rose" });
    expect(widgetLook(bp, stat("New customers"))).toEqual({ icon: "people", tone: "violet" });
    // "Latest" is not "late".
    expect(widgetLook(bp, stat("Latest pos sales")).icon).toBe("money");
  });

  it("falls back to the measured field, then the record type", () => {
    expect(widgetLook(bp, stat("Week so far", { metric: { op: "sum", fieldId: "amount" } })).icon).toBe(
      "money",
    );
    expect(widgetLook(bp, stat("Count")).icon).toBe("calendar");
  });
});

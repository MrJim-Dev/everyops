import { describe, expect, it } from "vitest";
import type { Blueprint } from "@/lib/blueprint/types";
import { courtBookingsSample } from "@/lib/catalog/court-bookings";
import { fieldUsage, renameInPages } from "./related";

const bp = {
  version: 1,
  workspaceName: "Smash Courts",
  systems: [{ id: "courts", name: "Courts", icon: "house", viewIds: ["about", "site"], widgetIds: [] }],
  entities: [
    {
      id: "booking",
      name: "Booking",
      pluralName: "Bookings",
      primaryFieldId: "guest",
      fields: [
        { id: "guest", name: "Guest", type: "text" },
        {
          id: "status",
          name: "Status",
          type: "status",
          options: [{ id: "pending", label: "Pending", tone: "neutral" }],
        },
      ],
    },
  ],
  views: [
    { id: "about", entityId: "", name: "About", type: "document" },
    { id: "site", entityId: "", name: "Site", type: "html" },
  ],
  widgets: [],
  rules: [],
} as unknown as Blueprint;

describe("renameInPages", () => {
  it("puts the new names into document and HTML text, never into markup", () => {
    const docs = {
      about: { body: "Book at Smash Courts. Courts open daily. Pending bookings expire. Courtyard parking." },
      site: {
        body: '<style>.Courts{color:red}</style><h1 class="Courts">Smash Courts</h1><p>Our Courts</p>',
      },
    };
    const { docOps, steps } = renameInPages(
      bp,
      [
        { op: "rename_workspace", name: "Rally House" },
        { op: "rename_system", systemId: "courts", name: "Fields" },
        {
          op: "update_field",
          entityId: "booking",
          fieldId: "status",
          patch: { options: [{ id: "pending", label: "Awaiting payment", tone: "neutral" }] },
        },
      ],
      docs,
    );
    expect(docOps.find((d) => d.viewId === "about")?.body).toBe(
      "Book at Rally House. Fields open daily. Awaiting payment bookings expire. Courtyard parking.",
    );
    expect(docOps.find((d) => d.viewId === "site")?.body).toBe(
      '<style>.Courts{color:red}</style><h1 class="Courts">Rally House</h1><p>Our Fields</p>',
    );
    expect(steps.map((s) => s.label)).toEqual(["Update the text on About", "Update the text on Site"]);
  });

  it("leaves pages alone when nothing they say is renamed, or when the plan rewrites them", () => {
    const docs = { about: { body: "Courts open daily." } };
    expect(renameInPages(bp, [{ op: "rename_view", viewId: "site", name: "Website" }], docs).docOps).toEqual(
      [],
    );
    expect(
      renameInPages(bp, [{ op: "rename_system", systemId: "courts", name: "Fields" }], docs, [
        { viewId: "about", body: "New text" },
      ]).docOps,
    ).toEqual([]);
  });
});

describe("fieldUsage", () => {
  it("lists the tabs, forms and cards built on each field", () => {
    const sample = courtBookingsSample(new Date("2026-10-13T09:30:00+08:00")).blueprint;
    const usage = fieldUsage(sample);
    const booking = sample.entities.find((e) => e.id === "booking");
    const line = usage.split("\n").find((l) => l.startsWith(`- ${booking?.name}:`)) ?? "";
    // The status field (labelled Payment) drives the list, the booking form and the money cards.
    expect(line).toMatch(/Payment \(status\): tab "List", form "New booking", card "Bookings today"/);
    // Linked record types count too: a player's total spent adds up booking amounts.
    expect(line).toMatch(/Amount \(amount\): [^;]*Player "Total spent"/);
  });
});

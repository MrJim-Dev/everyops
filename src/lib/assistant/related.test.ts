import { describe, expect, it } from "vitest";
import type { Blueprint } from "@/lib/blueprint/types";
import { courtBookingsSample } from "@/lib/catalog/court-bookings";
import { fieldUsage, renameInDesign, renameInPages } from "./related";

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

describe("renameInDesign", () => {
  const site = {
    version: 1,
    workspaceName: "Smash Courts",
    systems: [
      {
        id: "players",
        name: "Players",
        icon: "users",
        viewIds: ["all_players", "join"],
        widgetIds: ["new_players"],
      },
      { id: "web", name: "Website", icon: "house", viewIds: ["home"], widgetIds: [] },
    ],
    entities: [
      {
        id: "player",
        name: "Player",
        pluralName: "Players",
        primaryFieldId: "name",
        fields: [{ id: "name", name: "Name", type: "text" }],
      },
    ],
    views: [
      { id: "all_players", entityId: "player", name: "All players", type: "table", fieldIds: ["name"] },
      {
        id: "join",
        entityId: "player",
        name: "Join",
        type: "form",
        fieldIds: ["name"],
        intro: "New players get a free first hour.",
        submitLabel: "Join as a player",
      },
      {
        id: "home",
        entityId: "",
        name: "Home",
        type: "landing",
        blocks: [
          { id: "hero", type: "hero", heading: "Where players meet", ctaLabel: "Book" },
          {
            id: "how",
            type: "steps",
            title: "How it works",
            items: [{ title: "Sign up", body: "Players book online." }],
          },
          { id: "about", type: "text", markdown: "Our players love it." },
        ],
      },
    ],
    widgets: [
      {
        id: "new_players",
        title: "New players this month",
        entityId: "player",
        type: "stat",
        metric: { op: "count" },
      },
    ],
    rules: [
      {
        id: "welcome",
        name: "Welcome new players",
        trigger: { entityId: "player", event: "created" },
        actions: [],
      },
    ],
  } as unknown as Blueprint;
  const rename = { op: "rename_system", systemId: "players", name: "Members" } as const;

  it("carries a page rename into tabs, forms, page sections, cards and automations, in any case", () => {
    const { ops, steps } = renameInDesign(site, [rename], {});
    expect(ops).toEqual(
      expect.arrayContaining([
        { op: "rename_view", viewId: "all_players", name: "All members" },
        {
          op: "update_view",
          viewId: "join",
          patch: { intro: "New members get a free first hour." },
        },
      ]),
    );
    expect(ops).toContainEqual({
      op: "update_block",
      viewId: "home",
      blockId: "hero",
      patch: { heading: "Where members meet" },
    });
    expect(ops).toContainEqual({
      op: "update_block",
      viewId: "home",
      blockId: "how",
      patch: { items: [{ title: "Sign up", body: "Members book online." }] },
    });
    expect(ops).toContainEqual({
      op: "update_widget",
      widgetId: "new_players",
      patch: { title: "New members this month" },
    });
    expect(ops).toContainEqual(
      expect.objectContaining({
        op: "add_rule",
        rule: expect.objectContaining({ name: "Welcome new members" }),
      }),
    );
    expect(steps[0].detail).toBe("1 tab, 1 form, 3 page sections, 1 card, 1 automation");
  });

  it("changes the team's own words for a section where they're kept, and skips what the plan already changes", () => {
    const docs = {
      "home:hero": { body: JSON.stringify({ heading: "Players welcome", subheading: "Since 2020" }) },
    };
    const { ops, docOps } = renameInDesign(
      site,
      [rename, { op: "update_widget", widgetId: "new_players", patch: { title: "Sign-ups" } }],
      docs,
    );
    expect(docOps).toEqual([
      { viewId: "home:hero", body: JSON.stringify({ heading: "Members welcome", subheading: "Since 2020" }) },
    ]);
    expect(ops.some((o) => o.op === "update_block" && o.blockId === "hero")).toBe(false);
    expect(ops.some((o) => o.op === "update_widget")).toBe(false);
  });
});

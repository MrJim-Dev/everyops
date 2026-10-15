import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { Blueprint, LayoutView } from "@/lib/blueprint/types";
import { validateBlueprint } from "@/lib/blueprint/validate";
import { courtBookingsSample } from "@/lib/catalog/court-bookings";
import { resolveLayout } from "@/lib/public/layout";
import { isPublic, resolvePage, siteOf } from "@/lib/public/resolve";
import { keepValidParts, OVERVIEW_VIEW_ID, placeOverview } from "@/server/ai/overview-layout";
import { aboutPeople, layoutPublicProblems } from "./public-safety";
import { parseLayout } from "./registry";

const now = new Date("2026-10-15T09:00:00+08:00");
const sample = () => courtBookingsSample(now);

function withLayout(bp: Blueprint, sections: unknown, pub = true): LayoutView {
  const parsed = parseLayout({ sections });
  expect(parsed.errors).toEqual([]);
  const view: LayoutView = {
    id: "stats",
    name: "Our courts",
    entityId: "",
    type: "layout",
    sections: parsed.sections,
    public: pub,
  };
  bp.views.push(view);
  bp.systems[0].viewIds.push(view.id);
  return view;
}

/** A public page about the business: numbers, charts and the courts, nothing about players. */
const safe = [
  {
    title: "This week",
    columns: 3,
    items: [
      {
        component: "stat_cards",
        props: {
          stats: [
            { title: "Bookings", entityId: "booking", op: "count" },
            {
              title: "Revenue",
              entityId: "booking",
              op: "sum",
              fieldId: "amount",
              filter: "status == 'paid'",
            },
          ],
        },
      },
      { component: "chart_pie", props: { title: "By court", entityId: "booking", groupByFieldId: "court" } },
      { component: "table", props: { title: "Courts", entityId: "court", fieldIds: ["name", "surface"] } },
      { component: "calendar", props: { title: "Busy days", entityId: "booking", dateFieldId: "slot" } },
    ],
  },
];

describe("public layout pages", () => {
  it("knows which record types and fields are about people", () => {
    const { blueprint } = sample();
    const by = (id: string) => {
      const entity = blueprint.entities.find((e) => e.id === id);
      if (!entity) throw new Error(`no ${id}`);
      return entity;
    };
    expect(aboutPeople(by("player"))).toBe(true);
    expect(aboutPeople(by("court"))).toBe(false);
    expect(aboutPeople(by("booking"))).toBe(false);
  });

  it("publishes a page about the business, and refuses parts that would show people or team screens", () => {
    const { blueprint } = sample();
    const view = withLayout(blueprint, safe);
    expect(validateBlueprint(blueprint)).toEqual([]);
    expect(isPublic(view)).toBe(true);
    expect(siteOf("court-house", "Court House", blueprint)?.pages.map((p) => p.id)).toContain("stats");

    view.sections = parseLayout({
      sections: [
        {
          columns: 2,
          items: [
            { component: "list", props: { entityId: "player" } },
            { component: "table", props: { entityId: "booking", fieldIds: ["slot", "player"] } },
            {
              component: "leaderboard",
              props: { title: "Top", entityId: "booking", groupByFieldId: "player" },
            },
            { component: "widget", props: { widgetId: "bookings_today" } },
            { component: "form", props: { viewId: "new_booking" } },
          ],
        },
      ],
    }).sections;
    const problems = layoutPublicProblems(blueprint, view).join("\n");
    expect(problems).toMatch(/lists Players, which are about people/);
    expect(problems).toMatch(/Player, which names or reaches a person/);
    expect(problems).toMatch(/Dashboard card shows the team's own screens/);
    expect(problems).toMatch(/opens "new_booking", which isn't a public page/);
    expect(
      validateBlueprint(blueprint)
        .map((e) => e.message)
        .join("\n"),
    ).toMatch(/Our courts is public/);
  });

  it("sends visitors only worked-out results: no record ids, no player names, no unlisted fields", () => {
    const { blueprint, records } = sample();
    const view = withLayout(blueprint, safe);
    // A part saved before it was refused never reaches a visitor either.
    view.sections[0].items.push(
      ...parseLayout({
        sections: [{ columns: 1, items: [{ component: "list", props: { entityId: "player" } }] }],
      }).sections[0].items,
    );
    const page = resolvePage(blueprint, records, {}, "court-house", "stats", now);
    expect(page?.type).toBe("layout");
    const parts = page?.layout?.sections.flatMap((s) => s.items.map((i) => i.component));
    expect(parts).toEqual(["stat_cards", "chart_pie", "table", "calendar"]);
    const sent = JSON.stringify(page);
    for (const r of records) expect(sent).not.toContain(r.id);
    const players = records.filter((r) => r.entityId === "player").map((r) => String(r.data.name));
    for (const name of players) expect(sent).not.toContain(name);
    const stats = page?.layout?.sections[0].items[0].data.stats as { value: number }[];
    expect(stats[0].value).toBeGreaterThan(0);
    expect(
      resolveLayout(blueprint, records, {}, "court-house", { ...view, public: false }, now).sections.length,
    ).toBe(1);
  });

  it("is hidden until it's public", () => {
    const { blueprint, records } = sample();
    withLayout(blueprint, safe, false);
    expect(resolvePage(blueprint, records, {}, "court-house", "stats", now)).toBeNull();
  });
});

describe("setup's Overview layout", () => {
  it("keeps the parts that check out and places the page on the Overview, cards kept", () => {
    const { blueprint } = sample();
    const parsed = parseLayout({
      sections: [
        {
          title: "Today",
          columns: 3,
          items: [
            {
              component: "stat",
              props: { title: "Bookings", entityId: "booking", op: "count", filter: "is_today(slot)" },
            },
            {
              component: "stat",
              props: { title: "Broken", entityId: "booking", op: "sum", fieldId: "status" },
            },
            { component: "widget", props: { widgetId: "today_schedule" } },
            { component: "chart_bar", props: { title: "By court", entityId: "nope" } },
          ],
        },
        {
          title: "Gone",
          columns: 1,
          items: [{ component: "table", props: { entityId: "booking", fieldIds: ["missing"] } }],
        },
      ],
    });
    const view = keepValidParts(blueprint, {
      id: OVERVIEW_VIEW_ID,
      name: "Overview",
      entityId: "",
      type: "layout",
      sections: parsed.sections,
    });
    expect(view.sections.map((s) => s.title)).toEqual(["Today"]);
    expect(view.sections[0].items.map((i) => i.props.title ?? i.component)).toEqual(["Bookings", "widget"]);
    // The court template's Overview already has its cards: they stay what the page opens on, the layout joins as a tab.
    const next = placeOverview(blueprint, view);
    const overview = next.systems.find((s) => s.id === "overview");
    expect(overview?.viewIds.at(-1)).toBe(OVERVIEW_VIEW_ID);
    expect(next.views.find((v) => v.id === OVERVIEW_VIEW_ID)?.name).toBe("Insights");
    expect(overview?.widgetIds).toEqual(blueprint.systems.find((s) => s.id === "overview")?.widgetIds);
    expect(validateBlueprint(next)).toEqual([]);
  });
});

describe("public layouts with PR 59's booking pages", () => {
  it("sends visitors to a form's own booking page: buttons link there and the form part becomes a button", () => {
    const { blueprint, records } = sample();
    const form = blueprint.views.find((v) => v.id === "new_booking");
    if (form?.type !== "form") throw new Error("no form");
    form.public = true;
    form.page = "book_online";
    blueprint.views.push({
      id: "book_online",
      name: "Book online",
      entityId: "",
      type: "html",
      public: true,
      html: "<p>Book</p>",
    });
    withLayout(blueprint, [
      {
        columns: 2,
        items: [
          { component: "button", props: { label: "Book a court", viewId: "new_booking" } },
          { component: "form", props: { viewId: "new_booking", title: "Reserve" } },
        ],
      },
    ]);
    expect(validateBlueprint(blueprint)).toEqual([]);
    const items =
      resolvePage(blueprint, records, {}, "court-house", "stats", now)?.layout?.sections[0].items ?? [];
    expect(items.map((i) => [i.component, i.data.href])).toEqual([
      ["button", "/s/court-house/book_online"],
      ["button", "/s/court-house/book_online"],
    ]);
  });
});

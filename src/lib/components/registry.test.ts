import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { LayoutView } from "@/lib/blueprint/types";
import { validateBlueprint } from "@/lib/blueprint/validate";
import { courtBookingsSample } from "@/lib/catalog/court-bookings";
import { applyOps } from "@/lib/engine/changes";
import { toDesignOps } from "@/server/ai/assistant";
import { COMPONENT_USE, COMPONENTS, catalogText, parseLayout } from "./registry";

const sample = () => courtBookingsSample(new Date("2026-10-15T09:00:00+08:00"));

/** A layout the way Gemini writes one: loose names, settings beside the component, no ids. */
const written = {
  sections: [
    {
      title: "Today",
      columns: 3,
      items: [
        {
          component: "section_cards",
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
        {
          component: "bar chart",
          props: { title: "By court", entityId: "booking", groupByFieldId: "court" },
        },
        { component: "widget", props: { widgetId: "today_schedule" } },
      ],
    },
    {
      title: "Records",
      columns: 2,
      items: [
        {
          component: "tabs",
          props: {
            tabs: [
              {
                label: "Bookings",
                items: [
                  {
                    component: "data_table",
                    props: { title: "All", entityId: "booking", fieldIds: ["player", "slot", "status"] },
                  },
                ],
              },
              { label: "Schedule", items: [{ component: "view", props: { viewId: "schedule" } }] },
            ],
          },
        },
      ],
    },
  ],
};

describe("layout component library", () => {
  it("describes every component for the AI", () => {
    const text = catalogText();
    for (const c of COMPONENTS) expect(text).toContain(`- ${c.id}:`);
  });

  it("reads a layout as Gemini writes it: aliases, settings beside the component, ids and defaults filled in", () => {
    const { sections, errors } = parseLayout(JSON.stringify(written));
    expect(errors).toEqual([]);
    const [today, records] = sections;
    expect(today.items.map((i) => i.component)).toEqual(["stat_cards", "chart_bar", "widget"]);
    expect(today.items[1].props).toMatchObject({ op: "count", bucket: "day", stacked: false });
    const tabs = records.items[0].props.tabs as {
      items: { component: string; props: Record<string, unknown> }[];
    }[];
    expect(tabs[0].items[0]).toMatchObject({ component: "data_table", props: { pageSize: 10 } });
    expect(new Set(sections.flatMap((s) => s.items.map((i) => i.id))).size).toBe(4);
  });

  it("sends back unknown components, bad settings and tabs inside tabs", () => {
    const { errors } = parseLayout({
      sections: [
        {
          columns: 2,
          items: [
            { component: "spaceship" },
            { component: "stat", props: { entityId: "booking" } },
            {
              component: "tabs",
              props: { tabs: [{ label: "A", items: [{ component: "tabs", props: { tabs: [] } }] }] },
            },
          ],
        },
      ],
    });
    expect(errors.join("\n")).toMatch(/"spaceship" isn't a component/);
    expect(errors.join("\n")).toMatch(/\(stat\): title/);
    expect(errors.join("\n")).toMatch(/tabs can't hold tabs/);
  });

  it("validates what each component points at against the workspace", () => {
    const { blueprint } = sample();
    const { sections } = parseLayout(written);
    const page: LayoutView = { id: "insights", name: "Insights", entityId: "", type: "layout", sections };
    blueprint.views.push(page);
    blueprint.systems[0].viewIds.push(page.id);
    expect(validateBlueprint(blueprint)).toEqual([]);

    const broken = parseLayout({
      sections: [
        {
          columns: 2,
          items: [
            {
              component: "stat",
              props: { title: "Total", entityId: "booking", op: "sum", fieldId: "status" },
            },
            { component: "calendar", props: { entityId: "booking", dateFieldId: "player" } },
            {
              component: "table",
              props: { entityId: "booking", fieldIds: ["nope"], filter: "colour == 'red'" },
            },
            { component: "view", props: { viewId: "insights" } },
          ],
        },
      ],
    }).sections;
    page.sections = broken;
    const messages = validateBlueprint(blueprint).map((e) => e.message);
    expect(messages).toContainEqual(expect.stringMatching(/Stat needs a number or money field/));
    expect(messages).toContainEqual(expect.stringMatching(/Mini calendar needs a date/));
    expect(messages).toContainEqual(expect.stringMatching(/"nope", which isn't a field of Booking/));
    expect(messages).toContainEqual(expect.stringMatching(/colour/));
    expect(messages).toContainEqual(expect.stringMatching(/can't show itself/));
  });

  it("lets the assistant add a layout page from starter JSON, and rejects one that points at nothing", () => {
    const { blueprint } = sample();
    const raw = [
      {
        op: "add_view",
        systemId: "overview",
        view: {
          id: "insights",
          entityId: "",
          name: "Insights",
          type: "layout",
          starter: JSON.stringify(written),
        },
      },
    ] as unknown as Parameters<typeof toDesignOps>[1];
    const { ops, errors } = toDesignOps(blueprint, raw);
    expect(errors).toEqual([]);
    const next = applyOps(blueprint, ops);
    expect(next.views.find((v) => v.id === "insights")).toMatchObject({ type: "layout", entityId: "" });
    expect(validateBlueprint(next)).toEqual([]);

    const bad = toDesignOps(blueprint, [
      { ...raw[0], view: { ...(raw[0] as { view: object }).view, starter: "not json" } },
    ] as Parameters<typeof toDesignOps>[1]);
    expect(bad.errors.join()).toMatch(/isn't valid JSON/);
  });
});

describe("guidance for the AI", () => {
  it("says when to use every component", () => {
    for (const c of COMPONENTS) expect(COMPONENT_USE[c.id], c.id).toBeTruthy();
    expect(catalogText()).toContain("Use for");
  });
});

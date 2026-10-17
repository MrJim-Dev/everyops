import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { Blueprint, LayoutView, TableView } from "@/lib/blueprint/types";
import { courtBookingsSample } from "@/lib/catalog/court-bookings";
import { parseLayout } from "@/lib/components/registry";
import { widgetValue } from "@/lib/engine/aggregate";
import { compareStat } from "@/lib/engine/dashboard";
import { applyFilter } from "@/lib/engine/query";
import { resolveLayout } from "@/lib/public/layout";
import { planBlockers } from "./kit";
import { describeView, readDashboard, readView } from "./views";

const now = new Date("2026-10-15T09:00:00+08:00");
const sample = () => courtBookingsSample(now);
const view = (bp: Blueprint, id: string) => {
  const v = bp.views.find((x) => x.id === id);
  if (!v) throw new Error(`no ${id}`);
  return v;
};

function teamLayout(bp: Blueprint): LayoutView {
  const parsed = parseLayout({
    sections: [
      {
        title: "Front desk",
        columns: 2,
        items: [
          { component: "view", props: { viewId: "schedule" } },
          { component: "widget", props: { widgetId: "revenue_today" } },
          {
            component: "table",
            props: { title: "Players", entityId: "player", fieldIds: ["name", "phone"] },
          },
        ],
      },
    ],
  });
  expect(parsed.errors).toEqual([]);
  const layout: LayoutView = {
    id: "desk",
    name: "Desk",
    entityId: "",
    type: "layout",
    sections: parsed.sections,
  };
  bp.views.push(layout);
  bp.systems[0].viewIds.push(layout.id);
  return layout;
}

describe("what an agent sees of a page", () => {
  it("reads a table with its own filter and columns, a page at a time", () => {
    const { blueprint: bp, records } = sample();
    const table = view(bp, "all_bookings") as TableView;
    const booking = bp.entities.find((e) => e.id === "booking");
    if (!booking) throw new Error("no booking");
    const expected = applyFilter(bp, booking, records, table.filter, now);
    const first = readView(bp, records, {}, "court-house", table, { limit: 5, now }) as {
      total: number;
      nextOffset: number | null;
      columns: { id: string }[];
      rows: { id: string; values: Record<string, string> }[];
    };
    expect(first.total).toBe(expected.length);
    expect(first.columns.map((c) => c.id)).toEqual(table.fieldIds);
    expect(first.rows).toHaveLength(5);
    const allowed = new Set(expected.map((r) => r.id));
    expect(first.rows.every((r) => allowed.has(r.id))).toBe(true);
    // Only the table's columns, written the way the app shows them.
    expect(first.rows.every((r) => Object.keys(r.values).every((k) => table.fieldIds.includes(k)))).toBe(
      true,
    );
    expect(first.nextOffset).toBe(5);
    const last = readView(bp, records, {}, "court-house", table, { offset: expected.length - 1, now }) as {
      rows: unknown[];
      nextOffset: number | null;
    };
    expect(last.rows).toHaveLength(1);
    expect(last.nextOffset).toBeNull();
  });

  it("describes a tab's settings with the names of the fields it uses", () => {
    const { blueprint: bp } = sample();
    const d = describeView(bp, view(bp, "all_bookings"), "court-house") as {
      settings: { filter?: string; fieldIds: string[] };
      fieldNames: Record<string, string>;
      pageId: string;
    };
    expect(d.settings.filter).toBe("is_upcoming(slot)");
    expect(d.pageId).toBe("bookings");
    expect(d.fieldNames.court).toBe("Court");
  });

  it("works out a layout page for the team, including the parts a visitor never gets", () => {
    const { blueprint: bp, records } = sample();
    const layout = teamLayout(bp);
    // A visitor's version leaves out the team's own tab, its dashboard card and the players' phone numbers.
    expect(resolveLayout(bp, records, {}, "court-house", layout, now).sections).toEqual([]);
    const team = readView(bp, records, {}, "court-house", layout, { now }) as {
      sections: { items: { component: string; data: Record<string, unknown> }[] }[];
    };
    const items = team.sections[0].items;
    expect(items.map((i) => i.component)).toEqual(["view", "widget", "table"]);
    expect(items[0].data).toMatchObject({ viewId: "schedule", type: "slot_grid" });
    const card = bp.widgets.find((w) => w.id === "revenue_today");
    if (!card) throw new Error("no card");
    expect(items[1].data.value).toBe(compareStat(bp, card, records, now)?.current);
    // Rows carry their record ids, so the agent can open or change them.
    const players = new Set(records.filter((r) => r.entityId === "player").map((r) => r.id));
    const rows = items[2].data.items as { id: string }[];
    expect(items[2].data.total).toBe(players.size);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => players.has(r.id))).toBe(true);
  });

  it("gives a page's dashboard cards the numbers the cards show (this period's, when they compare)", () => {
    const { blueprint: bp, records } = sample();
    const overview = bp.systems.find((s) => s.id === "overview");
    if (!overview) throw new Error("no overview");
    const dash = readDashboard(bp, records, overview, now);
    expect(dash.cards.map((c) => c.id)).toEqual(overview.widgetIds);
    for (const c of dash.cards.filter((x) => x.type === "stat")) {
      const w = bp.widgets.find((x) => x.id === c.id);
      if (!w) throw new Error("no widget");
      const shown = compareStat(bp, w, records, now)?.current ?? widgetValue(bp, w, records, now);
      expect((c as { value: number }).value).toBe(shown);
    }
  });

  it("lists a day's bookings and slots for every court on the schedule", () => {
    const { blueprint: bp, records } = sample();
    const day = "2026-10-16";
    const out = readView(bp, records, {}, "court-house", view(bp, "schedule"), { from: day, now }) as {
      day: string;
      resources: { bookings: { start: string }[]; slots: { start: string; free: boolean }[] }[];
    };
    expect(out.day).toBe(day);
    expect(out.resources).toHaveLength(records.filter((r) => r.entityId === "court").length);
    expect(out.resources.every((r) => r.slots.length > 0)).toBe(true);
    expect(out.resources.flatMap((r) => r.bookings).every((b) => b.start.length > 0)).toBe(true);
  });
});

describe("which plans an agent may apply itself", () => {
  const all = () => true;
  const design = { ops: [{ op: "rename_workspace" as const, name: "Courts" }] };

  it("leaves team changes to a person, always", () => {
    const plan = { ops: [], teamOps: [{ op: "invite" as const, email: "a@x.ph", role: "staff" as const }] };
    expect(planBlockers(plan, { confirmDeletes: false }, all)).toHaveLength(1);
  });

  it("holds removals while the owner asks to approve them", () => {
    const plan = { ops: [{ op: "remove_view" as const, viewId: "courts_table" }] };
    expect(planBlockers(plan as never, { confirmDeletes: true }, all)).toHaveLength(1);
    expect(planBlockers(plan as never, { confirmDeletes: false }, all)).toEqual([]);
  });

  it("applies design changes only with design:apply", () => {
    expect(planBlockers(design, { confirmDeletes: true }, (p) => p !== "design:apply")).toHaveLength(1);
    expect(planBlockers(design, { confirmDeletes: true }, all)).toEqual([]);
  });
});

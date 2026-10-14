import { describe, expect, it } from "vitest";
import { validateBlueprint } from "@/lib/blueprint/validate";
import { posSample } from "@/lib/catalog/canteen-pos";
import { dashboardSystem, suggestWidgets } from "./dashboard-suggest";

describe("dashboard suggestions", () => {
  it("fills a numbers-only overview with valid charts and lists", () => {
    const bp = structuredClone(posSample(new Date("2026-10-14T06:00:00Z")).blueprint);
    const board = dashboardSystem(bp);
    if (!board) throw new Error("no overview");
    // A generated overview: just the stat cards.
    board.widgetIds = board.widgetIds.filter((id) => bp.widgets.find((w) => w.id === id)?.type === "stat");
    const extra = suggestWidgets(bp, board);
    expect(extra.map((w) => w.title)).toEqual(
      expect.arrayContaining(["Sales by day", "Sales by payment", "Top products", "Latest orders"]),
    );
    bp.widgets.push(...extra);
    board.widgetIds.push(...extra.map((w) => w.id));
    expect(validateBlueprint(bp)).toEqual([]);
  });

  it("leaves a dashboard alone once it has its charts", () => {
    const bp = posSample(new Date("2026-10-14T06:00:00Z")).blueprint;
    const board = dashboardSystem(bp);
    if (!board) throw new Error("no overview");
    const once = suggestWidgets(bp, board);
    const filled = { ...bp, widgets: [...bp.widgets, ...once] };
    const again = suggestWidgets(filled, {
      ...board,
      widgetIds: [...board.widgetIds, ...once.map((w) => w.id)],
    });
    expect(again).toEqual([]);
  });
});

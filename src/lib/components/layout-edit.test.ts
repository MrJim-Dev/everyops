import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { LayoutSection } from "@/lib/blueprint/types";
import { validateBlueprint } from "@/lib/blueprint/validate";
import { courtBookingsSample } from "@/lib/catalog/court-bookings";
import { withTemplateLayout } from "@/server/ai/overview-layout";
import { addItem, moveItem, removeSection, resizeItem, setColumns } from "./layout-edit";
import { layoutItems } from "./registry";
import { suggestParts } from "./suggest";

const now = new Date("2026-10-14T10:00:00+08:00");

const sections = (): LayoutSection[] => [
  {
    id: "a",
    columns: 2,
    items: [
      { id: "one", component: "text", props: { markdown: "1" } },
      { id: "two", component: "text", props: { markdown: "2" } },
    ],
  },
  { id: "b", columns: 3, items: [{ id: "three", component: "text", props: { markdown: "3" }, span: 3 }] },
];
const ids = (ss: LayoutSection[]) => ss.map((s) => s.items.map((i) => i.id));

describe("editing a layout", () => {
  it("moves a part within its section and across into the next one, leaving the draft it was given alone", () => {
    const before = sections();
    expect(ids(moveItem(before, { section: 0, item: 0 }, 1))).toEqual([["two", "one"], ["three"]]);
    expect(ids(moveItem(before, { section: 0, item: 1 }, 1))).toEqual([["one"], ["two", "three"]]);
    expect(ids(moveItem(before, { section: 0, item: 0 }, -1))).toEqual(ids(before));
    expect(ids(before)).toEqual([["one", "two"], ["three"]]);
  });

  it("keeps spans inside the section's columns", () => {
    expect(resizeItem(sections(), { section: 0, item: 0 }, 1)[0].items[0].span).toBe(2);
    expect(resizeItem(sections(), { section: 1, item: 0 }, 1)[1].items[0].span).toBe(3);
    expect(setColumns(sections(), 1, 2)[1].items[0].span).toBe(2);
    expect(setColumns(sections(), 1, 9)[1].columns).toBe(4);
  });

  it("gives an added part an id no other part or section has", () => {
    const next = addItem(sections(), 1, { component: "text", props: { markdown: "x" } });
    const again = addItem(next, 1, { component: "text", props: { markdown: "y" } });
    const all = again.flatMap((s) => [s.id, ...s.items.map((i) => i.id)]);
    expect(new Set(all).size).toBe(all.length);
    expect(removeSection(again, 0).map((s) => s.id)).toEqual(["b"]);
  });
});

describe("parts to add", () => {
  it("offers valid parts from the workspace's records, and the cards the Overview no longer shows", () => {
    const { blueprint } = sample();
    const bp = withTemplateLayout(blueprint);
    const page = bp.views.find((v) => v.type === "layout");
    if (page?.type !== "layout") throw new Error("no layout");
    // Remove one card from the page: it comes back as a suggestion.
    const [gone] = layoutItems(page.sections).map(({ item }) => item);
    const trimmed = {
      ...page,
      sections: page.sections.map((s) => ({ ...s, items: s.items.filter((i) => i !== gone) })),
    };
    const offered = suggestParts(bp, trimmed);
    expect(offered.some((s) => s.group === "cards" && s.item.props.widgetId === gone.props.widgetId)).toBe(
      true,
    );
    expect(offered.some((s) => s.group === "cards" && s.item.props.widgetId !== gone.props.widgetId)).toBe(
      false,
    );
    expect(offered.filter((s) => s.group === "data").length).toBeGreaterThan(3);
    // Every suggestion can be added without breaking the workspace.
    let draft = trimmed.sections;
    for (const s of offered) draft = addItem(draft, 0, s.item);
    const next = { ...bp, views: bp.views.map((v) => (v.id === page.id ? { ...page, sections: draft } : v)) };
    expect(validateBlueprint(next)).toEqual([]);
  });
});

function sample() {
  return courtBookingsSample(now);
}

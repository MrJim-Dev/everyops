import { displayKind } from "@/lib/blueprint/field-kind";
import type { Blueprint, Entity, LayoutItem, LayoutSection, LayoutView } from "@/lib/blueprint/types";
import { validateBlueprint } from "@/lib/blueprint/validate";
import { mainRecords, moneyField } from "@/lib/engine/overview-template";
import { layoutItems } from "./registry";

/**
 * Parts the owner can add to a layout page in one click, worked out from the workspace's own record types (its main
 * bookings or sales first), plus its dashboard cards the page doesn't show yet. Every suggestion is checked against
 * the blueprint, and ones the page already has are left out.
 */
export type PartSuggestion = {
  key: string;
  group: "data" | "cards" | "basics";
  label: string;
  item: Omit<LayoutItem, "id">;
};

const fieldsShown = (e: Entity, n: number) =>
  e.fields
    .filter(
      (f) =>
        f.type !== "long_text" && f.type !== "image" && !f.formula?.expr.includes("(") && f.type !== "rollup",
    )
    .slice(0, n)
    .map((f) => f.id);

export function suggestParts(bp: Blueprint, view: LayoutView): PartSuggestion[] {
  const out: PartSuggestion[] = [];
  const add = (
    key: string,
    label: string,
    component: string,
    props: Record<string, unknown>,
    group: PartSuggestion["group"] = "data",
    span?: number,
  ) => out.push({ key, group, label, item: { component, props, ...(span ? { span } : {}) } });

  const main = mainRecords(bp);
  if (main) {
    const { entity, date } = main;
    const money = moneyField(entity);
    const status = entity.fields.find((f) => f.type === "status");
    const plural = entity.pluralName;
    const day = date.type === "date" || date.type === "datetime" || date.type === "time_range";
    add(
      "stats",
      `Key numbers: ${plural.toLowerCase()} today${money ? " and revenue this week" : ""}`,
      "stat_cards",
      {
        stats: [
          {
            title: `${plural} today`,
            entityId: entity.id,
            op: "count",
            ...(day ? { compare: { dateFieldId: date.id, period: "day" } } : {}),
          },
          ...(money
            ? [
                {
                  title: "Revenue this week",
                  entityId: entity.id,
                  op: "sum",
                  fieldId: money.id,
                  compare: { dateFieldId: date.id, period: "week" },
                },
              ]
            : []),
        ],
      },
    );
    if (money) {
      add("trend", "Revenue over time (7, 30 or 90 days)", "chart_interactive", {
        title: "Revenue over time",
        entityId: entity.id,
        op: "sum",
        fieldId: money.id,
        dateFieldId: date.id,
      });
      add("by_day", "Revenue by day this month", "chart_bar", {
        title: "Revenue this month",
        entityId: entity.id,
        op: "sum",
        fieldId: money.id,
        dateFieldId: date.id,
        bucket: "day",
      });
    } else
      add("by_day", `${plural} by day this month`, "chart_bar", {
        title: `${plural} this month`,
        entityId: entity.id,
        op: "count",
        dateFieldId: date.id,
        bucket: "day",
      });
    if (status)
      add("stages", `${plural} by ${status.name.toLowerCase()}`, "status_overview", {
        title: `${plural} by ${status.name.toLowerCase()}`,
        entityId: entity.id,
        statusFieldId: status.id,
      });
    const group =
      entity.fields.find((f) => f.type === "relation" && f.id === entity.booking?.resourceFieldId) ??
      entity.fields.find((f) => f.type === "relation" || f.type === "select");
    if (group) {
      add("share", `${plural} by ${group.name.toLowerCase()} (donut)`, "chart_pie", {
        title: `${plural} by ${group.name.toLowerCase()}`,
        entityId: entity.id,
        groupByFieldId: group.id,
      });
      if (money)
        add("top", `Top ${group.name.toLowerCase()} by revenue`, "leaderboard", {
          title: `Top ${group.name.toLowerCase()}`,
          entityId: entity.id,
          op: "sum",
          fieldId: money.id,
          groupByFieldId: group.id,
        });
    }
    if (day)
      add("calendar", `Calendar of ${plural.toLowerCase()}`, "calendar", {
        title: plural,
        entityId: entity.id,
        dateFieldId: date.id,
      });
    add("table", `Searchable table of ${plural.toLowerCase()}`, "data_table", {
      title: plural,
      entityId: entity.id,
      fieldIds: fieldsShown(entity, 5),
      sort: [{ fieldId: date.id, dir: "desc" }],
    });
  }
  for (const e of bp.entities.filter((x) => !x.parent && x.id !== main?.entity.id).slice(0, 5)) {
    add(`list_${e.id}`, `List of ${e.pluralName.toLowerCase()}`, "table", {
      title: e.pluralName,
      entityId: e.id,
      fieldIds: fieldsShown(e, 4),
    });
    const status = e.fields.find((f) => f.type === "status");
    if (status)
      add(`stages_${e.id}`, `${e.pluralName} by ${status.name.toLowerCase()}`, "status_overview", {
        title: `${e.pluralName} by ${status.name.toLowerCase()}`,
        entityId: e.id,
        statusFieldId: status.id,
      });
    const image = e.fields.find((f) => displayKind(bp, f) === "image");
    if (image)
      add(`pics_${e.id}`, `Pictures of ${e.pluralName.toLowerCase()}`, "carousel", {
        title: e.pluralName,
        entityId: e.id,
        imageFieldId: image.id,
      });
  }
  const placed = new Set(
    layoutItems(view.sections).flatMap(({ item }) =>
      item.component === "widget" ? [String(item.props.widgetId)] : [],
    ),
  );
  for (const w of bp.widgets.filter((x) => !placed.has(x.id)))
    add(
      `card_${w.id}`,
      w.title,
      "widget",
      { widgetId: w.id },
      "cards",
      w.type === "heatmap" || w.type === "chart" ? 2 : undefined,
    );
  add("note", "A note for the team", "text", { markdown: "Write a note for your team here." }, "basics");
  add(
    "alert",
    "A reminder",
    "alert",
    { title: "Reminder", description: "Write what the team should remember.", tone: "warning" },
    "basics",
  );

  // Already on the page (same component on the same record type and field), or not valid here: left out.
  const signature = (i: Omit<LayoutItem, "id">) =>
    [
      i.component,
      i.props.entityId,
      i.props.groupByFieldId,
      i.props.statusFieldId,
      i.props.widgetId,
      i.props.dateFieldId,
      i.props.fieldId,
    ].join("|");
  const have = new Set(layoutItems(view.sections).map(({ item }) => signature(item)));
  return out.filter((s) => {
    if (s.group === "data" && have.has(signature(s.item))) return false;
    const probe: LayoutSection = { id: "probe", columns: 2, items: [{ ...s.item, id: "probe_item" }] };
    const test = {
      ...bp,
      views: [...bp.views.filter((v) => v.id !== view.id), { ...view, public: false, sections: [probe] }],
    };
    const at = `views.${test.views.length - 1}.`;
    return !validateBlueprint(test).some((e) => e.path.startsWith(at));
  });
}

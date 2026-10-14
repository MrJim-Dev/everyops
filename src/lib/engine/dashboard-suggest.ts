import type { Blueprint, Entity, Field, System, Widget } from "@/lib/blueprint/types";
import { lowStockFieldOf, stockFieldOf } from "./register";

/**
 * Charts and lists a dashboard is missing, worked out from the blueprint. Generated workspaces often arrive with a
 * row of numbers and nothing under it; this fills the space with what the owner would look at first: sales over
 * time, how people pay, what sells, what's running low, the latest records, and where the money goes.
 */

const amountLike = /total|amount|revenue|sales|grand|net/i;
const isMoney = (f: Field) =>
  f.type === "money" ||
  (f.type === "formula" && f.formula?.resultType === "money") ||
  (f.type === "rollup" && f.rollup?.op === "sum");
const text = (f: Field) => `${f.id} ${f.name}`;

function amountOf(e: Entity): Field | undefined {
  const money = e.fields.filter(isMoney);
  return (
    money.find((f) => f.id === "total") ??
    money.find((f) => amountLike.test(text(f)) && !/cash|change|tender|paid|cost|price/i.test(text(f))) ??
    money.find((f) => !/cash|change|tender|cost/i.test(text(f)))
  );
}
const dateOf = (e: Entity) =>
  e.fields.find((f) => f.type === "datetime") ?? e.fields.find((f) => f.type === "date");
const tableOf = (bp: Blueprint, entityId: string) =>
  bp.views.find((v) => v.type === "table" && v.entityId === entityId)?.id;

export function suggestWidgets(bp: Blueprint, system: System): Widget[] {
  const existing = system.widgetIds
    .map((id) => bp.widgets.find((w) => w.id === id))
    .filter((w): w is Widget => !!w);
  if (existing.filter((w) => w.type !== "stat").length >= 3) return [];
  const taken = new Set(bp.widgets.map((w) => w.id));
  const out: Widget[] = [];
  const add = (w: Widget) => {
    if (taken.has(w.id) || out.length >= 6) return;
    // Don't repeat what the dashboard already shows: a trend over time, a breakdown by the same field, or a
    // list of the same records.
    const same = (x: Widget) =>
      x.type === w.type &&
      x.entityId === w.entityId &&
      (w.type === "list" ||
        (!!w.chart?.dateFieldId && !!x.chart?.dateFieldId && !x.chart.groupByFieldId) ||
        (!!w.chart?.groupByFieldId &&
          (x.chart?.groupByFieldId === w.chart.groupByFieldId ||
            x.chart?.splitByFieldId === w.chart.groupByFieldId)));
    if (existing.some(same)) return;
    taken.add(w.id);
    out.push(w);
  };

  const checkout = bp.views.find((v) => v.type === "checkout");
  const sale = checkout ? bp.entities.find((e) => e.id === checkout.entityId) : undefined;
  const line =
    checkout?.type === "checkout" ? bp.entities.find((e) => e.id === checkout.lineEntityId) : undefined;
  const product =
    checkout?.type === "checkout" ? bp.entities.find((e) => e.id === checkout.productEntityId) : undefined;

  // The main money record: the register's orders, else the first record type with a date and an amount.
  const main = sale ?? bp.entities.find((e) => dateOf(e) && amountOf(e) && !/expense/i.test(e.name));
  const mainDate = main && dateOf(main);
  const mainAmount = main && amountOf(main);
  if (main && mainDate && mainAmount) {
    add({
      id: `auto_${main.id}_trend`,
      title: `${sale ? "Sales" : mainAmount.name} by day`,
      entityId: main.id,
      type: "chart",
      metric: { op: "sum", fieldId: mainAmount.id },
      chart: { kind: "area", dateFieldId: mainDate.id, bucket: "day" },
      width: "two_thirds",
    });
    const how = main.fields.find(
      (f) =>
        (f.type === "select" || f.type === "relation") && /pay|method|channel|type|source/i.test(text(f)),
    );
    if (how)
      add({
        id: `auto_${main.id}_by_${how.id}`,
        title: `${sale ? "Sales" : mainAmount.name} by ${how.name.toLowerCase()}`,
        entityId: main.id,
        type: "chart",
        metric: { op: "sum", fieldId: mainAmount.id },
        chart: { kind: "donut", bucket: "day", groupByFieldId: how.id },
        width: "third",
      });
  }

  if (line && product) {
    const link = line.fields.find((f) => f.type === "relation" && f.relation?.entityId === product.id);
    const lineAmount =
      line.fields.find((f) => isMoney(f) && /total|amount|subtotal/i.test(text(f))) ??
      line.fields.find((f) => f.type === "number" && /qty|quantity/i.test(text(f)));
    if (link && lineAmount)
      add({
        id: `auto_${line.id}_top`,
        title: `Top ${product.pluralName.toLowerCase()}`,
        entityId: line.id,
        type: "chart",
        metric: { op: "sum", fieldId: lineAmount.id },
        chart: { kind: "bar", bucket: "day", groupByFieldId: link.id },
        width: "two_thirds",
      });
  }

  if (product) {
    const stock = stockFieldOf(product);
    const flag = product.fields.find(
      (f) => f.type === "formula" && f.formula?.resultType === "checkbox" && /low/i.test(text(f)),
    );
    const level = lowStockFieldOf(product);
    const filter = flag
      ? flag.id
      : stock && level
        ? `${stock.id} <= ${level.id}`
        : stock
          ? `${stock.id} <= 5`
          : undefined;
    if (stock && filter)
      add({
        id: `auto_${product.id}_low`,
        title: "Running low",
        entityId: product.id,
        type: "list",
        filter,
        metric: { op: "count" },
        list: {
          fieldIds: [stock.id, ...(level ? [level.id] : [])],
          limit: 6,
          viewId: tableOf(bp, product.id),
          sort: [{ fieldId: stock.id, dir: "asc" }],
        },
        width: "third",
      });
  }

  if (main && mainDate) {
    const shown = [mainDate.id, ...(mainAmount ? [mainAmount.id] : [])];
    add({
      id: `auto_${main.id}_recent`,
      title: `Latest ${main.pluralName.toLowerCase()}`,
      entityId: main.id,
      type: "list",
      metric: { op: "count" },
      list: {
        fieldIds: shown,
        limit: 6,
        viewId: tableOf(bp, main.id),
        sort: [{ fieldId: mainDate.id, dir: "desc" }],
      },
      width: "third",
    });
  }

  const expense = bp.entities.find((e) => /expense|cost|bill/i.test(`${e.id} ${e.name}`) && amountOf(e));
  const expenseAmount = expense && amountOf(expense);
  const expenseGroup = expense?.fields.find((f) => f.type === "select" && /categ|type/i.test(text(f)));
  if (expense && expenseAmount && expenseGroup)
    add({
      id: `auto_${expense.id}_by_${expenseGroup.id}`,
      title: `${expense.pluralName} by ${expenseGroup.name.toLowerCase()}`,
      entityId: expense.id,
      type: "chart",
      metric: { op: "sum", fieldId: expenseAmount.id },
      chart: { kind: "donut", bucket: "month", groupByFieldId: expenseGroup.id },
      width: "third",
    });

  // Anything with stages (bookings, tasks, leave) gets a count by stage.
  for (const e of bp.entities) {
    const status = e.fields.find((f) => f.type === "status");
    if (!status || e === main || out.length >= 5) continue;
    add({
      id: `auto_${e.id}_by_${status.id}`,
      title: `${e.pluralName} by ${status.name.toLowerCase()}`,
      entityId: e.id,
      type: "chart",
      metric: { op: "count" },
      chart: { kind: "donut", bucket: "day", groupByFieldId: status.id },
      width: "third",
    });
  }
  return out;
}

/** The system that holds the workspace's dashboard: the one with stat widgets, preferring one named Overview. */
export function dashboardSystem(bp: Blueprint): System | undefined {
  const withWidgets = bp.systems.filter((s) => s.widgetIds.length);
  return withWidgets.find((s) => /overview|dashboard|home/i.test(`${s.id} ${s.name}`)) ?? withWidgets[0];
}

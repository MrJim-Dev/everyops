import type { Blueprint, Entity, Field, System, Widget } from "@/lib/blueprint/types";

/**
 * The Overview every generated workspace gets, laid out like the court-bookings template (PR 17): today's count and
 * money collected with a comparison to yesterday and a sparkline, what's unpaid today, a bar chart of revenue by
 * day, today's schedule, the list of what still needs payment, and the busy-hours heatmap, on the overview layout.
 * It's built from the workspace's own main record type (its bookings, or its orders or sales), so the numbers are
 * real. Other widgets the designer put on the Overview stay below it.
 */
export function templateOverview(bp: Blueprint): void {
  const main = mainRecords(bp);
  if (!main) return;
  const { entity, date } = main;
  const field = (id?: string) => (id ? entity.fields.find((f) => f.id === id) : undefined);
  const timed = date.type === "datetime" || (date.type === "time_range" && date.range !== "dates");
  const money = moneyField(entity);
  const status = field(entity.booking?.statusFieldId) ?? entity.fields.find((f) => f.type === "status");
  const options = status?.options ?? [];
  const pick = (re: RegExp) => options.filter((o) => re.test(o.id) || re.test(o.label));
  const cancelled = pick(/cancel|void|refund|no.?show|declin|reject/i);
  const unpaid = pick(/unpaid|pending|await|verif|for.?payment|not.?paid|due|balance|deposit/i).filter(
    (o) => !cancelled.includes(o),
  );
  const paid = pick(/^(paid|fully.?paid|completed?|confirmed|done|settled|closed)$/i).filter(
    (o) => !unpaid.includes(o),
  );
  const any = (ids: { id: string }[], op: "==" | "!=") =>
    status && ids.length
      ? ids.map((o) => `${status.id} ${op} '${o.id}'`).join(op === "==" ? " || " : " && ")
      : "";
  const wrap = (x: string) => (x.includes("||") ? `(${x})` : x);
  const live = any(cancelled, "!=");
  const isPaid = any(paid, "==");
  const isUnpaid = any(unpaid, "==");
  const both = (...parts: string[]) => parts.filter(Boolean).map(wrap).join(" && ") || undefined;

  const taken = new Set(bp.widgets.map((w) => w.id));
  const id = (base: string) => {
    let out = `overview_${base}`;
    for (let n = 2; taken.has(out); n++) out = `overview_${base}_${n}`;
    taken.add(out);
    return out;
  };
  const plural = entity.pluralName;
  const resource = field(entity.booking?.resourceFieldId);
  const table = bp.views.find((v) => v.type === "table" && v.entityId === entity.id);
  const built: Widget[] = [
    {
      id: id("count_today"),
      title: `${plural} today`,
      entityId: entity.id,
      type: "stat",
      filter: both(live),
      metric: { op: "count" },
      compare: { dateFieldId: date.id, period: "day" },
      sparkline: true,
    },
  ];
  if (money)
    built.push({
      id: id("collected_today"),
      title: isPaid ? "Collected today" : "Sales today",
      entityId: entity.id,
      type: "stat",
      filter: both(isPaid || live),
      metric: { op: "sum", fieldId: money.id },
      compare: { dateFieldId: date.id, period: "day" },
      sparkline: true,
    });
  if (money && isUnpaid)
    built.push({
      id: id("unpaid_today"),
      title: "Unpaid today",
      entityId: entity.id,
      type: "stat",
      filter: both(`is_today(${date.id})`, isUnpaid),
      metric: { op: "sum", fieldId: money.id },
    });
  built.push({
    id: id("by_day"),
    title: money ? "Revenue this month" : `${plural} this month`,
    entityId: entity.id,
    type: "chart",
    filter: both(money ? isPaid || live : live),
    metric: money ? { op: "sum", fieldId: money.id } : { op: "count" },
    chart: { kind: "bar", dateFieldId: date.id, bucket: "day" },
  });
  if (timed)
    built.push({
      id: id("schedule"),
      title: "Today's schedule",
      entityId: entity.id,
      type: "agenda",
      filter: both(live),
      metric: { op: "count" },
      agenda: { dateFieldId: date.id, fieldIds: [resource?.id, status?.id].filter((x): x is string => !!x) },
    });
  if (isUnpaid)
    built.push({
      id: id("needs_payment"),
      title: "Needs payment",
      entityId: entity.id,
      type: "list",
      filter: isUnpaid,
      metric: { op: "count" },
      list: {
        fieldIds: [date.id, resource?.id, money?.id].filter((x): x is string => !!x),
        limit: 5,
        ...(table ? { viewId: table.id } : {}),
        sort: [{ fieldId: date.id, dir: "asc" }],
      },
    });
  if (timed)
    built.push({
      id: id("busy_hours"),
      title: "Busy hours",
      entityId: entity.id,
      type: "heatmap",
      filter: both(live),
      metric: { op: "count" },
      heatmap: { dateFieldId: date.id, weeks: 6 },
      width: "two_thirds",
    });

  let board = bp.systems.find((s) => /overview|dashboard/i.test(`${s.id} ${s.name}`));
  if (!board) {
    const fresh: System = {
      id: bp.systems.some((s) => s.id === "overview") ? "overview_page" : "overview",
      name: "Overview",
      icon: "gauge",
      viewIds: [],
      widgetIds: [],
    };
    bp.systems.unshift(fresh);
    board = fresh;
  }
  // What the designer put on the Overview stays below the template, unless the template already shows it.
  const covered = (w: Widget) =>
    w.type === "stat" ||
    (w.entityId === entity.id &&
      (w.type === "agenda" ||
        w.type === "heatmap" ||
        (w.type === "chart" && !!w.chart?.dateFieldId && !w.chart.groupByFieldId) ||
        (w.type === "list" && /unpaid|payment|pending|due/i.test(`${w.title} ${w.filter ?? ""}`))));
  const extras = board.widgetIds
    .map((wid) => bp.widgets.find((w) => w.id === wid))
    .filter((w): w is Widget => !!w && !covered(w))
    .slice(0, 4);
  const others = bp.systems.filter((s) => s !== board);
  const kept = new Set(extras.map((w) => w.id));
  bp.widgets = bp.widgets.filter(
    (w) =>
      kept.has(w.id) || !board.widgetIds.includes(w.id) || others.some((s) => s.widgetIds.includes(w.id)),
  );
  bp.widgets.push(...built);
  board.widgetIds = [...built.map((w) => w.id), ...extras.map((w) => w.id)];
  board.layout = "overview";
}

/** The record type the business runs on: its bookings, else its dated, priced records (orders, sales, jobs). */
export function mainRecords(bp: Blueprint): { entity: Entity; date: Field } | undefined {
  const dateOf = (e: Entity) =>
    e.fields.find((f) => f.id === e.booking?.timeFieldId) ??
    e.fields.find((f) => f.type === "time_range") ??
    e.fields.find((f) => f.type === "datetime") ??
    e.fields.find((f) => f.type === "date");
  const booking = bp.entities.find((e) => e.booking && dateOf(e));
  if (booking) return { entity: booking, date: dateOf(booking) as Field };
  const checkout = bp.views.find((v) => v.type === "checkout");
  const busy = /order|sale|reservation|appointment|job|invoice|ticket/i;
  const ranked = bp.entities
    .filter((e) => !e.parent && dateOf(e) && moneyField(e))
    .sort(
      (a, b) =>
        Number(b.id === checkout?.entityId) - Number(a.id === checkout?.entityId) ||
        Number(busy.test(b.id)) - Number(busy.test(a.id)),
    );
  const entity = ranked[0];
  return entity ? { entity, date: dateOf(entity) as Field } : undefined;
}

/** The amount a record is worth: its total when it has one, else its first money field that isn't a rate. */
export function moneyField(e: Entity): Field | undefined {
  const money = e.fields.filter(
    (f) => f.type === "money" || (f.type === "formula" && f.formula?.resultType === "money"),
  );
  return (
    money.find((f) => /total|grand|amount/i.test(`${f.id} ${f.name}`)) ??
    money.find((f) => !/rate|price|cost|unit|per/i.test(`${f.id} ${f.name}`)) ??
    money[0]
  );
}

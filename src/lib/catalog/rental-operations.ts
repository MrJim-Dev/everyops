import type { Blueprint, DataRecord, WorkspaceData } from "@/lib/blueprint/types";
import { computeAll } from "@/lib/engine/compute";
import { addDays, todayKey } from "@/lib/time";
import { f, recordFactory } from "./define";

export function rentalBlueprint(workspaceName = "Rental operations"): Blueprint {
  return {
    version: 1,
    workspaceName,
    systems: [
      {
        id: "overview",
        name: "Overview",
        icon: "gauge",
        viewIds: [],
        widgetIds: ["in_house", "arrivals", "revenue_month", "arrivals_list"],
      },
      { id: "stays", name: "Stays", icon: "key", viewIds: ["stay_calendar", "stay_table"], widgetIds: [] },
      { id: "units", name: "Units", icon: "house", viewIds: ["unit_table"], widgetIds: [] },
      { id: "guests", name: "Guests", icon: "users", viewIds: ["guest_table"], widgetIds: [] },
    ],
    entities: [
      {
        id: "unit",
        name: "Unit",
        pluralName: "Units",
        primaryFieldId: "name",
        resource: { opensAt: "00:00", closesAt: "23:59", slotMinutes: 60 },
        fields: [
          f.text("name", "Name", { required: true }),
          f.select("kind", "Type", [
            ["studio", "Studio"],
            ["one_bed", "1 bedroom"],
            ["house", "House"],
          ]),
          f.money("nightly_rate", "Nightly rate", { required: true }),
          f.rollup("stays", "Stays", { childEntityId: "stay", viaFieldId: "unit", op: "count" }),
        ],
      },
      {
        id: "guest",
        name: "Guest",
        pluralName: "Guests",
        primaryFieldId: "name",
        fields: [
          f.text("name", "Name", { required: true }),
          f.text("phone", "Phone"),
          f.text("email", "Email"),
        ],
      },
      {
        id: "stay",
        name: "Stay",
        pluralName: "Stays",
        primaryFieldId: "guest_name",
        booking: {
          resourceFieldId: "unit",
          timeFieldId: "dates",
          statusFieldId: "status",
          blockingStatuses: ["reserved", "checked_in"],
        },
        fields: [
          f.formula("guest_name", "Stay", "guest.name", "text"),
          f.relation("guest", "Guest", "guest", { required: true }),
          f.relation("unit", "Unit", "unit", { required: true }),
          f.timeRange("dates", "Dates", {
            required: true,
            range: "dates",
            description: "Check-in to check-out",
          }),
          f.status(
            "status",
            "Status",
            [
              ["reserved", "Reserved", "accent"],
              ["checked_in", "Checked in", "success"],
              ["checked_out", "Checked out", "neutral"],
              ["cancelled", "Cancelled", "neutral"],
            ],
            { required: true },
          ),
          f.formula("nights", "Nights", "days(dates) - 1", "number"),
          f.formula("amount", "Amount", "nights * unit.nightly_rate", "money", "status == 'checked_out'"),
        ],
      },
    ],
    views: [
      {
        id: "stay_calendar",
        entityId: "stay",
        name: "Calendar",
        type: "calendar",
        dateFieldId: "dates",
        titleFieldId: "guest_name",
      },
      {
        id: "stay_table",
        entityId: "stay",
        name: "List",
        type: "table",
        fieldIds: ["dates", "unit", "guest", "status", "nights", "amount"],
        sort: [{ fieldId: "dates", dir: "asc" }],
      },
      {
        id: "unit_table",
        entityId: "unit",
        name: "All units",
        type: "table",
        fieldIds: ["name", "kind", "nightly_rate", "stays"],
      },
      {
        id: "guest_table",
        entityId: "guest",
        name: "All guests",
        type: "table",
        fieldIds: ["name", "phone", "email"],
      },
    ],
    widgets: [
      {
        id: "in_house",
        title: "Guests in house",
        entityId: "stay",
        type: "stat",
        filter: "status == 'checked_in'",
        metric: { op: "count" },
      },
      {
        id: "arrivals",
        title: "Upcoming arrivals",
        entityId: "stay",
        type: "stat",
        filter: "status == 'reserved' && is_upcoming(dates)",
        metric: { op: "count" },
      },
      {
        id: "revenue_month",
        title: "Booked this month",
        entityId: "stay",
        type: "chart",
        filter: "status != 'cancelled'",
        metric: { op: "sum", fieldId: "amount" },
        chart: { kind: "bar", dateFieldId: "dates", bucket: "day" },
      },
      {
        id: "arrivals_list",
        title: "Next arrivals",
        entityId: "stay",
        type: "list",
        filter: "status == 'reserved' && is_upcoming(dates)",
        metric: { op: "count" },
        list: { fieldIds: ["dates", "unit", "amount"], limit: 5, viewId: "stay_table" },
      },
    ],
    rules: [],
  };
}

export function rentalSample(now: Date, workspaceName?: string): WorkspaceData {
  const blueprint = rentalBlueprint(workspaceName);
  const rec = recordFactory(now);
  const today = todayKey(now);
  const units = [
    ["Mabolo Studio A", "studio", 1800],
    ["Mabolo Studio B", "studio", 1800],
    ["IT Park 1BR", "one_bed", 2600],
    ["Talisay Family House", "house", 4500],
  ].map(([name, kind, rate], i) => rec("unit", `unit_${i + 1}`, { name, kind, nightly_rate: rate }));
  const guests = [
    ["Joanna Villareal", "0917 220 1846", "joanna.v@gmail.com"],
    ["Ken Watanabe", "0927 556 2011", "ken.w@outlook.com"],
    ["Ria Cabahug", "0918 902 3394", "riacabahug@gmail.com"],
    ["Paolo Ramirez", "0917 118 4420", "paolo.r@yahoo.com"],
    ["Ellen Navarro", "0905 345 1172", "ellen.navarro@gmail.com"],
    ["Sam Ortega", "0920 776 0098", "sam.ortega@gmail.com"],
  ].map(([name, phone, email], i) => rec("guest", `guest_${i + 1}`, { name, phone, email }));

  const stays: [number, number, number, number, string][] = [
    [0, 0, -3, 2, "checked_in"],
    [1, 2, -1, 3, "checked_in"],
    [2, 1, -9, -6, "checked_out"],
    [3, 3, -14, -10, "checked_out"],
    [0, 4, 3, 6, "reserved"],
    [2, 5, 1, 4, "reserved"],
    [3, 0, 5, 8, "reserved"],
    [1, 3, 6, 9, "reserved"],
    [2, 2, 8, 11, "reserved"],
  ];
  const records: DataRecord[] = [...units, ...guests];
  records.push(
    ...stays.map(([unit, guest, from, to, status], i) =>
      rec("stay", `stay_${i + 1}`, {
        unit: units[unit].id,
        guest: guests[guest].id,
        dates: { start: addDays(today, from), end: addDays(today, to) },
        status,
      }),
    ),
  );
  return { blueprint, records: computeAll(blueprint, records, now) };
}

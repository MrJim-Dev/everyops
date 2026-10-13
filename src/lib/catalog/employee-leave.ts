import type { Blueprint, DataRecord, WorkspaceData } from "@/lib/blueprint/types";
import { computeAll } from "@/lib/engine/compute";
import { addDays, todayKey } from "@/lib/time";
import { f, recordFactory } from "./define";

export function leaveBlueprint(workspaceName = "Employee leave"): Blueprint {
  return {
    version: 1,
    workspaceName,
    systems: [
      { id: "leave", name: "Leave", icon: "airplane", viewIds: ["approvals", "leave_table"], widgetIds: [] },
      { id: "people", name: "People", icon: "users", viewIds: ["people_table"], widgetIds: [] },
    ],
    entities: [
      {
        id: "employee",
        name: "Employee",
        pluralName: "People",
        primaryFieldId: "name",
        fields: [
          f.text("name", "Name", { required: true }),
          f.text("position", "Position"),
          f.select("team", "Team", [
            ["kitchen", "Kitchen"],
            ["counter", "Counter"],
            ["admin", "Admin"],
          ]),
          f.number("leave_balance", "Leave balance (days)", { required: true }),
        ],
      },
      {
        id: "leave_request",
        name: "Leave request",
        pluralName: "Leave requests",
        primaryFieldId: "employee_name",
        fields: [
          f.formula("employee_name", "Request", "employee.name", "text"),
          f.relation("employee", "Employee", "employee", { required: true }),
          f.select(
            "kind",
            "Type",
            [
              ["vacation", "Vacation"],
              ["sick", "Sick leave"],
              ["personal", "Personal"],
            ],
            { required: true },
          ),
          f.timeRange("dates", "Dates", { required: true, range: "dates" }),
          f.formula("days", "Days", "days(dates)", "number"),
          f.text("reason", "Reason"),
          f.status(
            "status",
            "Status",
            [
              ["pending", "Pending", "warning"],
              ["approved", "Approved", "success"],
              ["declined", "Declined", "neutral"],
            ],
            { required: true },
          ),
        ],
      },
    ],
    views: [
      {
        id: "approvals",
        entityId: "leave_request",
        name: "Needs review",
        type: "approval_queue",
        statusFieldId: "status",
        pending: "pending",
        approve: "approved",
        approveLabel: "Approve",
        rejectLabel: "Decline",
        reject: "declined",
        detailFieldIds: ["kind", "dates", "days", "reason"],
      },
      {
        id: "leave_table",
        entityId: "leave_request",
        name: "All requests",
        type: "table",
        fieldIds: ["employee", "kind", "dates", "days", "status"],
        sort: [{ fieldId: "dates", dir: "desc" }],
      },
      {
        id: "people_table",
        entityId: "employee",
        name: "Everyone",
        type: "table",
        fieldIds: ["name", "position", "team", "leave_balance"],
      },
    ],
    widgets: [
      {
        id: "leave_pending",
        title: "Needs attention",
        entityId: "leave_request",
        type: "list",
        filter: "status == 'pending'",
        metric: { op: "count" },
        list: { fieldIds: ["dates", "kind"], limit: 5, viewId: "approvals" },
      },
    ],
    rules: [
      {
        id: "deduct_balance",
        name: "Deduct approved leave",
        trigger: { entityId: "leave_request", event: "status_changed", fieldId: "status", to: "approved" },
        actions: [
          {
            type: "adjust_number",
            target: { kind: "relation", fieldId: "employee" },
            fieldId: "leave_balance",
            delta: "-days",
          },
          { type: "notify", message: "Approved. {{days}} days deducted from the leave balance." },
        ],
      },
    ],
  };
}

export function leaveSample(now: Date, workspaceName?: string): WorkspaceData {
  const blueprint = leaveBlueprint(workspaceName);
  const rec = recordFactory(now);
  const today = todayKey(now);
  const people = [
    ["Jun Tenedero", "Head baker", "kitchen", 8],
    ["Maricel Flores", "Pastry chef", "kitchen", 6],
    ["Rico Alcantara", "Cashier", "counter", 5],
    ["Lea Mercado", "Store manager", "admin", 10],
    ["Bea Santiago", "Counter staff", "counter", 4],
  ].map(([name, position, team, balance], i) =>
    rec("employee", `emp_${i + 1}`, { name, position, team, leave_balance: balance }),
  );
  const requests: [number, string, number, number, string, string][] = [
    [0, "vacation", 3, 4, "Family trip to Bohol", "pending"],
    [1, "sick", 6, 6, "Clinic follow-up", "pending"],
    [2, "personal", 10, 10, "Renewing passport", "pending"],
    [3, "vacation", -12, -10, "Long weekend", "approved"],
    [4, "sick", -5, -5, "Fever", "approved"],
  ];
  const records: DataRecord[] = [...people];
  records.push(
    ...requests.map(([who, kind, from, to, reason, status], i) =>
      rec("leave_request", `leave_${i + 1}`, {
        employee: people[who].id,
        kind,
        dates: { start: addDays(today, from), end: addDays(today, to) },
        reason,
        status,
      }),
    ),
  );
  return { blueprint, records: computeAll(blueprint, records, now) };
}

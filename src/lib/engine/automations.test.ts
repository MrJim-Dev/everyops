import { describe, expect, it } from "vitest";
import type { Blueprint, DataRecord, Entity, Rule } from "@/lib/blueprint/types";
import { validateBlueprint } from "@/lib/blueprint/validate";
import { f } from "@/lib/catalog/define";
import {
  describeActions,
  describeTrigger,
  dueRuns,
  MAX_DEPTH,
  parseScheduleText,
  runSaveRules,
  saveRuns,
} from "./automations";
import { createRecord, updateRecord } from "./records";

// 2026-10-15 09:30 in Manila (a Thursday).
const NOW = new Date("2026-10-15T01:30:00Z");

const player: Entity = {
  id: "players",
  name: "Player",
  pluralName: "Players",
  primaryFieldId: "name",
  fields: [f.text("name", "Name", { required: true }), f.text("email", "Email")],
};
const booking: Entity = {
  id: "bookings",
  name: "Booking",
  pluralName: "Bookings",
  primaryFieldId: "ref",
  fields: [
    f.text("ref", "Ref"),
    f.relation("player", "Player", "players"),
    f.date("date", "Date"),
    f.money("price", "Price"),
    f.status("status", "Status", [
      ["pending", "Pending"],
      ["confirmed", "Confirmed"],
      ["unpaid", "Unpaid"],
    ]),
  ],
};
const invoice: Entity = {
  id: "invoices",
  name: "Invoice",
  pluralName: "Invoices",
  primaryFieldId: "amount",
  fields: [f.money("amount", "Amount"), f.relation("booking", "Booking", "bookings"), f.text("note", "Note")],
};

const bp = (rules: Rule[]): Blueprint => ({
  version: 1,
  workspaceName: "Court House",
  systems: [],
  entities: [player, booking, invoice],
  views: [],
  widgets: [],
  rules,
});

const rec = (id: string, entityId: string, data: DataRecord["data"]): DataRecord => ({
  id,
  entityId,
  data,
  createdAt: NOW.toISOString(),
  updatedAt: NOW.toISOString(),
});
const records = [
  rec("p1", "players", { name: "Ana", email: "ana@example.com" }),
  rec("b1", "bookings", { ref: "B-1", player: "p1", date: "2026-10-16", price: 400, status: "pending" }),
  rec("b2", "bookings", { ref: "B-2", player: "p1", date: "2026-10-20", price: 600, status: "unpaid" }),
];

const confirmEmail: Rule = {
  id: "confirm_email",
  name: "Email on confirm",
  trigger: { entityId: "bookings", event: "status_changed", fieldId: "status", to: "confirmed" },
  actions: [
    {
      type: "send_email",
      to: "{{player.email}}",
      subject: "Booking {{ref}} is {{status}}",
      body: "Hi {{player.name}}, see you on {{date}}. Total {{price}}.",
    },
  ],
};
const invoiceOnConfirm: Rule = {
  id: "invoice_on_confirm",
  name: "Invoice on confirm",
  trigger: { entityId: "bookings", event: "status_changed", fieldId: "status", to: "confirmed" },
  actions: [{ type: "create_record", entityId: "invoices", values: { amount: "price", note: '"auto"' } }],
};

describe("automations on save", () => {
  it("emails through a link with labels filled in, and only for the status it waits for", () => {
    const after = { ...records[1], data: { ...records[1].data, status: "confirmed" } };
    const runs = saveRuns(bp([confirmEmail]), [{ before: records[1], after }], records, NOW);
    expect(runs).toHaveLength(1);
    expect(runs[0].emails).toEqual([
      {
        to: "ana@example.com",
        subject: "Booking B-1 is Confirmed",
        body: "Hi Ana, see you on Fri, Oct 16, 2026. Total ₱400.",
      },
    ]);
    const unpaid = { ...records[1], data: { ...records[1].data, status: "unpaid" } };
    expect(saveRuns(bp([confirmEmail]), [{ before: records[1], after: unpaid }], records, NOW)).toEqual([]);
  });

  it("does nothing when the automation is off", () => {
    const off = { ...confirmEmail, enabled: false };
    const after = { ...records[1], data: { ...records[1].data, status: "confirmed" } };
    expect(saveRuns(bp([off]), [{ before: records[1], after }], records, NOW)).toEqual([]);
    const ws = { blueprint: bp([{ ...invoiceOnConfirm, enabled: false }]), records };
    const res = updateRecord(ws, "b1", { status: "confirmed" }, NOW);
    expect(res.ok && res.data.records.filter((r) => r.entityId === "invoices")).toEqual([]);
  });

  it("adds a record linked back to the one that set it off", () => {
    const ws = { blueprint: bp([invoiceOnConfirm]), records };
    const res = updateRecord(ws, "b1", { status: "confirmed" }, NOW);
    if (!res.ok) throw new Error("update failed");
    const invoices = res.data.records.filter((r) => r.entityId === "invoices");
    expect(invoices).toHaveLength(1);
    expect(invoices[0].data).toMatchObject({ amount: 400, note: "auto", booking: "b1" });
  });

  it("stops automations that keep creating records from each other", () => {
    const loop: Rule[] = [
      {
        id: "a",
        name: "Booking makes invoice",
        trigger: { entityId: "bookings", event: "created" },
        actions: [{ type: "create_record", entityId: "invoices", values: { amount: "price" } }],
      },
      {
        id: "b",
        name: "Invoice makes booking",
        trigger: { entityId: "invoices", event: "created" },
        actions: [{ type: "create_record", entityId: "bookings", values: { price: "amount" } }],
      },
    ];
    const res = createRecord({ blueprint: bp(loop), records }, "bookings", { ref: "B-9", price: 100 }, NOW);
    if (!res.ok) throw new Error("create failed");
    const made = res.data.records.length - records.length - 1;
    expect(made).toBe(MAX_DEPTH);
    expect(res.notices.some((n) => n.includes("stopped"))).toBe(true);
  });

  it("collects emails without sending them in the browser", () => {
    const out = runSaveRules(
      bp([confirmEmail]),
      records,
      { ...records[1], data: { ...records[1].data, status: "confirmed" } },
      "updated",
      ["status"],
      NOW,
    );
    expect(out.emails).toHaveLength(1);
    expect(out.records).toBe(records);
  });
});

describe("timed automations", () => {
  const reminder: Rule = {
    id: "reminder",
    name: "Day-before reminder",
    trigger: { entityId: "bookings", event: "date_reached", fieldId: "date", offsetDays: -1, at: "09:00" },
    actions: [{ type: "send_email", to: "{{player.email}}", subject: "Tomorrow", body: "See you." }],
  };
  const chase: Rule = {
    id: "chase",
    name: "Chase unpaid",
    trigger: { entityId: "bookings", event: "schedule", schedule: { every: "day", at: "09:00" } },
    when: 'status == "unpaid"',
    actions: [{ type: "set_field", target: { kind: "self" }, fieldId: "ref", value: '"chased"' }],
  };

  it("runs a date automation on the right day once its time has come", () => {
    const due = dueRuns(bp([reminder]), records, NOW);
    expect(due.map((d) => [d.record.id, d.key])).toEqual([["b1", "reminder:b1:2026-10-16"]]);
    expect(dueRuns(bp([reminder]), records, new Date("2026-10-15T00:30:00Z"))).toEqual([]);
  });

  it("runs a schedule for every record that matches its condition", () => {
    expect(dueRuns(bp([chase]), records, NOW).map((d) => d.key)).toEqual(["chase:b2:2026-10-15"]);
    const weekly = {
      ...chase,
      trigger: { ...chase.trigger, schedule: { every: "week" as const, at: "09:00", weekday: 1 } },
    };
    expect(dueRuns(bp([weekly]), records, NOW)).toEqual([]);
    expect(dueRuns(bp([weekly]), records, NOW, { force: true })).toHaveLength(1);
  });

  it("skips automations that are off", () => {
    expect(dueRuns(bp([{ ...chase, enabled: false }]), records, NOW)).toEqual([]);
  });

  it("reads the assistant's schedule text", () => {
    expect(parseScheduleText("schedule", "daily 8:00")).toEqual({ schedule: { every: "day", at: "08:00" } });
    expect(parseScheduleText("schedule", "weekly mon 17:30")).toEqual({
      schedule: { every: "week", at: "17:30", weekday: 1 },
    });
    expect(parseScheduleText("schedule", "monthly 31 08:00")).toEqual({
      schedule: { every: "month", at: "08:00", monthDay: 28 },
    });
    expect(parseScheduleText("date_reached", "-1 09:00")).toEqual({ offsetDays: -1, at: "09:00" });
    expect(parseScheduleText("schedule", "sometimes")).toBeUndefined();
  });

  it("describes automations in plain words", () => {
    const b = bp([reminder, chase, confirmEmail]);
    expect(describeTrigger(b, reminder)).toBe("1 day before a booking's date, at 9:00 AM");
    expect(describeTrigger(b, chase)).toBe("Every day at 9:00 AM, for each booking");
    expect(describeTrigger(b, confirmEmail)).toBe("When a booking's status becomes Confirmed");
    expect(describeActions(b, confirmEmail)).toEqual([
      "Email {{player.email}}: Booking {{ref}} is {{status}}",
    ]);
  });
});

describe("validation", () => {
  it("names what a timed or email automation is missing", () => {
    const broken: Rule[] = [
      { ...confirmEmail, actions: [{ type: "send_email", to: "{{phone}}", subject: "", body: "Hi" }] },
      {
        id: "s",
        name: "No time",
        trigger: { entityId: "bookings", event: "schedule" },
        actions: confirmEmail.actions,
      },
      {
        id: "d",
        name: "Bad date",
        trigger: { entityId: "bookings", event: "date_reached", fieldId: "price" },
        actions: confirmEmail.actions,
      },
    ];
    const messages = validateBlueprint(bp(broken)).map((e) => e.message);
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.stringContaining("the email has no subject"),
        expect.stringContaining("{{phone}} isn't a field of Booking"),
        expect.stringContaining("schedule needs trigger.schedule.every"),
        expect.stringContaining("date_reached needs trigger.fieldId"),
      ]),
    );
    expect(validateBlueprint(bp([confirmEmail, invoiceOnConfirm]))).toEqual([]);
  });
});

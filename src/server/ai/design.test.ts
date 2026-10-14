import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { Blueprint } from "@/lib/blueprint/types";
import { validateBlueprint } from "@/lib/blueprint/validate";
import { courtBookingsSample } from "@/lib/catalog/court-bookings";
import { leaveBlueprint } from "@/lib/catalog/employee-leave";
import { computeAll } from "@/lib/engine/compute";
import {
  cleanCopy,
  ensurePages,
  flaggedBy,
  flattenLinks,
  givenIn,
  mergeDateAndSlot,
  pendingOnly,
  repairStructure,
  restoreDropped,
  shrunk,
  tidy,
} from "./design";

describe("ensurePages", () => {
  it("gives a record type without any screen its own page", () => {
    const { blueprint } = courtBookingsSample(new Date("2026-10-13T09:30:00+08:00"));
    // Gemini's habit: courts and players folded into the Bookings section with no screens of their own.
    const folded = structuredClone(blueprint);
    folded.systems = folded.systems.filter((s) => s.id !== "courts" && s.id !== "players");
    folded.views = folded.views.filter((v) => v.id !== "courts_table" && v.id !== "players_table");
    const fixed = ensurePages(folded);
    const pages = fixed.systems.map((s) => s.name);
    expect(pages).toEqual(["Overview", "Bookings", "Courts", "Players"]);
    expect(fixed.systems.find((s) => s.name === "Courts")?.icon).toBe("court");
    expect(validateBlueprint(fixed)).toEqual([]);
  });

  it("leaves a workspace that already has a page per record type alone", () => {
    const { blueprint } = courtBookingsSample(new Date("2026-10-13T09:30:00+08:00"));
    expect(ensurePages(structuredClone(blueprint)).systems).toEqual(blueprint.systems);
  });
});

describe("repairStructure", () => {
  it("moves a page off the app's own URLs (a lists page Gemini called Settings)", () => {
    const { blueprint } = courtBookingsSample(new Date("2026-10-13T09:30:00+08:00"));
    const bp = structuredClone(blueprint);
    bp.systems.push({
      id: "settings",
      name: "Settings",
      icon: "package",
      viewIds: [bp.views[0].id],
      widgetIds: [],
    });
    const fixed = repairStructure(bp);
    const page = fixed.systems.at(-1);
    expect(page).toMatchObject({ id: "setup", name: "Setup" });
  });
  it("drops a table grouping that can't group and points a board at the status field", () => {
    const { blueprint } = courtBookingsSample(new Date("2026-10-13T09:30:00+08:00"));
    const bp = structuredClone(blueprint);
    const table = bp.views.find((v) => v.type === "table" && v.entityId === "booking");
    const booking = bp.entities.find((e) => e.id === "booking");
    const select = booking?.fields.find((f) => f.type === "select");
    if (table?.type !== "table" || !booking || !select) throw new Error("fixture changed");
    table.groupByFieldId = booking.booking?.timeFieldId;
    bp.views.push({
      id: "board",
      type: "kanban",
      entityId: "booking",
      name: "Board",
      statusFieldId: select.id,
      cardFieldIds: [],
    });
    const fixed = repairStructure(bp);
    expect(fixed.views.find((v) => v.id === table.id)).not.toHaveProperty("groupByFieldId");
    expect(fixed.views.find((v) => v.id === "board")).toMatchObject({
      statusFieldId: booking.booking?.statusFieldId,
    });
    expect(validateBlueprint(fixed).filter((e) => /group|Board columns/.test(e.message))).toEqual([]);
  });
  it("restores booking settings, attaches add-on lines to their booking and renames a Settings page", () => {
    const { blueprint } = courtBookingsSample(new Date("2026-10-13T09:30:00+08:00"));
    const bp = structuredClone(blueprint);
    const booking = bp.entities.find((e) => e.id === "booking");
    if (!booking) throw new Error("no booking");
    delete booking.booking;
    booking.fields.push({
      id: "addons_total",
      name: "Add-ons",
      type: "rollup",
      rollup: { childEntityId: "booking_addon", viaFieldId: "booking", op: "sum", fieldId: "price" },
    });
    bp.entities.push({
      id: "booking_addon",
      name: "Add-on line",
      pluralName: "Add-on lines",
      primaryFieldId: "title",
      fields: [
        { id: "title", name: "Title", type: "text" },
        { id: "booking", name: "Booking", type: "relation", relation: { entityId: "booking" } },
        { id: "price", name: "Price", type: "money" },
      ],
    });
    bp.views.push({
      id: "addon_lines",
      entityId: "booking_addon",
      name: "All",
      type: "table",
      fieldIds: ["title"],
    });
    bp.systems.push({
      id: "lines",
      name: "Add-on lines",
      icon: "package",
      viewIds: ["addon_lines"],
      widgetIds: [],
    });
    const courts = bp.systems.find((s) => s.id === "courts");
    if (courts) courts.name = "Settings";

    const fixed = repairStructure(bp);
    expect(fixed.entities.find((e) => e.id === "booking")?.booking).toMatchObject({
      resourceFieldId: "court",
      timeFieldId: "slot",
      statusFieldId: "status",
    });
    expect(fixed.entities.find((e) => e.id === "booking_addon")?.parent).toEqual({
      entityId: "booking",
      fieldId: "booking",
    });
    expect(fixed.systems.map((s) => s.name)).not.toContain("Add-on lines");
    expect(fixed.systems.find((s) => s.id === "courts")?.name).toBe("Setup");
  });
});

describe("mergeDateAndSlot", () => {
  it("turns a booking date plus a time-slot dropdown into one time range with booking settings", () => {
    const { blueprint } = courtBookingsSample(new Date("2026-10-13T09:30:00+08:00"));
    const bp = structuredClone(blueprint);
    const booking = bp.entities.find((e) => e.id === "booking");
    const court = bp.entities.find((e) => e.id === "court");
    if (!booking || !court) throw new Error("sample changed");
    delete booking.booking;
    delete court.resource;
    bp.views = bp.views.filter((v) => v.type !== "slot_grid");
    for (const s of bp.systems) s.viewIds = s.viewIds.filter((id) => bp.views.some((v) => v.id === id));
    booking.fields = booking.fields.filter((f) => f.id !== "slot" && f.type !== "formula");
    booking.fields.push(
      { id: "booking_date", name: "Date", type: "date", required: true },
      {
        id: "time_slot",
        name: "Time slot",
        type: "select",
        options: [
          { id: "06_00", label: "6:00 AM - 7:00 AM", tone: "neutral" },
          { id: "07_00", label: "7:00 AM - 8:00 AM", tone: "neutral" },
        ],
      },
    );
    const samples = mergeDateAndSlot(bp, [
      {
        ref: "b1",
        entityId: "booking",
        values: [
          { fieldId: "booking_date", value: "2026-10-14" },
          { fieldId: "time_slot", value: "07_00" },
        ],
      },
    ]);
    const fixed = bp.entities.find((e) => e.id === "booking");
    expect(fixed?.fields.some((f) => f.id === "booking_date" || f.id === "time_slot")).toBe(false);
    expect(fixed?.booking).toMatchObject({
      resourceFieldId: "court",
      timeFieldId: "time",
      statusFieldId: "status",
    });
    expect(court.resource).toEqual({ opensAt: "06:00", closesAt: "08:00", slotMinutes: 60 });
    expect(samples[0].values).toContainEqual({ fieldId: "time", value: "2026-10-14T07:00/2026-10-14T08:00" });
    expect(bp.views.some((v) => v.type === "slot_grid" && v.entityId === "booking")).toBe(true);

    // A typed-in court fee becomes the court's rate (evening rate from 5 PM) times the hours booked.
    court.fields.push(
      { id: "day_rate", name: "Day rate", type: "money" },
      { id: "evening_rate", name: "Evening rate", type: "money" },
    );
    fixed?.fields.push({ id: "court_fee", name: "Court fee", type: "money", required: true });
    repairStructure(bp);
    expect(fixed?.fields.find((f) => f.id === "court_fee")).toMatchObject({
      type: "formula",
      formula: { expr: "(hour(time) >= 17 ? court.evening_rate : court.day_rate) * duration_hours(time)" },
    });
  });
});

describe("cleanCopy", () => {
  it("drops an emoji loop and stops long text at a sentence", () => {
    const looped = `Book your court today! Open 6 AM to 10 PM. Ready, set, smash! ${"🎉🏆✨🔥".repeat(200)}`;
    expect(cleanCopy(looped, 260)).toBe("Book your court today! Open 6 AM to 10 PM. Ready, set, smash!");
    expect(cleanCopy("A ".repeat(200), 50)?.length).toBeLessThanOrEqual(50);
  });
});

describe("tidy add-ons on forms", () => {
  const withAddOns = (form: Record<string, unknown>) => {
    const { blueprint } = courtBookingsSample(new Date("2026-10-13T09:30:00+08:00"));
    const bp = structuredClone(blueprint);
    bp.entities.push(
      {
        id: "addon",
        name: "Add-on",
        pluralName: "Add-ons",
        primaryFieldId: "name",
        fields: [
          { id: "name", name: "Name", type: "text", required: true },
          { id: "price", name: "Price", type: "money" },
          { id: "active", name: "Active", type: "checkbox" },
        ],
      },
      {
        // No parent set, as Gemini often leaves it: tidy attaches it to the booking through its relation.
        id: "booking_addon",
        name: "Booking add-on",
        pluralName: "Booking add-ons",
        primaryFieldId: "label",
        fields: [
          { id: "label", name: "Label", type: "text" },
          { id: "booking", name: "Booking", type: "relation", relation: { entityId: "booking" } },
          { id: "addon", name: "Add-on", type: "relation", relation: { entityId: "addon" } },
          { id: "qty", name: "Qty", type: "number", required: true },
        ],
      },
    );
    bp.views.push({
      id: "book",
      entityId: "booking",
      name: "Book",
      type: "form",
      fieldIds: ["court", "slot"],
      ...form,
    } as never);
    const out = tidy(bp);
    return out.views.find((v) => v.id === "book") as Extract<(typeof out.views)[number], { type: "form" }>;
  };

  it("works out where the add-ons live when a form plans an add-ons step", () => {
    const form = withAddOns({
      public: true,
      steps: [
        { title: "Pick a slot", fieldIds: ["court", "slot", "missing"] },
        { title: "Add-ons", fieldIds: [], extras: true },
      ],
    });
    expect(form.extras).toEqual({
      lineEntityId: "booking_addon",
      itemFieldId: "addon",
      quantityFieldId: "qty",
      filter: "active == true",
    });
    expect(form.steps?.[0].fieldIds).toEqual(["court", "slot"]);
  });

  it("mends near misses and drops a filter over fields the items don't have", () => {
    const form = withAddOns({
      extras: {
        lineEntityId: "Booking add-ons",
        itemFieldId: "add_on",
        quantityFieldId: "quantity",
        filter: "in_stock > 0",
      },
    });
    expect(form.extras).toEqual({
      lineEntityId: "booking_addon",
      itemFieldId: "addon",
      quantityFieldId: "qty",
    });
  });
  it("makes a public booking page ask who's booking, drop questions visitors can't answer and show how to pay", () => {
    const { blueprint } = courtBookingsSample(new Date("2026-10-13T09:30:00+08:00"));
    const bp = structuredClone(blueprint);
    const booking = bp.entities.find((e) => e.id === "booking");
    if (!booking) throw new Error("no booking");
    booking.fields.push({
      id: "booked_via",
      name: "Booked via",
      type: "select",
      required: true,
      options: [{ id: "walk_in", label: "Walk-in", tone: "neutral" }],
    });
    bp.entities.push({
      id: "payment_method",
      name: "Payment method",
      pluralName: "Payment methods",
      primaryFieldId: "label",
      fields: [
        { id: "label", name: "Label", type: "text", required: true },
        { id: "account_number", name: "Account number", type: "text" },
        { id: "qr_code", name: "QR code", type: "image" },
        { id: "active", name: "Active", type: "checkbox" },
      ],
    });
    bp.views.push({
      id: "book",
      entityId: "booking",
      name: "Book",
      type: "form",
      public: true,
      fieldIds: ["court", "slot"],
      steps: [
        { title: "Pick a slot", fieldIds: ["court"] },
        { title: "Payment", fieldIds: ["slot"] },
      ],
    } as never);
    const out = tidy(bp);
    const form = out.views.find((v) => v.id === "book");
    if (form?.type !== "form") throw new Error("no form");
    expect(form.fieldIds).toEqual(["court", "slot", "guest_name", "guest_phone"]);
    expect(form.steps?.map((s) => s.title)).toEqual(["Pick a slot", "Your details", "Payment"]);
    // The ways to pay show on the payment step, where people need them.
    expect(form.steps?.at(-1)?.blockIds).toEqual(["how_to_pay"]);
    const via = out.entities.find((e) => e.id === "booking")?.fields.find((f) => f.id === "booked_via");
    expect(via?.required).toBe(false);
    expect(form.blocks?.[0]).toMatchObject({
      type: "records",
      entityId: "payment_method",
      layout: "cards",
      filter: "active == true",
      fieldIds: ["label", "account_number", "qr_code"],
    });
  });
});

describe("givenIn", () => {
  const brief = "A coffee shop at 12 Rizal St, Iloilo City. Call 0917 222 3344. Open 8 AM to 8 PM daily.";
  it("keeps contact details the owner gave and drops invented ones", () => {
    expect(givenIn(brief, "0917-222-3344")).toBe(true);
    expect(givenIn(brief, "12 Rizal St, Iloilo City")).toBe(true);
    expect(givenIn(brief, "8 AM to 8 PM daily")).toBe(true);
    expect(givenIn(brief, "Mon-Sun: 8:00 AM - 6:00 PM")).toBe(false);
    expect(givenIn(brief, "hello@kapeilaya.ph")).toBe(false);
    expect(givenIn(brief, "0918 555 1234")).toBe(false);
  });
});

describe("pending approval cards", () => {
  const board = () => {
    const bp = leaveBlueprint();
    bp.widgets = [
      { ...bp.widgets[0], id: "a", title: "Pending approvals", filter: undefined },
      { ...bp.widgets[0], id: "b", title: "Leave requests waiting", type: "stat", filter: "" },
      { ...bp.widgets[0], id: "c", title: "Pending sick leave", filter: "kind == 'sick'" },
      { ...bp.widgets[0], id: "d", title: "Recent requests", filter: undefined },
    ];
    return bp;
  };

  it("show only what's waiting when the designer left out the filter", () => {
    const bp = board();
    pendingOnly(bp);
    expect(bp.widgets.map((w) => w.filter)).toEqual([
      "status == 'pending'",
      "status == 'pending'",
      "kind == 'sick'",
      undefined,
    ]);
    expect(validateBlueprint(bp)).toEqual([]);
  });

  it("stay as they are without an approval queue for that record type", () => {
    const bp = board();
    bp.views = bp.views.filter((v) => v.type !== "approval_queue");
    pendingOnly(bp);
    expect(bp.widgets[0].filter).toBeUndefined();
  });
});

describe("repairs that drop record types or fields", () => {
  const field = (id: string, name: string) => ({ id, name, type: "text" });
  const design = (entities: { id: string; name: string; fields: ReturnType<typeof field>[] }[]) => ({
    entities,
    samples: entities.map((e) => ({ entityId: e.id, ref: e.id, values: [] })),
  });
  const before = design([
    {
      id: "employee",
      name: "Employee",
      fields: [
        field("name", "Name"),
        field("sss_no", "SSS no."),
        field("tin", "TIN"),
        field("hired", "Hired"),
      ],
    },
    { id: "payslip", name: "Payslip", fields: [field("label", "Label"), field("net_pay", "Net pay")] },
    { id: "cash_advance", name: "Cash advance", fields: [field("label", "Label")] },
  ]);

  it("get back what nothing asked the repair to touch, in its old place", () => {
    const after = design([
      { id: "employee", name: "Employee", fields: [field("name", "Name"), field("hired", "Hired")] },
      { id: "payslip", name: "Payslip", fields: [field("label", "Label"), field("net_pay", "Net pay")] },
    ]);
    const out = restoreDropped(before, after, new Set());
    expect(out.fields).toEqual(["employee.sss_no", "employee.tin"]);
    expect(out.entities).toEqual(["cash_advance"]);
    expect(out.design.entities[0].fields.map((f) => f.id)).toEqual(["name", "sss_no", "tin", "hired"]);
    expect(out.design.samples.map((s) => s.entityId)).toEqual(["employee", "payslip", "cash_advance"]);
    expect(after.entities).toHaveLength(2);
  });

  it("stay out when a problem pointed at them, or when they were renamed", () => {
    const after = design([
      {
        id: "employee",
        name: "Employee",
        fields: [field("name", "Name"), field("tin_no", "TIN"), field("hired", "Hired")],
      },
      { id: "payslip", name: "Payslip", fields: [field("label", "Label")] },
      { id: "cash_advance", name: "Cash advance", fields: [field("label", "Label")] },
    ]);
    const bp = {
      entities: before.entities.map((e) => ({ ...e, fields: e.fields })),
    } as unknown as Blueprint;
    const flagged = flaggedBy(bp, [
      'entities.1.fields.1: Formula "gross - deductions" is invalid: "gross" is not a field on Payslip',
      "employee: sss_no must be unique",
    ]);
    expect([...flagged].sort()).toEqual(["employee", "employee.sss_no", "payslip", "payslip.net_pay"]);
    const out = restoreDropped(before, after, flagged);
    expect(out.fields).toEqual([]);
    expect(out.entities).toEqual([]);
  });
  it("get back the link or the stages a kept field lost", () => {
    const rel = {
      id: "period",
      name: "Dues period",
      type: "relation",
      relation: { entityId: "dues_period" },
    };
    const status = {
      id: "status",
      name: "Status",
      type: "status",
      options: [{ id: "unpaid", label: "Unpaid", tone: "warning" }],
    };
    type D = Parameters<typeof restoreDropped>[0];
    const old: D = { entities: [{ id: "bill", name: "Bill", fields: [rel, status] }], samples: [] };
    const repaired: D = {
      entities: [
        {
          id: "bill",
          name: "Bill",
          fields: [
            { ...rel, relation: undefined, rollup: { childEntityId: "bill", op: "sum" } },
            { ...status, options: [] },
          ],
        },
      ],
      samples: [],
    };
    const out = restoreDropped(old, repaired, new Set());
    expect(out.settings).toEqual(["bill.period", "bill.status"]);
    expect(out.design.entities[0].fields).toEqual([rel, status]);
    expect(restoreDropped(old, repaired, new Set(["bill.period"])).settings).toEqual(["bill.status"]);
  });
});

describe("repairs that return only part of the design", () => {
  const sized = (entities: number, views: number) => ({
    entities: Array.from({ length: entities }) as never[],
    views: Array.from({ length: views }) as never[],
  });
  it("are sent back when most record types or views are gone", () => {
    const before = { entities: 9, views: 14 };
    expect(shrunk(before, sized(2, 2))[0]).toMatch(
      /only part of the design \(2 of 9 record types, 2 of 14 views\)/,
    );
    expect(shrunk(before, sized(9, 6))).toHaveLength(1);
  });
  it("pass when the design keeps its size or the first attempt is being checked", () => {
    expect(shrunk({ entities: 9, views: 14 }, sized(8, 13))).toEqual([]);
    expect(shrunk(null, sized(2, 2))).toEqual([]);
  });
});

describe("formulas two links away", () => {
  const blueprint = (): Blueprint =>
    ({
      version: 1,
      workspaceName: "Realty",
      entities: [
        {
          id: "property",
          name: "Property",
          pluralName: "Properties",
          primaryFieldId: "title",
          fields: [
            { id: "title", name: "Title", type: "text" },
            { id: "price", name: "Price", type: "money" },
          ],
        },
        {
          id: "deal",
          name: "Deal",
          pluralName: "Deals",
          primaryFieldId: "name",
          fields: [
            { id: "name", name: "Name", type: "text" },
            { id: "property", name: "Property", type: "relation", relation: { entityId: "property" } },
          ],
        },
        {
          id: "commission",
          name: "Commission",
          pluralName: "Commissions",
          primaryFieldId: "label",
          fields: [
            { id: "label", name: "Label", type: "text" },
            { id: "deal", name: "Deal", type: "relation", relation: { entityId: "deal" } },
            {
              id: "amount",
              name: "Amount",
              type: "formula",
              formula: { expr: "deal.property.price * 0.03", resultType: "money" },
            },
            {
              id: "note",
              name: "Note",
              type: "formula",
              formula: { expr: "'see a.b.c' + deal.property.title", resultType: "text" },
            },
          ],
        },
      ],
      views: [],
      widgets: [],
      rules: [],
      systems: [],
    }) as unknown as Blueprint;

  it("read through a one-link copy on the record in between, and compute", () => {
    const bp = flattenLinks(blueprint());
    const commission = bp.entities[2].fields;
    expect(commission.find((f) => f.id === "amount")?.formula?.expr).toBe("deal.property_price * 0.03");
    expect(commission.find((f) => f.id === "note")?.formula?.expr).toBe("'see a.b.c' + deal.property_title");
    expect(bp.entities[1].fields.find((f) => f.id === "property_price")).toMatchObject({
      type: "formula",
      formula: { expr: "property.price", resultType: "money" },
    });
    expect(validateBlueprint(bp).filter((e) => /Formula|resolve/.test(e.message))).toEqual([]);
    const at = "2026-10-14T00:00:00.000Z";
    const rec = (id: string, entityId: string, data: Record<string, unknown>) =>
      ({ id, entityId, data, createdAt: at, updatedAt: at }) as never;
    const records = computeAll(bp, [
      rec("p1", "property", { title: "Lot 4", price: 2_000_000 }),
      rec("d1", "deal", { name: "Santos", property: "p1" }),
      rec("c1", "commission", { label: "Santos", deal: "d1" }),
    ]);
    expect(records.find((r) => r.id === "c1")?.data.amount).toBe(60_000);
  });
});

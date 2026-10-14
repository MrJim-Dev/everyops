import { describe, expect, it } from "vitest";
import { bookingSteps, buildBookingWorkspace, suggestedAnswers } from "@/lib/assistant/interview";
import { planChange } from "@/lib/assistant/planner";
import { validateBlueprint } from "@/lib/blueprint/validate";
import { CATALOG } from "@/lib/catalog";
import { posSample } from "@/lib/catalog/canteen-pos";
import { courtBookingsSample } from "@/lib/catalog/court-bookings";
import { DEMO_WORKSPACES } from "@/lib/catalog/demo-workspaces";
import { addDays, at, todayKey } from "@/lib/time";
import { applyOps, commitChange, computeImpact, revertChange } from "./changes";
import { evaluate, parseExpr } from "./expr";
import { createRecord, createWithLines } from "./records";

const NOW = new Date("2026-10-13T09:30:00+08:00");
function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected a value");
  return value;
}
const ctx = (data: Record<string, unknown>) => ({
  now: NOW,
  get: (path: string[]) => (data as Record<string, never>)[path.join(".")],
});
const calc = (src: string, data: Record<string, unknown> = {}) => {
  const parsed = parseExpr(src);
  if (!parsed.ok) throw new Error(parsed.error);
  return evaluate(parsed.ast, ctx(data));
};

describe("formula language", () => {
  it("follows precedence and ternaries", () => {
    expect(calc("2 + 3 * 4")).toBe(14);
    expect(calc("(2 + 3) * 4")).toBe(20);
    expect(calc("rate > 450 ? 'peak' : 'standard'", { rate: 520 })).toBe("peak");
    expect(calc("!(a && b) || c", { a: true, b: true, c: false })).toBe(false);
  });

  it("reads one relation hop and Manila hours", () => {
    const slot = { start: at("2026-10-13", "18:00"), end: at("2026-10-13", "19:30") };
    expect(calc("hour(slot)", { slot })).toBe(18);
    expect(calc("duration_hours(slot)", { slot })).toBe(1.5);
    expect(calc("player.member ? 0.9 : 1", { "player.member": true })).toBe(0.9);
  });

  it("rejects unknown functions and broken input", () => {
    expect(parseExpr("eval(1)").ok).toBe(false);
    expect(parseExpr("1 +").ok).toBe(false);
    expect(parseExpr("constructor.prototype").ok).toBe(true); // a field ref, never a JS property
    expect(calc("constructor.prototype")).toBeNull();
  });
});

describe("blueprints", () => {
  it("every catalog system and demo workspace is valid", () => {
    for (const system of CATALOG)
      expect(validateBlueprint(system.sample(NOW).blueprint), system.id).toEqual([]);
    for (const demo of DEMO_WORKSPACES)
      expect(validateBlueprint(demo.build(NOW).blueprint), demo.slug).toEqual([]);
  });

  it("the setup interview produces a valid booking system", () => {
    const answers = { ...suggestedAnswers(bookingSteps("pickleball")), peak: "yes", payment: "deposit" };
    const data = buildBookingWorkspace(answers, NOW);
    expect(validateBlueprint(data.blueprint)).toEqual([]);
    expect(data.records.filter((r) => r.entityId === "resource")).toHaveLength(4);
  });
});

describe("bookings", () => {
  it("blocks double booking on the same court", () => {
    const ws = courtBookingsSample(NOW);
    const taken = must(
      ws.records.find(
        (r) =>
          r.entityId === "booking" &&
          r.data.status !== "cancelled" &&
          r.data.court === "court_2" &&
          (r.data.slot as { start: string }).start.startsWith(todayKey(NOW).slice(0, 4)),
      ),
    );
    const result = createRecord(
      ws,
      "booking",
      { player: "player_3", court: "court_2", slot: taken.data.slot, status: "unpaid" },
      NOW,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].message).toMatch(/Court 2 is already booked/);
  });

  it("re-prices unpaid upcoming bookings, keeps paid ones, and undo restores", () => {
    const ws = courtBookingsSample(NOW);
    const planned = planChange(ws.blueprint, "Charge ₱520 during peak hours and give members 10% off");
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    const next = applyOps(ws.blueprint, planned.plan.ops);
    const impact = computeImpact(ws, next, NOW);
    expect(impact.errors).toEqual([]);

    const tomorrow = addDays(todayKey(NOW), 1);
    const upcomingPeak = ws.records.filter(
      (r) =>
        r.entityId === "booking" &&
        (r.data.slot as { start: string }).start >= at(tomorrow, "09:00") &&
        [17, 18, 19, 20, 21].includes(new Date((r.data.slot as { start: string }).start).getUTCHours() + 8),
    );
    const committed = commitChange(ws, next, NOW).data;
    for (const before of upcomingPeak) {
      const after = must(committed.records.find((r) => r.id === before.id));
      if (before.data.status === "paid") expect(after.data.amount).toBe(before.data.amount);
      if (before.data.status === "unpaid") expect(after.data.amount).toBe(520);
    }
    const reverted = revertChange(committed, ws.blueprint, commitChange(ws, next, NOW).changes, NOW);
    expect(reverted.records.map((r) => r.data.amount)).toEqual(ws.records.map((r) => r.data.amount));
  });
});

describe("required fields a form doesn't ask", () => {
  it("stay empty for staff to fill in later, and are still required everywhere else", () => {
    const data = structuredClone(courtBookingsSample(new Date("2026-10-13T09:30:00+08:00")));
    const booking = data.blueprint.entities.find((e) => e.id === "booking");
    const player = booking?.fields.find((f) => f.type === "relation" && f.relation?.entityId === "player");
    const court = data.records.find((r) => r.entityId === "court");
    if (!booking?.booking || !player || !court) throw new Error("fixture changed");
    player.required = true;
    const input = {
      [booking.booking.resourceFieldId]: court.id,
      [booking.booking.timeFieldId]: { start: "2026-10-20T10:00:00.000Z", end: "2026-10-20T11:00:00.000Z" },
      [booking.booking.statusFieldId]: "unpaid",
    };
    const strict = createRecord(data, "booking", input);
    expect(strict.ok).toBe(false);
    if (!strict.ok) expect(strict.errors.map((e) => e.fieldId)).toContain(player.id);
    const visitor = createRecord(data, "booking", input, new Date(), undefined, {
      notYet: new Set([player.id]),
    });
    expect(visitor.ok).toBe(true);
  });
});

describe("rules", () => {
  it("a sale deducts stock and totals the order", () => {
    const ws = posSample(NOW);
    const turon = must(ws.records.find((r) => r.data.name === "Turon"));
    const result = createWithLines(
      ws,
      "order",
      {
        code: "#9001",
        placed_at: NOW.toISOString(),
        payment: "cash",
        status: "completed",
        cash_received: 100,
      },
      "order_line",
      [{ product: turon.id, qty: 2, price: 20 }],
      NOW,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.record.data.total).toBe(40);
    expect(result.record.data.change_due).toBe(60);
    expect(must(result.data.records.find((r) => r.id === turon.id)).data.stock).toBe(
      Number(turon.data.stock) - 2,
    );
  });
});

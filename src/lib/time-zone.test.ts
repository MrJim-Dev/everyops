import { afterEach, describe, expect, it } from "vitest";
import type { Rule } from "@/lib/blueprint/types";
import { validateBlueprint } from "@/lib/blueprint/validate";
import { courtBookingsSample } from "@/lib/catalog/court-bookings";
import { dueRuns } from "@/lib/engine/automations";
import { applyOps } from "@/lib/engine/changes";
import { formatDate, formatDateTime } from "@/lib/format";
import { slotsFor } from "@/lib/public/slots";
import {
  at,
  dateKey,
  fromLocal,
  setZoneSource,
  timeZoneOf,
  toLocal,
  utcOffset,
  zone,
  zonedParts,
} from "./time";

afterEach(() => setZoneSource(() => undefined));
const onClock = (tz: string) => setZoneSource(() => tz);

describe("time zones", () => {
  it("read Manila exactly as before, and other +8 zones the same", () => {
    expect(zone()).toBe("Asia/Manila");
    expect(at("2026-10-13", "18:00")).toBe("2026-10-13T10:00:00.000Z");
    expect(at("2026-10-13", "18:00", "Asia/Singapore")).toBe("2026-10-13T10:00:00.000Z");
    expect(dateKey("2026-10-13T16:30:00.000Z")).toBe("2026-10-14");
  });

  it("follow daylight saving", () => {
    expect(at("2026-07-01", "09:00", "America/New_York")).toBe("2026-07-01T13:00:00.000Z");
    expect(at("2026-12-01", "09:00", "America/New_York")).toBe("2026-12-01T14:00:00.000Z");
    // 2:30 AM doesn't exist the night clocks jump to 3 AM; it lands just after the jump.
    expect(at("2026-03-08", "02:30", "America/New_York")).toBe("2026-03-08T07:30:00.000Z");
    expect(utcOffset("America/New_York", new Date("2026-07-01T12:00:00Z"))).toBe("-04:00");
    expect(utcOffset("Pacific/Auckland", new Date("2026-12-01T00:00:00Z"))).toBe("+13:00");
    expect(utcOffset("Asia/Kolkata")).toBe("+05:30");
  });
  it("take the first of a repeated hour when clocks go back", () => {
    // New York repeats 1:00–2:00 AM on Nov 1, 2026; 1:30 is first 05:30 UTC (still daylight time).
    expect(at("2026-11-01", "01:30", "America/New_York")).toBe("2026-11-01T05:30:00.000Z");
  });

  it("put a moment on the right day and back", () => {
    const iso = "2026-10-15T03:00:00.000Z";
    expect(dateKey(iso, "America/New_York")).toBe("2026-10-14");
    expect(dateKey(iso, "Pacific/Auckland")).toBe("2026-10-15");
    expect(zonedParts(iso, "Asia/Tokyo")).toMatchObject({ day: 15, hour: 12, weekday: 4 });
    expect(toLocal(iso, "America/Los_Angeles")).toBe("2026-10-14T20:00");
    expect(fromLocal("2026-10-14T20:00", "America/Los_Angeles")).toBe(iso);
  });

  it("are what the workspace's dates read in", () => {
    onClock("Asia/Tokyo");
    expect(formatDateTime("2026-10-13T10:00:00.000Z")).toBe("Tue, Oct 13, 7:00 PM");
    // A calendar day is the same day on every clock.
    expect(formatDate("2026-10-13")).toBe("Tue, Oct 13");
    onClock("America/New_York");
    expect(formatDate("2026-10-13")).toBe("Tue, Oct 13");
  });

  it("run schedules and booking slots on the workspace's clock", () => {
    const ws = courtBookingsSample(new Date("2026-10-13T00:00:00Z"));
    const rule: Rule = {
      id: "morning",
      name: "Morning check",
      trigger: { entityId: "court", event: "schedule", schedule: { every: "day", at: "08:00" } },
      actions: [{ type: "notify", message: "Open" }],
    };
    const bp = { ...ws.blueprint, rules: [rule], timeZone: "Asia/Tokyo" };
    // 07:30 in Tokyo (06:30 in Manila): not yet. 08:05 in Tokyo: due.
    onClock("Asia/Tokyo");
    expect(dueRuns(bp, ws.records, new Date("2026-10-13T22:30:00Z"))).toHaveLength(0);
    expect(dueRuns(bp, ws.records, new Date("2026-10-13T23:05:00Z")).length).toBeGreaterThan(0);
    // The same moment in Manila is 07:05: not due there.
    onClock("Asia/Manila");
    expect(
      dueRuns({ ...bp, timeZone: undefined }, ws.records, new Date("2026-10-13T23:05:00Z")),
    ).toHaveLength(0);

    const form = ws.blueprint.views.find((v) => v.type === "form");
    const court = ws.records.find((r) => r.entityId === "court");
    if (form?.type !== "form" || !court) throw new Error("Sample changed.");
    onClock("Asia/Tokyo");
    const slots =
      slotsFor(bp, ws.records, form, court.id, "2026-12-01", new Date("2026-10-13T00:00:00Z")) ?? [];
    // The court opens at its first hour on Tokyo's clock: 06:00 there is 21:00 UTC the day before.
    expect(toLocal(slots[0]?.start ?? "", "Asia/Tokyo").slice(0, 10)).toBe("2026-12-01");
    expect(slots[0]?.start).toBe(
      at(
        "2026-12-01",
        ws.blueprint.entities.find((e) => e.id === "court")?.resource?.opensAt ?? "06:00",
        "Asia/Tokyo",
      ),
    );
  });

  it("is a validated, undoable design change", () => {
    const { blueprint } = courtBookingsSample(new Date("2026-10-13T00:00:00Z"));
    const next = applyOps(blueprint, [{ op: "set_time_zone", timeZone: "Asia/Singapore" }]);
    expect(timeZoneOf(next)).toBe("Asia/Singapore");
    expect(timeZoneOf(blueprint)).toBe("Asia/Manila");
    expect(validateBlueprint(next)).toEqual([]);
    expect(validateBlueprint({ ...next, timeZone: "Mars/Olympus" }).map((e) => e.path)).toEqual(["timeZone"]);
  });
});

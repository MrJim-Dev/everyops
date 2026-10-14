import { describe, expect, it } from "vitest";
import { courtBookingsSample } from "@/lib/catalog/court-bookings";
import { dateKey } from "@/lib/time";
import { describeScreen, resolveGoTo, type Screen, visibleRecords } from "./screen";

const NOW = new Date("2026-10-14T03:00:00Z");
const { blueprint: bp, records } = courtBookingsSample(NOW);
const today = dateKey(NOW);
const calendar = bp.views.find((v) => v.id === "booking_calendar");
if (!calendar) throw new Error("sample has no calendar");

describe("what the person is looking at", () => {
  it("counts only the bookings on the day the calendar shows, without cancelled ones", () => {
    const screen: Screen = {
      area: "page",
      systemId: "bookings",
      viewId: "booking_calendar",
      from: today,
      to: today,
      status: "active",
    };
    const shown = visibleRecords(bp, records, calendar, screen);
    const expected = records.filter(
      (r) =>
        r.entityId === "booking" &&
        r.data.status !== "cancelled" &&
        dateKey((r.data.slot as { start: string }).start) === today,
    );
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.map((r) => r.id).sort()).toEqual(expected.map((r) => r.id).sort());
    const { text, focusIds, entityId } = describeScreen(bp, records, screen);
    expect(entityId).toBe("booking");
    expect(text).toContain(`On screen: ${expected.length} Bookings`);
    expect(new Set(focusIds)).toEqual(new Set(expected.map((r) => r.id)));
  });

  it("narrows a table by its search", () => {
    const screen: Screen = { area: "page", systemId: "players", viewId: "players_table", search: "santos" };
    const { text, focusIds } = describeScreen(bp, records, screen);
    expect(focusIds.length).toBeGreaterThan(0);
    for (const id of focusIds)
      expect(JSON.stringify(records.find((r) => r.id === id)?.data).toLowerCase()).toContain("santos");
    expect(text).toContain('search "santos"');
  });

  it("puts the open record first, with its data", () => {
    const screen: Screen = { area: "page", systemId: "courts", recordId: "booking_1" };
    const { text, focusIds } = describeScreen(bp, records, screen);
    expect(focusIds[0]).toBe("booking_1");
    expect(text).toContain("Open in the side panel: Booking");
  });

  it("describes a dashboard page by its widgets", () => {
    const { text } = describeScreen(bp, records, { area: "page", systemId: "overview" });
    expect(text).toContain("Overview (overview), a dashboard with:");
  });
});

describe("taking the person somewhere", () => {
  const here: Screen = { area: "page", systemId: "courts" };
  const ctx = { screen: here, canManage: true };

  it("matches pages and tabs by id or loose name", () => {
    expect(resolveGoTo(bp, records, { to: "page", pageId: "Courts", open: true }, ctx)).toMatchObject({
      path: "/courts",
      label: "Courts",
    });
    expect(
      resolveGoTo(bp, records, { to: "page", tabId: "booking_calendar", open: true }, ctx),
    ).toMatchObject({
      path: "/bookings/booking_calendar",
      label: "Bookings › Calendar",
    });
    expect(resolveGoTo(bp, records, { to: "page", pageId: "bookings", open: false }, ctx)).toMatchObject({
      path: "/bookings",
      open: false,
    });
  });

  it("ignores places that don't exist or the person can't open", () => {
    expect(resolveGoTo(bp, records, { to: "page", pageId: "payroll", open: true }, ctx)).toBeUndefined();
    expect(resolveGoTo(bp, records, { to: "record", recordId: "nope", open: true }, ctx)).toBeUndefined();
    expect(resolveGoTo(bp, records, { to: "none", open: true }, ctx)).toBeUndefined();
    const viewer = { screen: here, canManage: false };
    expect(resolveGoTo(bp, records, { to: "publish", open: true }, viewer)).toBeUndefined();
    expect(resolveGoTo(bp, records, { to: "ask", open: true }, viewer)).toBeUndefined();
    expect(resolveGoTo(bp, records, { to: "history", open: true }, viewer)).toMatchObject({
      path: "/history",
    });
  });

  it("opens a record on a page that lists it, staying put when the current tab already does", () => {
    const elsewhere = resolveGoTo(bp, records, { to: "record", recordId: "booking_1", open: true }, ctx);
    expect(elsewhere).toMatchObject({ path: "/bookings/all_bookings", recordId: "booking_1" });
    expect(elsewhere?.label).toMatch(/^Booking: /);
    const onCalendar = resolveGoTo(
      bp,
      records,
      { to: "record", recordId: "booking_1", open: true },
      {
        screen: { area: "page", systemId: "bookings", viewId: "booking_calendar" },
        canManage: true,
      },
    );
    expect(onCalendar?.path).toBe("/bookings/booking_calendar");
  });
});

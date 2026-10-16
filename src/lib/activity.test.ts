import { describe, expect, it } from "vitest";
import { type ActivityItem, activityCsv, describeActivity } from "./activity";

const item = (over: Partial<ActivityItem>): ActivityItem => ({
  id: 1,
  at: "2026-10-16T04:00:00.000Z",
  workspaceId: "w",
  actorType: "api_key",
  actorId: "k1",
  actorName: "Booking sync",
  keyId: "k1",
  action: "record.create",
  target: "booking",
  ids: ["booking_1"],
  count: 1,
  result: "ok",
  detail: null,
  ip: "203.0.113.4",
  userAgent: null,
  ...over,
});

describe("describeActivity", () => {
  const names = (id: string, many: boolean) => (id === "booking" ? (many ? "bookings" : "booking") : id);
  it("reads record entries with the type's name and count", () => {
    expect(describeActivity(item({}), names)).toBe("Added booking");
    expect(describeActivity(item({ action: "record.update", ids: ["a", "b"], count: 2 }), names)).toBe(
      "Changed 2 bookings",
    );
  });
  it("names a single record when it's known, and says what a refused write tried", () => {
    expect(describeActivity(item({}), names, () => "BK-1042")).toBe("Added booking BK-1042");
    expect(describeActivity(item({ result: "conflict", action: "record.update" }), names)).toBe(
      "Tried to change booking",
    );
  });
  it("says why a request was refused", () => {
    expect(describeActivity(item({ action: "api.denied", target: "w", detail: "needs records:write" }))).toBe(
      "Was refused: needs records:write",
    );
  });
});

describe("activityCsv", () => {
  it("quotes delimiters and neutralises formulas", () => {
    const csv = activityCsv([item({ actorName: '=HYPERLINK("x")', detail: "a, b\nc" })]);
    const [head, row] = csv.trim().split("\r\n");
    expect(head.split(",")).toHaveLength(11);
    expect(row).toContain(`"'=HYPERLINK(""x"")"`);
    expect(row).toContain('"a, b\nc"');
  });
});

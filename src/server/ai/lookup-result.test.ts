import { describe, expect, it } from "vitest";
import { courtBookingsBlueprint } from "@/lib/catalog/court-bookings";
import { type LookupCall, lookupProblem, lookupResult } from "./lookup-result";

const bp = courtBookingsBlueprint();
const aggregate = (result: unknown): LookupCall => ({
  name: "aggregate",
  args: {
    entityId: "booking",
    metric: "sum",
    fieldId: "amount",
    filters: [
      { fieldId: "status", op: "eq", value: "paid" },
      { fieldId: "slot", op: "gte", value: "2026-10-01" },
    ],
  },
  result,
});

describe("lookup outcomes", () => {
  it("distinguishes a skipped lookup from a timeout and a successful empty result", () => {
    expect(lookupResult(bp, [], true).status).toBe("not_needed");
    expect(lookupResult(bp, [], false).status).toBe("failed");
    const empty = lookupResult(bp, [aggregate({ value: null, records: 0 })], true);
    expect(empty.status).toBe("no_matches");
    expect(lookupProblem(empty)).toBeNull();
  });
  it("does not treat a tool error or interrupted run as a successful fact", () => {
    expect(lookupProblem(lookupResult(bp, [aggregate({ error: "database unavailable" })], true))).toContain(
      "couldn't verify",
    );
    expect(lookupResult(bp, [aggregate({ value: 500, records: 1 })], false).status).toBe("failed");
  });
  it("records the actual filter scope and matching count, with readable names", () => {
    const result = lookupResult(bp, [aggregate({ value: 24500, records: 18 })], true);
    expect(result.evidence?.queries[0]).toEqual({
      label: "Bookings · sum of Amount",
      scope: "Payment is Paid · Time from 2026-10-01",
      matched: 18,
    });
    expect(result.text).toContain('"value":24500');
  });
  it("accepts a successful retry of the same query even if its losing hedge failed", () => {
    const good = aggregate({ value: 500, records: 1 });
    const bad = aggregate({ error: "timeout" });
    expect(lookupResult(bp, [bad, good, bad], true).status).toBe("success");
    expect(lookupResult(bp, [bad, good], true).evidence?.queries).toHaveLength(1);
  });
  it("marks capped searches, grouped aggregates and linked records as incomplete", () => {
    for (const result of [
      { total: 60, shown: 2, records: [{ id: "a" }, { id: "b" }] },
      { groups: [], truncated: true },
      { record: { id: "a" }, linked: { bookings: { total: 50, records: [] } } },
    ]) {
      const found = lookupResult(
        bp,
        [{ name: "search_records", args: { entityId: "booking" }, result }],
        true,
      );
      expect(found.status).toBe("truncated");
      expect(lookupProblem(found)).toContain("narrow");
    }
  });
  it("never feeds a half-cut JSON object to the answering model", () => {
    const result = lookupResult(bp, [aggregate({ value: 500, records: 1 })], true, 10);
    expect(result.status).toBe("truncated");
    expect(result.text).not.toContain('{"');
  });
});

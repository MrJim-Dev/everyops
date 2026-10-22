import { describe, expect, it } from "vitest";
import { displayKind } from "@/lib/blueprint/field-kind";
import type { Blueprint, DataRecord, Entity } from "@/lib/blueprint/types";
import { validateBlueprint } from "@/lib/blueprint/validate";
import { f } from "@/lib/catalog/define";
import { formatDuration, formatRating, parseDuration, parseRating } from "@/lib/format";
import { formatCell } from "@/lib/public/resolve";
import { metricOf } from "./aggregate";
import { fillTemplate } from "./automations";
import { coerceValues } from "./coerce";
import { computeAll } from "./compute";
import { validateRecord } from "./records";
import { toSheet, valueText } from "./value-text";

const NOW = new Date("2026-10-15T02:00:00Z");

const job: Entity = {
  id: "job",
  name: "Job",
  pluralName: "Jobs",
  primaryFieldId: "title",
  fields: [
    f.text("title", "Title"),
    f.rating("rating", "Rating"),
    f.duration("time_spent", "Time spent"),
    f.rollup("total_time", "Total time", {
      childEntityId: "visit",
      viaFieldId: "job",
      op: "sum",
      fieldId: "length",
    }),
    f.rollup("visits", "Visits", { childEntityId: "visit", viaFieldId: "job", op: "count" }),
  ],
};
const visit: Entity = {
  id: "visit",
  name: "Visit",
  pluralName: "Visits",
  primaryFieldId: "note",
  parent: { entityId: "job", fieldId: "job" },
  fields: [f.text("note", "Note"), f.relation("job", "Job", "job"), f.duration("length", "Length")],
};
const bp: Blueprint = {
  version: 1,
  workspaceName: "Aircon Pros",
  systems: [],
  entities: [job, visit],
  views: [],
  widgets: [],
  rules: [],
};
const rec = (id: string, entityId: string, data: DataRecord["data"]): DataRecord => ({
  id,
  entityId,
  data,
  createdAt: NOW.toISOString(),
  updatedAt: NOW.toISOString(),
});
const records = computeAll(
  bp,
  [
    rec("j1", "job", { title: "Clean split unit", rating: 4, time_spent: 95 }),
    rec("v1", "visit", { note: "Survey", job: "j1", length: 30 }),
    rec("v2", "visit", { note: "Cleaning", job: "j1", length: 120 }),
  ],
  NOW,
);
const field = (e: Entity, id: string) => {
  const found = e.fields.find((x) => x.id === id);
  if (!found) throw new Error(id);
  return found;
};

describe("rating fields", () => {
  it("read and write 1 to 5 stars", () => {
    expect(formatRating(4)).toBe("★★★★☆");
    for (const t of ["4", "4/5", "4 stars", "★★★★", "★★★★☆"]) expect(parseRating(t)).toBe(4);
    for (const t of ["0", "6", "3.5", "great"]) expect(parseRating(t)).toBeNull();
  });

  it("only accept whole numbers from 1 to 5", () => {
    expect(validateRecord(bp, job, { title: "x", rating: 5 }, records)).toEqual([]);
    expect(validateRecord(bp, job, { title: "x", rating: 6 }, records)[0]?.message).toBe(
      "Rating must be 1 to 5 stars",
    );
    expect(coerceValues(bp, records, job, { rating: "★★★" })).toEqual({ data: { rating: 3 }, errors: [] });
    expect(coerceValues(bp, records, job, { rating: "ten" }).errors).toHaveLength(1);
  });
});

describe("duration fields", () => {
  it("read the usual ways of writing time, in minutes", () => {
    expect(parseDuration("90")).toBe(90);
    expect(parseDuration("1:30")).toBe(90);
    expect(parseDuration("1h 30m")).toBe(90);
    expect(parseDuration("1 hr 30 mins")).toBe(90);
    expect(parseDuration("1.5 h")).toBe(90);
    expect(parseDuration("2 hours")).toBe(120);
    expect(parseDuration("45 min")).toBe(45);
    expect(parseDuration("soon")).toBeNull();
    expect(formatDuration(90)).toBe("1 h 30 min");
    expect(formatDuration(120)).toBe("2 h");
    expect(formatDuration(45)).toBe("45 min");
  });

  it("refuse text that isn't a time", () => {
    expect(validateRecord(bp, job, { title: "x", time_spent: "soon" }, records)[0]?.message).toBe(
      "Time spent needs a length of time, like 1:30 or 45 min",
    );
    expect(coerceValues(bp, records, job, { time_spent: "2:15" }).data).toEqual({ time_spent: 135 });
  });

  it("add up as time, while counts stay numbers", () => {
    expect(displayKind(bp, field(job, "total_time"))).toBe("duration");
    expect(displayKind(bp, field(job, "visits"))).toBe("number");
    const j1 = records.find((r) => r.id === "j1");
    expect(j1?.data.total_time).toBe(150);
    expect(fillTemplate("{{total_time}} over {{visits}} visits", bp, job, j1?.data ?? {}, records, NOW)).toBe(
      "2 h 30 min over 2 visits",
    );
  });
});

describe("rating and duration everywhere else", () => {
  it("read as people expect in emails, exports and public pages", () => {
    const j1 = records.find((r) => r.id === "j1") as DataRecord;
    expect(fillTemplate("{{rating}} · {{time_spent}}", bp, job, j1.data, records, NOW)).toBe(
      "★★★★☆ · 1 h 35 min",
    );
    expect(valueText(bp, records, field(job, "rating"), 4)).toBe("4/5");
    expect(valueText(bp, records, field(job, "time_spent"), 95)).toBe("1 h 35 min");
    const sheet = toSheet(bp, records, [field(job, "rating"), field(job, "time_spent")], [j1]);
    expect(sheet.columns.map((c) => c.format)).toEqual(["number", "text"]);
    expect(sheet.rows[0]).toEqual([4, "1 h 35 min"]);
    expect(formatCell(bp, records, field(job, "rating"), 4).text).toBe("★★★★☆");
    expect(formatCell(bp, records, field(job, "time_spent"), 95).text).toBe("1 h 35 min");
  });

  it("validate, and let dashboards average ratings and total time", () => {
    // Unrated jobs don't drag the average down: 4 and 5 average 4.5, not 3.
    const rated = [rec("a", "job", { rating: 4 }), rec("b", "job", { rating: 5 }), rec("c", "job", {})];
    expect(metricOf({ metric: { op: "avg", fieldId: "rating" } }, rated)).toBe(4.5);
    expect(metricOf({ metric: { op: "sum", fieldId: "rating" } }, rated)).toBe(9);
    const withCards: Blueprint = {
      ...bp,
      widgets: [
        {
          id: "avg",
          type: "stat",
          entityId: "job",
          title: "Average rating",
          metric: { op: "avg", fieldId: "rating" },
        },
        {
          id: "hrs",
          type: "stat",
          entityId: "job",
          title: "Time spent",
          metric: { op: "sum", fieldId: "time_spent" },
        },
      ],
    };
    expect(validateBlueprint(withCards)).toEqual([]);
    const bad = {
      ...bp,
      entities: [
        { ...job, fields: [...job.fields, { ...f.timeRange("t", "T"), range: "hours" as never }] },
        visit,
      ],
    };
    expect(validateBlueprint(bad).map((e) => e.message)).toEqual([
      'T: range is "dates" or "times", not "hours"',
    ]);
  });
});

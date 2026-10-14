import { describe, expect, it } from "vitest";
import type { Blueprint, DataRecord } from "@/lib/blueprint/types";
import { samplesThisYear } from "./shift";

const bp = {
  entities: [
    {
      id: "payroll_run",
      fields: [
        { id: "name", type: "text" },
        { id: "period", type: "time_range", range: "dates" },
        { id: "pay_date", type: "date" },
      ],
    },
    {
      id: "employee",
      fields: [
        { id: "birthday", type: "date" },
        { id: "hired", type: "date" },
      ],
    },
    { id: "attendance", fields: [{ id: "time_in", type: "datetime" }] },
  ],
} as unknown as Blueprint;
const rec = (id: string, entityId: string, data: DataRecord["data"]): DataRecord => ({
  id,
  entityId,
  data,
  createdAt: "2026-10-14T03:00:00.000Z",
  updatedAt: "2026-10-14T03:00:00.000Z",
});
const now = new Date("2026-10-14T03:00:00Z");

describe("samples written in the wrong year", () => {
  const samples = [
    rec("p1", "payroll_run", { period: { start: "2023-10-01", end: "2023-10-15" }, pay_date: "2023-10-20" }),
    rec("e1", "employee", { birthday: "1990-05-12", hired: "2019-03-01" }),
    rec("a1", "attendance", { time_in: "2023-10-13T00:58:00.000Z" }),
  ];

  it("move to this year with the same month and day; birthdays and old hire dates stay", () => {
    const out = samplesThisYear(bp, samples, now);
    expect(out.fields).toBe(3);
    expect(out.records[0].data).toEqual({
      period: { start: "2026-10-01", end: "2026-10-15" },
      pay_date: "2026-10-20",
    });
    expect(out.records[1].data).toEqual({ birthday: "1990-05-12", hired: "2019-03-01" });
    expect(out.records[2].data.time_in).toBe("2026-10-13T00:58:00.000Z");
    expect(out.records[2].createdAt).toBe("2026-10-14T03:00:00.000Z");
  });

  it("stay as they are when already current, or when moving them wouldn't land near today", () => {
    const current = [
      rec("p1", "payroll_run", { pay_date: "2026-10-20" }),
      rec("p2", "payroll_run", { pay_date: "2026-09-30" }),
    ];
    expect(samplesThisYear(bp, current, now).fields).toBe(0);
    const pastOnly = [
      rec("e1", "employee", { hired: "2025-03-01" }),
      rec("e2", "employee", { hired: "2024-06-01" }),
    ];
    expect(samplesThisYear(bp, pastOnly, now).records).toEqual(pastOnly);
  });

  it("move only the fields in the wrong year when others are right", () => {
    const mixed = [
      rec("p1", "payroll_run", {
        period: { start: "2023-10-01", end: "2023-10-15" },
        pay_date: "2023-10-20",
      }),
      rec("a1", "attendance", { time_in: "2026-10-13T00:58:00.000Z" }),
      rec("e1", "employee", { birthday: "1998-11-02", hired: "2023-06-01" }),
    ];
    const out = samplesThisYear(bp, mixed, now);
    expect(out.records[0].data).toEqual({
      period: { start: "2026-10-01", end: "2026-10-15" },
      pay_date: "2026-10-20",
    });
    expect(out.records[1].data.time_in).toBe("2026-10-13T00:58:00.000Z");
    expect(out.records[2].data).toEqual({ birthday: "1998-11-02", hired: "2023-06-01" });
  });

  it("take the year written in the record's name along", () => {
    const named = [
      rec("p1", "payroll_run", { name: "Oct 1-15, 2024", pay_date: "2024-10-20" }),
      rec("p2", "payroll_run", { name: "Oct 16-31, 2024 (since 2019)", pay_date: "2024-11-05" }),
      rec("e1", "employee", { birthday: "1990-05-12" }),
    ];
    const out = samplesThisYear(bp, named, now);
    expect(out.records[0].data).toEqual({ name: "Oct 1-15, 2026", pay_date: "2026-10-20" });
    expect(out.records[1].data).toEqual({ name: "Oct 16-31, 2026 (since 2019)", pay_date: "2026-11-05" });
    expect(out.records[2]).toBe(named[2]);
  });
});

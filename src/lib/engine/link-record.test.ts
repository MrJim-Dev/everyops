import { describe, expect, it } from "vitest";
import type { Blueprint, DataRecord, Entity, Rule, WorkspaceData } from "@/lib/blueprint/types";
import { validateBlueprint } from "@/lib/blueprint/validate";
import { f } from "@/lib/catalog/define";
import { describeActions } from "./automations";
import { createRecord, updateRecord } from "./records";
import { completeAction } from "./rule-repair";

// 2026-10-15 23:30 in Manila (still the 15th), 15:30 UTC.
const NOW = new Date("2026-10-15T15:30:00Z");

const summary: Entity = {
  id: "daily_summary",
  name: "Daily Summary",
  pluralName: "Daily Summaries",
  primaryFieldId: "day",
  fields: [
    f.text("day", "Day"),
    f.date("date", "Date"),
    f.rollup("minutes", "Active minutes", {
      childEntityId: "activity_log",
      viaFieldId: "daily_summary",
      op: "sum",
      fieldId: "duration",
    }),
    f.rollup("logs", "Logs", { childEntityId: "activity_log", viaFieldId: "daily_summary", op: "count" }),
  ],
};
const log: Entity = {
  id: "activity_log",
  name: "Activity Log",
  pluralName: "Activity Logs",
  primaryFieldId: "title",
  fields: [
    f.text("title", "Title"),
    f.datetime("started", "Started"),
    f.number("duration", "Duration (min)"),
    f.status("status", "Status", [
      ["planned", "Planned"],
      ["logged", "Logged"],
    ]),
    f.relation("daily_summary", "Daily Summary", "daily_summary"),
  ],
};

const fileUnderDay: Rule = {
  id: "file_log",
  name: "File logs under their day",
  // How the designer writes "when saved as Logged": one rule, triggered on create, the status in its condition.
  trigger: { entityId: "activity_log", event: "created" },
  when: "status == 'logged'",
  actions: [
    {
      type: "link_record",
      target: { kind: "relation", fieldId: "daily_summary" },
      fieldId: "date",
      value: "started",
    },
  ],
};

const bp: Blueprint = {
  version: 1,
  workspaceName: "Daily Momentum",
  systems: [],
  entities: [summary, log],
  views: [],
  widgets: [],
  rules: [fileUnderDay],
};

const rec = (id: string, entityId: string, data: DataRecord["data"]): DataRecord => ({
  id,
  entityId,
  data,
  createdAt: NOW.toISOString(),
  updatedAt: NOW.toISOString(),
});

const add = (ws: WorkspaceData, data: DataRecord["data"]) => {
  const made = createRecord(ws, "activity_log", data, NOW);
  if (!made.ok) throw new Error(made.errors.map((e) => e.message).join("; "));
  return made;
};
const summaries = (ws: WorkspaceData) => ws.records.filter((r) => r.entityId === "daily_summary");

describe("link_record", () => {
  it("validates, and reads as what it does", () => {
    expect(validateBlueprint(bp)).toEqual([]);
    expect(describeActions(bp, fileUnderDay)).toEqual([
      "File it under the daily summary with the same date, on every save (adding one if there's none)",
    ]);
  });

  it("adds the day's summary the first time, named after its date, and its rollups count the log", () => {
    const made = add(
      { blueprint: bp, records: [] },
      {
        title: "Morning run",
        started: "2026-10-15T14:00:00Z", // 10 PM in Manila on the 15th
        duration: 40,
        status: "logged",
      },
    );
    const [day] = summaries(made.data);
    expect(day.data.date).toBe("2026-10-15");
    expect(day.data.day).toMatch(/Oct 15, 2026/);
    expect(made.record.data.daily_summary).toBe(day.id);
    expect(day.data.minutes).toBe(40);
    expect(day.data.logs).toBe(1);
  });

  it("files later logs of that day under the same summary instead of adding another", () => {
    const existing = rec("s1", "daily_summary", { day: "Oct 15", date: "2026-10-15" });
    const first = add(
      { blueprint: bp, records: [existing] },
      {
        title: "Run",
        started: "2026-10-15T00:30:00Z",
        duration: 30,
        status: "logged",
      },
    );
    const second = add(first.data, {
      title: "Reading",
      started: "2026-10-15T12:00:00Z",
      duration: 20,
      status: "logged",
    });
    expect(summaries(second.data)).toHaveLength(1);
    expect(summaries(second.data)[0].data.minutes).toBe(50);
    // Saving again changes nothing.
    const again = updateRecord(second.data, second.record.id, { duration: 25 }, NOW);
    expect(again.ok && summaries(again.data)).toHaveLength(1);
  });

  it("keeps logs filed on every save: a planned log is filed once it's logged, though the rule fires on create", () => {
    const planned = add(
      { blueprint: bp, records: [] },
      {
        title: "Study",
        started: "2026-10-16T01:00:00Z",
        duration: 60,
        status: "planned",
      },
    );
    expect(planned.record.data.daily_summary).toBeUndefined();
    const logged = updateRecord(planned.data, planned.record.id, { status: "logged" }, NOW);
    if (!logged.ok) throw new Error("not saved");
    const [day] = summaries(logged.data);
    expect(day.data.date).toBe("2026-10-16");
    expect(logged.record.data.daily_summary).toBe(day.id);
    // A changed date moves it to that day's summary.
    const moved = updateRecord(logged.data, planned.record.id, { started: "2026-10-17T01:00:00Z" }, NOW);
    if (!moved.ok) throw new Error("not saved");
    const next = summaries(moved.data).find((s) => s.data.date === "2026-10-17");
    expect(moved.record.data.daily_summary).toBe(next?.id);
    expect(summaries(moved.data).find((s) => s.id === day.id)?.data.logs).toBe(0);
  });

  it("does nothing without a value to match", () => {
    const made = add({ blueprint: bp, records: [] }, { title: "Undated", duration: 10, status: "logged" });
    expect(summaries(made.data)).toEqual([]);
  });

  it("is completed when Gemini names the record type instead of the link, or leaves the date out", () => {
    const loose = {
      type: "link_record" as const,
      target: { kind: "relation" as const, fieldId: "daily_summary" },
      fieldId: "",
      value: "started",
    };
    expect(completeAction(bp, fileUnderDay, loose)).toMatchObject({ fieldId: "date" });
    // The linked type's own field given as the value: the log's date instead.
    expect(completeAction(bp, fileUnderDay, { ...loose, fieldId: "date", value: "date_str" })).toMatchObject({
      value: "started",
    });
    expect(
      JSON.stringify(
        validateBlueprint({ ...bp, rules: [{ ...fileUnderDay, actions: [{ ...loose, value: "" }] }] }),
      ),
    ).toMatch(/link_record needs value/);
    // A fixed value would file every log under one summary.
    expect(
      JSON.stringify(
        validateBlueprint({
          ...bp,
          rules: [{ ...fileUnderDay, actions: [{ ...loose, fieldId: "date", value: "'2026-10-15'" }] }],
        }),
      ),
    ).toMatch(/must read a field of Activity Log/);
  });
});

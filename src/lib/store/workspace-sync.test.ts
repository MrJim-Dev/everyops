import { describe, expect, it } from "vitest";
import type { DataRecord } from "@/lib/blueprint/types";
import { courtBookingsSample } from "@/lib/catalog/court-bookings";
import { workspaceFrom } from "./workspace-model";
import { afterSave, baselineOf, diffWorkspace, mergeRecord, pullInto } from "./workspace-sync";

const rec = (id: string, data: DataRecord["data"], at = "2026-10-13T01:00:00.000Z"): DataRecord => ({
  id,
  entityId: "booking",
  data,
  createdAt: at,
  updatedAt: at,
});

function workspace() {
  const data = courtBookingsSample(new Date("2026-10-13T00:00:00Z"), "Court House");
  return {
    ...workspaceFrom(
      { name: "Court House", summary: "Courts", data },
      "court-house-1a2b",
      "2026-10-13T00:00:00.000Z",
    ),
    loaded: true as const,
  };
}

describe("saving a workspace as patches", () => {
  it("sends nothing when nothing changed, and only the edited record when one changed", () => {
    const ws = workspace();
    const base = baselineOf(ws);
    expect(diffWorkspace(base, ws)).toBeNull();
    const target = ws.records[3];
    const edited = {
      ...ws,
      records: ws.records.map((r) => (r.id === target.id ? { ...r, data: { ...r.data, note: "x" } } : r)),
    };
    const patch = diffWorkspace(base, edited);
    expect(patch?.records?.put.map((p) => p.record.id)).toEqual([target.id]);
    expect(patch?.records?.put[0].rev).toBe(1);
    expect(patch?.versions).toBeUndefined();
    expect(patch?.meta).toBeUndefined();
  });

  it("treats a recomputed copy with the same values as unchanged", () => {
    const ws = workspace();
    const base = baselineOf(ws);
    const copied = { ...ws, records: ws.records.map((r) => ({ ...r, data: { ...r.data } })) };
    expect(diffWorkspace(base, copied)).toBeNull();
  });

  it("sends new versions, deletions and settings, and nothing again once saved", () => {
    const ws = workspace();
    const base = baselineOf(ws);
    const gone = ws.records[0];
    const next = {
      ...ws,
      name: "Court House PH",
      versions: [...ws.versions, { ...ws.versions[0], version: 2 }],
      currentVersion: 2,
      records: ws.records.slice(1),
    };
    const patch = diffWorkspace(base, next);
    expect(patch?.versions?.map((v) => v.version)).toEqual([2]);
    expect(patch?.records?.delete).toEqual([{ id: gone.id, rev: 1 }]);
    expect(patch?.meta?.name).toBe("Court House PH");
    expect(diffWorkspace(afterSave(base, patch ?? {}, {}), next)).toBeNull();
  });

  it("creates a new workspace in one patch, and list summaries never send records", () => {
    const ws = workspace();
    const patch = diffWorkspace(undefined, ws);
    expect(patch?.create).toBe(true);
    expect(patch?.records?.put).toHaveLength(ws.records.length);
    const summary = { ...ws, loaded: false as const, records: [], versions: [], current: ws.versions[0] };
    const base = baselineOf(summary);
    expect(diffWorkspace(base, summary)).toBeNull();
    expect(diffWorkspace(base, { ...summary, name: "Renamed" })?.records).toBeUndefined();
  });
});

describe("merging with changes saved elsewhere", () => {
  it("keeps this browser's edited fields and takes the rest from the server", () => {
    const base = rec("a", { status: "pending", note: "", amount: 100 });
    const local = rec("a", { status: "paid", note: "", amount: 100 });
    const server = rec("a", { status: "pending", note: "Called", amount: 120 });
    expect(mergeRecord(base, local, server).data).toEqual({ status: "paid", note: "Called", amount: 120 });
  });

  it("adds both registers' sales to a stock count", () => {
    const base = rec("p", { stock: 14 });
    expect(mergeRecord(base, rec("p", { stock: 13 }), rec("p", { stock: 13 })).data.stock).toBe(12);
  });

  it("adds a public booking made while a staff edit was unsaved, without losing the edit", () => {
    const a = rec("a", { status: "pending" });
    const baseRecords = new Map([["a", { record: a, rev: 1 }]]);
    const local = [{ ...a, data: { status: "paid" } }];
    const booking = rec("public", { status: "pending" }, "2026-10-13T03:00:00.000Z");
    const out = pullInto(local, baseRecords, {
      changed: [{ record: booking, rev: 1 }],
      deleted: [],
      syncedAt: "2026-10-13T03:00:01.000Z",
    });
    expect(out.records.map((r) => [r.id, r.data.status])).toEqual([
      ["a", "paid"],
      ["public", "pending"],
    ]);
    expect(out.added).toEqual(["public"]);
  });

  it("skips its own saves and drops records deleted elsewhere", () => {
    const a = rec("a", { n: 1 });
    const b = rec("b", { n: 2 });
    const baseRecords = new Map([
      ["a", { record: a, rev: 2 }],
      ["b", { record: b, rev: 1 }],
    ]);
    const out = pullInto([a, b], baseRecords, {
      changed: [{ record: a, rev: 2 }],
      deleted: ["b"],
      syncedAt: "x",
    });
    expect(out.records.map((r) => r.id)).toEqual(["a"]);
    expect(out.baseRecords.has("b")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { validateBlueprint } from "@/lib/blueprint/validate";
import { posSample } from "@/lib/catalog/canteen-pos";
import { courtBookingsSample } from "@/lib/catalog/court-bookings";
import type { ChangePlan } from "@/lib/engine/changes";
import { applyPlan, canRedo, redoPlan, revertChanges, undoPlan } from "./apply-plan";
import { blueprintOf, mergeStaffChanges, type Workspace, workspaceFrom } from "./workspace-model";

const NOW = new Date("2026-10-14T03:00:00Z");
const court = () => {
  const ws = workspaceFrom(
    { name: "Court House", summary: "", data: courtBookingsSample(NOW) },
    "court-house",
    NOW.toISOString(),
  );
  return {
    ...ws,
    docs: { notes: { body: "Old text", updatedAt: NOW.toISOString() } },
    members: [
      {
        accountId: "u1",
        name: "Ana",
        email: "ana@example.com",
        role: "staff" as const,
        joinedAt: NOW.toISOString(),
      },
    ],
    invites: [],
  } satisfies Workspace;
};
const plan = (p: Partial<ChangePlan>): ChangePlan => ({
  request: "test",
  title: "Test",
  facts: [],
  steps: [],
  ops: [],
  ...p,
});
const sameData = (a: Workspace, b: Workspace) => {
  const sort = (w: Workspace) => [...w.records].sort((x, y) => x.id.localeCompare(y.id));
  expect(sort(a).map((r) => [r.id, r.data])).toEqual(sort(b).map((r) => [r.id, r.data]));
  expect(blueprintOf(a)).toEqual(blueprintOf(b));
};

describe("every assistant change can be undone", () => {
  it("a design change undone by mistake can be redone, and undone again", () => {
    const before = court();
    const { workspace, entry } = applyPlan(
      before,
      plan({ ops: [{ op: "remove_entity", entityId: "player" }] }),
      { now: NOW },
    );
    const undone = undoPlan(workspace, entry.id, NOW) as Workspace;
    expect(canRedo(undone, entry.id)).toBe(true);
    const redone = redoPlan(undone, entry.id, NOW) as Workspace;
    sameData(redone, workspace);
    expect(redone.changes[0].undoneAt).toBeUndefined();
    sameData(undoPlan(redone, entry.id, NOW) as Workspace, before);
  });

  it("a change that edited records can't be redone", () => {
    const before = workspaceFrom(
      { name: "Canteen", summary: "", data: posSample(NOW) },
      "canteen",
      NOW.toISOString(),
    );
    const order = before.records.find((r) => r.entityId === "order");
    if (!order) throw new Error("no order");
    const { workspace, entry } = applyPlan(
      before,
      plan({ recordOps: [{ op: "delete_record", recordId: order.id }] }),
      {
        now: NOW,
      },
    );
    expect(canRedo(undoPlan(workspace, entry.id, NOW) as Workspace, entry.id)).toBe(false);
  });

  it("removing a record type takes its records, pages and links, and undo brings all of it back", () => {
    const before = court();
    const { workspace, entry } = applyPlan(
      before,
      plan({ ops: [{ op: "remove_entity", entityId: "player" }] }),
      { now: NOW },
    );
    const bp = blueprintOf(workspace);
    expect(bp.entities.some((e) => e.id === "player")).toBe(false);
    expect(bp.systems.some((s) => s.id === "players")).toBe(false);
    expect(
      bp.entities.find((e) => e.id === "booking")?.fields.some((f) => f.relation?.entityId === "player"),
    ).toBe(false);
    expect(validateBlueprint(bp)).toEqual([]);
    expect(workspace.records.some((r) => r.entityId === "player")).toBe(false);
    expect(entry.removedRecords?.length).toBe(before.records.filter((r) => r.entityId === "player").length);
    const undone = undoPlan(workspace, entry.id, NOW);
    expect(undone).not.toBeNull();
    sameData(undone as Workspace, before);
  });

  it("deleting a record also deletes its line items, and undo restores both", () => {
    const sample = posSample(NOW);
    const before = workspaceFrom(
      { name: "Canteen", summary: "", data: sample },
      "canteen",
      NOW.toISOString(),
    );
    const order = before.records.find(
      (r) => r.entityId === "order" && before.records.some((l) => l.data.order === r.id),
    );
    if (!order) throw new Error("sample has no order with lines");
    const lines = before.records.filter((r) => r.data.order === order.id);
    const { workspace, entry } = applyPlan(
      before,
      plan({ recordOps: [{ op: "delete_record", recordId: order.id }] }),
      { now: NOW },
    );
    expect(workspace.records.some((r) => r.id === order.id || r.data.order === order.id)).toBe(false);
    expect(entry.removedRecords?.map((r) => r.id).sort()).toEqual(
      [order.id, ...lines.map((l) => l.id)].sort(),
    );
    sameData(undoPlan(workspace, entry.id, NOW) as Workspace, before);
  });

  it("removing a field hides it everywhere and undo shows its values again", () => {
    const before = court();
    const { workspace, entry } = applyPlan(
      before,
      plan({ ops: [{ op: "remove_field", entityId: "booking", fieldId: "method" }] }),
      { now: NOW },
    );
    const bp = blueprintOf(workspace);
    expect(bp.views.flatMap((v) => (v.type === "table" ? v.fieldIds : []))).not.toContain("method");
    expect(validateBlueprint(bp)).toEqual([]);
    sameData(undoPlan(workspace, entry.id, NOW) as Workspace, before);
  });

  it("removes and reorders pages, tabs and cards, and undo restores the design", () => {
    const before = court();
    const card = blueprintOf(before).widgets[0].id;
    const { workspace, entry } = applyPlan(
      before,
      plan({
        ops: [
          { op: "remove_view", viewId: "booking_calendar" },
          { op: "remove_widget", widgetId: card },
          { op: "move_system", systemId: "players", index: 0 },
          { op: "remove_system", systemId: "courts" },
        ],
      }),
      { now: NOW },
    );
    const bp = blueprintOf(workspace);
    expect(bp.systems.map((s) => s.id)).toEqual(["players", "overview", "bookings"]);
    expect(bp.views.some((v) => v.id === "booking_calendar" || v.id === "courts_table")).toBe(false);
    expect(bp.widgets.some((w) => w.id === card)).toBe(false);
    expect(validateBlueprint(bp)).toEqual([]);
    sameData(undoPlan(workspace, entry.id, NOW) as Workspace, before);
  });

  it("groups pages in the sidebar, and undo lists them on their own again", () => {
    const before = court();
    const { workspace, entry } = applyPlan(
      before,
      plan({
        ops: [
          { op: "group_system", systemId: "players", group: " Front desk " },
          { op: "group_system", systemId: "courts", group: "Front desk" },
          { op: "group_system", systemId: "bookings", group: "" },
        ],
      }),
      { now: NOW },
    );
    const bp = blueprintOf(workspace);
    expect(bp.systems.map((s) => [s.id, s.group])).toEqual([
      ["overview", undefined],
      ["bookings", undefined],
      ["courts", "Front desk"],
      ["players", "Front desk"],
    ]);
    expect(validateBlueprint(bp)).toEqual([]);
    const undone = blueprintOf(undoPlan(workspace, entry.id, NOW) as Workspace);
    expect(undone.systems.every((s) => s.group === undefined)).toBe(true);
  });

  it("restores page text and the team on undo", () => {
    const before = court();
    const { workspace, entry } = applyPlan(
      before,
      plan({
        docOps: [
          { viewId: "notes", body: "New text" },
          { viewId: "fresh", body: "Brand new" },
        ],
        teamOps: [
          { op: "invite", email: "Ben@Example.com", role: "viewer" },
          { op: "set_role", email: "ana@example.com", role: "admin" },
        ],
      }),
      { now: NOW, by: "James" },
    );
    expect(workspace.docs?.notes.body).toBe("New text");
    expect(workspace.invites).toMatchObject([
      { email: "ben@example.com", role: "viewer", invitedBy: "James" },
    ]);
    expect(workspace.members?.[0].role).toBe("admin");
    const undone = undoPlan(workspace, entry.id, NOW) as Workspace;
    expect(undone.docs).toEqual(before.docs);
    expect(undone.invites).toEqual([]);
    expect(undone.members?.[0].role).toBe("staff");
  });

  it("undoes newest first", () => {
    const first = applyPlan(court(), plan({ recordOps: [{ op: "delete_record", recordId: "booking_1" }] }), {
      now: NOW,
    });
    const second = applyPlan(
      first.workspace,
      plan({ recordOps: [{ op: "delete_record", recordId: "booking_2" }] }),
      {
        now: new Date(NOW.getTime() + 1000),
      },
    );
    expect(undoPlan(second.workspace, first.entry.id, NOW)).toBeNull();
    const back = undoPlan(second.workspace, second.entry.id, NOW) as Workspace;
    expect(undoPlan(back, first.entry.id, NOW)?.records.some((r) => r.id === "booking_1")).toBe(true);
  });
});

describe("reverting a conversation from one message on", () => {
  const at = (s: number) => new Date(NOW.getTime() + s * 1000);
  const three = () => {
    const before = court();
    const a = applyPlan(before, plan({ ops: [{ op: "remove_view", viewId: "booking_calendar" }] }), {
      now: at(1),
    });
    const b = applyPlan(a.workspace, plan({ recordOps: [{ op: "delete_record", recordId: "booking_1" }] }), {
      now: at(2),
    });
    const c = applyPlan(b.workspace, plan({ recordOps: [{ op: "delete_record", recordId: "booking_2" }] }), {
      now: at(3),
    });
    return { before, a, b, c };
  };

  it("undoes design and data changes together, newest first, back to how it was", () => {
    const { before, a, b, c } = three();
    const result = revertChanges(c.workspace, [a.entry.id, b.entry.id, c.entry.id], at(4));
    if (!result.ok) throw new Error("expected the revert to work");
    expect(result.undone.map((e) => e.id)).toEqual([c.entry.id, b.entry.id, a.entry.id]);
    sameData(result.workspace, before);
    expect(result.workspace.changes.every((e) => e.undoneAt)).toBe(true);
  });

  it("reverts only from the chosen change on", () => {
    const { a, b, c } = three();
    const result = revertChanges(c.workspace, [b.entry.id, c.entry.id], at(4));
    if (!result.ok) throw new Error("expected the revert to work");
    sameData(result.workspace, a.workspace);
  });

  it("refuses, changing nothing, when a newer change from elsewhere is in the way", () => {
    const { a, b, c } = three();
    const result = revertChanges(c.workspace, [a.entry.id, b.entry.id], at(4));
    expect(result).toEqual({ ok: false, blocking: [c.entry] });
  });

  it("skips changes already undone", () => {
    const { a, b, c } = three();
    const later = undoPlan(c.workspace, c.entry.id, at(4)) as Workspace;
    const result = revertChanges(later, [b.entry.id, c.entry.id], at(5));
    if (!result.ok) throw new Error("expected the revert to work");
    expect(result.undone.map((e) => e.id)).toEqual([b.entry.id]);
    sameData(result.workspace, a.workspace);
  });
});

describe("history a staff save may write", () => {
  it("adds data-only changes at the current version and their undo, nothing else", () => {
    const ws = court();
    const dataOnly = applyPlan(ws, plan({ recordOps: [{ op: "delete_record", recordId: "booking_1" }] }), {
      now: NOW,
    }).entry;
    const design = applyPlan(ws, plan({ ops: [{ op: "remove_view", viewId: "booking_calendar" }] }), {
      now: NOW,
    }).entry;
    const team = applyPlan(ws, plan({ teamOps: [{ op: "invite", email: "x@example.com", role: "admin" }] }), {
      now: NOW,
    }).entry;
    const merged = mergeStaffChanges([], [dataOnly, design, team], ws.currentVersion);
    expect(merged.map((c) => c.id)).toEqual([dataOnly.id]);
    const undone = mergeStaffChanges(
      merged,
      [{ ...dataOnly, undoneAt: NOW.toISOString() }],
      ws.currentVersion,
    );
    expect(undone[0].undoneAt).toBe(NOW.toISOString());
  });
});

describe("who applied a change", () => {
  it("keeps the person's name and marks a change the assistant applied on its own", () => {
    const plan: ChangePlan = {
      request: "Rename the workspace",
      title: "Rename workspace",
      facts: [],
      steps: [],
      ops: [{ op: "rename_workspace", name: "Rally House" }],
    };
    expect(applyPlan(court(), plan, { by: "Ana", now: NOW }).entry).toMatchObject({ appliedBy: "Ana" });
    const auto = applyPlan(court(), plan, { by: "Ana", now: NOW, auto: true }).entry;
    expect(auto).toMatchObject({ appliedBy: "Ana", auto: true });
  });
});

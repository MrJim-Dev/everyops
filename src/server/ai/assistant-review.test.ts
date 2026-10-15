import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { DEFAULT_PERMISSIONS } from "@/lib/assistant/permissions";
import type { ChangeOp, ChangePlan } from "@/lib/engine/changes";
import { skipsReview } from "./assistant";

type RecordOp = NonNullable<ChangePlan["recordOps"]>[number];
const renamePage = { op: "rename_system", systemId: "players", name: "Members" } as ChangeOp;
// Code renames the page's tab too; Gemini asked for one rename.
const renameTab = { op: "rename_view", viewId: "players_table", name: "Members" } as ChangeOp;
const paid = { op: "update_record", recordId: "b1", data: { status: "paid" } } as unknown as RecordOp;
const plan = (ops: ChangeOp[], recordOps: RecordOp[] = []) => ({ ops, recordOps });

describe("skipsReview", () => {
  it("skips the review for one requested change the person approves first", () => {
    expect(
      skipsReview(
        "Rename the Players page to Members",
        1,
        plan([renamePage, renameTab]),
        DEFAULT_PERMISSIONS,
      ),
    ).toBe(true);
    expect(skipsReview("Mark Ana's booking paid", 1, plan([], [paid]), DEFAULT_PERMISSIONS)).toBe(true);
  });
  it("reviews requests that ask for more than one thing", () => {
    for (const ask of [
      "Rename Players to Members and Courts to Venues",
      "Rename Players to Members, then add a notes field",
      "Rename Players to Members; also hide the Courts page",
    ])
      expect(skipsReview(ask, 1, plan([renamePage]), DEFAULT_PERMISSIONS)).toBe(false);
  });
  it("reviews plans where Gemini wrote several changes, or that remove something", () => {
    expect(
      skipsReview(
        "Tidy up Players",
        4,
        plan([renamePage, renameTab, renamePage, renameTab]),
        DEFAULT_PERMISSIONS,
      ),
    ).toBe(false);
    const remove = { op: "remove_system", systemId: "players" } as ChangeOp;
    expect(skipsReview("Remove Players", 1, plan([remove]), DEFAULT_PERMISSIONS)).toBe(false);
    const del = { op: "delete_record", recordId: "b1" } as RecordOp;
    expect(skipsReview("Delete Ana's booking", 1, plan([], [del]), DEFAULT_PERMISSIONS)).toBe(false);
  });
  it("reviews a plan that applies on its own, since nobody looks at it first", () => {
    const auto = { ...DEFAULT_PERMISSIONS, autonomy: "auto_data" as const };
    expect(skipsReview("Mark Ana's booking paid", 1, plan([], [paid]), auto)).toBe(false);
  });
  it("ignores the note about the section the person clicked", () => {
    const ask = "(About the Players section I clicked)\nRename it to Members";
    expect(skipsReview(ask, 1, plan([renamePage]), DEFAULT_PERMISSIONS)).toBe(true);
  });
});

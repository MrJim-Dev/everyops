import { describe, expect, it } from "vitest";
import type { ChangeEntry } from "@/lib/store/workspace-model";
import { groupHistory, historyDayLabel } from "./history-groups";

const NOW = new Date("2026-10-14T10:00:00Z"); // 6 PM in Manila
const entry = (id: string, appliedAt: string, undone = false): ChangeEntry => ({
  id,
  request: id,
  title: id,
  steps: [],
  fromVersion: 1,
  toVersion: 2,
  recordChanges: [],
  appliedAt,
  ...(undone ? { undoneAt: appliedAt } : {}),
});

describe("history, as people read it", () => {
  it("names days in Manila time", () => {
    expect(historyDayLabel("2026-10-14T01:00:00Z", NOW)).toBe("Today");
    // 11 PM on the 13th in Manila is still yesterday there, though it's the 13th in UTC too.
    expect(historyDayLabel("2026-10-13T15:00:00Z", NOW)).toBe("Yesterday");
    // 1 AM on the 14th in Manila is 5 PM on the 13th in UTC: today.
    expect(historyDayLabel("2026-10-13T17:00:00Z", NOW)).toBe("Today");
    expect(historyDayLabel("2026-10-10T04:00:00Z", NOW)).toMatch(/Sat.*Oct.*10/);
  });

  it("folds two or more undone attempts in a row into one run, and keeps a single undone change on its own", () => {
    const days = groupHistory(
      [
        entry("kept", "2026-10-14T05:00:00Z"),
        entry("try 3", "2026-10-14T04:40:00Z", true),
        entry("try 2", "2026-10-14T04:20:00Z", true),
        entry("try 1", "2026-10-14T04:17:00Z", true),
        entry("first", "2026-10-14T03:00:00Z"),
        entry("oops", "2026-10-13T03:00:00Z", true),
      ],
      NOW,
    );
    expect(days.map((d) => d.label)).toEqual(["Today", "Yesterday"]);
    expect(days[0].items.map((i) => (i.kind === "run" ? i.entries.map((e) => e.id) : i.entry.id))).toEqual([
      "kept",
      ["try 3", "try 2", "try 1"],
      "first",
    ]);
    expect(days[1].items).toEqual([{ kind: "entry", entry: expect.objectContaining({ id: "oops" }) }]);
  });
});

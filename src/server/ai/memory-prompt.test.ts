import { describe, expect, it } from "vitest";
import { DEFAULT_PERMISSIONS } from "@/lib/assistant/permissions";
import { toEdits, worthRemembering } from "./memory-prompt";

const memory = {
  instructions: "",
  notes: [
    {
      id: "mem_hours",
      kind: "business" as const,
      text: "Open 6 AM to 10 PM",
      source: "setup" as const,
      createdAt: "",
      updatedAt: "",
    },
  ],
  permissions: DEFAULT_PERMISSIONS,
  updatedAt: null,
};

describe("worthRemembering", () => {
  it("skips plain lookups and commands, and reads messages about the business", () => {
    expect(worthRemembering("open bookings")).toBe(false);
    expect(worthRemembering("How many bookings today?")).toBe(false);
    expect(worthRemembering("We now close at 11 PM on weekends")).toBe(true);
    expect(worthRemembering("Always ask before deleting anything")).toBe(true);
  });
});

describe("toEdits", () => {
  it("keeps edits to real notes and turns an update of an unknown note into an add", () => {
    const edits = toEdits(
      {
        notes: [
          { action: "update", id: "mem_hours", kind: "business", text: "Open 6 AM to 11 PM" },
          { action: "update", id: "mem_made_up", kind: "goal", text: "Second branch by December" },
          { action: "remove", id: "mem_made_up", kind: "business", text: "" },
          { action: "add", id: "", kind: "preference", text: "  " },
        ],
      },
      memory,
    );
    expect(edits).toEqual([
      { action: "update", id: "mem_hours", kind: "business", text: "Open 6 AM to 11 PM" },
      { action: "add", kind: "goal", text: "Second branch by December" },
    ]);
  });
});

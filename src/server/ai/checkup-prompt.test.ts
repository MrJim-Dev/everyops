import { describe, expect, it } from "vitest";
import { DEFAULT_PERMISSIONS } from "@/lib/assistant/permissions";
import { findingId, toFindings } from "./checkup-prompt";
import { toDraftNotes } from "./memory-draft-prompt";

describe("toFindings", () => {
  it("keeps complete findings once each, with ids that stay the same between checks", () => {
    const finding = {
      kind: "mismatch" as const,
      title: "Peak rate isn't charged",
      detail: "Bookings from 5 to 9 PM are charged ₱400.",
      evidence: "Memory: peak ₱500/hr · Rate per hour: 400",
      fix: "Charge ₱500 per hour from 5 to 9 PM",
    };
    const found = toFindings({
      findings: [
        finding,
        { ...finding, title: "peak rate isn't charged!" },
        { ...finding, title: "No fix", fix: " " },
      ],
    });
    expect(found).toHaveLength(1);
    expect(found[0].id).toBe(findingId("Peak rate isn't charged"));
  });
});

describe("toDraftNotes", () => {
  it("skips notes the memory already has and empty ones", () => {
    const memory = {
      instructions: "",
      notes: [
        {
          id: "mem_1",
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
    const notes = toDraftNotes(
      {
        notes: [
          { kind: "business", text: "open 6am to 10pm." },
          { kind: "business", text: "Courts: Court 1 to Court 4, ₱400 per hour" },
          { kind: "goal", text: "  " },
        ],
      },
      memory,
    );
    expect(notes).toEqual([
      { action: "add", kind: "business", text: "Courts: Court 1 to Court 4, ₱400 per hour" },
    ]);
  });
});

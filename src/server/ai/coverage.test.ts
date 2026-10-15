import { describe, expect, it } from "vitest";
import { courtBookingsBlueprint } from "@/lib/catalog/court-bookings";
import type { ChangePlan } from "@/lib/engine/changes";
import { changedReferences, checkedCoverage, coverageEvidence } from "./coverage-prompt";

const plan: ChangePlan = {
  request: "Add notes and rename Players",
  title: "Update bookings",
  facts: [],
  steps: [],
  ops: [{ op: "add_field", entityId: "booking", field: { id: "notes", name: "Notes", type: "long_text" } }],
};
const refs = coverageEvidence(courtBookingsBlueprint(), plan);

describe("request coverage gate", () => {
  it("returns missing requirements for repair while retaining covered requirements", () => {
    const checked = checkedCoverage(
      {
        preserve: [],
        requirements: [
          {
            request: "Add notes",
            status: "covered",
            evidence: ["ops:0"],
            detail: "Adds a Notes field to bookings.",
          },
          {
            request: "Rename Players",
            status: "missing",
            evidence: [],
            detail: "Rename the Players page to Members.",
          },
        ],
      },
      refs,
    );
    expect(checked.covered).toHaveLength(1);
    expect(checked.errors).toEqual(["Rename Players: Rename the Players page to Members."]);
  });
  it("rejects invented evidence ids and claims with no evidence", () => {
    for (const evidence of [[], ["ops:99"], ["ops:0", "view:imaginary"]])
      expect(
        checkedCoverage(
          {
            preserve: [],
            requirements: [{ request: "Add notes", status: "covered", evidence, detail: "Done" }],
          },
          refs,
        ).errors,
      ).toHaveLength(1);
  });
  it("requires clarification instead of approving a guessed record", () => {
    const checked = checkedCoverage(
      {
        preserve: [],
        requirements: [
          {
            request: "Update Ana",
            status: "clarify",
            evidence: [],
            detail: "Which of Ana's two bookings should change?",
          },
        ],
      },
      refs,
    );
    expect(checked.questions).toEqual(["Which of Ana's two bookings should change?"]);
    expect(checked.covered).toEqual([]);
  });
  it("does not approve an empty checklist", () => {
    expect(checkedCoverage({ preserve: [], requirements: [] }, refs).errors).toHaveLength(1);
  });
});

it("rejects changes inside a page the request explicitly preserves", () => {
  const bp = courtBookingsBlueprint();
  const change: ChangePlan = {
    ...plan,
    ops: [{ op: "update_field", entityId: "booking", fieldId: "court", patch: { name: "Venue" } }],
  };
  const answer = {
    preserve: ["page:bookings"],
    requirements: [
      {
        request: "Keep Bookings unchanged",
        status: "covered" as const,
        evidence: ["page:bookings"],
        detail: "Claims it is unchanged",
      },
    ],
  };
  expect(
    checkedCoverage(answer, coverageEvidence(bp, change), changedReferences(bp, change)).errors,
  ).toContain("The request says to preserve page:bookings, but the plan changes it. Remove those changes.");
});

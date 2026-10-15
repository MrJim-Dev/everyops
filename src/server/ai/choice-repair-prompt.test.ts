import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { choicePatch } from "./choice-repair-prompt";
import { applyDesignPatch } from "./design";
import type { Design } from "./design-prompt";

const design: Design = {
  workspaceName: "Fixwell",
  summary: "Repairs",
  systems: [],
  views: [],
  widgets: [],
  rules: [],
  samples: [],
  entities: [
    {
      id: "job",
      name: "Job",
      pluralName: "Jobs",
      primaryFieldId: "item",
      fields: [
        { id: "item", name: "Item", type: "text" },
        { id: "status", name: "Status", type: "status" },
      ],
    },
  ],
};
const options = ["Received", "In progress", "Ready", "Collected", "Cancelled"].map((label) => ({
  id: label.toLowerCase().replaceAll(" ", "_"),
  label,
  tone: "neutral" as const,
}));
describe("focused choice repairs", () => {
  it("repairs the requested lifecycle while preserving every other field", () => {
    const patch = choicePatch(design, { fields: [{ entityId: "job", fieldId: "status", options }] });
    expect(patch).not.toBeNull();
    if (!patch) throw new Error("Expected a choice patch");
    const next = applyDesignPatch(design, patch).design;
    expect(next.entities[0].fields[0]).toEqual(design.entities[0].fields[0]);
    expect(next.entities[0].fields[1].options?.map((o) => o.label)).toEqual(options.map((o) => o.label));
    expect(design.entities[0].fields[1].options).toBeUndefined();
  });
  it("refuses unknown fields, non-choice fields and duplicate option ids", () => {
    for (const fieldId of ["imaginary", "item"])
      expect(choicePatch(design, { fields: [{ entityId: "job", fieldId, options }] })).toBeNull();
    expect(
      choicePatch(design, {
        fields: [{ entityId: "job", fieldId: "status", options: [options[0], options[0]] }],
      }),
    ).toBeNull();
  });
});

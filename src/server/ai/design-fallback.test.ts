import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./coverage", () => ({ reviewCoverage: vi.fn() }));
vi.mock("./references", async (original) => ({
  ...(await original<typeof import("./references")>()),
  setupReferences: vi.fn(async () => ({ playbooks: [], systems: [] })),
}));
vi.mock("./samples", () => ({ fillEmptySamples: vi.fn(async (_bp: unknown, samples: unknown) => samples) }));
vi.mock("./overview-layout", () => ({ withOverviewLayout: vi.fn(async (bp: unknown) => bp) }));
vi.mock("./gemini", async (original) => ({
  ...(await original<typeof import("./gemini")>()),
  generateJsonHedged: vi.fn(),
}));

import { validateBlueprint } from "@/lib/blueprint/validate";
import { reviewCoverage } from "./coverage";
import { designWorkspace } from "./design";
import type { Design } from "./design-prompt";
import { generateJsonHedged } from "./gemini";

const tokens = { input: 1, output: 1, thinking: 0, cached: 0 };
const ok = (data: unknown) => ({ ok: true as const, data, model: "test", ms: 1, tokens });

/** A small habit tracker, the kind of design whose repairs kept running out. */
const habitDesign = (): Design =>
  ({
    workspaceName: "Habit Tracker",
    summary: "Habits and check-ins",
    systems: [{ id: "habits_page", name: "Habits", icon: "list", viewIds: ["habits_all"], widgetIds: [] }],
    entities: [
      {
        id: "habit",
        name: "Habit",
        pluralName: "Habits",
        primaryFieldId: "name",
        fields: [
          { id: "name", name: "Name", type: "text", required: true },
          { id: "target_per_week", name: "Target per week", type: "number" },
        ],
      },
    ],
    views: [{ id: "habits_all", entityId: "habit", name: "All habits", type: "table", fieldIds: ["name"] }],
    widgets: [],
    rules: [],
    samples: [
      {
        ref: "h1",
        entityId: "habit",
        values: [
          { fieldId: "name", value: "Drink water" },
          { fieldId: "target_per_week", value: "7" },
        ],
      },
    ],
  }) as unknown as Design;

const gap = "Daily reading log: there is no record type for reading sessions.";

describe("designWorkspace when repairs run out", () => {
  beforeEach(() => {
    vi.mocked(generateJsonHedged).mockReset();
    vi.mocked(reviewCoverage).mockReset();
  });

  it("hands over the workspace and lists what's missing instead of failing", async () => {
    vi.mocked(generateJsonHedged).mockImplementation(
      async (_schema, input) => (input.task === "design" ? ok(habitDesign()) : ok({})) as never,
    );
    vi.mocked(reviewCoverage).mockResolvedValue({
      covered: [],
      missing: ["Daily reading log"],
      errors: [gap],
      questions: [],
    });
    const result = await designWorkspace("A habit tracker with habits and a daily reading log.", "Habits");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.gaps).toEqual([
      { request: "Daily reading log", detail: "there is no record type for reading sessions." },
    ]);
    expect(validateBlueprint(result.data.blueprint)).toEqual([]);
    expect(result.data.blueprint.entities.map((e) => e.id)).toContain("habit");
  });

  it("keeps the best design when a repair call fails", async () => {
    vi.mocked(generateJsonHedged).mockImplementation(
      async (_schema, input) =>
        (input.task === "design"
          ? ok(habitDesign())
          : { ok: false, error: "Gemini is unavailable right now.", retryable: true }) as never,
    );
    vi.mocked(reviewCoverage).mockResolvedValue({
      covered: [],
      missing: ["Daily reading log"],
      errors: [gap],
      questions: [],
    });
    const result = await designWorkspace("A habit tracker with habits and a daily reading log.", "Habits");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.gaps?.map((g) => g.request)).toEqual(["Daily reading log"]);
  });

  it("finishes a valid design when the brief review is unavailable", async () => {
    vi.mocked(generateJsonHedged).mockImplementation(async () => ok(habitDesign()) as never);
    vi.mocked(reviewCoverage).mockResolvedValue(null);
    const result = await designWorkspace("A habit tracker with habits.", "Habits");
    expect(result).toMatchObject({ ok: true, name: "Habit Tracker" });
    if (result.ok) expect(result.gaps).toBeUndefined();
  });
});

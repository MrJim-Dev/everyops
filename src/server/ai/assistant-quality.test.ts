import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./lookup", () => ({ lookupData: vi.fn() }));
vi.mock("./coverage", () => ({ reviewCoverage: vi.fn() }));
vi.mock("./gemini", async (original) => ({
  ...(await original<typeof import("./gemini")>()),
  generateJsonHedged: vi.fn(),
}));

import { courtBookingsBlueprint } from "@/lib/catalog/court-bookings";
import { assistantTurn } from "./assistant";
import type { AssistantAnswer } from "./assistant-prompt";
import { reviewCoverage } from "./coverage";
import { generateJsonHedged } from "./gemini";
import { lookupData } from "./lookup";

const input = () => ({
  blueprint: courtBookingsBlueprint(),
  records: [],
  messages: [{ role: "user" as const, text: "Rename Players to Members and Courts to Venues" }],
  screen: { area: "ask" as const },
  canDesign: true,
  canEditRecords: true,
  userId: "quality",
  workspaceId: "quality",
});
function answer(complete = false): AssistantAnswer {
  return {
    kind: "plan",
    reply: "Here is the change.",
    suggestions: [],
    sources: [],
    goTo: { to: "none", open: false },
    plan: {
      title: "Rename pages",
      facts: [],
      steps: [],
      ops: [],
      renames: [
        { kind: "page", id: "players", newName: "Members" },
        ...(complete ? [{ kind: "page" as const, id: "courts", newName: "Venues" }] : []),
      ],
      recordOps: [],
      formulas: [],
      pageTexts: [],
      team: [],
    },
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(lookupData).mockResolvedValue({ status: "not_needed", text: "No lookup needed." });
});

describe("assistant quality gates", () => {
  it("does not call the answering model or prepare changes when record retrieval fails", async () => {
    vi.mocked(lookupData).mockResolvedValue({
      status: "failed",
      text: "failed",
      evidence: { status: "failed", checkedAt: "2026-10-15T01:00:00Z", queries: [] },
    });
    const result = await assistantTurn(input());
    expect(result).toMatchObject({ ok: true, kind: "clarify", evidence: { status: "failed" } });
    expect(result).not.toHaveProperty("plan");
    expect(generateJsonHedged).not.toHaveBeenCalled();
  });
  it("repairs an omitted requirement before offering a plan, keeping both requested changes", async () => {
    vi.mocked(generateJsonHedged)
      .mockResolvedValueOnce({
        ok: true,
        data: answer(),
        model: "test",
        ms: 1,
        tokens: { input: 1, output: 1, thinking: 0 },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: answer(true),
        model: "test",
        ms: 1,
        tokens: { input: 1, output: 1, thinking: 0 },
      });
    vi.mocked(reviewCoverage)
      .mockResolvedValueOnce({ covered: [], errors: ["Courts must become Venues."], questions: [] })
      .mockResolvedValueOnce({
        covered: [{ request: "Rename Players and Courts", detail: "Both pages renamed." }],
        errors: [],
        questions: [],
      });
    const result = await assistantTurn(input());
    expect(result.ok && result.plan?.ops.filter((op) => op.op === "rename_system")).toHaveLength(2);
    expect(result.ok && result.plan?.coverage).toHaveLength(1);
    expect(vi.mocked(generateJsonHedged).mock.calls[1][1].prompt).toContain("Courts must become Venues");
  });
  it("withholds the plan when its independent review fails", async () => {
    vi.mocked(generateJsonHedged).mockResolvedValue({
      ok: true,
      data: answer(),
      model: "test",
      ms: 1,
      tokens: { input: 1, output: 1, thinking: 0 },
    });
    vi.mocked(reviewCoverage).mockResolvedValue(null);
    const result = await assistantTurn(input());
    expect(result).toMatchObject({ ok: true, kind: "clarify" });
    expect(result).not.toHaveProperty("plan");
  });
});

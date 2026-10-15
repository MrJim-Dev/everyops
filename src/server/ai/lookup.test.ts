import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./gemini", () => ({ generateJsonHedged: vi.fn() }));
vi.mock("./record-tools", () => ({ recordTools: vi.fn() }));

import { courtBookingsBlueprint } from "@/lib/catalog/court-bookings";
import { generateJsonHedged } from "./gemini";
import { lookupData } from "./lookup";
import { recordTools } from "./record-tools";

const input = {
  workspaceId: "quality",
  blueprint: courtBookingsBlueprint(),
  digest: "All-time totals only",
  screen: "Ask",
  today: "2026-10-15",
  messages: [{ role: "user" as const, text: "How many paid bookings used Maya this month?" }],
};
const answered = {
  ok: true as const,
  data: { note: "Checked." },
  model: "test",
  ms: 1,
  tokens: { input: 1, output: 1, thinking: 0 },
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(recordTools).mockReturnValue({
    declarations: [],
    run: vi.fn().mockResolvedValue({ value: 0, records: 0 }),
  });
});

describe("lookup recovery", () => {
  it("requires query evidence for scoped numbers even when the model skips tools", async () => {
    vi.mocked(generateJsonHedged).mockResolvedValue(answered);
    expect(await lookupData(input)).toMatchObject({ status: "failed" });
    expect(generateJsonHedged).toHaveBeenCalledTimes(2);
  });

  it("retries a skipped query and distinguishes a verified zero from failure", async () => {
    vi.mocked(generateJsonHedged)
      .mockResolvedValueOnce(answered)
      .mockImplementationOnce(async (_schema, options) => {
        await options.tools?.run("aggregate", { entityId: "booking", metric: "count" });
        return answered;
      });
    expect(await lookupData(input)).toMatchObject({
      status: "no_matches",
      evidence: { queries: [{ matched: 0 }] },
    });
  });

  it("replaces a failed attempt with fresh evidence without hiding a second failure", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({ error: "Unknown field" })
      .mockResolvedValueOnce({ value: 1200, records: 2 });
    vi.mocked(recordTools).mockReturnValue({ declarations: [], run });
    vi.mocked(generateJsonHedged).mockImplementation(async (_schema, options) => {
      await options.tools?.run("aggregate", { entityId: "booking", metric: "sum", fieldId: "total" });
      return answered;
    });
    expect(await lookupData(input)).toMatchObject({ status: "success" });
    run.mockResolvedValue({ error: "Database unavailable" });
    expect(await lookupData(input)).toMatchObject({ status: "failed" });
  });
});

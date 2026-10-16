import { describe, expect, it } from "vitest";
import { compare, type RunResult, sharedTypes, summarize } from "./design-score";

const run = (n: number, over: Partial<RunResult> = {}): RunResult => ({
  scenario: "courts",
  run: n,
  ok: true,
  ms: 30_000,
  route: "template",
  playbooks: ["courts"],
  calls: 3,
  repairs: 0,
  rejected: 0,
  runaways: 0,
  stalls: 0,
  hedges: 0,
  inputTokens: 10_000,
  outputTokens: 4_000,
  cachedTokens: 0,
  valid: true,
  asks: { hours: true, form: true },
  gaps: [],
  entities: ["court", "booking"],
  views: 8,
  records: 20,
  timings: [],
  ...over,
});

describe("summarize", () => {
  it("tells asks no run met from asks only some runs met, and counts failed runs as missing every ask", () => {
    const s = summarize("courts", [
      run(1, { asks: { hours: true, form: false } }),
      run(2, { asks: { hours: false, form: false } }),
      run(3, { ok: false, asks: {} }),
    ]);
    expect(s.missed).toEqual(["form"]);
    expect(s.flaky).toEqual(["hours"]);
    expect(s.askRate).toBeCloseTo(1 / 6);
    expect(s.okRate).toBeCloseTo(2 / 3);
  });

  it("measures how alike the runs' record types are", () => {
    const same = summarize("courts", [run(1), run(2)]);
    const apart = summarize("courts", [run(1), run(2, { entities: ["court", "reservation"] })]);
    expect(same.sameTypes).toBe(1);
    expect(apart.sameTypes).toBe(0.5);
  });

  it("counts a renamed type that keeps its words as the same, and an extra type as a difference", () => {
    expect(sharedTypes(["activity log", "category"], ["activity category", "activity log"])).toBe(1);
    expect(
      sharedTypes(["attendance", "payslip"], ["attendance log", "payslip", "service category"]),
    ).toBeCloseTo(2 / 3);
    // "add on" pairs with one type only, even when both "add on" and "stay add on" could match it.
    expect(sharedTypes(["add on", "stay add on"], ["stay add on", "extra"])).toBe(0.5);
  });

  it("counts a first pass only when no round was sent back", () => {
    const s = summarize("courts", [run(1), run(2, { rejected: 1 }), run(3, { valid: false })]);
    expect(s.validRate).toBeCloseTo(2 / 3);
    expect(s.firstPassRate).toBeCloseTo(1 / 3);
  });
});

describe("compare", () => {
  const base = [summarize("courts", [run(1), run(2), run(3)])];
  const five = (over: Partial<RunResult>[] = []) => [
    summarize(
      "courts",
      [1, 2, 3, 4, 5].map((n, i) => run(n, over[i] ?? {})),
    ),
  ];

  it("treats one run in five as the noise it is, and fails when two runs get worse", () => {
    // The same code run twice moves first passes by one run; that must not fail the gate.
    expect(compare(five(), five([{ rejected: 1 }])).ok).toBe(true);
    const worse = compare(five(), five([{ rejected: 1 }, { rejected: 1 }]));
    expect(worse.ok).toBe(false);
    expect(worse.regressions.join()).toMatch(/first-pass valid 100% → 60%/);
  });

  it("fails when every run stops meeting an ask, whatever the sample", () => {
    const missing = { asks: { hours: false, form: true } };
    const result = compare(five(), five([missing, missing, missing, missing, missing]));
    expect(result.ok).toBe(false);
    expect(result.regressions.join()).toMatch(/no run met hours/);
  });

  it("reports sameness without failing on it", () => {
    const apart = { entities: ["court", "reservation", "guest"] };
    const result = compare(five(), five([apart, apart, {}, {}, {}]));
    expect(result.ok).toBe(true);
    expect(result.warnings.join()).toMatch(/same record types/);
  });

  it("fails when designs stop validating, or gaps grow", () => {
    expect(
      compare(base, [summarize("courts", [run(1), run(2, { valid: false }), run(3, { valid: false })])]).ok,
    ).toBe(false);
    expect(compare(base, [summarize("courts", [run(1), run(2, { gaps: ["a", "b"] }), run(3)])]).ok).toBe(
      false,
    );
  });

  it("passes a faster run of equal quality and reports it, and only warns when it's slower", () => {
    const faster = compare(base, [summarize("courts", [run(1, { ms: 10_000 }), run(2, { ms: 12_000 })])]);
    expect(faster.ok).toBe(true);
    expect(faster.improvements.join()).toMatch(/median time 30s → 11s/);
    const slower = compare(base, [summarize("courts", [run(1, { ms: 60_000 })])]);
    expect(slower.ok).toBe(true);
    expect(slower.warnings.join()).toMatch(/median time/);
  });

  it("skips briefs the baseline doesn't have", () => {
    expect(compare(base, [summarize("salon", [run(1, { scenario: "salon", valid: false })])]).ok).toBe(true);
  });
});

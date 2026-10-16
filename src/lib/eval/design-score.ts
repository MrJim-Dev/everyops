import type { WorkspaceData } from "@/lib/blueprint/types";

/**
 * Scoring for the setup design eval (scripts/design-eval.mts): what one design run is worth against its brief, how
 * steady repeated runs of the same brief are, and whether a new report is worse than a baseline. Pure, so the gate
 * itself is tested; the runner and the briefs live in scripts/.
 */

/** One explicit requirement of a brief, checked against the finished design and its sample records. */
export type Ask = { id: string; label: string; check: (data: WorkspaceData) => boolean };

export type Scenario = {
  id: string;
  name: string;
  brief: string;
  /** The setup route the brief should take; a different one is reported, since it changes cost and shape. */
  route: "template" | "playbook" | "custom";
  asks: Ask[];
};

export type CallTiming = { task: string; ms: number; firstMs: number | null; output: number };

export type RunResult = {
  scenario: string;
  run: number;
  ok: boolean;
  reason?: string;
  ms: number;
  route: string;
  /** The playbooks the brief matched, which decide the route. */
  playbooks: string[];
  calls: number;
  repairs: number;
  /** Design rounds the validator or brief checks sent back. */
  rejected: number;
  /** Why each of those rounds was sent back (the validator's and brief checks' messages). */
  rejectedFor?: string[][];
  /** Cards the designer wrote that tidying dropped, as written. */
  droppedWidgets?: string[];
  /** On the template route, what the structure patch returned and removed (design_template_patched). */
  templatePatch?: Record<string, unknown>;
  /** The first design answer's size by part, in characters (design_output_parts). */
  outputParts?: Record<string, number>;
  runaways: number;
  stalls: number;
  hedges: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  valid: boolean;
  /** Each ask's result, by ask id. */
  asks: Record<string, boolean>;
  gaps: string[];
  /** Record type names, normalized, to compare runs of the same brief. */
  entities: string[];
  views: number;
  records: number;
  timings: CallTiming[];
};

export type ScenarioSummary = {
  scenario: string;
  runs: number;
  routes: string[];
  /** Runs that ended with a design. */
  okRate: number;
  validRate: number;
  /** Runs that validated without any round sent back. */
  firstPassRate: number;
  /** Share of asks met, over every run. */
  askRate: number;
  /** Asks no run met, and asks some runs met and others didn't. */
  missed: string[];
  flaky: string[];
  /** Mean share of record types two runs have in common (1: every run built the same ones). */
  sameTypes: number;
  gaps: number;
  repairs: number;
  msP50: number;
  msMax: number;
  outputTokens: number;
  cachedTokens: number;
};

export const normalizeName = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/ies$/, "y")
    .replace(/([^s])s$/, "$1");

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const rate = (xs: boolean[]) => mean(xs.map((x) => (x ? 1 : 0)));

function median(xs: number[]) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const words = (name: string) => ` ${name} `;

/**
 * The share of record types two designs have in common: types are paired by the same name first, then by one name
 * containing the other ("category" and "activity category"), and the pairs counted against the larger design. A
 * renamed type that keeps its words still counts as the same, so naming alone doesn't read as inconsistency.
 */
export function sharedTypes(a: string[], b: string[]): number {
  const left = [...new Set(a)];
  const right = new Set(b);
  const size = Math.max(left.length, right.size);
  if (!size) return 1;
  let pairs = 0;
  for (const name of left.filter((n) => right.has(n))) {
    right.delete(name);
    pairs++;
  }
  for (const name of left.filter((n) => !b.includes(n))) {
    const match = [...right].find((r) => words(r).includes(words(name)) || words(name).includes(words(r)));
    if (match) {
      right.delete(match);
      pairs++;
    }
  }
  return pairs / size;
}

/** Runs one ask; an ask that throws on an odd design counts as not met. */
export function checkAsk(ask: Ask, data: WorkspaceData): boolean {
  try {
    return ask.check(data);
  } catch {
    return false;
  }
}

export function summarize(scenario: string, runs: RunResult[]): ScenarioSummary {
  const done = runs.filter((r) => r.ok);
  const askIds = [...new Set(runs.flatMap((r) => Object.keys(r.asks)))];
  // A run that ended without a design met none of its asks.
  const met = (id: string) => runs.map((r) => r.ok && r.asks[id] === true);
  const pairs: number[] = [];
  for (let i = 0; i < done.length; i++)
    for (let j = i + 1; j < done.length; j++) pairs.push(sharedTypes(done[i].entities, done[j].entities));
  return {
    scenario,
    runs: runs.length,
    routes: [...new Set(runs.map((r) => r.route))],
    okRate: rate(runs.map((r) => r.ok)),
    validRate: rate(runs.map((r) => r.ok && r.valid)),
    firstPassRate: rate(runs.map((r) => r.ok && r.valid && r.rejected === 0)),
    askRate: askIds.length ? mean(askIds.map((id) => rate(met(id)))) : 1,
    missed: askIds.filter((id) => met(id).every((x) => !x)),
    flaky: askIds.filter((id) => {
      const m = met(id);
      return m.some(Boolean) && !m.every(Boolean);
    }),
    sameTypes: pairs.length ? mean(pairs) : 1,
    gaps: mean(done.map((r) => r.gaps.length)),
    repairs: mean(runs.map((r) => r.repairs)),
    msP50: median(runs.map((r) => r.ms)),
    msMax: Math.max(0, ...runs.map((r) => r.ms)),
    outputTokens: mean(runs.map((r) => r.outputTokens)),
    cachedTokens: mean(runs.map((r) => r.cachedTokens)),
  };
}

/**
 * How far a quality number may move before it counts. The same code run twice moves a rate by one run (20 points at
 * five runs a brief) and sameness by about 25 points, so a rate fails only when it drops by more than one run's
 * worth (or 10 points, whichever is more), and sameness is reported but never fails.
 */
export const TOLERANCE = { rate: 0.1, gaps: 0.5, slower: 1.25 } as const;

export type Comparison = {
  ok: boolean;
  /** Quality got worse: the gate fails on these. */
  regressions: string[];
  /** Slower or bigger, reported but not failing. */
  warnings: string[];
  improvements: string[];
};

const RATES = [
  ["validRate", "valid designs"],
  ["firstPassRate", "first-pass valid"],
  ["askRate", "asks met"],
] as const;

/**
 * A new report against a baseline, brief by brief (briefs in only one of them are skipped). Quality (designs that
 * validate, first passes, asks met, gaps) must not drop by more than the noise of that many runs; sameness, speed and
 * size are reported both ways.
 */
export function compare(baseline: ScenarioSummary[], current: ScenarioSummary[]): Comparison {
  const regressions: string[] = [];
  const warnings: string[] = [];
  const improvements: string[] = [];
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const secs = (ms: number) => `${Math.round(ms / 1000)}s`;
  for (const now of current) {
    const was = baseline.find((b) => b.scenario === now.scenario);
    if (!was) continue;
    const s = now.scenario;
    for (const [key, label] of RATES) {
      const a = was[key];
      const b = now[key];
      // One run's worth of the smaller sample is what the same code moves by on its own.
      const noise = Math.max(TOLERANCE.rate, 1 / Math.max(1, Math.min(was.runs, now.runs))) + 1e-9;
      const line = `${s}: ${label} ${pct(a)} → ${pct(b)}`;
      if (b < a - noise) regressions.push(line);
      else if (b > a + noise) improvements.push(line);
    }
    const same = `${s}: same record types across runs ${pct(was.sameTypes)} → ${pct(now.sameTypes)}`;
    if (now.sameTypes < was.sameTypes - 0.3) warnings.push(same);
    else if (now.sameTypes > was.sameTypes + 0.3) improvements.push(same);
    const newlyMissed = now.missed.filter((id) => !was.missed.includes(id));
    if (newlyMissed.length) regressions.push(`${s}: no run met ${newlyMissed.join(", ")}`);
    const gaps = `${s}: gaps ${was.gaps.toFixed(1)} → ${now.gaps.toFixed(1)}`;
    if (now.gaps > was.gaps + TOLERANCE.gaps) regressions.push(gaps);
    else if (now.gaps < was.gaps - TOLERANCE.gaps) improvements.push(gaps);
    const time = `${s}: median time ${secs(was.msP50)} → ${secs(now.msP50)}`;
    if (now.msP50 > was.msP50 * TOLERANCE.slower) warnings.push(time);
    else if (now.msP50 < was.msP50 / TOLERANCE.slower) improvements.push(time);
    if (now.outputTokens > was.outputTokens * TOLERANCE.slower)
      warnings.push(`${s}: output tokens ${Math.round(was.outputTokens)} → ${Math.round(now.outputTokens)}`);
    if (now.routes.join() !== was.routes.join())
      warnings.push(`${s}: route ${was.routes.join("/")} → ${now.routes.join("/")}`);
  }
  return { ok: regressions.length === 0, regressions, warnings, improvements };
}

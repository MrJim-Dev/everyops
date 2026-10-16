/**
 * Setup design eval: runs setup's design stage (designWorkspace) on fixed briefs, a few times each, and reports per
 * brief how often the design validates (and on the first pass), how many of the owner's explicit asks it meets, how
 * alike repeated runs are, its gaps, repairs, time and tokens, plus where the time went by Gemini task. With a
 * baseline report it fails when quality dropped (see compare in src/lib/eval/design-score.ts). Nothing is saved.
 *
 *   pnpm db:proxy                       # in another terminal: community systems come from the database
 *   pnpm eval:design                    # every brief, 3 runs each
 *   EVAL_ONLY=courts,habits EVAL_REPEAT=2 pnpm eval:design
 *   EVAL_LABEL=fanout EVAL_BASELINE=<report from before> pnpm eval:design
 *
 * EVAL_CONCURRENCY (default 3) runs briefs side by side; keep it the same for runs you compare, since it affects time.
 * Designs run on production's design model (gemini-3.5-flash, asia-southeast1) unless GEMINI_DESIGN_MODEL is set;
 * set it to an empty value to design on GEMINI_MODEL. EVAL_KEEP_DESIGNS=1 saves every design next to the report, and
 * EVAL_RESCORE=<report> scores those saved designs again with the current checks (after a check is fixed), in place,
 * without calling Gemini.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorkspaceData } from "@/lib/blueprint/types";
import {
  type CallTiming,
  checkAsk,
  compare,
  normalizeName,
  type RunResult,
  type ScenarioSummary,
  summarize,
} from "@/lib/eval/design-score";
import { SCENARIOS } from "./fixtures/design-briefs";

if (process.env.GEMINI_DESIGN_MODEL === undefined) process.env.GEMINI_DESIGN_MODEL = "gemini-3.5-flash";
if (process.env.GEMINI_DESIGN_LOCATION === undefined) process.env.GEMINI_DESIGN_LOCATION = "asia-southeast1";
// Imported after the model settings above, which gemini.ts reads when it loads.
const { designWorkspace } = await import("@/server/ai/design");
const { validateBlueprint } = await import("@/lib/blueprint/validate");

const repeat = Math.max(1, Math.min(10, Number(process.env.EVAL_REPEAT) || 3));
const concurrency = Math.max(1, Math.min(6, Number(process.env.EVAL_CONCURRENCY) || 3));
const only = process.env.EVAL_ONLY?.split(",").map((s) => s.trim());
const label = process.env.EVAL_LABEL || "run";
const rescoring = process.env.EVAL_RESCORE;
const reportPath = rescoring || process.env.EVAL_REPORT || join(tmpdir(), `design-eval-${label}.json`);
const designsPath = (report: string) => `${report.replace(/\.json$/, "")}-designs.json`;
const scenarios = SCENARIOS.filter((s) => !only || only.includes(s.id));
if (!scenarios.length)
  throw new Error(`No briefs match EVAL_ONLY. Briefs: ${SCENARIOS.map((s) => s.id).join(", ")}`);

// Each run's log lines (design_route, design_done, gemini, …) go to that run, so runs side by side stay apart.
type Event = Record<string, unknown>;
const runLog = new AsyncLocalStorage<Event[]>();
const out = { log: console.log, info: console.info, warn: console.warn, error: console.error };
for (const level of ["log", "info", "warn", "error"] as const)
  console[level] = (...args: unknown[]) => {
    const events = runLog.getStore();
    if (!events) return out[level](...args);
    const line = args[0];
    if (typeof line === "string" && line.startsWith("{"))
      try {
        events.push(JSON.parse(line) as Event);
      } catch {}
  };

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const designs: Record<string, WorkspaceData> = {};

async function runOne(scenario: (typeof scenarios)[number], run: number): Promise<RunResult> {
  const events: Event[] = [];
  const started = Date.now();
  const result = await runLog
    .run(events, () => designWorkspace(scenario.brief, scenario.name))
    .catch((e: unknown) => ({ ok: false as const, message: e instanceof Error ? e.message : String(e) }));
  const ms = Date.now() - started;
  const of = (name: string) => events.filter((e) => e.event === name);
  const done = of("design_done")[0] ?? {};
  const route = String(done.tier ?? of("design_route")[0]?.tier ?? "unknown");
  const gemini = of("gemini");
  const timings: CallTiming[] = gemini.map((g) => ({
    task: String(g.task),
    ms: num(g.ms),
    firstMs: typeof g.firstMs === "number" ? g.firstMs : null,
    output: num(g.output),
  }));
  const base = {
    scenario: scenario.id,
    run,
    ms,
    route,
    playbooks: (of("design_route")[0]?.playbooks as string[] | undefined) ?? [],
    calls: num(done.calls) || gemini.length,
    repairs: num(done.repairs),
    rejected: of("design_rejected").length,
    rejectedFor: of("design_rejected").map((e) => ((e.errors as string[] | undefined) ?? []).map(String)),
    droppedWidgets: of("design_widgets_dropped").flatMap((e) => (e.widgets as string[] | undefined) ?? []),
    templatePatch: of("design_template_patched")[0],
    outputParts: of("design_output_parts")[0]?.parts as Record<string, number> | undefined,
    runaways: of("gemini_runaway").length,
    stalls: of("gemini_stalled").length,
    hedges: of("gemini_hedge").length,
    inputTokens: gemini.reduce((n, g) => n + num(g.input), 0),
    outputTokens: gemini.reduce((n, g) => n + num(g.output), 0),
    cachedTokens: gemini.reduce((n, g) => n + num(g.cached), 0),
    timings,
  };
  if (!result.ok)
    return {
      ...base,
      ok: false,
      reason: result.message,
      valid: false,
      asks: {},
      gaps: [],
      entities: [],
      views: 0,
      records: 0,
    };
  const data = result.data;
  if (process.env.EVAL_KEEP_DESIGNS) designs[`${scenario.id}-${run}`] = data;
  return {
    ...base,
    ok: true,
    valid: validateBlueprint(data.blueprint).length === 0,
    asks: Object.fromEntries(scenario.asks.map((a) => [a.id, checkAsk(a, data)])),
    gaps: (result.gaps ?? []).map((g) => g.request),
    entities: [...new Set(data.blueprint.entities.map((e) => normalizeName(e.name)))].sort(),
    views: data.blueprint.views.length,
    records: data.records.length,
  };
}

const secs = (ms: number) => `${Math.round(ms / 1000)}s`;
const pct = (x: number) => `${Math.round(x * 100)}%`;

type Report = {
  at: string;
  label: string;
  config: Record<string, unknown>;
  ms: number;
  summaries: ScenarioSummary[];
  runs: RunResult[];
};

/** A saved report's runs with their asks checked again against its saved designs (runs without one keep theirs). */
function rescore(path: string): { saved: Report; runs: RunResult[] } {
  const saved = JSON.parse(readFileSync(path, "utf8")) as Report;
  const kept = JSON.parse(readFileSync(designsPath(path), "utf8")) as Record<string, WorkspaceData>;
  const runs = saved.runs.flatMap((r) => {
    const scenario = scenarios.find((s) => s.id === r.scenario);
    if (!scenario) return [];
    const data = kept[`${r.scenario}-${r.run}`];
    return [
      data ? { ...r, asks: Object.fromEntries(scenario.asks.map((a) => [a.id, checkAsk(a, data)])) } : r,
    ];
  });
  out.log(`Rescored "${saved.label}" (${runs.length} runs) with the current checks.`);
  return { saved, runs };
}

async function runAll(): Promise<RunResult[]> {
  const jobs = scenarios.flatMap((s) =>
    Array.from({ length: repeat }, (_, i) => ({ scenario: s, run: i + 1 })),
  );
  const runs: RunResult[] = [];
  out.log(
    `Design eval "${label}": ${scenarios.length} briefs × ${repeat} runs, ${concurrency} at a time, designing on ${process.env.GEMINI_DESIGN_MODEL || process.env.GEMINI_MODEL || "gemini-3.7-flash"}`,
  );
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
      while (next < jobs.length) {
        const job = jobs[next++];
        const r = await runOne(job.scenario, job.run);
        runs.push(r);
        const asks = Object.values(r.asks);
        out.log(
          [
            `  ${r.scenario} #${r.run}`.padEnd(16),
            r.ok ? (r.valid ? "valid" : "INVALID") : `FAILED (${r.reason})`,
            `${r.route}${r.playbooks.length ? ` (${r.playbooks.join(", ")})` : ""}`,
            secs(r.ms),
            `asks ${asks.filter(Boolean).length}/${job.scenario.asks.length}`,
            `repairs ${r.repairs}`,
            `gaps ${r.gaps.length}`,
            `out ${r.outputTokens}`,
            r.runaways || r.stalls || r.hedges
              ? `runaways ${r.runaways} stalls ${r.stalls} hedges ${r.hedges}`
              : "",
          ].join("  "),
        );
      }
    }),
  );
  return runs;
}

const evalStarted = Date.now();
const rescored = rescoring ? rescore(rescoring) : null;
const runs = rescored?.runs ?? (await runAll());
runs.sort((a, b) => a.scenario.localeCompare(b.scenario) || a.run - b.run);
const summaries: ScenarioSummary[] = scenarios.map((s) =>
  summarize(
    s.id,
    runs.filter((r) => r.scenario === s.id),
  ),
);

const table = [
  "| Brief | Route | Valid | First pass | Asks met | Same types | Gaps | Repairs | Time p50 / max | Output tokens | Missed | Sometimes missed |",
  "|---|---|---|---|---|---|---|---|---|---|---|---|",
  ...summaries.map((s) => {
    const expected = scenarios.find((x) => x.id === s.scenario)?.route;
    const routes = s.routes.join("/") + (s.routes.join() === expected ? "" : ` (expected ${expected})`);
    return `| ${s.scenario} | ${routes} | ${pct(s.validRate)} | ${pct(s.firstPassRate)} | ${pct(s.askRate)} | ${pct(s.sameTypes)} | ${s.gaps.toFixed(1)} | ${s.repairs.toFixed(1)} | ${secs(s.msP50)} / ${secs(s.msMax)} | ${Math.round(s.outputTokens)} | ${s.missed.join(", ") || ""} | ${s.flaky.join(", ") || ""} |`;
  }),
];

// Where the time goes: each Gemini task's calls across every run.
const byTask = new Map<string, CallTiming[]>();
for (const t of runs.flatMap((r) => r.timings)) byTask.set(t.task, [...(byTask.get(t.task) ?? []), t]);
const med = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : 0;
};
const tasks = [
  "| Gemini task | Calls | Median time | Median first part | Median output tokens |",
  "|---|---|---|---|---|",
  ...[...byTask.entries()]
    .sort((a, b) => med(b[1].map((t) => t.ms)) - med(a[1].map((t) => t.ms)))
    .map(([task, ts]) => {
      const first = ts.map((t) => t.firstMs).filter((x): x is number => x !== null);
      return `| ${task} | ${ts.length} | ${secs(med(ts.map((t) => t.ms)))} | ${first.length ? secs(med(first)) : ""} | ${med(ts.map((t) => t.output))} |`;
    }),
];

const config = {
  designModel: process.env.GEMINI_DESIGN_MODEL || process.env.GEMINI_MODEL || "gemini-3.7-flash",
  designLocation: process.env.GEMINI_DESIGN_LOCATION || process.env.GEMINI_LOCATION || "global",
  model: process.env.GEMINI_MODEL || "gemini-3.7-flash",
  location: process.env.GEMINI_LOCATION || "global",
  repeat,
  concurrency,
};
const report: Report = rescored
  ? { ...rescored.saved, summaries, runs }
  : { at: new Date().toISOString(), label, config, ms: Date.now() - evalStarted, summaries, runs };
writeFileSync(reportPath, JSON.stringify(report, null, 2));
if (process.env.EVAL_KEEP_DESIGNS && !rescored)
  writeFileSync(designsPath(reportPath), JSON.stringify(designs));

out.log(`\n${table.join("\n")}\n\n${tasks.join("\n")}\n`);
out.log(`Took ${secs(report.ms)}. Report: ${reportPath}`);

let exitCode = 0;
if (process.env.EVAL_BASELINE) {
  const baseline = JSON.parse(readFileSync(process.env.EVAL_BASELINE, "utf8")) as {
    label: string;
    summaries: ScenarioSummary[];
  };
  const result = compare(baseline.summaries, summaries);
  const list = (title: string, xs: string[]) =>
    xs.length ? `\n${title}\n${xs.map((x) => `  - ${x}`).join("\n")}` : "";
  out.log(
    `\nAgainst "${baseline.label}": ${result.ok ? "quality held" : "QUALITY DROPPED"}` +
      list("Worse:", result.regressions) +
      list("Watch:", result.warnings) +
      list("Better:", result.improvements),
  );
  if (!result.ok) exitCode = 1;
}
process.exit(exitCode);

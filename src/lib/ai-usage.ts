/**
 * Shared names for the AI use log (table ai_call): what each feature and step is called on screen, what a call's
 * outcome means, and the rates used to estimate what it cost. Used by the server (to log and summarise calls) and by
 * the settings screens (to show them).
 */

/** The product feature a call was made for: the route that started it, or a script outside the app. */
export const AI_FEATURES = {
  assistant: "Ask EveryOps",
  "setup-interview": "Setup conversation",
  "setup-design": "Workspace design",
  checkup: "Workspace checkup",
  import: "Import matching",
  voice: "Voice input",
  "plan-change": "Change planner",
  memory: "Memory notes",
  script: "Scripts and evals",
  other: "Other",
} as const;
export type AiFeature = keyof typeof AI_FEATURES;

/** The step inside a feature: the task name generateJson logs for each call. */
const STEPS: Record<string, string> = {
  assistant: "Answer or plan",
  "assistant-lookup": "Record lookup",
  "assistant-coverage": "Coverage check",
  "assistant-memory": "Remembering",
  "assistant-checkup": "Checkup",
  "assistant-memory-draft": "Memory draft",
  interview: "Interview",
  design: "Design",
  "design-fix": "Design fix",
  "design-choices": "Choice lists",
  "design-template": "Template adapt",
  "design-template-samples": "Sample records",
  "design-samples": "Sample records",
  "overview-layout": "Overview layout",
  "import-map": "Column matching",
  transcribe: "Transcription",
  "plan-change": "Change plan",
};
export const stepLabel = (task: string) => STEPS[task] ?? task;
export const featureLabel = (feature: string) => AI_FEATURES[feature as AiFeature] ?? feature;

/**
 * How a call ended. Anything but ok is waste: the tokens were paid for and the answer thrown away (a duplicate
 * that lost the race, a loop that was stopped, an answer that didn't fit the schema).
 */
export const AI_OUTCOMES = {
  ok: "OK",
  cancelled: "Duplicate cancelled",
  runaway: "Stopped looping",
  stalled: "Stalled",
  timeout: "Timed out",
  schema: "Didn't fit",
  malformed: "Broken JSON",
  empty: "Empty answer",
  "rate-limited": "Rate limited",
  error: "Failed",
} as const;
export type AiOutcome = keyof typeof AI_OUTCOMES;
export const outcomeLabel = (o: string) => AI_OUTCOMES[o as AiOutcome] ?? o;

/** Where the call ran: "production", "local:HOST" (a dev server) or "script:NAME@HOST". */
export function originLabel(origin: string): string {
  if (origin === "production") return "Production";
  if (origin.startsWith("local:")) return `Local dev · ${shortHost(origin.slice(6))}`;
  if (origin.startsWith("script:")) {
    const [name, host] = origin.slice(7).split("@");
    return `Script · ${name}${host ? ` · ${shortHost(host)}` : ""}`;
  }
  return origin;
}
const shortHost = (host: string) => host.replace(/\.local$/, "");

/**
 * US dollars per million tokens, from the billing account's Vertex AI SKU rates (October 2026). Thinking is billed
 * as output, and cached input (Gemini reusing an identical prompt start) at a tenth of input. Regional endpoints
 * (e.g. asia-southeast1) cost 10% more than global. These are estimates; Google's invoice is the bill.
 */
type Rate = { input: number; cached: number; output: number };
const RATES: Record<string, Rate> = {
  "gemini-3.5-flash": { input: 1.5, cached: 0.15, output: 9 },
  "gemini-3.7-flash": { input: 1.5, cached: 0.15, output: 7.5 },
  "gemini-3.8-flash": { input: 1.5, cached: 0.15, output: 7.5 },
  "gemini-2.5-flash": { input: 0.3, cached: 0.03, output: 2.5 },
};
const FALLBACK = RATES["gemini-3.7-flash"];
const REGIONAL = 1.1;

export type CallTokens = { input: number; cached: number; output: number; thinking: number };

/** Estimated cost of one call in micro-dollars (millionths of a dollar), so sums stay exact integers. */
export function costMicros(model: string, location: string, t: CallTokens): number {
  const rate = RATES[model] ?? FALLBACK;
  const factor = location === "global" ? 1 : REGIONAL;
  const cached = Math.min(t.cached, t.input);
  // Dollars per million tokens is the same number as micro-dollars per token.
  return Math.round(
    factor * ((t.input - cached) * rate.input + cached * rate.cached + (t.output + t.thinking) * rate.output),
  );
}

/** Micro-dollars as dollars: $0.0042, $1.37, $142. */
export function formatCost(micros: number): string {
  const dollars = micros / 1_000_000;
  if (dollars === 0) return "$0";
  if (dollars < 0.01) return `$${dollars.toFixed(4)}`;
  if (dollars < 100) return `$${dollars.toFixed(2)}`;
  return `$${Math.round(dollars).toLocaleString("en-US")}`;
}

/** Tokens in short form: 950, 12.4k, 3.1M. */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export const AI_PERIODS = { month: "This month", "30d": "Last 30 days", "last-month": "Last month" } as const;
export type AiPeriod = keyof typeof AI_PERIODS;

/** One row of a breakdown: a feature, step, model, source, person or workspace. */
export type UsageGroup = {
  key: string;
  label: string;
  /** A second line, e.g. a person's email or a model's region. */
  detail?: string;
  calls: number;
  /** Separate user actions (one message can make several calls). */
  requests: number;
  tokens: number;
  costMicros: number;
  /** Cost of calls that didn't produce the answer (duplicates, loops, failures). */
  wastedMicros: number;
};

export type UsageCall = {
  at: string;
  feature: string;
  task: string;
  model: string;
  location: string;
  outcome: string;
  attempt: number;
  tokens: number;
  estimated: boolean;
  costMicros: number;
  ms: number;
  origin: string;
  person?: string;
  workspace?: string;
};

export type UsageReport = {
  period: AiPeriod;
  from: string;
  to: string;
  totals: {
    calls: number;
    requests: number;
    input: number;
    cached: number;
    output: number;
    thinking: number;
    costMicros: number;
    wastedCalls: number;
    wastedMicros: number;
  };
  daily: { day: string; costMicros: number; tokens: number; calls: number }[];
  byFeature: UsageGroup[];
  byStep: UsageGroup[];
  byModel: UsageGroup[];
  byOrigin: UsageGroup[];
  /** Workspace view, for owners and admins. */
  byPerson?: UsageGroup[];
  /** Account view. */
  byWorkspace?: UsageGroup[];
  recent: UsageCall[];
};

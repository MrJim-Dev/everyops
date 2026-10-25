/**
 * EveryOps plans: what each costs, how many AI credits it includes each month and the limits that keep one
 * account from using more than it pays for. Shared by the server (which enforces them) and the browser (pricing
 * page, Account → Plan & usage, admin), so the numbers on screen are the numbers enforced.
 *
 * A credit is a thousandth of a US dollar of Gemini cost as logged in ai_call.cost_micros (1 credit = 1,000
 * micro-dollars). Counting cost instead of tokens or requests prices every model and feature fairly: a workspace
 * design on the design model costs about 130 credits, an Ask EveryOps answer in a small workspace about 10.
 */

export const CREDIT_MICROS = 1_000;

export type PlanId = "free" | "starter" | "pro" | "business" | "internal" | "demo";

/** What API keys may do on a plan: nothing, read records and pages, or everything the key's permissions allow. */
export type ApiAccess = "none" | "read" | "full";

export type PlanLimits = {
  /** AI credits included each month (renews on the 1st, Asia/Manila). */
  credits: number;
  /** Workspaces the account owns, not counting the starter workspaces every account gets. */
  workspaces: number;
  /** People on one workspace's team besides the owner, pending invites included. */
  members: number;
  /** Records in one workspace. */
  records: number;
  /** Files uploaded to the account's workspaces, in megabytes. */
  storageMb: number;
  /** Automation emails a day across every workspace the account owns. */
  emailsPerDay: number;
  api: ApiAccess;
  /** Custom domains across the account's workspaces. */
  customDomains: number;
  /** Workspace designs started per day (the most expensive AI step). */
  designsPerDay: number;
  /** Setup conversation turns per day. */
  interviewTurnsPerDay: number;
  /** AI requests in any 10 minutes. */
  aiPer10Min: number;
};

export type Plan = {
  id: PlanId;
  name: string;
  tagline: string;
  /** Monthly price in centavos (PHP minor units), the unit payment providers take. */
  monthlyCentavos: number;
  /** Shown on the pricing page and offered for upgrades. Internal and demo plans are assigned, never sold. */
  public: boolean;
  /** Free accounts are paused first when the daily AI spending limit is reached. */
  pausedBySafetySwitch: boolean;
  limits: PlanLimits;
  highlights: string[];
};

/** Big enough to never matter, and still a finite number for JSON and arithmetic. */
export const UNLIMITED = 1_000_000_000;

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free",
    name: "Free",
    tagline: "Try EveryOps on one business system.",
    monthlyCentavos: 0,
    public: true,
    pausedBySafetySwitch: true,
    limits: {
      credits: 1_000,
      workspaces: 1,
      members: 2,
      // The biggest starter workspace (the canteen) comes with about 1,300 sample records.
      records: 2_000,
      storageMb: 200,
      emailsPerDay: 20,
      api: "none",
      customDomains: 0,
      designsPerDay: 3,
      interviewTurnsPerDay: 30,
      aiPer10Min: 20,
    },
    highlights: ["Public booking and order pages", "Print templates and signatures", "Community systems"],
  },
  starter: {
    id: "starter",
    name: "Starter",
    tagline: "For a small shop running a few systems.",
    monthlyCentavos: 49_900,
    public: true,
    pausedBySafetySwitch: false,
    limits: {
      credits: 3_000,
      workspaces: 3,
      members: 5,
      records: 10_000,
      storageMb: 2_000,
      emailsPerDay: 100,
      api: "read",
      customDomains: 0,
      designsPerDay: 10,
      interviewTurnsPerDay: 80,
      aiPer10Min: 30,
    },
    highlights: ["Everything in Free", "Read-only API and MCP access", "Excel export and Sheets sync"],
  },
  pro: {
    id: "pro",
    name: "Pro",
    tagline: "For a growing team that lives in EveryOps.",
    monthlyCentavos: 149_900,
    public: true,
    pausedBySafetySwitch: false,
    limits: {
      credits: 8_000,
      workspaces: 10,
      members: 15,
      records: 50_000,
      storageMb: 10_000,
      emailsPerDay: 500,
      api: "full",
      customDomains: 1,
      designsPerDay: 25,
      interviewTurnsPerDay: 200,
      aiPer10Min: 60,
    },
    highlights: ["Everything in Starter", "Full API, MCP and webhooks", "Your own domain"],
  },
  business: {
    id: "business",
    name: "Business",
    tagline: "For several branches or a whole company.",
    monthlyCentavos: 399_900,
    public: true,
    pausedBySafetySwitch: false,
    limits: {
      credits: 20_000,
      workspaces: 25,
      members: 50,
      records: 100_000,
      storageMb: 50_000,
      emailsPerDay: 2_000,
      api: "full",
      customDomains: 3,
      designsPerDay: 50,
      interviewTurnsPerDay: 400,
      aiPer10Min: 120,
    },
    highlights: ["Everything in Pro", "Three custom domains", "Priority help from the team"],
  },
  internal: {
    id: "internal",
    name: "Internal",
    tagline: "The EveryOps team.",
    monthlyCentavos: 0,
    public: false,
    pausedBySafetySwitch: false,
    limits: {
      credits: UNLIMITED,
      workspaces: UNLIMITED,
      members: UNLIMITED,
      records: UNLIMITED,
      storageMb: UNLIMITED,
      emailsPerDay: 2_000,
      api: "full",
      customDomains: 10,
      designsPerDay: UNLIMITED,
      interviewTurnsPerDay: UNLIMITED,
      aiPer10Min: 120,
    },
    highlights: [],
  },
  demo: {
    id: "demo",
    name: "Demo",
    tagline: "The shared demo account.",
    monthlyCentavos: 0,
    public: false,
    pausedBySafetySwitch: true,
    limits: {
      credits: 3_000,
      workspaces: 10,
      members: 0,
      records: 10_000,
      storageMb: 500,
      emailsPerDay: 0,
      api: "none",
      customDomains: 0,
      designsPerDay: 10,
      interviewTurnsPerDay: 80,
      aiPer10Min: 30,
    },
    highlights: [],
  },
};

export const PUBLIC_PLANS = Object.values(PLANS).filter((p) => p.public);
export const PLAN_IDS = Object.keys(PLANS) as PlanId[];

export const isPlanId = (v: unknown): v is PlanId => typeof v === "string" && v in PLANS;
export const planOf = (id: string | null | undefined): Plan => (isPlanId(id) ? PLANS[id] : PLANS.free);

/** Yearly billing: twelve months for the price of ten. */
export const YEARLY_MONTHS_PAID = 10;
export const yearlyCentavos = (plan: Plan) => plan.monthlyCentavos * YEARLY_MONTHS_PAID;

/** Extra credits for the current month, bought when the allowance runs out instead of upgrading. */
export type CreditPack = { id: string; credits: number; centavos: number };
export const CREDIT_PACKS: CreditPack[] = [
  { id: "credits-2000", credits: 2_000, centavos: 24_900 },
  { id: "credits-10000", credits: 10_000, centavos: 99_900 },
];
export const packOf = (id: unknown) => CREDIT_PACKS.find((p) => p.id === id) ?? null;

/** ₱499, ₱1,499, ₱0. */
export function formatPeso(centavos: number): string {
  const pesos = centavos / 100;
  return `₱${pesos.toLocaleString("en-PH", { maximumFractionDigits: pesos % 1 ? 2 : 0 })}`;
}

export const isUnlimited = (n: number) => n >= UNLIMITED;
/** 1,000 or Unlimited. */
export const formatLimit = (n: number, unit = "") =>
  isUnlimited(n) ? "Unlimited" : `${n.toLocaleString("en-US")}${unit}`;

export const creditsFromMicros = (micros: number) => Math.round(micros / CREDIT_MICROS);

/** Storage limits in MB as people read them: 200 MB, 2 GB. */
export function formatStorage(mb: number): string {
  if (isUnlimited(mb)) return "Unlimited";
  return mb >= 1000 ? `${(mb / 1000).toLocaleString("en-US")} GB` : `${mb} MB`;
}

export const API_LABEL: Record<ApiAccess, string> = {
  none: "No API",
  read: "Read only",
  full: "Full access",
};

/** The permissions an API key may carry on a plan. */
export function apiAllows(access: ApiAccess, permission: string): boolean {
  if (access === "full") return true;
  if (access === "read") return permission === "records:read" || permission === "pages:read";
  return false;
}

/** The rows of the comparison table on the pricing page, in order. */
export const LIMIT_ROWS: { key: keyof PlanLimits; label: string; show: (l: PlanLimits) => string }[] = [
  { key: "credits", label: "AI credits each month", show: (l) => formatLimit(l.credits) },
  { key: "workspaces", label: "Workspaces", show: (l) => formatLimit(l.workspaces) },
  { key: "members", label: "Team members per workspace", show: (l) => formatLimit(l.members) },
  { key: "records", label: "Records per workspace", show: (l) => formatLimit(l.records) },
  { key: "storageMb", label: "File storage", show: (l) => formatStorage(l.storageMb) },
  { key: "emailsPerDay", label: "Automation emails a day", show: (l) => formatLimit(l.emailsPerDay) },
  { key: "api", label: "API, MCP and webhooks", show: (l) => API_LABEL[l.api] },
  {
    key: "customDomains",
    label: "Custom domains",
    show: (l) => (l.customDomains ? String(l.customDomains) : "—"),
  },
  { key: "designsPerDay", label: "New workspace designs a day", show: (l) => formatLimit(l.designsPerDay) },
];

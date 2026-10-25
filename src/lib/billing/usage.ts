import type { PlanId } from "./plans";

/** Account → Plan & usage: what the account is on and how much of each limit it has used. */
export type PlanUsage = {
  plan: PlanId;
  source: "assigned" | "default" | "site-admin" | "demo";
  status: string;
  suspended: boolean;
  suspendedReason: string | null;
  verified: boolean;
  email: string;
  /** The billing month (YYYY-MM-01) and when credits renew (YYYY-MM-DD). */
  month: string;
  renewsOn: string;
  credits: { used: number; allowance: number; bonus: number };
  /** Credits by feature this month, biggest first. */
  byFeature: { feature: string; credits: number; requests: number }[];
  workspaces: { used: number; starter: number };
  /** The workspace closest to each per-workspace limit. */
  members: { used: number; workspace: string | null };
  records: { used: number; workspace: string | null };
  storageBytes: number;
  emailsToday: number;
  customDomains: number;
  apiKeys: number;
  today: { designs: number; turns: number };
  /** Upgrades and credit packs asked for while payment is manual. */
  requests: { at: string; detail: Record<string, unknown> }[];
  /** Whether people can pay online yet. */
  paymentsOnline: boolean;
  /** Daily AI safety switch, for admins and for an explanation when free AI is paused. */
  safetySwitchOn: boolean;
};

/** /admin/accounts: one row per account. */
export type AccountRow = {
  id: string;
  name: string;
  email: string;
  verified: boolean;
  createdAt: string;
  plan: PlanId;
  source: PlanUsage["source"];
  status: string;
  suspended: boolean;
  suspendedReason: string | null;
  bonusCredits: number;
  note: string | null;
  creditsUsed: number;
  allowance: number;
  aiRequests: number;
  workspaces: number;
  records: number;
  storageBytes: number;
  lastAiAt: string | null;
  pendingRequest: string | null;
};

export type SpendOverview = {
  todayMicros: number;
  monthMicros: number;
  limitUsd: number;
  on: boolean;
  wastedMonthMicros: number;
};

const short = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
/** 0 B, 340 KB, 1.5 MB, 200 MB, 2 GB. */
export const formatBytes = (n: number) =>
  n >= 1e9
    ? `${short(Math.round(n / 1e8) / 10)} GB`
    : n >= 1e6
      ? `${short(Math.round(n / 1e5) / 10)} MB`
      : n >= 1e3
        ? `${Math.round(n / 1e3)} KB`
        : `${n} B`;

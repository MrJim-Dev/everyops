import type { AiFeature } from "@/lib/ai-usage";
import { formatLimit, formatStorage, type Plan } from "./plans";

/**
 * The decisions behind every plan limit, as plain functions of numbers the server has already read, so they're
 * tested without a database and the browser can explain a refusal with the same words.
 */

/** Where people see their plan, usage and limits. */
export const PLAN_PAGE = "/account#plan";

/**
 * Credits a feature must have left before it starts, roughly its usual cost, so an account at 990 of 1,000 credits
 * can't start a 150-credit workspace design. Its real cost is what's counted afterwards.
 */
export const FEATURE_RESERVE: Partial<Record<AiFeature, number>> = {
  "setup-design": 150,
  "setup-interview": 30,
  assistant: 20,
  "plan-change": 20,
  checkup: 10,
  memory: 10,
  import: 5,
  voice: 5,
};

export type AiRefusal =
  | "suspended"
  | "verify_email"
  | "safety_switch"
  | "credits"
  | "daily_designs"
  | "daily_turns";

export type AiDecision = { ok: true } | { ok: false; code: AiRefusal; message: string };

export type AiGate = {
  plan: Plan;
  /** Whether the person asking has a verified email (Google, or the link we email). */
  verified: boolean;
  /** The account that pays (the workspace's owner) is suspended. */
  suspended: boolean;
  /** Credits the paying account used this month. */
  usedCredits: number;
  /** Credits added for this month (an admin grant or a credit pack). */
  bonusCredits: number;
  /** Today's AI spending across EveryOps is over the safety limit. */
  safetySwitchOn: boolean;
  feature: AiFeature;
  /** The payer is someone else (a team member using the owner's workspace). */
  forOwner?: boolean;
};

export const allowanceOf = (plan: Plan, bonusCredits: number) =>
  plan.limits.credits + Math.max(0, bonusCredits);

export const remainingCredits = (plan: Plan, usedCredits: number, bonusCredits: number) =>
  Math.max(0, allowanceOf(plan, bonusCredits) - usedCredits);

/** Whether an AI request may start, checked before any Gemini call. */
export function decideAi(g: AiGate): AiDecision {
  const whose = g.forOwner ? "This workspace's owner has" : "You have";
  if (g.suspended)
    return {
      ok: false,
      code: "suspended",
      message: g.forOwner
        ? "AI is paused on this workspace's account. Ask its owner to contact EveryOps."
        : "AI is paused on your account. Contact the EveryOps team to sort it out.",
    };
  if (!g.verified)
    return {
      ok: false,
      code: "verify_email",
      message: "Verify your email address to use AI. Send yourself a link from Account → Plan & usage.",
    };
  if (g.safetySwitchOn && g.plan.pausedBySafetySwitch)
    return {
      ok: false,
      code: "safety_switch",
      message:
        "AI on free accounts is paused for the rest of the day because of unusually high use. It's back tomorrow, or right away on a paid plan.",
    };
  const left = remainingCredits(g.plan, g.usedCredits, g.bonusCredits);
  const reserve = FEATURE_RESERVE[g.feature] ?? 1;
  if (left < reserve)
    return {
      ok: false,
      code: "credits",
      message:
        left <= 0
          ? `${whose} used this month's AI credits. They renew on the 1st; add credits or upgrade in Account → Plan & usage.`
          : `${whose} ${left} AI credits left this month, and this usually takes about ${reserve}. Add credits or upgrade in Account → Plan & usage.`,
    };
  return { ok: true };
}

export function dailyCapMessage(code: "daily_designs" | "daily_turns", plan: Plan): string {
  return code === "daily_designs"
    ? `The ${plan.name} plan designs up to ${plan.limits.designsPerDay} workspaces a day. Try again tomorrow, or upgrade for more.`
    : `The ${plan.name} plan allows ${plan.limits.interviewTurnsPerDay} setup messages a day. Try again tomorrow, or upgrade for more.`;
}

export type CountedLimit =
  | "workspaces"
  | "members"
  | "records"
  | "storageMb"
  | "customDomains"
  | "emailsPerDay";

/**
 * Whether adding brings a count past its limit. Removing, editing or staying put never fails, so an account that is
 * over a limit after a downgrade keeps its data and only can't add more.
 */
export const fits = (limit: number, current: number, adding: number) =>
  adding <= 0 || current + adding <= limit;

const plural = (n: number, word: string) => `${formatLimit(n)} ${word}${n === 1 ? "" : "s"}`;

export function limitMessage(kind: CountedLimit, plan: Plan): string {
  const l = plan.limits;
  const upgrade = "Upgrade in Account → Plan & usage for more.";
  switch (kind) {
    case "workspaces":
      return `The ${plan.name} plan includes ${plural(l.workspaces, "workspace")} besides the starter ones. Delete one or upgrade in Account → Plan & usage.`;
    case "members":
      return l.members
        ? `The ${plan.name} plan allows ${plural(l.members, "team member")} per workspace, invites included. ${upgrade}`
        : `The ${plan.name} plan doesn't include a team.`;
    case "records":
      return `This workspace has reached the ${plan.name} plan's ${formatLimit(l.records)} records. Remove old records or upgrade in Account → Plan & usage.`;
    case "storageMb":
      return `This account has used its ${formatStorage(l.storageMb)} of file storage. ${upgrade}`;
    case "customDomains":
      return l.customDomains
        ? `The ${plan.name} plan includes ${plural(l.customDomains, "custom domain")}. ${upgrade}`
        : `Custom domains come with the Pro plan. ${upgrade}`;
    case "emailsPerDay":
      return `Over the ${plan.name} plan's ${formatLimit(l.emailsPerDay)} automation emails a day.`;
  }
}

/** A share for meters: 0–100 (a zero limit reads as full). */
export const share = (used: number, limit: number) =>
  limit <= 0 ? 100 : Math.min(100, (used / limit) * 100);

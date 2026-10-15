import type { ChangePlan } from "@/lib/engine/changes";

/**
 * How much Ask EveryOps may do on its own in a workspace, set by the owner in Settings → Assistant. Every level
 * still respects the person's role, and whatever applies on its own is saved to History and can be undone.
 */
export const AUTONOMY_LEVELS = ["read_only", "ask", "auto_data", "autonomous"] as const;
export type Autonomy = (typeof AUTONOMY_LEVELS)[number];

export type AssistantPermissions = {
  autonomy: Autonomy;
  /** Removals (records, pages, fields, record types) wait for approval at every level. */
  confirmDeletes: boolean;
  /** The assistant saves facts and preferences people mention to the workspace's memory. */
  learn: boolean;
};

export const DEFAULT_PERMISSIONS: AssistantPermissions = {
  autonomy: "ask",
  confirmDeletes: true,
  learn: true,
};

export const AUTONOMY_INFO: Record<Autonomy, { label: string; detail: string }> = {
  read_only: {
    label: "Read only",
    detail: "Answers questions and explains the workspace. It never prepares changes.",
  },
  ask: {
    label: "Ask for approval",
    detail: "Prepares every change as a plan. Nothing changes until someone presses Apply.",
  },
  auto_data: {
    label: "Auto-apply data",
    detail:
      "Record and page-text changes apply on their own. Changes to pages, fields, automations and the team wait for approval.",
  },
  autonomous: {
    label: "Full autonomy",
    detail:
      "Applies changes on its own, design included. Team invites and role changes still wait for approval.",
  },
};

/** Reads stored settings, filling in anything missing or unknown with the defaults. */
export function normalizePermissions(raw: unknown): AssistantPermissions {
  const p = (raw && typeof raw === "object" ? raw : {}) as Partial<AssistantPermissions>;
  return {
    autonomy: AUTONOMY_LEVELS.includes(p.autonomy as Autonomy) ? (p.autonomy as Autonomy) : "ask",
    confirmDeletes: typeof p.confirmDeletes === "boolean" ? p.confirmDeletes : true,
    learn: typeof p.learn === "boolean" ? p.learn : true,
  };
}

/** Whether a plan removes anything: records, or parts of the design. */
export function removesSomething(plan: Pick<ChangePlan, "ops" | "recordOps">) {
  return (
    plan.ops.some((op) => op.op.startsWith("remove_")) ||
    (plan.recordOps ?? []).some((op) => op.op === "delete_record")
  );
}

/** Whether a checked plan applies without anyone pressing Apply. */
export function appliesOnItsOwn(
  plan: Pick<ChangePlan, "ops" | "recordOps" | "teamOps">,
  permissions: AssistantPermissions,
): boolean {
  if (permissions.autonomy === "read_only" || permissions.autonomy === "ask") return false;
  // Invites send email and roles change what people can see: always a person's decision.
  if (plan.teamOps?.length) return false;
  if (permissions.confirmDeletes && removesSomething(plan)) return false;
  if (permissions.autonomy === "auto_data") return plan.ops.length === 0;
  return true;
}

/** What the assistant is told about its permissions, after the person's role. */
export function permissionsText(permissions: AssistantPermissions) {
  switch (permissions.autonomy) {
    case "read_only":
      return "The owner has set you to read only in this workspace: answer questions only and never return a plan. For changes, say an owner or admin can allow them in Settings → Assistant.";
    case "auto_data":
      return `Data changes you plan (records, page text) apply as soon as you answer; design changes wait for approval.${
        permissions.confirmDeletes ? " Removals always wait for approval." : ""
      } Write the reply for a data-only plan as done, in the past tense ("Marked Miguel's booking paid."); for the rest, say it's ready to apply.`;
    case "autonomous":
      return `Plans you make apply as soon as you answer (team changes wait for approval${
        permissions.confirmDeletes ? ", and so do removals" : ""
      }). Keep plans to what was asked and write the reply as done, in the past tense ("Renamed Players to Members."),${
        permissions.confirmDeletes ? " except a plan that removes something, which is ready to apply" : ""
      }.`;
    default:
      return "";
  }
}

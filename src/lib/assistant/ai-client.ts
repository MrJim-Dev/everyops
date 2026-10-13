"use client";

import type { AttachmentRef } from "@/lib/assistant/attachments";
import type { Blueprint } from "@/lib/blueprint/types";
import type { ChangePlan } from "@/lib/engine/changes";
import type { OptionUsage } from "@/lib/engine/options";
import { type PlanResult, planChange } from "./planner";

export type AiPlanResult = PlanResult & { source?: "gemini" | "basic"; model?: string };

/**
 * Plans a change with Gemini on the server. If Gemini can't be reached, the built-in planner
 * handles the requests it knows, so the demo keeps working; the plan says which one answered.
 */
export async function requestPlan(
  blueprint: Blueprint,
  request: string,
  attachments: AttachmentRef[] = [],
  optionUsage: OptionUsage = {},
): Promise<AiPlanResult> {
  try {
    const response = await fetch("/api/ai/plan-change", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ blueprint, request, attachments, optionUsage }),
    });
    const body = (await response.json().catch(() => null)) as
      | { ok: true; plan: ChangePlan; model: string }
      | { ok: false; message: string; kind?: string }
      | null;
    if (body?.ok) return { ok: true, plan: body.plan, source: "gemini", model: body.model };
    if (body && response.status !== 502) return { ok: false, message: body.message };
  } catch {
    // Network failure: fall through to the built-in planner.
  }
  const fallback = planChange(blueprint, request);
  return fallback.ok ? { ...fallback, source: "basic" } : fallback;
}

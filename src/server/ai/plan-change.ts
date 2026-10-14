import "server-only";
import type { AttachmentRef } from "@/lib/assistant/attachments";
import type { Blueprint, Field } from "@/lib/blueprint/types";
import { validateBlueprint } from "@/lib/blueprint/validate";
import { applyOps, type ChangeOp, type ChangePlan } from "@/lib/engine/changes";
import { type OptionUsage, strandedOptions } from "@/lib/engine/options";
import { attachmentParts } from "./attachments";
import { generateJson } from "./gemini";
import { type Answer, answer, SYSTEM } from "./plan-change-prompt";

export type PlanChangeResult =
  | { ok: true; plan: ChangePlan; model: string }
  | { ok: false; message: string; kind: "clarify" | "unsupported" | "error" };

/** Turns the model's flat operations into ChangeOps, rejecting anything that doesn't fit the blueprint. */
function toOps(
  bp: Blueprint,
  raw: NonNullable<Answer["ops"]>,
  usage: OptionUsage,
): { ops: ChangeOp[]; errors: string[] } {
  const ops: ChangeOp[] = [];
  const errors: string[] = [];
  const added = new Map<string, Set<string>>();
  for (const [i, o] of raw.entries()) {
    const at = `ops[${i}] (${o.op})`;
    const entityId = "entityId" in o ? o.entityId : undefined;
    const entity = entityId ? bp.entities.find((e) => e.id === entityId) : undefined;
    switch (o.op) {
      case "add_field": {
        if (!entity || !o.field) {
          errors.push(`${at}: needs an existing entityId and a field`);
          continue;
        }
        if (!/^[a-z][a-z0-9_]*$/.test(o.field.id)) {
          errors.push(`${at}: field id must be snake_case`);
          continue;
        }
        if (entity.fields.some((f) => f.id === o.field?.id)) {
          errors.push(`${at}: ${entity.name} already has a field "${o.field.id}"`);
          continue;
        }
        const field = o.field as Field;
        ops.push({ op: "add_field", entityId: entity.id, field });
        added.set(entity.id, (added.get(entity.id) ?? new Set()).add(field.id));
        continue;
      }
      case "update_field": {
        const field = entity?.fields.find((f) => f.id === o.fieldId);
        if (!entity || !field || !o.patch) {
          errors.push(`${at}: needs an existing entityId, fieldId and a patch`);
          continue;
        }
        if (o.patch.formula && field.type !== "formula") {
          errors.push(`${at}: ${field.name} is not a formula field, so it can't get a formula`);
          continue;
        }
        ops.push({ op: "update_field", entityId: entity.id, fieldId: field.id, patch: o.patch });
        continue;
      }
      case "add_view_field": {
        const view = bp.views.find((v) => v.id === o.viewId);
        if (!view || view.type !== "table" || !o.fieldId) {
          errors.push(`${at}: needs an existing table viewId`);
          continue;
        }
        const exists =
          bp.entities.find((e) => e.id === view.entityId)?.fields.some((f) => f.id === o.fieldId) ||
          added.get(view.entityId)?.has(o.fieldId);
        if (!exists) {
          errors.push(`${at}: "${o.fieldId}" is not a field of that view's entity`);
          continue;
        }
        ops.push({ op: "add_view_field", viewId: view.id, fieldId: o.fieldId });
        continue;
      }
      case "set_view_fields": {
        const view = bp.views.find((v) => v.id === o.viewId);
        if (!view || view.type !== "table" || !o.fieldIds?.length) {
          errors.push(`${at}: needs an existing table viewId and fieldIds`);
          continue;
        }
        const own = bp.entities.find((e) => e.id === view.entityId)?.fields.map((f) => f.id) ?? [];
        const known = new Set([...own, ...(added.get(view.entityId) ?? [])]);
        const unknown = o.fieldIds.filter((id) => !known.has(id));
        if (unknown.length) {
          errors.push(
            `${at}: ${unknown.join(", ")} aren't fields of that table (fields: ${[...known].join(", ")})`,
          );
          continue;
        }
        ops.push({ op: "update_view", viewId: view.id, patch: { fieldIds: o.fieldIds } });
        continue;
      }
      case "rename_workspace": {
        const name = o.name?.trim();
        if (!name) {
          errors.push(`${at}: needs a name`);
          continue;
        }
        ops.push({ op: "rename_workspace", name });
        continue;
      }
    }
  }
  if (!errors.length) {
    // Only report problems the plan introduces, not ones the blueprint already had.
    const before = new Set(validateBlueprint(bp).map((e) => `${e.path} ${e.message}`));
    const next = applyOps(bp, ops);
    for (const e of validateBlueprint(next))
      if (!before.has(`${e.path} ${e.message}`)) errors.push(`${e.path}: ${e.message}`);
    // This planner can't move records, so an option that records use can't be dropped here.
    errors.push(...strandedOptions(bp, next, usage));
  }
  return { ops, errors };
}

/** Plans a change with Gemini. Invalid plans get one repair attempt with the validator's errors. */
/** Keeps model-written text short even if it runs on; the plan itself is what was validated. */
function clip(text: string, max: number) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 15)).replace(/[\s,.;:–-]+$/, "")}…`;
}

export async function planChangeWithGemini(
  bp: Blueprint,
  request: string,
  files?: { userId: string; attachments: AttachmentRef[] },
  /** Which options the workspace's records use, so a plan can't drop one out from under them. */
  usage: OptionUsage = {},
): Promise<PlanChangeResult> {
  const context = `Blueprint (JSON):\n${JSON.stringify(bp)}\n\nOwner's request: ${request}`;
  const fileParts = files ? await attachmentParts(files.userId, files.attachments) : [];
  const withFiles = (text: string) => (fileParts.length ? [{ text }, ...fileParts] : text);
  let prompt = withFiles(context);
  let repaired = false;
  // Up to three calls: transient failures (timeouts, malformed JSON) are retried, invalid plans get one repair.
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await generateJson(answer, { system: SYSTEM, prompt, task: "plan-change" });
    if (!result.ok) {
      if (result.retryable && attempt < 2) continue;
      return { ok: false, kind: "error", message: result.error };
    }
    const a = result.data;
    if (a.status !== "plan")
      return {
        ok: false,
        kind: a.status,
        message: clip(a.message || "I couldn't plan that change. Try describing it differently.", 240),
      };
    const { ops, errors } = toOps(bp, a.ops, usage);
    if (!errors.length && ops.length)
      return {
        ok: true,
        model: result.model,
        plan: {
          request,
          title: clip(a.title || "Workspace change", 60),
          facts: a.facts.slice(0, 6).map((f) => ({ label: clip(f.label, 40), value: clip(f.value, 100) })),
          steps: a.steps
            .slice(0, 8)
            .map((st) => ({ ...st, label: clip(st.label, 50), detail: clip(st.detail, 140) })),
          ops,
        },
      };
    console.warn(JSON.stringify({ event: "plan_rejected", attempt, errors }));
    if (repaired) break;
    repaired = true;
    prompt = withFiles(
      `${context}\n\nYour previous plan was rejected:\n- ${errors.length ? errors.join("\n- ") : "it had no operations"}\nReturn a corrected plan.`,
    );
  }
  return { ok: false, kind: "error", message: "I couldn't make a valid plan for that. Try rephrasing it." };
}

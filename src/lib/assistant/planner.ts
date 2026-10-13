/**
 * Change planner for "Ask for a change". This frontend build recognises a
 * few requests with patterns; Gemini replaces planChange() later. Whatever
 * produces the plan, the engine computes its impact and applies it the same way.
 */
import { findField } from "@/lib/blueprint/lookup";
import type { Blueprint, Entity, Field } from "@/lib/blueprint/types";
import type { ChangeOp, ChangePlan } from "@/lib/engine/changes";
import { formatMoney } from "@/lib/format";

export type PlanResult = { ok: true; plan: ChangePlan } | { ok: false; message: string };

export const EXAMPLE_REQUESTS = [
  "Charge ₱520 during peak hours and give members 10% off",
  "Add a notes field to bookings",
  "Rename the workspace to Court House Cebu",
];

const hourLabel = (h: number) => `${h % 12 || 12} ${h < 12 ? "AM" : "PM"}`;

function bookingWithRate(bp: Blueprint): Entity | undefined {
  return bp.entities.find((e) => e.booking && e.fields.some((f) => f.id === "rate" && f.formula));
}

function planPricing(bp: Blueprint, request: string): PlanResult {
  const booking = bookingWithRate(bp);
  if (!booking?.booking) return { ok: false, message: "This workspace has no booking prices to change yet." };
  const timeField = booking.booking.timeFieldId;
  const personField = booking.fields.find(
    (f) => f.type === "relation" && f.id !== booking.booking?.resourceFieldId,
  );
  const person = personField?.relation
    ? bp.entities.find((e) => e.id === personField.relation?.entityId)
    : undefined;

  const rateField = findField(booking, "rate");
  const current = Number(rateField?.formula?.expr);
  const base = Number.isFinite(current) ? current : 400;
  const peak = Number(/₱?\s?(\d{3,5})/.exec(request)?.[1] ?? Math.round(base * 1.3));
  const percent = Number(/(\d{1,2})\s?%/.exec(request)?.[1] ?? 0);
  const wantsMembers = /member/i.test(request) && percent > 0 && person && personField;
  const [from, to] = [17, 22];

  const ops: ChangeOp[] = [];
  const steps: ChangePlan["steps"] = [];
  const facts: ChangePlan["facts"] = [
    { label: "Peak hours", value: `${hourLabel(from)} – ${hourLabel(to)}` },
  ];

  ops.push({
    op: "update_field",
    entityId: booking.id,
    fieldId: "rate",
    patch: {
      formula: {
        ...(rateField?.formula ?? { resultType: "money" }),
        expr: `hour(${timeField}) >= ${from} && hour(${timeField}) < ${to} ? ${peak} : ${base}`,
      },
    },
  });
  steps.push({
    kind: "change",
    label: "Peak-hour rate",
    detail: `${formatMoney(base)} → ${formatMoney(peak)} per hour`,
  });

  if (wantsMembers && person && personField) {
    facts.push({ label: "Member discount", value: `${percent}%` });
    if (!person.fields.some((f) => f.id === "member")) {
      const member: Field = { id: "member", name: "Member", type: "checkbox" };
      ops.push({ op: "add_field", entityId: person.id, field: member });
      const table = bp.views.find((v) => v.type === "table" && v.entityId === person.id);
      if (table) ops.push({ op: "add_view_field", viewId: table.id, fieldId: "member" });
      steps.push({
        kind: "add",
        label: `Member status on ${person.pluralName.toLowerCase()}`,
        detail: "A checkbox you can tick per person",
      });
    }
    const amount = findField(booking, "amount");
    ops.push({
      op: "update_field",
      entityId: booking.id,
      fieldId: "amount",
      patch: {
        formula: {
          ...(amount?.formula ?? { resultType: "money" }),
          expr: `rate * duration_hours(${timeField}) * (${personField.id}.member ? ${(100 - percent) / 100} : 1)`,
        },
      },
    });
    steps.push({
      kind: "change",
      label: "Member price",
      detail: `${formatMoney(peak)} → ${formatMoney(Math.round(peak * (100 - percent)) / 100)} per peak hour`,
    });
  }
  return { ok: true, plan: { request, title: "Pricing changes", facts, steps, ops } };
}

function planAddField(bp: Blueprint, request: string, match: RegExpExecArray): PlanResult {
  const label = match[1].trim().replace(/^(a|an|the)\s+/i, "");
  const target = match[2]?.trim().toLowerCase();
  const entity =
    bp.entities.find(
      (e) =>
        target &&
        (e.name.toLowerCase() === target ||
          e.pluralName.toLowerCase() === target ||
          target.startsWith(e.name.toLowerCase())),
    ) ??
    bp.entities.find((e) => e.booking) ??
    bp.entities[0];
  if (!entity) return { ok: false, message: "This workspace has nothing to add a field to yet." };
  const id = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  if (entity.fields.some((f) => f.id === id))
    return { ok: false, message: `${entity.pluralName} already have a ${label} field.` };
  const type: Field["type"] = /date|deadline|birthday/i.test(label)
    ? "date"
    : /amount|price|fee|cost|deposit/i.test(label)
      ? "money"
      : /note|comment|description/i.test(label)
        ? "long_text"
        : /count|qty|quantity|number/i.test(label)
          ? "number"
          : "text";
  const name = label.charAt(0).toUpperCase() + label.slice(1);
  const ops: ChangeOp[] = [{ op: "add_field", entityId: entity.id, field: { id, name, type } }];
  for (const view of bp.views)
    if (view.type === "table" && view.entityId === entity.id)
      ops.push({ op: "add_view_field", viewId: view.id, fieldId: id });
  return {
    ok: true,
    plan: {
      request,
      title: `Add ${name.toLowerCase()} to ${entity.pluralName.toLowerCase()}`,
      facts: [{ label: "Applies to", value: entity.pluralName }],
      steps: [
        {
          kind: "add",
          label: name,
          detail: `New ${type.replace("_", " ")} field on every ${entity.name.toLowerCase()}`,
        },
      ],
      ops,
    },
  };
}

export function planChange(bp: Blueprint, request: string): PlanResult {
  const text = request.trim();
  if (!text) return { ok: false, message: "Describe the change you want." };
  if (/peak|member|discount|rate|price/i.test(text)) return planPricing(bp, text);
  const add = /add (.+?) (?:field|column)(?: (?:to|on) (.+))?$/i.exec(text);
  if (add) return planAddField(bp, text, add);
  const rename = /rename (?:the )?workspace to (.+)$/i.exec(text);
  if (rename)
    return {
      ok: true,
      plan: {
        request: text,
        title: "Rename workspace",
        facts: [{ label: "New name", value: rename[1].trim() }],
        steps: [
          { kind: "change", label: "Workspace name", detail: `${bp.workspaceName} → ${rename[1].trim()}` },
        ],
        ops: [{ op: "rename_workspace", name: rename[1].trim() }],
      },
    };
  return {
    ok: false,
    message:
      "I can't plan that change in this preview yet. Try changing prices, adding a field, or renaming the workspace.",
  };
}

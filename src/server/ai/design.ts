import "server-only";
import type { Part } from "@google/genai";
import type { AttachmentRef } from "@/lib/assistant/attachments";
import type {
  Block,
  Blueprint,
  DataRecord,
  Entity,
  Field,
  FieldValue,
  IconName,
  NotesView,
  Rule,
  View,
  Widget,
  WorkspaceData,
} from "@/lib/blueprint/types";
import { validateBlueprint } from "@/lib/blueprint/validate";
import { CATALOG } from "@/lib/catalog";
import { computeAll } from "@/lib/engine/compute";
import { isImagePath } from "@/lib/engine/records";
import { hhmm, todayKey } from "@/lib/time";
import { attachmentParts } from "./attachments";
import { DESIGN_SYSTEM, type Design, designRequest } from "./design-prompt";
import { generateJsonHedged } from "./gemini";

const SLOT_MINUTES = [15, 30, 60, 90, 120] as const;
const pick = <T extends object>(source: T, keys: (keyof T)[]) =>
  Object.fromEntries(keys.filter((k) => source[k] !== undefined).map((k) => [k, source[k]])) as Partial<T>;

/** Turns the model's view (optional keys) into the strict view type for its kind. */
export function toView(v: Design["views"][number]): View {
  const base = { id: v.id, entityId: v.entityId, name: v.name };
  switch (v.type) {
    case "table":
      return {
        ...base,
        type: "table",
        fieldIds: v.fieldIds ?? [],
        filter: v.filter,
        sort: v.sort,
        ...(v.groupByFieldId ? { groupByFieldId: v.groupByFieldId } : {}),
        ...(v.totals ? { totals: true } : {}),
      };
    case "kanban":
      return {
        ...base,
        type: "kanban",
        statusFieldId: v.statusFieldId ?? "",
        cardFieldIds: v.cardFieldIds ?? [],
        filter: v.filter,
      };
    case "calendar":
      return {
        ...base,
        type: "calendar",
        dateFieldId: v.dateFieldId ?? "",
        titleFieldId: v.titleFieldId ?? "",
        filter: v.filter,
      };
    case "slot_grid":
      return { ...base, type: "slot_grid" };
    case "checkout":
      return {
        ...base,
        type: "checkout",
        productEntityId: v.productEntityId ?? "",
        lineEntityId: v.lineEntityId ?? "",
        paymentFieldId: v.paymentFieldId ?? "",
      };
    case "approval_queue":
      return {
        ...base,
        type: "approval_queue",
        statusFieldId: v.statusFieldId ?? "",
        pending: v.pending ?? "",
        approve: v.approve ?? "",
        reject: v.reject ?? "",
        approveLabel: v.approveLabel ?? "Approve",
        rejectLabel: v.rejectLabel ?? "Decline",
        detailFieldIds: v.detailFieldIds ?? [],
      };
    case "form":
      return {
        ...base,
        type: "form",
        fieldIds: v.fieldIds ?? [],
        ...(v.intro ? { intro: v.intro } : {}),
        ...(v.submitLabel ? { submitLabel: v.submitLabel } : {}),
        ...(v.public ? { public: true } : {}),
        ...(v.blocks?.length ? { blocks: v.blocks as Block[] } : {}),
        ...(v.steps?.length ? { steps: v.steps } : {}),
        ...(v.steps?.length && v.review ? { review: true } : {}),
      };
    case "notes":
      return {
        ...base,
        type: "notes",
        titleFieldId: v.titleFieldId ?? "",
        bodyFieldId: v.bodyFieldId ?? "",
        metaFieldIds: v.metaFieldIds ?? [],
      };
    case "document":
      return { ...base, entityId: "", type: "document", ...(v.starter ? { starter: v.starter } : {}) };
    case "canvas":
      return { ...base, entityId: "", type: "canvas" };
    case "landing":
      return {
        ...base,
        entityId: "",
        type: "landing",
        blocks: (v.blocks ?? []) as Block[],
        ...(v.public === false ? { public: false } : {}),
      };
  }
}

export function toEntity(e: Design["entities"][number]): Entity {
  const fields = e.fields.map((f) => {
    const out: Field = {
      id: f.id,
      name: f.name,
      type: f.type,
      ...pick(f, ["required", "description", "options", "range", "relation", "formula", "rollup"]),
    };
    return out;
  });
  const want = e.resource?.slotMinutes ?? 60;
  const resource = e.resource
    ? {
        ...e.resource,
        slotMinutes: SLOT_MINUTES.reduce((a, b) => (Math.abs(b - want) < Math.abs(a - want) ? b : a)),
      }
    : undefined;
  return {
    id: e.id,
    name: e.name,
    pluralName: e.pluralName,
    primaryFieldId: e.primaryFieldId,
    fields,
    ...pick({ ...e, resource }, ["parent", "booking", "resource"]),
  };
}

export function toRule(r: Design["rules"][number]): Rule {
  const target = (t?: { kind: "self" | "relation"; fieldId?: string }) =>
    t?.kind === "relation"
      ? { kind: "relation" as const, fieldId: t.fieldId ?? "" }
      : { kind: "self" as const };
  return {
    ...r,
    actions: r.actions.map((a) =>
      a.type === "notify"
        ? { type: "notify" as const, message: a.message ?? "" }
        : a.type === "set_field"
          ? {
              type: "set_field" as const,
              target: target(a.target),
              fieldId: a.fieldId ?? "",
              value: a.value ?? "null",
            }
          : {
              type: "adjust_number" as const,
              target: target(a.target),
              fieldId: a.fieldId ?? "",
              delta: a.delta ?? "0",
            },
    ),
  };
}

function toBlueprint(d: Design): Blueprint {
  return {
    version: 1,
    workspaceName: d.workspaceName,
    systems: d.systems,
    entities: d.entities.map(toEntity),
    views: d.views.map(toView),
    widgets: d.widgets as Widget[],
    rules: d.rules.map(toRule),
  };
}

/**
 * Fixes small, unambiguous slips so they don't cost a whole repair round: a computed field used as the
 * record name, status fields without stages, links to record types that don't exist, screens and
 * widgets that point at missing fields, and empty sidebar sections.
 */
export function tidy(bp: Blueprint): Blueprint {
  // Resolve loose references ("projects", "Project") to the real record type id.
  const norm = (x: string) =>
    x
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")
      .replace(/(es|s)$/, "");
  const byName = new Map<string, string>();
  for (const e of bp.entities) for (const k of [e.id, e.name, e.pluralName]) byName.set(norm(k), e.id);
  const resolve = (id: string | undefined) =>
    id === undefined ? id : bp.entities.some((e) => e.id === id) ? id : (byName.get(norm(id)) ?? id);
  for (const e of bp.entities) {
    if (e.parent) e.parent.entityId = resolve(e.parent.entityId) as string;
    for (const f of e.fields) {
      if (f.relation) f.relation.entityId = resolve(f.relation.entityId) as string;
      if (f.rollup) f.rollup.childEntityId = resolve(f.rollup.childEntityId) as string;
    }
  }
  for (const v of bp.views) {
    v.entityId = resolve(v.entityId) as string;
    if (v.type === "checkout") {
      v.productEntityId = resolve(v.productEntityId) as string;
      v.lineEntityId = resolve(v.lineEntityId) as string;
    }
  }
  for (const w of bp.widgets) {
    w.entityId = resolve(w.entityId) as string;
    for (const t of w.calc?.terms ?? []) t.entityId = resolve(t.entityId) as string;
  }
  for (const r of bp.rules) r.trigger.entityId = resolve(r.trigger.entityId) as string;
  // "patient.name" when Patient's name field is called something else: point it at the primary field.
  const fixRefs = (entity: Entity, expr: string) =>
    expr.replace(/\b([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\b/g, (whole, rel: string, target: string) => {
      const field = entity.fields.find((x) => x.id === rel);
      const other = bp.entities.find((x) => x.id === field?.relation?.entityId);
      if (!other || other.fields.some((x) => x.id === target)) return whole;
      if (/^(name|title|label|full_name)$/.test(target)) return `${rel}.${other.primaryFieldId}`;
      // "court.peak_rate" when the court's money fields are called something else: pick the matching one.
      if (/price|rate|cost|fee|amount/.test(target)) {
        const money = other.fields.filter(
          (x) => x.type === "money" || (x.type === "formula" && x.formula?.resultType === "money"),
        );
        const peak = /peak|evening|night|prime/;
        const base = /std|standard|day|regular|base|off/;
        const pick =
          (peak.test(target) && money.find((x) => peak.test(x.id))) ||
          (base.test(target) && money.find((x) => base.test(x.id) || !peak.test(x.id))) ||
          (money.length === 1 && money[0]) ||
          money.find((x) => target.split("_").some((part) => part.length > 2 && x.id.includes(part)));
        if (pick) return `${rel}.${pick.id}`;
      }
      return whole;
    });
  for (const e of bp.entities)
    for (const f of e.fields)
      if (f.formula) {
        f.formula.expr = fixRefs(e, f.formula.expr);
        if (f.formula.freezeWhen) f.formula.freezeWhen = fixRefs(e, f.formula.freezeWhen);
      }
  const entityIds = new Set(bp.entities.map((e) => e.id));
  for (const e of bp.entities) {
    for (const f of e.fields) {
      if (f.type === "relation" && !entityIds.has(f.relation?.entityId ?? "")) {
        f.type = "text";
        delete f.relation;
      }
      if (f.type === "status" && !f.options?.length)
        f.options = [
          { id: "todo", label: "To do", tone: "neutral" },
          { id: "in_progress", label: "In progress", tone: "accent" },
          { id: "done", label: "Done", tone: "success" },
        ];
      if ((f.type === "select" || f.type === "multi_select") && !f.options?.length) {
        f.type = "text";
        delete f.options;
      }
    }
    const primary = e.fields.find((x) => x.id === e.primaryFieldId);
    if (!primary || primary.type === "formula" || primary.type === "rollup" || primary.type === "relation") {
      const text = e.fields.find((x) => x.type === "text");
      if (text) e.primaryFieldId = text.id;
      else {
        const id = e.fields.some((x) => x.id === "title") ? "record_title" : "title";
        e.fields.unshift({ id, name: "Title", type: "text", required: true });
        e.primaryFieldId = id;
      }
    }
  }
  const fieldsOf = (entityId: string) =>
    new Set(bp.entities.find((e) => e.id === entityId)?.fields.map((x) => x.id) ?? []);
  bp.views = bp.views.filter((v) =>
    v.type === "document" || v.type === "canvas" || v.type === "landing" ? true : entityIds.has(v.entityId),
  );
  const formIds = new Set(bp.views.filter((v) => v.type === "form").map((v) => v.id));
  for (const v of bp.views) {
    if (v.type === "document" || v.type === "canvas" || v.type === "landing") {
      v.entityId = "";
      if (v.type === "landing") v.blocks = tidyBlocks(v.blocks, resolve, fieldsOf, formIds);
      continue;
    }
    const has = fieldsOf(v.entityId);
    if (v.type === "form") {
      v.fieldIds = v.fieldIds.filter((id) => has.has(id));
      if (v.blocks) v.blocks = tidyBlocks(v.blocks, resolve, fieldsOf, formIds);
      if (v.steps) {
        // Each field in one step, only real fields, and no empty steps.
        const seen = new Set<string>();
        v.steps = v.steps
          .map((s) => ({
            ...s,
            fieldIds: s.fieldIds.filter((id) => has.has(id) && !seen.has(id) && seen.add(id)),
          }))
          .filter((s) => s.fieldIds.length);
        if (v.steps.length < 2) {
          delete v.steps;
          delete v.review;
        }
      }
    }
    if (v.type === "notes") {
      const entity = bp.entities.find((e) => e.id === v.entityId);
      if (entity) fillNotesView(v, entity);
    }
    if (v.type === "table") {
      v.fieldIds = v.fieldIds.filter((id) => has.has(id));
      if (!v.fieldIds.length) v.fieldIds = [...has].slice(0, 5);
      v.sort = v.sort?.filter((x) => has.has(x.fieldId));
      if (v.groupByFieldId && !has.has(v.groupByFieldId)) delete v.groupByFieldId;
    }
    if (v.type === "kanban") v.cardFieldIds = v.cardFieldIds.filter((id) => has.has(id));
    if (v.type === "approval_queue") {
      // The designer isn't asked for these (they were where Gemini ran away), so they come from the record type:
      // button labels from its status options, details from its first plain fields.
      const entity = bp.entities.find((e) => e.id === v.entityId);
      const status = entity?.fields.find((f) => f.id === v.statusFieldId);
      const label = (id: string, fallback: string) => {
        const name =
          status?.options
            ?.find((o) => o.id === id)
            ?.label.toLowerCase()
            .trim() ?? "";
        return BUTTON_VERBS[name] ?? fallback;
      };
      if (v.approveLabel === "Approve") v.approveLabel = label(v.approve, "Approve");
      if (v.rejectLabel === "Decline") v.rejectLabel = label(v.reject, "Decline");
      v.detailFieldIds = v.detailFieldIds.filter((id) => has.has(id));
      if (!v.detailFieldIds.length && entity)
        v.detailFieldIds = entity.fields
          .filter(
            (f) =>
              f.id !== entity.primaryFieldId &&
              f.id !== v.statusFieldId &&
              !["long_text", "rollup"].includes(f.type),
          )
          .slice(0, 4)
          .map((f) => f.id);
    }
  }
  bp.widgets = bp.widgets.filter((w) => {
    // A progress bar needs a target, which the designer isn't asked for: it shows as a total instead.
    if (w.type === "progress" && !w.target) w.type = "stat";
    if (w.calc) {
      // A formula card keeps only totals that point at real record types and fields.
      w.calc.terms = w.calc.terms.filter(
        (t) =>
          entityIds.has(t.entityId) &&
          (t.op === "count" || (!!t.fieldId && fieldsOf(t.entityId).has(t.fieldId))),
      );
      if (!w.calc.terms.length || (w.type !== "stat" && w.type !== "progress")) delete w.calc;
      else w.entityId = w.calc.terms[0].entityId;
    }
    if (!entityIds.has(w.entityId)) return false;
    const has = fieldsOf(w.entityId);
    if (w.metric.fieldId && !has.has(w.metric.fieldId)) return false;
    if (w.type === "chart") {
      const chart = w.chart;
      if (!chart) return false;
      if (chart.groupByFieldId && !has.has(chart.groupByFieldId)) delete chart.groupByFieldId;
      if (chart.dateFieldId && !has.has(chart.dateFieldId)) delete chart.dateFieldId;
      if (chart.splitByFieldId && !has.has(chart.splitByFieldId)) delete chart.splitByFieldId;
      if (chart.kind === "donut" && !chart.groupByFieldId) chart.kind = "bar";
      if (!chart.bucket) chart.bucket = "day";
      if (!chart.groupByFieldId && !chart.dateFieldId) return false;
    }
    if (w.list) w.list.fieldIds = w.list.fieldIds.filter((id) => has.has(id));
    if (w.type === "list" && !w.list?.fieldIds.length) return false;
    const fieldOf = (id: string) =>
      bp.entities.find((e) => e.id === w.entityId)?.fields.find((f) => f.id === id);
    const dated = (id: string) => ["date", "datetime", "time_range"].includes(fieldOf(id)?.type ?? "");
    const timed = (id: string) => {
      const f = fieldOf(id);
      return !!f && (f.type === "datetime" || (f.type === "time_range" && f.range !== "dates"));
    };
    if (w.compare && (w.type !== "stat" || w.calc || !dated(w.compare.dateFieldId))) {
      delete w.compare;
      delete w.sparkline;
    }
    // A sparkline draws the comparison's daily values, so it means nothing without one.
    if (!w.compare) delete w.sparkline;
    if (w.type === "agenda") {
      if (!w.agenda || !dated(w.agenda.dateFieldId)) return false;
      w.agenda.fieldIds = w.agenda.fieldIds?.filter((id) => has.has(id)).slice(0, 3);
    } else delete w.agenda;
    if (w.type === "heatmap") {
      if (!w.heatmap || !timed(w.heatmap.dateFieldId)) return false;
    } else delete w.heatmap;
    return true;
  });
  const viewIds = new Set(bp.views.map((v) => v.id));
  const widgetIds = new Set(bp.widgets.map((w) => w.id));
  for (const w of bp.widgets) if (w.list?.viewId && !viewIds.has(w.list.viewId)) delete w.list.viewId;
  bp.systems = bp.systems
    .map((sys) => ({
      ...sys,
      viewIds: [...new Set(sys.viewIds.filter((id) => viewIds.has(id)))],
      widgetIds: [...new Set(sys.widgetIds.filter((id) => widgetIds.has(id)))],
    }))
    .filter((sys) => sys.viewIds.length + sys.widgetIds.length > 0);
  bp.rules = bp.rules.filter((r) => entityIds.has(r.trigger.entityId));
  return bp;
}

/** Problems the generic validator doesn't catch but would break a screen. */
function extraChecks(bp: Blueprint): string[] {
  const errors: string[] = [];
  const entityIds = new Set(bp.entities.map((e) => e.id));
  const viewIds = new Set(bp.views.map((v) => v.id));
  if (!bp.systems.length) errors.push("The workspace has no systems.");
  for (const e of bp.entities) {
    const primary = e.fields.find((f) => f.id === e.primaryFieldId);
    if (primary && (primary.type === "formula" || primary.type === "rollup"))
      errors.push(`${e.name}: the primary field must be a plain field`);
    for (const f of e.fields)
      if (f.type === "rollup" && f.rollup && !entityIds.has(f.rollup.childEntityId))
        errors.push(`${e.name}.${f.id}: rollup uses a missing record type`);
  }
  for (const w of bp.widgets) {
    const entity = bp.entities.find((e) => e.id === w.entityId);
    if (!entity) continue;
    const has = (id?: string) => !id || entity.fields.some((f) => f.id === id);
    if (!has(w.metric.fieldId)) errors.push(`Widget ${w.title}: field "${w.metric.fieldId}" is missing`);
    if (w.type === "chart" && (!w.chart || !has(w.chart.dateFieldId)))
      errors.push(`Widget ${w.title}: a chart needs a date field`);
    if (w.type === "list" && (!w.list || !w.list.fieldIds.every((id) => has(id))))
      errors.push(`Widget ${w.title}: list fields are missing`);
    if (w.list?.viewId && !viewIds.has(w.list.viewId))
      errors.push(`Widget ${w.title}: links to a missing view`);
  }
  return errors;
}

const toIso = (v: string) => {
  const t = v.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const withZone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(t) ? t : `${t.length === 16 ? `${t}:00` : t}+08:00`;
  const ms = Date.parse(withZone);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
};

/**
 * Turns a value Gemini wrote as text into the field's stored type. Returns undefined when it doesn't
 * fit (unknown option, unparseable date). `ref` resolves relation values to record ids.
 */
export function toFieldValue(
  field: Field,
  value: string,
  ref: (v: string) => string | undefined,
): FieldValue | undefined {
  const v = value.trim();
  switch (field.type) {
    case "formula":
    case "rollup":
      return undefined;
    case "number":
    case "money":
    case "percent": {
      if (v === "") return null;
      const n = Number(v.replace(/[₱,%\s]/g, ""));
      return Number.isFinite(n) ? n : undefined;
    }
    case "checkbox":
      return /^(true|yes|1)$/i.test(v);
    case "image":
      // Pictures are uploaded by people; the AI can't make one, so sample values are left empty.
      return isImagePath(v) ? v : null;
    case "relation":
      return v === "" ? null : ref(v);
    case "select":
    case "status": {
      const opt = field.options?.find((o) => o.id === v || o.label.toLowerCase() === v.toLowerCase());
      return opt?.id;
    }
    case "multi_select":
      return v
        .split(",")
        .map(
          (x) =>
            field.options?.find((o) => o.id === x.trim() || o.label.toLowerCase() === x.trim().toLowerCase())
              ?.id,
        )
        .filter((x): x is string => !!x);
    case "date": {
      const iso = toIso(v);
      return iso ? iso.slice(0, 10) : undefined;
    }
    case "datetime":
      return toIso(v) ?? undefined;
    case "time_range": {
      const [a, b] = v.split("/").map((x) => (x ? toIso(x) : null));
      if (!a || !b) return undefined;
      return field.range === "dates" ? { start: a.slice(0, 10), end: b.slice(0, 10) } : { start: a, end: b };
    }
    default:
      return v;
  }
}

/** Converts sample values (strings) into typed record data, dropping anything that doesn't fit. */
function toRecords(bp: Blueprint, samples: Design["samples"], now: Date): DataRecord[] {
  const stamp = now.toISOString();
  const ids = new Map<string, string>();
  for (const [i, s] of samples.entries()) ids.set(s.ref, `${s.entityId}_${i + 1}`);
  return samples.flatMap((s, i) => {
    const entity = bp.entities.find((e) => e.id === s.entityId);
    if (!entity) return [];
    const data: Record<string, FieldValue> = {};
    for (const { fieldId, value } of s.values) {
      const field = entity.fields.find((f) => f.id === fieldId);
      if (!field) continue;
      const converted = toFieldValue(field, value, (v) => ids.get(v));
      if (converted !== undefined) data[field.id] = converted;
    }
    if (!data[entity.primaryFieldId]) return [];
    return [{ id: `${s.entityId}_${i + 1}`, entityId: entity.id, data, createdAt: stamp, updatedAt: stamp }];
  });
}

const EXAMPLES = (() => {
  const now = new Date();
  return ["court-bookings", "canteen-pos"]
    .map((id) => CATALOG.find((s) => s.id === id)?.sample(now).blueprint)
    .filter(Boolean)
    .map((bp) => JSON.stringify(bp))
    .join("\n\n");
})();

export type DesignResult =
  | { ok: true; name: string; summary: string; data: WorkspaceData }
  | { ok: false; message: string };

/** Designs a workspace from the interview brief. Invalid designs get up to two repairs with the validator's errors. */
export async function designWorkspace(
  brief: string,
  workspaceName: string,
  files?: { userId: string; attachments: AttachmentRef[] },
): Promise<DesignResult> {
  const now = new Date();
  const context = `Examples:\n${EXAMPLES}\n\nToday in Manila: ${todayKey(now)}\nWorkspace name: ${workspaceName || "choose one"}\n\nBrief:\n${brief}`;
  // The owner's files go with the first request; a repair works from the previous design, which already used them.
  const fileParts = files ? await attachmentParts(files.userId, files.attachments) : [];
  let prompt: string | Part[] = fileParts.length
    ? [
        { text: context },
        ...fileParts,
        { text: "Design the workspace from the brief, using these files for real names, items and prices." },
      ]
    : context;
  let repairs = 0;
  for (let attempt = 0; attempt < 4; attempt++) {
    // Designs take 8–30 s; a stalled call gets a parallel twin after 35 s instead of a minute's wait, and a call
    // that runs away (see runawayWatcher) is stopped within seconds and replaced. Real designs are 2–7k tokens.
    const result = await generateJsonHedged(
      designRequest,
      {
        system: DESIGN_SYSTEM,
        prompt,
        task: "design",
        timeoutMs: 75_000,
        thinking: "LOW",
        maxOutputTokens: 16_000,
        enumLiterals: true,
      },
      { hedgeMs: 35_000, attempts: 4 },
    );
    if (!result.ok) return { ok: false, message: result.error };
    const raw = toBlueprint(result.data);
    const samples = mergeDateAndSlot(raw, result.data.samples);
    const bp = ensurePages(repairStructure(tidy(raw)));
    const errors = [...validateBlueprint(bp).map((e) => `${e.path}: ${e.message}`), ...extraChecks(bp)];
    if (!errors.length) {
      const records = computeAll(bp, toRecords(bp, samples, now), now);
      return {
        ok: true,
        name: result.data.workspaceName || workspaceName,
        summary: result.data.summary,
        data: { blueprint: bp, records },
      };
    }
    console.warn(JSON.stringify({ event: "design_rejected", attempt, errors: errors.slice(0, 15) }));
    if (++repairs > 2) break;
    prompt = `Today in Manila: ${todayKey(now)}\n\nBrief:\n${brief}\n\nYour previous design:\n${JSON.stringify(result.data)}\n\nIt has these problems:\n- ${errors.slice(0, 20).join("\n- ")}\nReturn the full corrected design.`;
  }
  return {
    ok: false,
    message: "I couldn't design a valid workspace for that yet. Add a detail or two and try again.",
  };
}

/** Approval buttons say what they do: a status called "Confirmed" gets a "Confirm" button. */
const BUTTON_VERBS: Record<string, string> = {
  confirmed: "Confirm",
  approved: "Approve",
  accepted: "Accept",
  verified: "Verify",
  paid: "Mark as paid",
  completed: "Complete",
  cancelled: "Cancel",
  canceled: "Cancel",
  rejected: "Reject",
  declined: "Decline",
  denied: "Deny",
};

const PAGE_ICONS: [RegExp, IconName][] = [
  [/court|room|venue|table|space|resource/, "court"],
  [/player|client|customer|member|guest|staff|employee|people|person|team|contact|supplier/, "users"],
  [/product|item|inventory|stock|menu|ingredient/, "package"],
  [/order|sale|invoice|payment|expense|transaction|receipt/, "receipt"],
  [/booking|appointment|reservation|event|schedule|shift|leave/, "calendar"],
  [/campaign|post|content/, "megaphone"],
];

/**
 * Every main record type gets a page people can manage it from. Gemini sometimes folds everything
 * into one section (bookings with the courts inside); this adds a plain table page for any record type
 * that has no screen anywhere. Line items (records with a parent) stay inside their parent.
 */
export function ensurePages(bp: Blueprint): Blueprint {
  const shown = new Set(
    bp.systems.flatMap((s) => s.viewIds).map((id) => bp.views.find((v) => v.id === id)?.entityId),
  );
  const taken = new Set([...bp.views.map((v) => v.id), ...bp.systems.map((s) => s.id)]);
  const unique = (id: string) => {
    let out = id;
    for (let n = 2; taken.has(out); n++) out = `${id}_${n}`;
    taken.add(out);
    return out;
  };
  for (const e of bp.entities) {
    if (e.parent || shown.has(e.id)) continue;
    const viewId = unique(`${e.id}_all`);
    bp.views.push({
      id: viewId,
      entityId: e.id,
      name: `All ${e.pluralName.toLowerCase()}`,
      type: "table",
      fieldIds: e.fields
        .filter((f) => f.type !== "long_text")
        .slice(0, 6)
        .map((f) => f.id),
    });
    const key = `${e.id} ${e.pluralName}`.toLowerCase();
    bp.systems.push({
      id: unique(`${e.id}_page`),
      name: e.pluralName,
      icon: PAGE_ICONS.find(([re]) => re.test(key))?.[1] ?? "briefcase",
      viewIds: [viewId],
      widgetIds: [],
    });
  }
  // Pages built for people outside the team (a website, a public form, a document) need a place in the sidebar too.
  const listed = new Set(bp.systems.flatMap((s) => s.viewIds));
  for (const v of bp.views) {
    if (
      listed.has(v.id) ||
      (v.type !== "landing" && v.type !== "form" && v.type !== "document" && v.type !== "canvas")
    )
      continue;
    bp.systems.push({
      id: unique(`${v.id}_page`),
      name: v.name,
      icon: v.type === "landing" ? "house" : v.type === "form" ? "calendar" : "image",
      viewIds: [v.id],
      widgetIds: [],
    });
  }
  return bp;
}

/**
 * A notebook needs a title and a markdown body. Points the view at the record type's name field and its first
 * long text field, adding a "Body" field if the record type has none.
 */
export function fillNotesView(view: NotesView, entity: Entity) {
  const has = (id: string | undefined) => !!id && entity.fields.some((f) => f.id === id);
  if (!has(view.titleFieldId)) view.titleFieldId = entity.primaryFieldId;
  if (!has(view.bodyFieldId) || entity.fields.find((f) => f.id === view.bodyFieldId)?.type !== "long_text") {
    let body = entity.fields.find((f) => f.type === "long_text");
    if (!body) {
      body = {
        id: entity.fields.some((f) => f.id === "body") ? "note_body" : "body",
        name: "Body",
        type: "long_text",
      };
      entity.fields.push(body);
    }
    view.bodyFieldId = body.id;
  }
  view.metaFieldIds = (view.metaFieldIds ?? []).filter(
    (id) => has(id) && id !== view.titleFieldId && id !== view.bodyFieldId,
  );
}

/** Blocks that point at real things: record types by their id, fields that exist, forms that exist. */
export function tidyBlocks(
  blocks: Block[],
  resolve: (id: string | undefined) => string | undefined,
  fieldsOf: (entityId: string) => Set<string>,
  formIds: Set<string>,
): Block[] {
  const seen = new Set<string>();
  return blocks.flatMap((b): Block[] => {
    if (seen.has(b.id)) return [];
    seen.add(b.id);
    if (b.type === "text") return [{ ...b, markdown: cleanCopy(b.markdown, 6000) ?? "" }];
    if (b.type === "records") {
      const entityId = resolve(b.entityId) as string;
      const has = fieldsOf(entityId);
      const fieldIds = b.fieldIds.filter((id) => has.has(id));
      return fieldIds.length
        ? [
            {
              ...b,
              title: cleanCopy(b.title, 80),
              entityId,
              fieldIds,
              sort: b.sort?.filter((s) => has.has(s.fieldId)),
            },
          ]
        : [];
    }
    if (b.type === "form") return formIds.has(b.viewId) ? [b] : [];
    if (b.type === "hero") {
      const hero = {
        ...b,
        heading: cleanCopy(b.heading, 90) ?? "",
        subheading: cleanCopy(b.subheading, 260),
        ctaLabel: cleanCopy(b.ctaLabel, 30),
      };
      if (hero.ctaViewId && !formIds.has(hero.ctaViewId)) {
        const { ctaViewId: _drop, ...rest } = hero;
        return [rest];
      }
      return [hero];
    }
    return [b];
  });
}

const RESERVED_PAGES: Record<string, string> = { settings: "Setup", history: "Log", search: "Lookup" };

/**
 * Structural slips that would quietly break features: a page named like one of the app's own, bookings without
 * booking settings (no schedule, no double-booking check, no public slots), and line items without a parent.
 */
export function repairStructure(bp: Blueprint): Blueprint {
  for (const s of bp.systems) {
    const fix = RESERVED_PAGES[s.name.trim().toLowerCase()];
    if (fix) s.name = fix;
  }
  for (const e of bp.entities) {
    if (!e.booking) {
      const resourceField = e.fields.find(
        (f) => f.type === "relation" && bp.entities.find((x) => x.id === f.relation?.entityId)?.resource,
      );
      const time = e.fields.find((f) => f.type === "time_range" && f.range !== "dates");
      const status = e.fields.find((f) => f.type === "status");
      if (resourceField && time && status)
        e.booking = {
          resourceFieldId: resourceField.id,
          timeFieldId: time.id,
          statusFieldId: status.id,
          blockingStatuses: (status.options ?? []).map((o) => o.id).filter((id) => !/cancel/.test(id)),
        };
    }
    if (!e.parent && /(line|item|addon|add_on|extra)/.test(e.id)) {
      for (const f of e.fields) {
        if (f.type !== "relation" || !f.relation) continue;
        const parent = bp.entities.find((x) => x.id === f.relation?.entityId);
        const rolledUp = parent?.fields.some(
          (x) => x.type === "rollup" && x.rollup?.childEntityId === e.id && x.rollup.viaFieldId === f.id,
        );
        if (parent && rolledUp) {
          e.parent = { entityId: parent.id, fieldId: f.id };
          break;
        }
      }
    }
  }
  // A booking's court fee comes from the court's rates and the hours booked, not from a number someone types.
  for (const e of bp.entities) {
    const b = e.booking;
    const res = b ? e.fields.find((f) => f.id === b.resourceFieldId) : undefined;
    const court = bp.entities.find((x) => x.id === res?.relation?.entityId);
    if (!b || !court) continue;
    const rates = court.fields.filter((f) => f.type === "money");
    const fee =
      e.fields.find(
        (f) =>
          f.type === "money" &&
          /(court|rental|booking)_?(fee|rate|price|cost)|^(fee|rate|price|amount)$/.test(f.id),
      ) ??
      e.fields.find(
        (f) =>
          f.type === "money" &&
          /fee|rate|price|cost/.test(f.id) &&
          !/paid|deposit|balance|discount|addon|add_on|extra/.test(f.id),
      );
    if (!fee || !rates.length) continue;
    const peak = rates.find((f) => /evening|night|peak|prime/.test(f.id));
    const base =
      rates.find((f) => f !== peak && /day|regular|base|standard|rate|price/.test(f.id)) ??
      rates.find((f) => f !== peak);
    const rate =
      peak && base
        ? `(hour(${b.timeFieldId}) >= 17 ? ${res?.id}.${peak.id} : ${res?.id}.${base.id})`
        : `${res?.id}.${(base ?? peak ?? rates[0]).id}`;
    Object.assign(fee, {
      type: "formula",
      required: undefined,
      formula: { expr: `${rate} * duration_hours(${b.timeFieldId})`, resultType: "money" },
    });
  }
  // Pages that only list line items go: those show inside their parent record.
  const children = new Set(bp.entities.filter((e) => e.parent).map((e) => e.id));
  bp.systems = bp.systems.filter(
    (s) =>
      s.widgetIds.length > 0 ||
      !s.viewIds.length ||
      !s.viewIds.every((id) => children.has(bp.views.find((v) => v.id === id)?.entityId ?? "")),
  );
  return bp;
}

/** "6:00 AM - 7:00 AM", "6 PM", "18:00-19:00" or an id like "06_00" → minutes after midnight for start and end. */
function slotTimes(label: string, id: string): { start: number; end?: number } | null {
  const one = (text: string): number | null => {
    const m = text.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
    if (!m) return null;
    let h = Number(m[1]) % 24;
    const ap = m[3]?.toLowerCase();
    if (ap === "pm" && h < 12) h += 12;
    if (ap === "am" && h === 12) h = 0;
    return h * 60 + Number(m[2] ?? 0);
  };
  const parts = label.split(/\s*(?:-|–|to)\s*/i);
  const start = one(parts[0] ?? "") ?? one(id.replace(/_/g, ":"));
  if (start === null) return null;
  const end = parts[1] ? one(parts[1]) : null;
  return { start, ...(end !== null && end > start ? { end } : {}) };
}

/**
 * Gemini sometimes models a court booking as a date plus a dropdown of time slots. Bookings need one time_range
 * for the schedule, double-booking checks and public slots, so the pair becomes a "Time" range: screens, charts and
 * blocks point at it, the resource gets its hours from the slots, booking settings are filled in, and sample
 * bookings are converted. Returns the samples to use.
 */
export function mergeDateAndSlot(bp: Blueprint, samples: Design["samples"]): Design["samples"] {
  let out = samples;
  for (const e of bp.entities) {
    if (e.booking) continue;
    const date = e.fields.find((f) => f.type === "date");
    const slot = e.fields.find(
      (f) =>
        f.type === "select" &&
        (f.options?.length ?? 0) >= 2 &&
        f.options?.every((o) => slotTimes(o.label, o.id)),
    );
    // The thing being booked: a record type with hours, else one named like a court or room, never people.
    const relations = e.fields.filter((f) => f.type === "relation" && f.relation?.entityId !== e.id);
    const target = (f: Field) => bp.entities.find((x) => x.id === f.relation?.entityId);
    const named = (f: Field, re: RegExp) => re.test(`${target(f)?.id} ${target(f)?.name}`.toLowerCase());
    const resourceField =
      relations.find((f) => target(f)?.resource) ??
      relations.find((f) => named(f, /court|room|table|space|venue|lane|field|studio|desk|resource/)) ??
      relations.find((f) => !named(f, /player|client|customer|member|guest|person|staff|user|people/));
    const resource = bp.entities.find((x) => x.id === resourceField?.relation?.entityId);
    if (!date || !slot?.options || !resourceField || !resource) continue;

    const times = new Map(
      slot.options.map((o) => [o.id, slotTimes(o.label, o.id) as { start: number; end?: number }]),
    );
    const starts = [...times.values()].map((t) => t.start).sort((a, b) => a - b);
    const step = starts.length > 1 ? starts[1] - starts[0] : 60;
    const endOf = (t: { start: number; end?: number }) => t.end ?? t.start + step;
    const id = e.fields.some((f) => f.id === "time") ? "booking_time" : "time";
    const time: Field = { id, name: "Time", type: "time_range", range: "times", required: true };
    const at = e.fields.indexOf(date);
    e.fields = e.fields.filter((f) => f !== date && f !== slot);
    e.fields.splice(Math.min(at, e.fields.length), 0, time);
    if (e.primaryFieldId === date.id || e.primaryFieldId === slot.id)
      e.primaryFieldId = e.fields.find((f) => f.type === "text")?.id ?? id;

    const swap = (ids: string[]) => [...new Set(ids.map((x) => (x === date.id || x === slot.id ? id : x)))];
    const swapOne = (x: string | undefined) => (x === date.id || x === slot.id ? id : x);
    for (const v of bp.views) {
      if (v.entityId !== e.id && v.type !== "landing" && v.type !== "form") continue;
      if (v.type === "table" || v.type === "form") v.fieldIds = swap(v.fieldIds);
      if (v.type === "kanban") v.cardFieldIds = swap(v.cardFieldIds);
      if (v.type === "calendar") v.dateFieldId = swapOne(v.dateFieldId) ?? id;
      if (v.type === "notes" && v.metaFieldIds) v.metaFieldIds = swap(v.metaFieldIds);
      if ((v.type === "landing" || v.type === "form") && v.blocks)
        for (const b of v.blocks)
          if (b.type === "records" && b.entityId === e.id) b.fieldIds = swap(b.fieldIds);
    }
    for (const w of bp.widgets) {
      if (w.entityId !== e.id) continue;
      if (w.chart) {
        if (w.chart.dateFieldId === date.id || w.chart.dateFieldId === slot.id) w.chart.dateFieldId = id;
        if (w.chart.groupByFieldId === slot.id) delete w.chart.groupByFieldId;
        if (!w.chart.dateFieldId && !w.chart.groupByFieldId) w.chart.dateFieldId = id;
      }
      if (w.list) w.list.fieldIds = swap(w.list.fieldIds);
    }
    // Formulas and filters that read the date now read the range (date functions take ranges too).
    const word = (name: string) => new RegExp(`\\b${name}\\b`, "g");
    const rewrite = (expr: string) => expr.replace(word(date.id), id);
    for (const f of e.fields) if (f.formula) f.formula.expr = rewrite(f.formula.expr);
    for (const v of bp.views)
      if ("filter" in v && v.filter && v.entityId === e.id) v.filter = rewrite(v.filter);
    for (const w of bp.widgets) if (w.filter && w.entityId === e.id) w.filter = rewrite(w.filter);
    for (const w of bp.widgets)
      for (const t of w.calc?.terms ?? []) if (t.filter && t.entityId === e.id) t.filter = rewrite(t.filter);

    resource.resource ??= {
      opensAt: hhmm(starts[0]),
      closesAt: hhmm(Math.max(...[...times.values()].map(endOf))),
      slotMinutes: SLOT_MINUTES.reduce((a, b) => (Math.abs(b - step) < Math.abs(a - step) ? b : a)),
    };
    const status =
      e.fields.find((f) => f.type === "status" && f.options?.some((o) => /cancel/.test(o.id))) ??
      e.fields.find((f) => f.type === "status");
    if (status)
      e.booking = {
        resourceFieldId: resourceField.id,
        timeFieldId: id,
        statusFieldId: status.id,
        blockingStatuses: (status.options ?? []).map((o) => o.id).filter((x) => !/cancel/.test(x)),
      };
    const home = bp.systems.find((s) =>
      s.viewIds.some(
        (v) =>
          bp.views.find((x) => x.id === v)?.entityId === e.id &&
          bp.views.find((x) => x.id === v)?.type !== "calendar",
      ),
    );
    if (status && home && !bp.views.some((v) => v.type === "slot_grid" && v.entityId === e.id)) {
      const viewId = bp.views.some((v) => v.id === `${e.id}_schedule`)
        ? `${e.id}_schedule_2`
        : `${e.id}_schedule`;
      bp.views.push({ id: viewId, entityId: e.id, name: "Schedule", type: "slot_grid" });
      home.viewIds.unshift(viewId);
    }

    out = out.map((s) => {
      if (s.entityId !== e.id) return s;
      const day = s.values.find((v) => v.fieldId === date.id)?.value;
      const t = times.get(s.values.find((v) => v.fieldId === slot.id)?.value ?? "");
      const rest = s.values.filter((v) => v.fieldId !== date.id && v.fieldId !== slot.id);
      if (!day || !t) return { ...s, values: rest };
      const iso = (m: number) => `${day.slice(0, 10)}T${hhmm(m)}`;
      return { ...s, values: [...rest, { fieldId: id, value: `${iso(t.start)}/${iso(endOf(t))}` }] };
    });
  }
  return out;
}

/** Generated page text, kept sane: runs of emoji (a model stuck in a loop) go, and long text stops at a sentence. */
export function cleanCopy(text: string | undefined, max: number): string | undefined {
  if (text === undefined) return undefined;
  const noLoops = text
    .replace(/(?:[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}]\s*){4,}/gu, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  if (noLoops.length <= max) return noLoops;
  const cut = noLoops.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return (
    end > max * 0.5
      ? cut.slice(0, end + 1)
      : cut.slice(0, cut.lastIndexOf(" ") > 0 ? cut.lastIndexOf(" ") : max)
  ).trim();
}

import "server-only";
import type {
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
import { todayKey } from "@/lib/time";
import { DESIGN_SYSTEM, type Design, design } from "./design-prompt";
import { generateJson } from "./gemini";

const SLOT_MINUTES = [15, 30, 60, 90, 120] as const;
const pick = <T extends object>(source: T, keys: (keyof T)[]) =>
  Object.fromEntries(keys.filter((k) => source[k] !== undefined).map((k) => [k, source[k]])) as Partial<T>;

/** Turns the model's view (optional keys) into the strict view type for its kind. */
export function toView(v: Design["views"][number]): View {
  const base = { id: v.id, entityId: v.entityId, name: v.name };
  switch (v.type) {
    case "table":
      return { ...base, type: "table", fieldIds: v.fieldIds ?? [], filter: v.filter, sort: v.sort };
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
  for (const w of bp.widgets) w.entityId = resolve(w.entityId) as string;
  for (const r of bp.rules) r.trigger.entityId = resolve(r.trigger.entityId) as string;
  // "patient.name" when Patient's name field is called something else: point it at the primary field.
  const fixRefs = (entity: Entity, expr: string) =>
    expr.replace(/\b([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\b/g, (whole, rel: string, target: string) => {
      const field = entity.fields.find((x) => x.id === rel);
      const other = bp.entities.find((x) => x.id === field?.relation?.entityId);
      if (!other || other.fields.some((x) => x.id === target)) return whole;
      return /^(name|title|label|full_name)$/.test(target) ? `${rel}.${other.primaryFieldId}` : whole;
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
  bp.views = bp.views.filter((v) => (v.type === "document" ? true : entityIds.has(v.entityId)));
  for (const v of bp.views) {
    if (v.type === "document") {
      v.entityId = "";
      continue;
    }
    const has = fieldsOf(v.entityId);
    if (v.type === "form") v.fieldIds = v.fieldIds.filter((id) => has.has(id));
    if (v.type === "notes") {
      const entity = bp.entities.find((e) => e.id === v.entityId);
      if (entity) fillNotesView(v, entity);
    }
    if (v.type === "table") {
      v.fieldIds = v.fieldIds.filter((id) => has.has(id));
      if (!v.fieldIds.length) v.fieldIds = [...has].slice(0, 5);
      v.sort = v.sort?.filter((x) => has.has(x.fieldId));
    }
    if (v.type === "kanban") v.cardFieldIds = v.cardFieldIds.filter((id) => has.has(id));
    if (v.type === "approval_queue") v.detailFieldIds = v.detailFieldIds.filter((id) => has.has(id));
  }
  bp.widgets = bp.widgets.filter((w) => {
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
      if (!chart.groupByFieldId && !chart.dateFieldId) return false;
    }
    if (w.list) w.list.fieldIds = w.list.fieldIds.filter((id) => has.has(id));
    if (w.type === "list" && !w.list?.fieldIds.length) return false;
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
export async function designWorkspace(brief: string, workspaceName: string): Promise<DesignResult> {
  const now = new Date();
  const context = `Examples:\n${EXAMPLES}\n\nToday in Manila: ${todayKey(now)}\nWorkspace name: ${workspaceName || "choose one"}\n\nBrief:\n${brief}`;
  let prompt = context;
  let repairs = 0;
  for (let attempt = 0; attempt < 4; attempt++) {
    const result = await generateJson(design, {
      system: DESIGN_SYSTEM,
      prompt,
      task: "design",
      timeoutMs: 60_000,
      thinking: "LOW",
    });
    if (!result.ok) {
      if (result.retryable && attempt < 1) continue;
      return { ok: false, message: result.error };
    }
    const bp = ensurePages(tidy(toBlueprint(result.data)));
    const errors = [...validateBlueprint(bp).map((e) => `${e.path}: ${e.message}`), ...extraChecks(bp)];
    if (!errors.length) {
      const records = computeAll(bp, toRecords(bp, result.data.samples, now), now);
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

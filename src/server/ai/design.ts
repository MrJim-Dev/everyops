import { htmlConnectionProblems } from "@/lib/public/html-connections";
import "server-only";
import type { Part } from "@google/genai";
import type { AttachmentRef } from "@/lib/assistant/attachments";
import { type DesignSketch, type DesignStage, sketchOf } from "@/lib/assistant/design-sketch";
import { isEmail, isFilePath, isPhone, normalizeUrl } from "@/lib/blueprint/contact";
import { displayKind } from "@/lib/blueprint/field-kind";
import type {
  Block,
  Blueprint,
  DataRecord,
  Entity,
  Field,
  FieldValue,
  FormStep,
  IconName,
  NotesView,
  Rule,
  View,
  Widget,
  WorkspaceData,
} from "@/lib/blueprint/types";
import { FREE_PAGE_TYPES } from "@/lib/blueprint/types";
import { GROUP_KINDS, validateBlueprint } from "@/lib/blueprint/validate";
import { CATALOG } from "@/lib/catalog";
import { samplesThisYear } from "@/lib/catalog/shift";
import { computeAll } from "@/lib/engine/compute";
import { dashboardSystem, suggestWidgets } from "@/lib/engine/dashboard-suggest";
import { impliedRules } from "@/lib/engine/implied-rules";
import { templateOverview } from "@/lib/engine/overview-template";
import { isImagePath } from "@/lib/engine/records";
import { repairRules } from "@/lib/engine/rule-repair";
import { parsePartialJson } from "@/lib/partial-json";
import { withCustomSite } from "@/lib/public/custom-site";
import { MAX_HTML_BYTES } from "@/lib/public/html-page";
import { copyFromBlocks, type SiteCopy, standardBlocks } from "@/lib/public/site-template";
import { hhmm, todayKey } from "@/lib/time";
import { attachmentParts } from "./attachments";
import { CHOICE_REPAIR_SYSTEM, choicePatch, choiceRepairAnswer } from "./choice-repair-prompt";
import { reviewCoverage } from "./coverage";
import {
  DESIGN_SYSTEM,
  type Design,
  type DesignPatch,
  designPatch,
  designRequest,
  PATCH_INSTRUCTIONS,
  TEMPLATE_INSTRUCTIONS,
} from "./design-prompt";
import { type SetupGap, salvage, widgetProblems } from "./design-salvage";
import {
  fewSamples,
  noProgress,
  rebindTemplateSamples,
  seedDesign,
  seedForPrompt,
  type TemplateSeed,
  templateChecks,
  withBriefHours,
  withTemplateForms,
} from "./design-template";
import { generateJsonHedged } from "./gemini";
import { withOverviewLayout } from "./overview-layout";
import {
  communitySystem,
  referencesText,
  type SetupReferences,
  type SetupRoute,
  setupReferences,
  setupRoute,
} from "./references";
import { fillEmptySamples, writeTemplateSamples } from "./samples";

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
        ...(v.fieldIds?.length ? { fieldIds: v.fieldIds } : {}),
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
        ...(v.extras ? { extras: { ...v.extras } } : {}),
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
    case "html":
      return {
        ...base,
        entityId: "",
        type: "html",
        ...(v.public ? { public: true } : {}),
        ...(v.html ? { html: v.html.slice(0, MAX_HTML_BYTES) } : {}),
      };
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

/**
 * A text field named exactly like contact details becomes that type ("Email" → email, "Phone" → phone, "Website"
 * → url), for designs that still used text for them. Only plain names: "Email template" stays text.
 */
function contactType(f: { id: string; name: string; type: Field["type"] }): Field["type"] {
  if (f.type !== "text") return f.type;
  const name = `${f.name}`.trim().toLowerCase();
  const id = f.id.toLowerCase();
  if (/^(e-?mail|e-?mail address)$/.test(name) || /^e_?mail(_address)?$/.test(id)) return "email";
  if (/^(phone|mobile|phone number|mobile number|contact number|cell(phone)?( number)?)$/.test(name))
    return "phone";
  if (/^(phone|mobile|phone_number|mobile_number|contact_number)$/.test(id)) return "phone";
  if (/^(website|web address|url|site)$/.test(name) || /^(website|url|web_address)$/.test(id)) return "url";
  return "text";
}

export function toEntity(e: Design["entities"][number]): Entity {
  const fields = e.fields.map((f) => {
    const out: Field = {
      id: f.id,
      name: f.name,
      type: contactType(f),
      ...(pick(f, ["required", "description", "options", "range", "relation"]) as Partial<Field>),
      // resultType and op come as plain text (the schema is near Gemini's limit); validation names a wrong one.
      ...(f.formula
        ? {
            formula: {
              ...f.formula,
              resultType: f.formula.resultType.trim().toLowerCase() as NonNullable<
                Field["formula"]
              >["resultType"],
            },
          }
        : {}),
      ...(f.rollup
        ? {
            rollup: {
              ...f.rollup,
              op: f.rollup.op.trim().toLowerCase() as NonNullable<Field["rollup"]>["op"],
            },
          }
        : {}),
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
    ...(pick({ ...e, resource }, ["parent", "booking", "resource"]) as Partial<Entity>),
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
              // Gemini sometimes names the field it changes in value ("value": "stock").
              fieldId: a.fieldId ?? (a.value && /^[a-z_][a-z0-9_]*$/.test(a.value) ? a.value : ""),
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
      // "checkin.date" when the check-in's date field is called something else: its one date, or the one named alike.
      if (/date|day|when|time|_at$|_on$/.test(target)) {
        const dates = other.fields.filter(
          (x) =>
            x.type === "date" ||
            x.type === "datetime" ||
            (x.type === "formula" && x.formula?.resultType === "date"),
        );
        const pick =
          dates.find((x) => x.id.includes(target) || target.includes(x.id)) ??
          (dates.length === 1 ? dates[0] : undefined);
        if (pick) return `${rel}.${pick.id}`;
      }
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
  // Filters on views and dashboard cards read fields the same way.
  const entityOf = (id: string) => bp.entities.find((e) => e.id === id);
  for (const v of bp.views) {
    const e = entityOf(v.entityId);
    if (e && "filter" in v && typeof v.filter === "string") v.filter = fixRefs(e, v.filter);
  }
  for (const w of bp.widgets) {
    const e = entityOf(w.entityId);
    if (e && w.filter) w.filter = fixRefs(e, w.filter);
    for (const t of w.calc?.terms ?? []) {
      const te = entityOf(t.entityId);
      if (te && t.filter) t.filter = fixRefs(te, t.filter);
    }
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
  bp.views = bp.views.filter((v) => FREE_PAGE_TYPES.has(v.type) || entityIds.has(v.entityId));
  const formIds = new Set(bp.views.filter((v) => v.type === "form").map((v) => v.id));
  for (const v of bp.views) {
    if (FREE_PAGE_TYPES.has(v.type)) {
      v.entityId = "";
      if (v.type === "landing") v.blocks = tidyBlocks(v.blocks, resolve, fieldsOf, formIds);
      continue;
    }
    const has = fieldsOf(v.entityId);
    if (v.type === "form") {
      v.fieldIds = v.fieldIds.filter((id) => has.has(id));
      if (v.blocks) v.blocks = tidyBlocks(v.blocks, resolve, fieldsOf, formIds);
      tidyFormExtras(bp, v, resolve);
      if (v.public) tidyPublicForm(bp, v);
      if (v.steps) {
        // Each field in one step, only real fields (tidyPublicForm may have added guest details), and no empty
        // steps except the one holding the add-ons.
        const real = fieldsOf(v.entityId);
        const seen = new Set<string>();
        v.steps = v.steps
          .map((s) => ({
            ...s,
            fieldIds: s.fieldIds.filter((id) => real.has(id) && !seen.has(id) && seen.add(id)),
          }))
          .map(({ extras, ...s }): FormStep => (extras && v.extras ? { ...s, extras } : s))
          .filter((s) => s.fieldIds.length || s.extras || s.blockIds?.length);
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
    if (v.type === "checkout" && v.fieldIds) v.fieldIds = v.fieldIds.filter((id) => has.has(id));
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
  bp.rules = repairRules(bp);
  // Totals the design moves (stock received and sold, leave days, balances) stay in sync even when the designer
  // didn't write the automation.
  const empty = { ...bp, entities: [], rules: [] };
  bp.rules.push(...impliedRules(empty, bp).map((x) => x.rule));
  // The Overview follows the court-bookings template: comparison stats, revenue by day, today's schedule, what
  // needs payment and busy hours, built from the business's own bookings or sales.
  templateOverview(bp);
  // A dashboard of only numbers gets the charts and lists an owner looks at first.
  const board = dashboardSystem(bp);
  if (board) {
    const extra = suggestWidgets(bp, board);
    bp.widgets.push(...extra);
    board.widgetIds.push(...extra.map((w) => w.id));
  }
  pendingOnly(bp);
  return bp;
}

/**
 * A card titled "Pending approvals" should hold only what's waiting, but the designer often leaves out its filter, so
 * it listed approved and declined requests too. A list or count with such a title and no filter of its own, on a
 * record type with an approval queue, gets the queue's filter: status is the pending stage.
 */
export function pendingOnly(bp: Blueprint): void {
  const waiting = /\b(pending|waiting|awaiting|for approval|to approve|needs? approval)\b/i;
  for (const w of bp.widgets) {
    if ((w.type !== "list" && w.type !== "stat") || w.calc || w.filter?.trim() || !waiting.test(w.title))
      continue;
    const queue = bp.views.find(
      (v): v is Extract<View, { type: "approval_queue" }> =>
        v.type === "approval_queue" && v.entityId === w.entityId && !!v.pending,
    );
    const status = bp.entities
      .find((e) => e.id === queue?.entityId)
      ?.fields.find((f) => f.id === queue?.statusFieldId);
    if (queue && status?.options?.some((o) => o.id === queue.pending))
      w.filter = `${queue.statusFieldId} == '${queue.pending}'`;
  }
}

type ShapeField = {
  id: string;
  name: string;
  type: string;
  relation?: { entityId: string };
  options?: unknown[];
  formula?: unknown;
  rollup?: unknown;
};
type Shape = {
  entities: { id: string; name: string; fields: ShapeField[] }[];
  samples: { entityId: string }[];
};

/** The setting a field of each type can't work without. */
const SETTING: Partial<Record<string, "relation" | "options" | "formula" | "rollup">> = {
  relation: "relation",
  select: "options",
  multi_select: "options",
  status: "options",
  formula: "formula",
  rollup: "rollup",
};

/**
 * The record types and fields of a rejected design that its problems point at: by path ("entities.3.fields.2") or by
 * id in the message. A repair may drop these on purpose, so they aren't put back.
 */
export function flaggedBy(bp: Pick<Blueprint, "entities">, errors: string[]): Set<string> {
  const flagged = new Set<string>();
  const words = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9_]+/g) ?? []);
  for (const error of errors) {
    const at = /^entities\.(\d+)(?:\.fields\.(\d+))?/.exec(error);
    const entity = at ? bp.entities[Number(at[1])] : undefined;
    if (entity) {
      const field = at?.[2] === undefined ? undefined : entity.fields[Number(at[2])];
      flagged.add(field ? `${entity.id}.${field.id}` : entity.id);
    }
    const said = words(error);
    for (const e of bp.entities) {
      if (said.has(e.id)) flagged.add(e.id);
      for (const f of e.fields) if (f.id.includes("_") && said.has(f.id)) flagged.add(`${e.id}.${f.id}`);
    }
  }
  return flagged;
}

/**
 * A repair is asked to change only what its problems need, but Gemini sometimes returns the design with a record
 * type or a few fields missing that nothing asked it to touch, and the workspace quietly loses them. Those come back
 * from the previous design (with their samples), in their old place. Left out: anything the problems pointed at, and
 * a field whose name the repair still has under a new id (it was renamed, not dropped).
 */
export function restoreDropped<D extends Shape>(
  previous: D,
  next: D,
  flagged: Set<string>,
): { design: D; entities: string[]; fields: string[]; settings: string[] } {
  const entities: string[] = [];
  const fields: string[] = [];
  const settings: string[] = [];
  const nextIds = new Set(next.entities.map((e) => e.id));
  const out = structuredClone(next);
  for (const old of previous.entities) {
    if (!nextIds.has(old.id)) {
      if (flagged.has(old.id)) continue;
      out.entities.push(structuredClone(old));
      out.samples.push(...structuredClone(previous.samples.filter((s) => s.entityId === old.id)));
      entities.push(old.id);
      continue;
    }
    const now = out.entities.find((e) => e.id === old.id) as D["entities"][number];
    const ids = new Set(now.fields.map((f) => f.id));
    const names = new Set(now.fields.map((f) => f.name.trim().toLowerCase()));
    old.fields.forEach((f, i) => {
      const key = `${old.id}.${f.id}`;
      if (flagged.has(key)) return;
      const kept = now.fields.find((x) => x.id === f.id);
      if (kept) {
        // Same field, but the repair lost what makes it work (a link without its record type, a status without its
        // stages) or swapped it for a setting of another type: the old setting comes back.
        const setting = SETTING[f.type];
        if (kept.type !== f.type || !setting || !f[setting]) return;
        const lost =
          setting === "relation"
            ? !kept.relation?.entityId
            : setting === "options"
              ? !kept.options?.length
              : !kept[setting];
        if (!lost) return;
        for (const other of ["relation", "options", "formula", "rollup"] as const)
          if (other !== setting && !f[other]) delete kept[other];
        Object.assign(kept, { [setting]: structuredClone(f[setting]) });
        settings.push(key);
        return;
      }
      if (names.has(f.name.trim().toLowerCase())) return;
      // After the nearest earlier field that's still there, or first.
      const before = old.fields
        .slice(0, i)
        .reverse()
        .find((x) => ids.has(x.id));
      const at = before ? now.fields.findIndex((x) => x.id === before.id) + 1 : 0;
      now.fields.splice(at, 0, structuredClone(f));
      ids.add(f.id);
      fields.push(key);
    });
  }
  return { design: out, entities, fields, settings };
}

/** Problems the generic validator doesn't catch but would break a screen. */
const RESULT_TYPE: Partial<Record<Field["type"], NonNullable<Field["formula"]>["resultType"]>> = {
  money: "money",
  number: "number",
  percent: "number",
  rollup: "number",
  checkbox: "checkbox",
  date: "date",
};

/**
 * Formulas reach one link away (deal.price), but Gemini keeps writing two (deal.property.price), which fails
 * validation and costs a repair that rewrites the whole design. Each two-link reference becomes a one-link formula
 * field on the record in between (deal.property_price = property.price) that the original formula reads instead.
 * Text in quotes is left alone. Formulas compute, then roll-ups, then formulas again, so the copy is current.
 */
export function flattenLinks(bp: Blueprint): Blueprint {
  const linkOf = (entity: Entity, id: string) => {
    const f = entity.fields.find((x) => x.id === id && x.relation);
    return f ? bp.entities.find((e) => e.id === f.relation?.entityId) : undefined;
  };
  for (const entity of bp.entities)
    for (const field of entity.fields) {
      if (!field.formula?.expr.includes(".")) continue;
      field.formula.expr = field.formula.expr
        .split(/('[^']*')/)
        .map((part, i) =>
          i % 2
            ? part
            : part.replace(
                /\b([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\b/g,
                (whole, a, b, c) => {
                  const middle = linkOf(entity, a);
                  const far = middle && linkOf(middle, b);
                  const target = far?.fields.find((x) => x.id === c);
                  if (!middle || !far || !target) return whole;
                  const id = `${b}_${c}`;
                  if (!middle.fields.some((x) => x.id === id))
                    middle.fields.push({
                      id,
                      name: `${middle.fields.find((x) => x.id === b)?.name ?? b} ${target.name.toLowerCase()}`,
                      type: "formula",
                      formula: {
                        expr: `${b}.${c}`,
                        resultType:
                          target.type === "formula"
                            ? (target.formula?.resultType ?? "text")
                            : (RESULT_TYPE[target.type] ?? "text"),
                      },
                    });
                  return `${a}.${id}`;
                },
              ),
        )
        .join("");
    }
  return bp;
}

/**
 * A repair must return the whole design. Gemini sometimes returns only the parts it fixed (two record types of nine),
 * which validates but loses the workspace, so a repair that drops more than a quarter of the record types or
 * views is sent back.
 */
export function shrunk(
  previous: { entities: number; views: number } | null,
  bp: Pick<Blueprint, "entities" | "views">,
): string[] {
  if (!previous) return [];
  if (bp.entities.length >= previous.entities * 0.75 && bp.views.length >= previous.views * 0.75) return [];
  return [
    `design: you returned only part of the design (${bp.entities.length} of ${previous.entities} record types, ${bp.views.length} of ${previous.views} views). Return the whole design again with every record type, view, widget, rule and sample, with the problems fixed.`,
  ];
}

/**
 * Whether the brief asks for something: a mention counts unless its clause says it isn't wanted, before it ("no POS
 * needed", "without a booking page") or after it ("POS / Public Website: None", "a booking page is not needed").
 */
export function asksFor(brief: string, pattern: RegExp): boolean {
  for (const match of brief.matchAll(pattern)) {
    const at = match.index ?? 0;
    const before =
      brief
        .slice(0, at)
        .split(/[.!?;,\n]/)
        .at(-1) ?? "";
    const after = brief.slice(at + match[0].length).split(/[.!?;\n]/)[0] ?? "";
    if (/\b(no|not|without|never|instead of|don't|do not|doesn't|does not|isn't|aren't)\b/i.test(before))
      continue;
    if (
      /^[^,]{0,40}?(:\s*(none|no|n\/a)\b|\b(not needed|not required|isn't needed|is not needed)\b)/i.test(
        after,
      )
    )
      continue;
    return true;
  }
  return false;
}

function extraChecks(bp: Blueprint, brief: string): string[] {
  const errors: string[] = [];
  const entityIds = new Set(bp.entities.map((e) => e.id));
  if (!bp.systems.length) errors.push("The workspace has no systems.");
  // The brief is the plan the owner agreed to; a public booking page it lists can't be left out.
  if (asksFor(brief, PUBLIC_PAGE_ASK) && !bp.views.some((v) => v.type === "form" && v.public))
    errors.push("The brief asks for a public page customers use, but no form view has public true.");
  // Same for a register: a POS without one is just tables of orders. Only "POS" or "point of sale" asks for one: a
  // finance tracker's "Cashier / Manager" field and a "Cash Register" account type each cost repair rounds that
  // added a register nobody wanted.
  if (asksFor(brief, /\bpos\b|point[- ]of[- ]sale/gi) && !bp.views.some((v) => v.type === "checkout"))
    errors.push(
      "The brief asks for a point of sale, but there is no checkout view (products, orders with line items and a payment field).",
    );
  for (const e of bp.entities) {
    const primary = e.fields.find((f) => f.id === e.primaryFieldId);
    if (primary && (primary.type === "formula" || primary.type === "rollup"))
      errors.push(`${e.name}: the primary field must be a plain field`);
    for (const f of e.fields)
      if (f.type === "rollup" && f.rollup && !entityIds.has(f.rollup.childEntityId))
        errors.push(`${e.name}.${f.id}: rollup uses a missing record type`);
  }
  return errors;
}

const PUBLIC_PAGE_ASK = /public (booking|order|request|inquiry|reservation|form)|booking page|book online/gi;

/**
 * Account numbers, phones and emails in configuration records (a GCash account) only when the brief gives them:
 * Gemini fills a payment method with a made-up "0917 123 4567" otherwise, which looks real enough to be trusted.
 * The owner adds the real one on the record. Same rule as the website's contact details.
 */
export function withoutInventedContacts(
  samples: Design["samples"],
  design: Pick<Design, "entities">,
  brief: string,
): Design["samples"] {
  return samples.map((s) => {
    const entity = design.entities.find((e) => e.id === s.entityId);
    if (!entity) return s;
    return {
      ...s,
      values: s.values.filter((v) => {
        const field = entity.fields.find((f) => f.id === v.fieldId);
        if (!field) return true;
        // Phone and email fields hold contact details by definition; text fields only when their name says so.
        if (field.type === "phone" || field.type === "email") return givenIn(brief, v.value);
        if (field.type !== "text" && field.type !== "long_text") return true;
        if (
          !/account_?(no|num|number)|phone|mobile|contact|email|gcash_?(no|number)/i.test(
            `${field.id} ${field.name}`,
          )
        )
          return true;
        return givenIn(brief, v.value);
      }),
    };
  });
}

/**
 * A brief that asks for a public booking page gets one even when every form came back private, which the designer
 * and a template patch each do now and then: the booking record type's form (else the only form) is copied as a
 * public form without the fields a visitor can't set (statuses, how the booking was made), on the same page.
 * tidy then asks visitors for a name and a phone and shows the payment methods, and the custom booking page is
 * built from it, so the check doesn't cost a repair round.
 */
export function ensurePublicForm(bp: Blueprint, brief: string): Blueprint {
  const forms = bp.views.filter((v): v is Extract<View, { type: "form" }> => v.type === "form");
  if (forms.some((f) => f.public) || !asksFor(brief, PUBLIC_PAGE_ASK)) return bp;
  const booking = bp.entities.find((e) => e.booking);
  const source =
    forms.find((f) => booking && f.entityId === booking.id) ?? (forms.length === 1 ? forms[0] : null);
  const entity = source && bp.entities.find((e) => e.id === source.entityId);
  if (!source || !entity || entity.parent) return bp;
  const staffOnly = new Set(
    entity.fields
      .filter(
        (f) =>
          f.type === "status" || f.type === "person" || /^(source|booked_via|channel|cashier)$/.test(f.id),
      )
      .map((f) => f.id),
  );
  const taken = new Set(bp.views.map((v) => v.id));
  let id = `${source.id}_public`;
  for (let n = 2; taken.has(id); n++) id = `${source.id}_public_${n}`;
  const steps = source.steps
    ?.map((s) => ({ ...s, fieldIds: s.fieldIds.filter((f) => !staffOnly.has(f)) }))
    .filter((s) => s.fieldIds.length || s.extras || s.blockIds?.length);
  const { steps: _steps, review: _review, intro: _intro, submitLabel: _label, ...rest } = source;
  const copy: Extract<View, { type: "form" }> = {
    ...rest,
    id,
    name: "Book online",
    public: true,
    fieldIds: source.fieldIds.filter((f) => !staffOnly.has(f)),
    ...(steps?.length ? { steps, review: true } : {}),
  };
  console.info(JSON.stringify({ event: "design_public_form_added", from: source.id, id }));
  return {
    ...bp,
    views: [...bp.views, copy],
    systems: bp.systems.map((s) =>
      s.viewIds.includes(source.id) ? { ...s, viewIds: [...s.viewIds, id] } : s,
    ),
  };
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
    case "file":
      // Documents are uploaded by people too.
      return isFilePath(v) ? v : null;
    case "email":
      return v === "" ? null : isEmail(v) ? v : undefined;
    case "phone":
      return v === "" ? null : isPhone(v) ? v : undefined;
    case "url":
      return v === "" ? null : normalizeUrl(v);
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
export function toRecords(bp: Blueprint, samples: Design["samples"], now: Date): DataRecord[] {
  const stamp = now.toISOString();
  const ids = new Map<string, string>();
  for (const [i, s] of samples.entries()) ids.set(s.ref, `${s.entityId}_${i + 1}`);
  const primaryOf = (entityId: string) => bp.entities.find((e) => e.id === entityId)?.primaryFieldId;
  const titles = new Map(
    samples.map((s) => [s.ref, s.values.find((v) => v.fieldId === primaryOf(s.entityId))?.value]),
  );
  const counts = new Map<string, number>();
  const dropped: Record<string, number> = {};
  const records = samples.flatMap((s, i) => {
    const entity = bp.entities.find((e) => e.id === s.entityId);
    if (!entity) return [];
    const data: Record<string, FieldValue> = {};
    for (const { fieldId, value } of s.values) {
      const field = entity.fields.find((f) => f.id === fieldId);
      if (!field) continue;
      const converted = toFieldValue(field, value, (v) => ids.get(v));
      if (converted !== undefined) data[field.id] = converted;
    }
    const n = (counts.get(entity.id) ?? 0) + 1;
    counts.set(entity.id, n);
    // A line item's own name is often a Title field Gemini leaves empty (it fills the order, the product and the
    // quantity). It takes the name of what it links to, e.g. the product, else "Order line 2", instead of being dropped.
    const primary = entity.fields.find((f) => f.id === entity.primaryFieldId);
    if (!data[entity.primaryFieldId] && primary?.type === "text" && Object.keys(data).length) {
      const linked = entity.fields
        .filter((f) => f.type === "relation" && f.id !== entity.parent?.fieldId)
        .map((f) => s.values.find((v) => v.fieldId === f.id)?.value)
        .map((ref) => (ref ? titles.get(ref) : undefined))
        .find((t) => !!t);
      data[primary.id] = linked ?? `${entity.name} ${n}`;
    }
    if (!data[entity.primaryFieldId]) {
      dropped[entity.id] = (dropped[entity.id] ?? 0) + 1;
      return [];
    }
    return [{ id: `${s.entityId}_${i + 1}`, entityId: entity.id, data, createdAt: stamp, updatedAt: stamp }];
  });
  if (Object.keys(dropped).length) console.warn(JSON.stringify({ event: "design_samples_dropped", dropped }));
  return records;
}

const EXAMPLES = (() => {
  const now = new Date();
  return ["court-bookings", "canteen-pos"]
    .map((id) => CATALOG.find((s) => s.id === id)?.sample(now).blueprint)
    .filter(Boolean)
    .map((bp) => JSON.stringify(bp))
    .join("\n\n");
})();

/**
 * The example blueprints the designer follows. A design built from playbooks gets the matched community systems
 * (the shapes closest to this business, official ones only); a custom design, the standard pair. The template
 * route needs none: the design it starts from is the example.
 */
export function examplesFor(route: SetupRoute, refs: SetupReferences): string {
  if (route.tier === "template") return "";
  if (route.tier === "playbook") {
    const picked = refs.systems
      .filter((s) => s.official)
      .map((s) => JSON.stringify(s.blueprint))
      .filter((json) => json.length <= 30_000)
      .slice(0, 2);
    if (picked.length) return picked.join("\n\n");
  }
  return EXAMPLES;
}

export type DesignResult =
  | {
      ok: true;
      name: string;
      summary: string;
      data: WorkspaceData;
      coverage?: { request: string; detail: string }[];
      /** What the workspace doesn't do yet that the brief asked for, so the owner can ask for it afterwards. */
      gaps?: SetupGap[];
    }
  | { ok: false; message: string };

/** "Request: what's missing" (a coverage finding or a check) as something the owner can ask for afterwards. */
function asGap(error: string): SetupGap {
  const at = error.indexOf(": ");
  return at > 0
    ? { request: error.slice(0, at), detail: error.slice(at + 2) }
    : { request: error, detail: "" };
}

/** How long the design rounds may take in all. Samples and the Overview (60 s at most) come after, inside Cloud Run's limit. */
const DESIGN_BUDGET_MS = 220_000;

export type DesignProgress =
  | { type: "stage"; stage: DesignStage; issues?: number; from?: { id: string; name: string } }
  | { type: "sketch"; sketch: DesignSketch };

export type DesignOptions = {
  /** The files from the setup conversation, so real items and prices end up in the workspace. */
  files?: { userId: string; attachments: AttachmentRef[] };
  /** Progress for the setup screen: the step it's on, and a sketch of the design as Gemini writes it. */
  onEvent?: (event: DesignProgress) => void;
  /** Stops the design, e.g. when the owner closes the page. */
  signal?: AbortSignal;
  budgetMs?: number;
  /** The community system the interview chose to start from (its id); otherwise the brief decides the route. */
  base?: string;
};

/**
 * Applies a repair's patch to the design it repairs: returned items replace the ones with their id (a record type's
 * fields merge by id, so fields it leaves out stay), new ones are added, and ids in remove go.
 */
export function applyDesignPatch(
  previous: Design,
  patch: DesignPatch,
): { design: Design; removed: Set<string> } {
  const removed = new Set(patch.remove ?? []);
  const merge = <T extends { id: string }>(
    items: T[],
    changes: T[] | undefined,
    combine?: (old: T, next: T) => T,
  ) => {
    const out = items.filter((i) => !removed.has(i.id));
    for (const change of changes ?? []) {
      const at = out.findIndex((i) => i.id === change.id);
      if (at < 0) out.push(change);
      else out[at] = combine ? combine(out[at], change) : change;
    }
    return out;
  };
  const design = structuredClone(previous);
  // A record type a patch returns keeps the fields it leaves out, and its settings (bookable resource hours, booking
  // and line-item links) when the patch leaves those out too: a patch that renames a court must not turn the court
  // into a plain record type.
  design.entities = merge(design.entities, patch.entities, (old, next) => ({
    ...next,
    fields: merge(old.fields, next.fields),
    ...(next.resource || !old.resource ? {} : { resource: old.resource }),
    ...(next.booking || !old.booking ? {} : { booking: old.booking }),
    ...(next.parent || !old.parent ? {} : { parent: old.parent }),
  })).map((e) => ({ ...e, fields: e.fields.filter((f) => !removed.has(`${e.id}.${f.id}`)) }));
  // A view a patch returns (to rename it, say) keeps the content it leaves out: a custom page's HTML, a landing
  // page's sections, a document's starter text. Without this a retitled home page came back empty.
  design.views = merge(design.views, patch.views, (old, next) => {
    if (old.type !== next.type) return next;
    const o = old as { html?: string; blocks?: unknown[]; starter?: string };
    const n = next as { html?: string; blocks?: unknown[]; starter?: string };
    return {
      ...next,
      ...(n.html || !o.html ? {} : { html: o.html }),
      ...(n.blocks?.length || !o.blocks?.length ? {} : { blocks: o.blocks }),
      ...(n.starter || !o.starter ? {} : { starter: o.starter }),
    } as typeof next;
  });
  design.widgets = merge(design.widgets, patch.widgets);
  design.rules = merge(design.rules, patch.rules);
  design.systems = merge(design.systems, patch.systems).map((s) => ({
    ...s,
    viewIds: s.viewIds.filter((id) => !removed.has(id)),
    widgetIds: s.widgetIds.filter((id) => !removed.has(id)),
  }));
  if (patch.site) design.site = patch.site;
  const entityIds = new Set(design.entities.map((e) => e.id));
  const added = new Set((patch.samples ?? []).map((s) => s.ref));
  design.samples = [
    ...design.samples.filter((s) => entityIds.has(s.entityId) && !added.has(s.ref)),
    ...(patch.samples ?? []).filter((s) => entityIds.has(s.entityId)),
  ];
  return { design, removed };
}

/**
 * Designs a workspace from the interview brief. Invalid designs get up to two repairs with the validator's errors;
 * a repair returns a patch, not the whole design again.
 */
export async function designWorkspace(
  brief: string,
  workspaceName: string,
  options: DesignOptions = {},
): Promise<DesignResult> {
  const { files, onEvent } = options;
  const now = new Date();
  const started = Date.now();
  const budget = AbortSignal.timeout(options.budgetMs ?? DESIGN_BUDGET_MS);
  const signal = options.signal ? AbortSignal.any([budget, options.signal]) : budget;
  const stats = { calls: 0, repairs: 0, output: 0 };
  // What businesses like this one need and how similar community systems are built, and from that the route: a
  // template to adapt, a design guided by the matched systems, or a custom design.
  const refs: SetupReferences = await setupReferences(brief).catch(() => ({ playbooks: [], systems: [] }));
  const chosen = options.base
    ? (refs.systems.find((s) => s.id === options.base) ??
      (await communitySystem(options.base).catch(() => undefined)))
    : undefined;
  const route: SetupRoute = chosen ? { tier: "template", base: chosen } : setupRoute(brief, refs);
  const from = route.base ? { id: route.base.id, name: route.base.name } : undefined;
  console.info(
    JSON.stringify({
      event: "design_route",
      tier: route.tier,
      ...(from ? { from: from.id } : {}),
      playbooks: refs.playbooks.map((p) => p.id),
    }),
  );
  const done = (result: DesignResult): DesignResult => {
    console.info(
      JSON.stringify({
        event: "design_done",
        ok: result.ok,
        ms: Date.now() - started,
        calls: stats.calls,
        repairs: stats.repairs,
        output: stats.output,
        tier: route.tier,
        ...(from ? { from: from.id } : {}),
        ...(result.ok ? {} : { reason: result.message }),
      }),
    );
    return result;
  };
  const failed = (error: string) =>
    done({
      ok: false,
      message: budget.aborted
        ? "Designing this one took too long, so I stopped. Try again, or leave out a detail or two."
        : error,
    });
  // The designer fills gaps from the references. On the template route the design it starts from stands in for
  // the community descriptions and the examples.
  const references = referencesText(route.tier === "template" ? { ...refs, systems: [] } : refs);
  const examples = examplesFor(route, refs);
  const facts = `Today in Manila: ${todayKey(now)}\nWorkspace name: ${workspaceName || "choose one"}\n\nBrief:\n${brief}\n\nReferences:\n${references}`;
  const context = `${examples ? `Examples:\n${examples}\n\n` : ""}${facts}`;
  // The owner's files go with the first request; a repair works from the previous design, which already used them.
  const fileParts = files ? await attachmentParts(files.userId, files.attachments) : [];
  const prompt: string | Part[] = fileParts.length
    ? [
        { text: context },
        ...fileParts,
        { text: "Design the workspace from the brief, using these files for real names, items and prices." },
      ]
    : context;
  /** The template route's prompt: the facts, then the design to start from and how to adapt it. */
  const templatePrompt = (seed: TemplateSeed, base: { id: string; name: string }): string | Part[] => {
    const must = seed.master
      .map((id) => seed.design.entities.find((e) => e.id === id))
      .filter((e): e is Design["entities"][number] => !!e)
      .map((e) => `${e.pluralName} (${e.id})`);
    const start = `${facts}\n\nStarting design: the community system "${base.name}" (${base.id}), a working workspace for a business like this one, with a few of its sample records per record type (the rest follow the same shape):\n${JSON.stringify(seedForPrompt(seed.design))}\n\n${TEMPLATE_INSTRUCTIONS}${
      must.length
        ? `\n- The starting sample records belong to another business. You must return the complete sample records of: ${must.join(", ")}, written from the brief (this owner's real names, counts, prices and accounts), with the same refs where a record stays and new refs for new ones.`
        : ""
    }`;
    return fileParts.length
      ? [{ text: start }, ...fileParts, { text: "Use these files for the real names, items and prices." }]
      : start;
  };
  /** The template the design started from, when it did: its form settings come back on the built form, and its
   * configuration records must have been replaced. */
  let seedRef: TemplateSeed | null = null;

  // The setup screen draws the design while it's written: a sketch of the answer so far, a few times a second, from
  // whichever hedged twin is furthest along.
  let drawing = -1;
  let drawn = 0;
  let drawnAt = 0;
  let shown = "";
  const show = (sketch: DesignSketch | undefined) => {
    if (!sketch || !onEvent) return;
    const key = JSON.stringify(sketch);
    if (key === shown) return;
    shown = key;
    onEvent({ type: "sketch", sketch });
  };
  const onText = (text: string, attempt: number) => {
    if (attempt !== drawing && text.length <= drawn) return;
    drawing = attempt;
    drawn = text.length;
    if (Date.now() - drawnAt < 350) return;
    drawnAt = Date.now();
    show(sketchOf(parsePartialJson(text)));
  };

  /** The last whole design that was rejected: a repair's patch applies to it. */
  let previous: { entities: number; views: number; data: Design; flagged: Set<string> } | null = null;
  let errors: string[] = [];
  /** The problems the last round was given, to tell a repair that changed nothing. */
  let lastErrors: string[] = [];
  type Built = { data: Design; samples: Design["samples"]; name: string; bp: Blueprint; advisory: string[] };
  type Candidate = { built: Built; coverage: SetupGap[]; gaps: SetupGap[] };
  /** The design that validated with the fewest shortfalls so far, and the last one that didn't validate. */
  let best: Candidate | null = null;
  let lastBroken: Built | null = null;
  /** The final touches that don't depend on the review: samples for empty record types and the Overview layout. */
  const prepare = ({ bp, samples, name }: Built) =>
    Promise.all([fillEmptySamples(bp, samples, now), withOverviewLayout(bp, name, brief, now)]);
  const finish = async (
    { built, coverage, gaps }: Candidate,
    prepared: ReturnType<typeof prepare> = prepare(built),
  ): Promise<DesignResult> => {
    const { data, name, bp } = built;
    if (gaps.length)
      console.info(JSON.stringify({ event: "design_gaps", gaps: gaps.map((g) => g.request).slice(0, 15) }));
    show(sketchOf(bp, true));
    onEvent?.({ type: "stage", stage: "finish" });
    // Record types the design left without samples (line items, most often) get theirs from one small call, while
    // the Overview becomes a layout of library components (when that step fails the template layout stays).
    const [filled, laidOut] = await prepared;
    // Samples in the wrong year (the right month and day, but 2023) move to this year.
    const dated = samplesThisYear(laidOut, toRecords(laidOut, filled, now), now);
    if (dated.fields) console.info(JSON.stringify({ event: "design_samples_moved", fields: dated.fields }));
    const records = computeAll(laidOut, dated.records, now);
    // Businesses whose customers book on their own get a custom HTML website and a calendar that suits them.
    const blueprint = withCustomSite(laidOut, records, name, now);
    const sketch = sketchOf(blueprint, true);
    show(sketch && { ...sketch, samples: records.length });
    return done({
      ok: true,
      name,
      summary: data.summary,
      data: { blueprint, records },
      coverage,
      ...(gaps.length ? { gaps } : {}),
    });
  };
  /**
   * When the repairs run out or a repair call fails, setup still hands over a workspace: the best one that validated
   * (with what it doesn't do yet listed), else the last design with the parts that don't work taken out. Only a
   * design that never came back, or the owner leaving, ends in an error.
   */
  const settle = (reason: string): Promise<DesignResult> | DesignResult => {
    if (options.signal?.aborted) return failed(reason);
    if (best) {
      console.info(JSON.stringify({ event: "design_settled", from: "best", reason, gaps: best.gaps.length }));
      return finish(best);
    }
    const saved = lastBroken && salvage(lastBroken.bp);
    if (lastBroken && saved) {
      console.info(
        JSON.stringify({
          event: "design_settled",
          from: "salvage",
          reason,
          removed: saved.removed.map((g) => g.request),
        }),
      );
      return finish({
        built: { ...lastBroken, bp: saved.bp },
        coverage: [],
        gaps: [...saved.removed, ...lastBroken.advisory.map(asGap)],
      });
    }
    return failed(reason);
  };
  for (let round = 0; round < 3; round++) {
    let designed: Design;
    let removed = new Set<string>();
    if (!previous) {
      onEvent?.({ type: "stage", stage: "design", ...(from ? { from } : {}) });
      let seeded: Design | null = null;
      if (route.tier === "template" && route.base && round === 0) {
        // The template route: the community system for this kind of business, with its sample records, is the
        // design; Gemini writes the changes that make it the owner's. The patch is a few thousand tokens where a
        // design is ten thousand or more, and its structure already validates. The template's pages show at once.
        const seed = seedDesign(route.base, workspaceName, now);
        seedRef = seed;
        show(sketchOf(seed.design, true));
        // Two calls side by side: the structural patch, and this business's configuration records (its courts,
        // products, payment methods) written from the brief by a small call with a schema that requires them. The
        // patch call was asked for those records too and left them out more often than not.
        stats.calls += seed.master.length ? 2 : 1;
        const [result, config] = await Promise.all([
          generateJsonHedged(
            designPatch,
            {
              system: DESIGN_SYSTEM,
              prompt: templatePrompt(seed, route.base),
              task: "design-template",
              timeoutMs: 120_000,
              idleMs: 15_000,
              firstPartMs: 60_000,
              thinking: "LOW",
              maxOutputTokens: 12_000,
              enumLiterals: true,
              signal,
            },
            { hedgeMs: 20_000, attempts: 3, afterSilence: true },
          ),
          seed.master.length
            ? writeTemplateSamples(
                toBlueprint(seed.design),
                seed.design.samples,
                seed.master,
                brief,
                now,
                signal,
              )
            : Promise.resolve<Design["samples"]>([]),
        ]);
        if (result.ok) {
          stats.output += result.tokens.output;
          const applied = applyDesignPatch(seed.design, result.data);
          let next = rebindTemplateSamples(seed.design, applied.design, result.data);
          // The configuration records replace the template's (and whatever the patch wrote for those types).
          const given = config && withoutInventedContacts(config, seed.design, brief);
          if (given?.length)
            next = rebindTemplateSamples(
              next,
              { ...next, samples: [...next.samples, ...given] },
              { samples: given },
            );
          seeded = withBriefHours(seed.design, next, brief);
          console.info(
            JSON.stringify({
              event: "design_template_patched",
              from: route.base.id,
              entities: (result.data.entities ?? []).map((e) => `${e.id}${e.resource ? "*" : ""}`),
              views: result.data.views?.length ?? 0,
              samples: result.data.samples?.length ?? 0,
              config: config?.length ?? null,
              removed: [...applied.removed],
            }),
          );
          show(sketchOf(seeded, true));
        } else if (!result.retryable || signal.aborted) {
          return settle(result.error);
        } else {
          // A patch that never came back: the design is written from scratch instead, as on the other routes.
          console.warn(
            JSON.stringify({ event: "design_template_fallback", from: route.base.id, reason: result.error }),
          );
          seedRef = null;
        }
      }
      if (seeded) designed = seeded;
      else {
        // Designs take 8–40 s on 3.5 Flash and 60–150 s on 3.7 Flash, longer when Vertex is busy. A call is judged by
        // whether its answer keeps streaming, not by the clock: one that has said nothing for 20 s gets a parallel
        // twin, one silent for 15 s mid-answer (60 s before its first part, while it thinks) is stopped and retried.
        // A call that runs away (see runawayWatcher) is stopped within seconds and replaced. Real designs are 2–16k
        // tokens; the cap leaves room, because an answer cut off at the cap is thrown away whole.
        stats.calls++;
        const result = await generateJsonHedged(
          designRequest,
          {
            system: DESIGN_SYSTEM,
            prompt,
            task: "design",
            timeoutMs: 170_000,
            idleMs: 15_000,
            firstPartMs: 60_000,
            thinking: "LOW",
            maxOutputTokens: 24_000,
            enumLiterals: true,
            signal,
            onText,
          },
          { hedgeMs: 20_000, attempts: 4, afterSilence: true },
        );
        if (!result.ok) return settle(result.error);
        stats.output += result.tokens.output;
        designed = result.data;
      }
    } else {
      stats.repairs++;
      onEvent?.({ type: "stage", stage: "fix", issues: errors.length });
      stats.calls++;
      // The large design schema can repeatedly omit optional choices. A tiny required schema repairs them directly,
      // on any repair: a later patch that turned a formula back into a status once left it with placeholder stages.
      let choices: DesignPatch | null = null;
      if (errors.some((e) => e.startsWith("Brief coverage:") && /options|choices|stages|statuses/i.test(e))) {
        const result = await generateJsonHedged(
          choiceRepairAnswer,
          {
            system: CHOICE_REPAIR_SYSTEM,
            task: "design-choices",
            thinking: "LOW",
            signal,
            prompt: `Brief: ${brief}\nProblems: ${errors.join("\n")}\nExisting choice fields: ${JSON.stringify(previous.data.entities.map((e) => ({ id: e.id, name: e.name, fields: e.fields.filter((f) => ["status", "select", "multi_select"].includes(f.type)) })))}`,
            timeoutMs: 30_000,
            maxOutputTokens: 2500,
          },
          { hedgeMs: 12_000, afterSilence: true, attempts: 2 },
        );
        if (result.ok) {
          stats.output += result.tokens.output;
          choices = choicePatch(previous.data, result.data);
        }
      }
      if (choices) {
        ({ design: designed, removed } = applyDesignPatch(previous.data, choices));
      } else {
        const result = await generateJsonHedged(
          designPatch,
          {
            system: DESIGN_SYSTEM,
            // On the template route the repair's samples replace a record type's, since the template's records
            // are another business's; elsewhere samples are only for record types the repair adds.
            prompt: `Today in Manila: ${todayKey(now)}\n\nBrief:\n${brief}\n\nYour design:\n${JSON.stringify(seedRef ? seedForPrompt(previous.data, 4) : previous.data)}\n\nIt has these problems:\n- ${errors.slice(0, 20).join("\n- ")}\n\n${PATCH_INSTRUCTIONS}${
              seedRef
                ? "\n- Exception on this design: sample records you return for a record type replace all of that record type's. For a record type whose records are still the starting system's, return its complete set from the brief."
                : ""
            }`,
            task: "design-fix",
            timeoutMs: 120_000,
            idleMs: 30_000,
            firstPartMs: 60_000,
            thinking: "LOW",
            maxOutputTokens: 12_000,
            enumLiterals: true,
            signal,
          },
          { hedgeMs: 40_000, attempts: 3, afterSilence: true },
        );
        if (!result.ok) return settle(result.error);
        stats.output += result.tokens.output;
        ({ design: designed, removed } = applyDesignPatch(previous.data, result.data));
        // On the template route a repair's samples replace that record type's, as the first patch's do.
        if (seedRef) designed = rebindTemplateSamples(previous.data, designed, result.data);
      }
    }
    const build = (data: Design) => {
      const raw = ensurePublicForm(withTemplateForms(toBlueprint(data), seedRef?.forms ?? new Map()), brief);
      const samples = mergeDateAndSlot(raw, data.samples);
      const name = data.workspaceName || workspaceName;
      const bp = ensurePages(
        withStandardSite(repairStructure(tidy(raw)), name, data.site, fileParts.length ? undefined : brief),
      );
      const partial = shrunk(previous, bp);
      // What would break a screen, and what only falls short of the brief.
      const structural = [
        ...validateBlueprint(bp).map((e) => `${e.path}: ${e.message}`),
        ...bp.views.flatMap((v) =>
          v.type === "html" && v.html ? htmlConnectionProblems(bp, v.id, v.html) : [],
        ),
        ...widgetProblems(bp).map((p) => p.message),
        ...partial,
      ];
      const advisory = [...extraChecks(bp, brief), ...(seedRef ? templateChecks(seedRef, data) : [])];
      const errors = [...structural, ...advisory];
      return { data, samples, name, bp, partial, errors, structural, advisory };
    };
    let built = build(designed);
    if (previous) {
      // Fields a patch returned without what makes them work (a link without its record type, a status without its
      // options) get it back, then the design is checked again. Not what the patch removed on purpose.
      const back = restoreDropped(previous.data, designed, new Set([...previous.flagged, ...removed]));
      if (back.entities.length || back.fields.length || back.settings.length) {
        const restored = build(back.design);
        const kept = restored.errors.length <= built.errors.length;
        console.info(
          JSON.stringify({
            event: kept ? "design_repair_restored" : "design_repair_restore_skipped",
            entities: back.entities,
            fields: back.fields,
            settings: back.settings,
          }),
        );
        if (kept) built = restored;
      }
    }
    const { data, samples, name, bp, partial } = built;
    errors = built.errors;
    // Validates and lost nothing: good enough to hand over if the repairs run out.
    const sound = !built.structural.length;
    if (!sound && !partial.length) lastBroken = built;
    if (sound) {
      onEvent?.({ type: "stage", stage: "check" });
      stats.calls++;
      // On the template route the structure is the community system's and a repair is the exception, so the final
      // touches start while the review runs; a review that does ask for a repair leaves them unused.
      const early = route.tier === "template" && !previous ? prepare(built) : null;
      early?.catch(() => undefined);
      const checked = await reviewCoverage({
        blueprint: bp,
        plan: { request: brief, title: name, facts: [], steps: [], ops: [] },
        conversation: "New workspace setup. The brief contains the owner's requirements.",
        lookup:
          "Planned sample records (illustrative, not live business records) are in the evidence map as sample:<ref>, up to eight per record type.",
        // Up to eight samples per record type: every court, product and payment method, without a season of
        // bookings (a template's) to read.
        samples: fewSamples(samples, 8),
        today: todayKey(now),
        signal,
        mode: "setup",
      });
      // The review is a second opinion: when it's unavailable, a workspace that validates is still handed over, and a
      // question it raises is shown to the owner instead of stopping setup (the interview already asked).
      const gaps: SetupGap[] = built.advisory.map(asGap);
      if (checked) {
        errors.push(...checked.errors.map((e) => `Brief coverage: ${e}`));
        gaps.push(
          ...checked.errors.map(asGap),
          ...checked.questions.map((q) => ({ request: "A detail to confirm", detail: q })),
        );
      }
      const candidate: Candidate = { built, coverage: checked?.covered ?? [], gaps };
      if (!best || gaps.length <= best.gaps.length) best = candidate;
      if (!errors.length) return finish(candidate, early ?? undefined);
      if (early) console.info(JSON.stringify({ event: "design_early_finish_unused", from: route.base?.id }));
    }
    // A repair that left every problem it was given in place would most likely come back the same again: the
    // design is handed over now (the best one, with its gaps) instead of after another call.
    if (previous && noProgress(lastErrors, errors)) {
      console.warn(JSON.stringify({ event: "design_no_progress", round, errors: errors.slice(0, 10) }));
      return settle("The repair didn't fix what the check found.");
    }
    lastErrors = errors;
    console.warn(JSON.stringify({ event: "design_rejected", round, errors: errors.slice(0, 15) }));
    if (!partial.length)
      previous = {
        entities: bp.entities.length,
        views: bp.views.length,
        data,
        flagged: flaggedBy(bp, errors),
      };
  }
  return settle("I couldn't design a valid workspace for that yet. Add a detail or two and try again.");
}

/**
 * A public form is used by strangers, so it must say who they are, can't demand what they can't know, and should
 * show how to pay. Gemini forgets each of these now and then: a booking page without a name or phone, a required
 * "Booked via" dropdown, a GCash QR code the brief asked for but the page doesn't show.
 */
function tidyPublicForm(bp: Blueprint, v: Extract<View, { type: "form" }>) {
  const entity = bp.entities.find((e) => e.id === v.entityId);
  if (!entity) return;
  const field = (id: string) => entity.fields.find((f) => f.id === id);
  // Who is booking (a name) and how to reach them (a phone or email), asked as plain text.
  const asked = (pattern: RegExp) =>
    v.fieldIds.filter((id) => {
      const f = field(id);
      return f?.type === "text" && pattern.test(f.id);
    });
  const names = asked(/name|guest|customer|client|player/);
  const reach = asked(/phone|mobile|cell|email|contact/);
  const added = [
    ...(names.length ? [] : [{ id: "guest_name", name: "Your name", type: "text" as const, required: true }]),
    ...(reach.length
      ? []
      : [{ id: "guest_phone", name: "Mobile number", type: "text" as const, required: true }]),
  ];
  if (added.length) {
    const ids = added.map((f) => f.id);
    for (const f of added) if (!field(f.id)) entity.fields.push(f);
    v.fieldIds.push(...ids);
    if (v.steps?.length) {
      // Next to the details already asked, else in a details step before the last one.
      const known = [...names, ...reach];
      const last = v.steps[v.steps.length - 1];
      const home =
        v.steps.find((s) => s.fieldIds.some((id) => known.includes(id))) ??
        (/detail|contact|info|you/i.test(last.title) ? last : undefined);
      if (home) home.fieldIds.push(...ids);
      else
        v.steps.splice(v.steps.length - 1, 0, { id: "your_details", title: "Your details", fieldIds: ids });
    }
  }
  if (!names.length) {
    // Staff see who booked on the page in the list as well.
    const table = bp.views.find((x) => x.type === "table" && x.entityId === entity.id);
    if (table?.type === "table" && !table.fieldIds.includes("guest_name"))
      table.fieldIds.unshift("guest_name");
  }
  // Required fields the page doesn't ask for are added to it; a choice the business makes (Booked via) or a link
  // to a private list (players) can't be answered by a visitor, so it stops being required.
  const booking = entity.booking;
  for (const f of entity.fields)
    if (
      f.required &&
      !v.fieldIds.includes(f.id) &&
      (f.type === "select" || f.type === "multi_select" || f.type === "relation") &&
      f.id !== booking?.resourceFieldId
    )
      f.required = false;
  // The ways to pay, shown on the form when the workspace keeps them.
  const pay = bp.entities.find(
    (e) =>
      e.id !== entity.id &&
      !e.parent &&
      !e.resource &&
      /payment|pay_/.test(e.id) &&
      e.fields.some((f) => f.type === "image" || /account|qr|instruction/.test(f.id)),
  );
  if (pay && !v.blocks?.some((b) => b.type === "records" && b.entityId === pay.id)) {
    const shown = [
      pay.primaryFieldId,
      ...pay.fields
        .filter(
          (f) =>
            f.id !== pay.primaryFieldId && /type|method|provider|account|number|instruction|qr/.test(f.id),
        )
        .map((f) => f.id),
    ].slice(0, 7);
    const active = pay.fields.find((f) => /active|enabled|status/.test(f.id));
    const filter =
      active?.type === "checkbox"
        ? `${active.id} == true`
        : active?.type === "status" && active.options?.some((o) => o.id === "active")
          ? `${active.id} == 'active'`
          : undefined;
    v.blocks = [
      ...(v.blocks ?? []),
      {
        id: "how_to_pay",
        type: "records",
        title: "How to pay",
        entityId: pay.id,
        fieldIds: shown,
        layout: "cards",
        ...(filter ? { filter } : {}),
      },
    ];
  }
  // The ways to pay show on the form's payment step when it has one, where people need them.
  const payBlock = pay && v.blocks?.find((b) => b.type === "records" && b.entityId === pay.id);
  const payStep = v.steps?.find((s) => /pay/i.test(s.title));
  if (payBlock && payStep && !v.steps?.some((s) => s.blockIds?.includes(payBlock.id)))
    payStep.blockIds = [...(payStep.blockIds ?? []), payBlock.id];
}

/**
 * A form's add-ons point at a line-item record type under the form's record type and its link to the items offered.
 * Near misses are mended (a loose id, a missing parent, the wrong link or quantity field); anything else is dropped,
 * since the form works without add-ons.
 */
function tidyFormExtras(
  bp: Blueprint,
  v: Extract<View, { type: "form" }>,
  resolve: (id: string) => string | undefined,
) {
  // Gemini often plans an add-ons step without saying where the add-ons live; a form with that step, or a public
  // form whose record type has add-on line items (add-ons, rentals, products), gets them anyway.
  const wantsExtras = v.steps?.some((s) => s.extras);
  if (!v.extras && (v.public || wantsExtras)) {
    const line = bp.entities.find(
      (e) =>
        (e.parent
          ? e.parent.entityId === v.entityId
          : e.fields.some((f) => f.type === "relation" && f.relation?.entityId === v.entityId)) &&
        e.fields.some((f) => f.type === "relation" && f.relation?.entityId !== v.entityId),
    );
    const item = line?.fields.find((f) => f.type === "relation" && f.relation?.entityId !== v.entityId);
    const items = bp.entities.find((e) => e.id === item?.relation?.entityId);
    const addOnLike = /add|extra|rental|equipment|gear|product|merch|upsell|inclusion/;
    if (line && item && items && !items.resource && (wantsExtras || addOnLike.test(items.id))) {
      const active = items.fields.find((f) => /active|available|in_stock/.test(f.id));
      const filter =
        active?.type === "checkbox"
          ? `${active.id} == true`
          : active?.type === "status" && active.options?.some((o) => o.id === "active")
            ? `${active.id} == 'active'`
            : undefined;
      v.extras = { lineEntityId: line.id, itemFieldId: item.id, ...(filter ? { filter } : {}) };
    }
  }
  const extras = v.extras;
  if (!extras) return;
  const line = bp.entities.find((e) => e.id === (resolve(extras.lineEntityId) ?? extras.lineEntityId));
  const toParent = line?.fields.find((f) => f.type === "relation" && f.relation?.entityId === v.entityId);
  if (line && !line.parent && toParent) line.parent = { entityId: v.entityId, fieldId: toParent.id };
  const links =
    line?.fields.filter((f) => f.type === "relation" && f.relation?.entityId !== v.entityId) ?? [];
  const item = links.find((f) => f.id === extras.itemFieldId) ?? (links.length === 1 ? links[0] : undefined);
  const items = bp.entities.find((e) => e.id === item?.relation?.entityId);
  if (!line || line.parent?.entityId !== v.entityId || !item || !items) {
    delete v.extras;
    return;
  }
  extras.lineEntityId = line.id;
  extras.itemFieldId = item.id;
  const numbers = line.fields.filter((f) => f.type === "number");
  const qty =
    numbers.find((f) => f.id === extras.quantityFieldId) ??
    numbers.find((f) => /qty|quantity|count|pcs/.test(f.id));
  if (qty) extras.quantityFieldId = qty.id;
  else delete extras.quantityFieldId;
  // A filter may only name the items' own fields (active == true); one that names anything else is dropped.
  const known = new Set(items.fields.map((f) => f.id));
  const words = (extras.filter ?? "").replace(/'[^']*'/g, "").match(/[a-z_][a-z0-9_.]*\s*\(?/gi) ?? [];
  const plain = words.filter((w) => !w.endsWith("(")).map((w) => w.trim());
  if (plain.some((w) => !known.has(w) && !["true", "false", "null"].includes(w))) delete extras.filter;
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
/**
 * Every website uses the standard layout. Gemini writes the words (site); the page itself is built from the
 * workspace's data. A design with a public form but no landing page gets one; custom HTML sections stay.
 */
export function withStandardSite(
  bp: Blueprint,
  name: string,
  site?: Design["site"],
  /** The brief, to keep only contact details the owner actually gave. Skipped when files may hold them. */
  brief?: string,
): Blueprint {
  // An explicitly coded public page owns its design and any landing views used as data sources.
  if (bp.views.some((v) => v.type === "html" && v.public && v.html?.trim())) return bp;
  const landing = bp.views.find((v) => v.type === "landing");
  const hasForm = bp.views.some((v) => v.type === "form" && v.public);
  if (!landing && !hasForm) return bp;
  const copy: SiteCopy = site
    ? {
        headline: site.headline,
        intro: site.intro,
        cta: site.cta,
        offerTitle: site.offerTitle,
        highlights: site.highlights,
        steps: site.steps,
        contact: Object.fromEntries(
          site.contact
            .filter((c) => brief === undefined || givenIn(brief, c.value))
            .map((c) => [c.kind, c.value]),
        ),
      }
    : copyFromBlocks(landing?.type === "landing" ? landing.blocks : []);
  const html = landing?.type === "landing" ? landing.blocks.filter((b) => b.type === "html") : [];
  const blocks = [...standardBlocks(bp, name, copy), ...html];
  if (landing?.type === "landing") {
    landing.blocks = blocks;
    landing.layout = "standard";
    return bp;
  }
  const id = bp.views.some((v) => v.id === "home") ? "site_home" : "home";
  bp.views.push({
    id,
    entityId: "",
    name: "Home",
    type: "landing",
    public: true,
    layout: "standard",
    blocks,
  });
  return bp;
}

/**
 * Whether a contact detail comes from the brief rather than the model's imagination: its digits (phones, hours)
 * or its longer words (addresses) appear there.
 */
export function givenIn(brief: string, value: string): boolean {
  const text = brief.toLowerCase();
  const digits = value.replace(/\D/g, "");
  if (digits.length >= 7) return text.replace(/\D/g, "").includes(digits);
  const numbers = value.match(/\d+/g) ?? [];
  if (numbers.length && !numbers.every((n) => new RegExp(`\\b${n}\\b`).test(text))) return false;
  const words = value.toLowerCase().match(/[a-z]{4,}/g) ?? [];
  const known = words.filter((w) => text.includes(w));
  return numbers.length ? true : known.length >= Math.min(2, words.length);
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
  // Pages built for people outside the team (a website, a public form, a document) need a place in the sidebar too.
  const listed = new Set(bp.systems.flatMap((s) => s.viewIds));
  for (const v of bp.views) {
    if (
      listed.has(v.id) ||
      (v.type !== "landing" &&
        v.type !== "form" &&
        v.type !== "document" &&
        v.type !== "canvas" &&
        v.type !== "html" &&
        v.type !== "layout")
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
/** URL segments under /w/[workspace] the app uses itself; a page with one of these ids could never be opened. */
const RESERVED_IDS = new Set(["settings", "history", "ask"]);

/**
 * Structural slips that would quietly break features: a page named like one of the app's own, bookings without
 * booking settings (no schedule, no double-booking check, no public slots), and line items without a parent.
 */
export function repairStructure(bp: Blueprint): Blueprint {
  flattenLinks(bp);
  for (const s of bp.systems) {
    const fix = RESERVED_PAGES[s.name.trim().toLowerCase()];
    if (fix) s.name = fix;
    if (RESERVED_IDS.has(s.id)) {
      const base =
        s.name
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "_") || "page";
      let id = RESERVED_IDS.has(base) ? `${base}_page` : base;
      while (bp.systems.some((x) => x !== s && x.id === id)) id = `${id}_2`;
      s.id = id;
    }
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
  bookableSchedules(bp);
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
  // Two slips that used to cost a whole repair round (and a repair rewrites the whole design, sometimes losing
  // fields): a table grouped by a date or number, which can't be grouped, and a board on a select instead of the
  // record type's status. A record type with no status at all (habits by category, workouts by type) turns the
  // board's select into its status; with nothing to make columns from, the board becomes a table.
  bp.views = bp.views.map((v) => {
    const entity = bp.entities.find((e) => e.id === v.entityId);
    if (!entity) return v;
    if (v.type === "table" && v.groupByFieldId) {
      const field = entity.fields.find((f) => f.id === v.groupByFieldId);
      if (!field || !GROUP_KINDS.has(displayKind(bp, field))) delete v.groupByFieldId;
    }
    if (v.type === "kanban" && entity.fields.find((f) => f.id === v.statusFieldId)?.type !== "status") {
      const status = entity.fields.find((f) => f.type === "status");
      const picked = entity.fields.find((f) => f.id === v.statusFieldId);
      const select = picked?.type === "select" ? picked : entity.fields.find((f) => f.type === "select");
      if (status) v.statusFieldId = status.id;
      else if (select?.options?.length) {
        select.type = "status";
        v.statusFieldId = select.id;
      } else {
        const has = new Set(entity.fields.map((f) => f.id));
        const fieldIds = [...new Set([entity.primaryFieldId, ...v.cardFieldIds])].filter((id) => has.has(id));
        const { statusFieldId: _status, cardFieldIds: _cards, ...base } = v;
        return { ...base, type: "table", fieldIds } satisfies View;
      }
    }
    return v;
  });
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
  // The whole label has to be a time or a range of two: "1 - Poor" is a rating, not 1:00. A lone bare number
  // ("3") is a count or a rating too; a time says so with ":" or am/pm, or comes as a range.
  const parts = label
    .trim()
    .split(/\s*(?:-|–|to)\s*/i)
    .filter(Boolean);
  const times = parts.map(one);
  const timeLike = parts.length === 2 || /:|am|pm/i.test(label);
  if (parts.length && parts.length <= 2 && timeLike && times.every((t) => t !== null)) {
    const [start, end] = times as number[];
    return { start, ...(end !== undefined && end > start ? { end } : {}) };
  }
  const fromId = /^\d{1,2}_\d{2}$/.test(id) ? one(id.replace("_", ":")) : null;
  return fromId === null ? null : { start: fromId };
}

/** The thing a record type books: a record type with hours, else one named like a court or room, never people. */
function bookableField(bp: Blueprint, e: Entity): Field | undefined {
  const relations = e.fields.filter((f) => f.type === "relation" && f.relation?.entityId !== e.id);
  const target = (f: Field) => bp.entities.find((x) => x.id === f.relation?.entityId);
  const named = (f: Field, re: RegExp) => re.test(`${target(f)?.id} ${target(f)?.name}`.toLowerCase());
  return (
    relations.find((f) => target(f)?.resource) ??
    relations.find((f) =>
      named(
        f,
        /court|room|table|space|venue|lane|field|studio|desk|resource|amenit|facilit|pool|hall|clubhouse/,
      ),
    ) ??
    relations.find((f) => !named(f, /player|client|customer|member|guest|person|staff|user|people|resident/))
  );
}

/** Hours a bookable thing gets when the design doesn't say: the owner can change them in Settings. */
const DEFAULT_HOURS = { opensAt: "08:00", closesAt: "22:00", slotMinutes: 60 as const };

/**
 * A schedule (slot grid) only works on bookings of something with opening hours. Gemini often adds one to bookings of
 * an amenity or room without saying the hours or which fields hold the time and status, and the validator sent the
 * whole design back for a repair (the repair HOA setups needed about half the time). Those settings are filled in
 * from the record type itself: the time range, the status, and the thing booked, which gets default hours. Without a
 * time range to book, the schedule becomes a calendar, or goes when there's no date either.
 */
export function bookableSchedules(bp: Blueprint): Blueprint {
  const dropped = new Set<string>();
  bp.views = bp.views.map((v): View => {
    if (v.type !== "slot_grid") return v;
    const e = bp.entities.find((x) => x.id === v.entityId);
    if (!e) return v;
    const time =
      e.fields.find(
        (f) => f.id === e.booking?.timeFieldId && f.type === "time_range" && f.range !== "dates",
      ) ?? e.fields.find((f) => f.type === "time_range" && f.range !== "dates");
    const status =
      e.fields.find((f) => f.id === e.booking?.statusFieldId) ?? e.fields.find((f) => f.type === "status");
    const resourceField =
      e.fields.find((f) => f.id === e.booking?.resourceFieldId && f.type === "relation") ??
      bookableField(bp, e);
    const resource = bp.entities.find((x) => x.id === resourceField?.relation?.entityId);
    if (time && status && resourceField && resource) {
      resource.resource ??= { ...DEFAULT_HOURS };
      e.booking = {
        resourceFieldId: resourceField.id,
        timeFieldId: time.id,
        statusFieldId: status.id,
        blockingStatuses:
          e.booking?.blockingStatuses.filter((id) => status.options?.some((o) => o.id === id)) ??
          (status.options ?? []).map((o) => o.id).filter((id) => !/cancel/.test(id)),
      };
      return v;
    }
    const date = e.fields.find((f) => f.type === "time_range" || f.type === "datetime" || f.type === "date");
    if (date)
      return {
        id: v.id,
        entityId: v.entityId,
        name: v.name,
        type: "calendar",
        dateFieldId: date.id,
        titleFieldId: e.primaryFieldId,
      };
    dropped.add(v.id);
    return v;
  });
  if (dropped.size) {
    bp.views = bp.views.filter((v) => !dropped.has(v.id));
    for (const s of bp.systems) s.viewIds = s.viewIds.filter((id) => !dropped.has(id));
  }
  return bp;
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
    const resourceField = bookableField(bp, e);
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

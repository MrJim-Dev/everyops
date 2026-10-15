import { publicProblems, sharedTableProblems } from "@/lib/components/public-safety";
import { componentDef, layoutItems, type Ref } from "@/lib/components/registry";
import { formulaOrder } from "@/lib/engine/compute";
import { parseExpr } from "@/lib/engine/expr";
import { displayKind, isNumericKind } from "./field-kind";
import { walkPath } from "./paths";
import type { Block, Blueprint, Entity, Field, FormExtras, LayoutView, Rule } from "./types";

export type ValidationError = { path: string; message: string };

const DATE_TYPES = new Set(["date", "datetime", "time_range"]);
/** What a table can group its rows by. */
export const GROUP_KINDS = new Set(["choice", "status", "relation", "person", "checkbox"]);
/** A moment in time with an hour, which heatmaps need. */
const hasHour = (f: Field | undefined) =>
  !!f && (f.type === "datetime" || (f.type === "time_range" && f.range !== "dates"));

function checkExpr(bp: Blueprint, entity: Entity, src: string, path: string, errors: ValidationError[]) {
  const parsed = parseExpr(src);
  if (!parsed.ok) {
    errors.push({ path, message: `Formula "${src}" is invalid: ${parsed.error}` });
    return;
  }
  for (const ref of parsed.refs) {
    const { error } = walkPath(bp, entity, ref.split("."));
    if (error) errors.push({ path, message: error });
  }
}

/** Returns every problem in a blueprint, each with a path and a plain message. */
export function validateBlueprint(bp: Blueprint): ValidationError[] {
  const errors: ValidationError[] = [];
  const entityIds = new Set(bp.entities.map((e) => e.id));
  const viewIds = new Set(bp.views.map((v) => v.id));
  const widgetIds = new Set(bp.widgets.map((w) => w.id));
  for (const [kind, ids] of [
    ["view", bp.views.map((v) => v.id)],
    ["widget", bp.widgets.map((w) => w.id)],
    ["page", bp.systems.map((s) => s.id)],
    ["record type", bp.entities.map((e) => e.id)],
  ] as const)
    for (const id of new Set(ids.filter((id, i) => ids.indexOf(id) !== i)))
      errors.push({ path: kind, message: `Duplicate ${kind} id "${id}"` });

  bp.entities.forEach((entity, ei) => {
    const fieldIds = new Set<string>();
    entity.fields.forEach((field, fi) => {
      const path = `entities.${ei}.fields.${fi}`;
      if (fieldIds.has(field.id)) errors.push({ path, message: `Duplicate field "${field.id}"` });
      fieldIds.add(field.id);
      if (field.type === "relation" && !entityIds.has(field.relation?.entityId ?? ""))
        errors.push({ path, message: `${field.name} links to a missing entity` });
      if ((field.type === "select" || field.type === "status") && !field.options?.length)
        errors.push({ path, message: `${field.name} needs options` });
      if (field.type === "formula") {
        if (!field.formula) errors.push({ path, message: `${field.name} has no formula` });
        else {
          checkExpr(bp, entity, field.formula.expr, path, errors);
          if (field.formula.freezeWhen) checkExpr(bp, entity, field.formula.freezeWhen, path, errors);
        }
      }
    });
    if (!fieldIds.has(entity.primaryFieldId))
      errors.push({ path: `entities.${ei}`, message: `${entity.name} has no primary field` });
    const formulas = entity.fields.filter((f) => f.type === "formula");
    if (formulaOrder(entity).length < formulas.length)
      errors.push({ path: `entities.${ei}`, message: `${entity.name} has a formula cycle` });
    if (entity.booking) {
      const b = entity.booking;
      for (const id of [b.resourceFieldId, b.timeFieldId, b.statusFieldId])
        if (!fieldIds.has(id))
          errors.push({ path: `entities.${ei}.booking`, message: `Missing field "${id}"` });
    }
  });

  bp.views.forEach((view, vi) => {
    const path = `views.${vi}`;
    if (view.type === "document" || view.type === "canvas" || view.type === "html") return;
    if (view.type === "landing") {
      checkBlocks(bp, view.blocks, path, errors);
      return;
    }
    if (view.type === "layout") {
      checkLayout(bp, view, path, errors);
      return;
    }
    const entity = bp.entities.find((e) => e.id === view.entityId);
    if (!entity) {
      errors.push({ path, message: `View "${view.name}" uses a missing entity` });
      return;
    }
    const has = (id: string) => entity.fields.some((f) => f.id === id);
    const missing = (ids: string[]) => {
      for (const id of ids)
        if (!has(id)) errors.push({ path, message: `Field "${id}" does not exist on ${entity.name}` });
    };
    switch (view.type) {
      case "table":
        missing(view.fieldIds);
        if (view.filter) checkExpr(bp, entity, view.filter, path, errors);
        if (view.publicData)
          for (const message of sharedTableProblems(bp, view)) errors.push({ path, message });
        if (view.groupByFieldId) {
          const field = entity.fields.find((f) => f.id === view.groupByFieldId);
          if (!field || !GROUP_KINDS.has(displayKind(bp, field)))
            errors.push({
              path,
              message: `${view.name} can only group by a select, status, relation, person or checkbox field`,
            });
        }
        break;
      case "kanban":
        missing([view.statusFieldId, ...view.cardFieldIds]);
        if (entity.fields.find((f) => f.id === view.statusFieldId)?.type !== "status")
          errors.push({ path, message: "Board columns must use a status field" });
        break;
      case "calendar":
        missing([view.dateFieldId, view.titleFieldId]);
        break;
      case "slot_grid": {
        const resourceField = entity.fields.find((f) => f.id === entity.booking?.resourceFieldId);
        const resource = bp.entities.find((e) => e.id === resourceField?.relation?.entityId);
        if (!entity.booking || !resource?.resource)
          errors.push({ path, message: "A schedule needs a bookable resource with opening hours" });
        break;
      }
      case "checkout":
        if (!entityIds.has(view.productEntityId) || !entityIds.has(view.lineEntityId))
          errors.push({ path, message: "Checkout needs products and line items" });
        missing([view.paymentFieldId, ...(view.fieldIds ?? [])]);
        break;
      case "approval_queue":
        missing([view.statusFieldId, ...view.detailFieldIds]);
        break;
      case "form":
        missing(view.fieldIds);
        if (view.blocks) checkBlocks(bp, view.blocks, path, errors);
        if (view.steps) {
          const seen = new Set<string>();
          for (const step of view.steps) {
            // A step may ask nothing but show the add-ons or some of the form's blocks (how to pay).
            if (!step.fieldIds.length && !(step.extras && view.extras) && !step.blockIds?.length)
              errors.push({ path, message: `${view.name}: step "${step.title}" asks nothing` });
            missing(step.fieldIds);
            for (const id of step.blockIds ?? [])
              if (!view.blocks?.some((b) => b.id === id))
                errors.push({
                  path,
                  message: `${view.name}: step "${step.title}" shows block "${id}", which isn't on the form (blocks: ${(view.blocks ?? []).map((b) => b.id).join(", ") || "none"})`,
                });
            for (const id of step.fieldIds) {
              if (seen.has(id)) errors.push({ path, message: `${view.name}: "${id}" is asked in two steps` });
              seen.add(id);
            }
          }
        }
        if (view.extras) checkExtras(bp, entity, view.extras, path, errors);
        break;
      case "notes":
        missing([view.titleFieldId, view.bodyFieldId, ...(view.metaFieldIds ?? [])]);
        if (entity.fields.find((f) => f.id === view.bodyFieldId)?.type !== "long_text")
          errors.push({ path, message: "A notebook's body must be a long text field" });
        break;
    }
  });

  bp.systems.forEach((system, si) => {
    const path = `systems.${si}`;
    if (system.viewIds.length + system.widgetIds.length === 0)
      errors.push({ path, message: `${system.name} is empty` });
    for (const id of system.viewIds)
      if (!viewIds.has(id)) errors.push({ path, message: `${system.name} lists a missing view "${id}"` });
    for (const id of system.widgetIds)
      if (!widgetIds.has(id)) errors.push({ path, message: `${system.name} lists a missing widget "${id}"` });
  });

  bp.widgets.forEach((widget, wi) => {
    const entity = bp.entities.find((e) => e.id === widget.entityId);
    if (!entity) errors.push({ path: `widgets.${wi}`, message: `${widget.title} uses a missing entity` });
    else if (widget.filter && !widget.calc) checkExpr(bp, entity, widget.filter, `widgets.${wi}`, errors);
    const chart = widget.type === "chart" ? widget.chart : undefined;
    if (widget.calc && (widget.type === "stat" || widget.type === "progress")) {
      const path = `widgets.${wi}.calc`;
      const ids = new Set<string>();
      for (const term of widget.calc.terms) {
        if (!/^[a-z][a-z0-9_]*$/.test(term.id))
          errors.push({ path, message: `${widget.title}: total "${term.id}" needs a snake_case name` });
        if (ids.has(term.id))
          errors.push({ path, message: `${widget.title}: total "${term.id}" is listed twice` });
        ids.add(term.id);
        const source = bp.entities.find((e) => e.id === term.entityId);
        if (!source) {
          errors.push({
            path,
            message: `${widget.title}: total "${term.id}" uses a missing entity "${term.entityId}"`,
          });
          continue;
        }
        if (term.op !== "count" && !source.fields.some((f) => f.id === term.fieldId))
          errors.push({
            path,
            message: `${widget.title}: total "${term.id}" adds up "${term.fieldId ?? ""}", which isn't a field of ${source.name}`,
          });
        if (term.filter) checkExpr(bp, source, term.filter, path, errors);
      }
      if (!widget.calc.terms.length)
        errors.push({ path, message: `${widget.title}: a formula needs at least one total` });
      const parsed = parseExpr(widget.calc.expr);
      if (!parsed.ok)
        errors.push({
          path,
          message: `${widget.title}: formula "${widget.calc.expr}" is invalid: ${parsed.error}`,
        });
      else
        for (const ref of parsed.refs)
          if (!ids.has(ref))
            errors.push({
              path,
              message: `${widget.title}: "${ref}" in the formula isn't one of its totals (${[...ids].join(", ")})`,
            });
    }
    if (entity && widget.type === "chart") {
      const path = `widgets.${wi}`;
      const has = (id?: string) => !!id && entity.fields.some((f) => f.id === id);
      if (!chart || (!has(chart.dateFieldId) && !has(chart.groupByFieldId)))
        errors.push({ path, message: `${widget.title} needs a date field or a field to group by` });
      else if (chart.kind === "donut" && !has(chart.groupByFieldId))
        errors.push({ path, message: `${widget.title}: a donut needs a field to group by` });
    }
    if (entity) {
      const path = `widgets.${wi}`;
      const fieldOf = (id?: string) => entity.fields.find((f) => f.id === id);
      if (widget.compare) {
        if (widget.type !== "stat")
          errors.push({ path, message: `${widget.title}: only stats can compare periods` });
        if (widget.calc)
          errors.push({ path, message: `${widget.title}: a stat with a formula can't compare periods` });
        if (!DATE_TYPES.has(fieldOf(widget.compare.dateFieldId)?.type ?? ""))
          errors.push({
            path,
            message: `${widget.title}: compare needs a date, date-time or time range field`,
          });
      }
      if (widget.type === "agenda" && !DATE_TYPES.has(fieldOf(widget.agenda?.dateFieldId)?.type ?? ""))
        errors.push({
          path,
          message: `${widget.title}: an agenda needs a date, date-time or time range field`,
        });
      if (widget.type === "agenda")
        for (const id of widget.agenda?.fieldIds ?? [])
          if (!fieldOf(id)) errors.push({ path, message: `${widget.title}: field "${id}" does not exist` });
      if (widget.type === "heatmap" && !hasHour(fieldOf(widget.heatmap?.dateFieldId)))
        errors.push({
          path,
          message: `${widget.title}: a heatmap needs a date-time or time range field with times`,
        });
    }
  });

  bp.rules.forEach((rule, ri) => {
    const entity = bp.entities.find((e) => e.id === rule.trigger.entityId);
    if (!entity) errors.push({ path: `rules.${ri}`, message: `${rule.name} uses a missing entity` });
    else {
      if (rule.when) checkExpr(bp, entity, rule.when, `rules.${ri}`, errors);
      checkRule(bp, entity, rule, `rules.${ri}`, errors);
    }
  });

  return errors;
}

const NUMERIC = new Set(["number", "money", "percent"]);
const list = (fields: Field[]) => fields.map((f) => f.id).join(", ") || "none";

/**
 * An automation must do something real: each change points at a link of the record that triggers it and a field
 * of the record it changes, with a formula that reads real fields. Without this a rule with a blank field saved
 * fine and quietly did nothing ("Add stock on delivery" that never added stock).
 */
function checkRule(bp: Blueprint, source: Entity, rule: Rule, path: string, errors: ValidationError[]) {
  const say = (message: string) => errors.push({ path, message: `Automation "${rule.name}": ${message}` });
  const t = rule.trigger;
  if (t.event === "status_changed") {
    const status = source.fields.find((f) => f.id === t.fieldId);
    if (!status || (status.type !== "status" && status.type !== "select"))
      say(`status_changed needs trigger.fieldId, a status field of ${source.name}`);
    else if (t.to && !status.options?.some((o) => o.id === t.to))
      say(
        `${status.name} has no option "${t.to}" (options: ${(status.options ?? []).map((o) => o.id).join(", ")})`,
      );
  }
  if (!rule.actions.length) say("it has no actions");
  for (const action of rule.actions) {
    if (action.type === "notify") {
      if (!action.message.trim()) say("the notice has no message");
      continue;
    }
    let target = source;
    if (action.target.kind === "relation") {
      const linkId = action.target.fieldId;
      const link = source.fields.find((f) => f.id === linkId);
      const linked = bp.entities.find((e) => e.id === link?.relation?.entityId);
      if (!link || link.type !== "relation" || !linked) {
        say(
          `target.fieldId "${linkId}" isn't a link on ${source.name} (links: ${list(source.fields.filter((f) => f.type === "relation"))})`,
        );
        continue;
      }
      target = linked;
    }
    const field = target.fields.find((f) => f.id === action.fieldId);
    if (!field) {
      say(
        `fieldId "${action.fieldId}" isn't a field of ${target.name}; say which one it changes (fields: ${list(target.fields)})`,
      );
      continue;
    }
    if (field.type === "formula" || field.type === "rollup") {
      say(`${target.name}'s ${field.name} is calculated, so an automation can't change it`);
      continue;
    }
    if (action.type === "set_field") {
      checkExpr(bp, source, action.value, path, errors);
      continue;
    }
    if (!NUMERIC.has(field.type))
      say(`${target.name}'s ${field.name} isn't a number, so it can't be added to`);
    const delta = action.delta.trim();
    if (!delta || delta === "0")
      say(`it adds nothing to ${field.name}; delta is a formula such as quantity or -qty`);
    else checkExpr(bp, source, delta, path, errors);
    if (t.event === "updated")
      say(
        `adding to ${field.name} on every edit counts it again each time. Trigger it when the record is created (later edits and deletes are kept in step) or when its status changes`,
      );
  }
}

/** Blocks on public pages: live data must point at real fields, and links at real forms. */
/** Add-ons on a form: line items under the form's record type, linking to the items offered. */
function checkExtras(
  bp: Blueprint,
  entity: Entity,
  extras: FormExtras,
  path: string,
  errors: ValidationError[],
) {
  const line = bp.entities.find((e) => e.id === extras.lineEntityId);
  if (!line) {
    errors.push({ path, message: `Add-ons use a missing line-item record type "${extras.lineEntityId}"` });
    return;
  }
  if (line.parent?.entityId !== entity.id)
    errors.push({
      path,
      message: `Add-on line items (${line.name}) must have ${entity.name} as their parent`,
    });
  const item = line.fields.find((f) => f.id === extras.itemFieldId);
  const items = bp.entities.find((e) => e.id === item?.relation?.entityId);
  if (!item || item.type !== "relation" || !items)
    errors.push({
      path,
      message: `Add-ons need "${extras.itemFieldId}" to be a link on ${line.name} to the items offered`,
    });
  else if (extras.filter) checkExpr(bp, items, extras.filter, path, errors);
  if (extras.quantityFieldId && line.fields.find((f) => f.id === extras.quantityFieldId)?.type !== "number")
    errors.push({
      path,
      message: `Add-on quantity "${extras.quantityFieldId}" must be a number field on ${line.name}`,
    });
}

function checkBlocks(bp: Blueprint, blocks: Block[], path: string, errors: ValidationError[]) {
  const ids = new Set<string>();
  const isForm = (id: string | undefined) => !!id && bp.views.some((v) => v.id === id && v.type === "form");
  blocks.forEach((block, bi) => {
    const at = `${path}.blocks.${bi}`;
    if (ids.has(block.id)) errors.push({ path: at, message: `Duplicate block "${block.id}"` });
    ids.add(block.id);
    switch (block.type) {
      case "records": {
        const entity = bp.entities.find((e) => e.id === block.entityId);
        if (!entity) {
          errors.push({ path: at, message: `${block.title ?? "A list"} uses a missing record type` });
          break;
        }
        for (const id of block.fieldIds)
          if (!entity.fields.some((f) => f.id === id))
            errors.push({ path: at, message: `Field "${id}" does not exist on ${entity.name}` });
        if (!block.fieldIds.length)
          errors.push({ path: at, message: `${block.title ?? "A list"} shows no fields` });
        if (block.filter) checkExpr(bp, entity, block.filter, at, errors);
        break;
      }
      case "form":
        if (!isForm(block.viewId))
          errors.push({ path: at, message: "The form block points at a missing form" });
        break;
      case "hero":
        if (block.ctaViewId && !isForm(block.ctaViewId))
          errors.push({ path: at, message: "The button points at a missing form" });
        break;
      case "highlights":
      case "steps":
        if (!block.items.length)
          errors.push({ path: at, message: `The ${block.type} section has nothing in it` });
        break;
    }
  });
}

/** What a layout component's field must hold, and how to say so. */
const NEEDS: Record<
  NonNullable<Extract<Ref, { kind: "field" }>["needs"]>,
  { ok: (kind: string) => boolean; words: string }
> = {
  date: {
    ok: (k) => k === "date" || k === "datetime" || k === "time_range",
    words: "a date, date and time, or time range",
  },
  number: { ok: (k) => isNumericKind(k as never), words: "a number or money field" },
  image: { ok: (k) => k === "image", words: "a picture field" },
  group: {
    ok: (k) => GROUP_KINDS.has(k) || k === "text",
    words: "a select, status, link, person, checkbox or text field",
  },
  status: { ok: (k) => k === "status", words: "a status field" },
};

/**
 * A layout page: every component is in the library, its settings fit its schema, and everything it points at
 * (record types, fields of the right kind, filters, tabs, dashboard cards) exists. A layout can't show itself.
 */
function checkLayout(bp: Blueprint, view: LayoutView, path: string, errors: ValidationError[]) {
  if (!view.sections?.length) {
    errors.push({ path, message: `${view.name} has no sections` });
    return;
  }
  for (const { item, path: at } of layoutItems(view.sections)) {
    const where = `${path}.${at}`;
    const d = componentDef(item.component);
    if (!d) {
      errors.push({ path: where, message: `${view.name}: "${item.component}" isn't a component` });
      continue;
    }
    const parsed = d.props.safeParse(item.props);
    if (!parsed.success) {
      errors.push({
        path: where,
        message: `${view.name}: ${d.name} settings: ${parsed.error.issues
          .slice(0, 3)
          .map((i) => `${i.path.join(".") || "settings"} ${i.message}`)
          .join("; ")}`,
      });
      continue;
    }
    if (view.public)
      for (const problem of publicProblems(bp, d, parsed.data))
        errors.push({ path: where, message: `${view.name} is public: ${problem}` });
    for (const ref of d.refs(parsed.data)) {
      if (ref.kind === "view") {
        if (ref.viewId === view.id) errors.push({ path: where, message: `${view.name} can't show itself` });
        else if (!bp.views.some((v) => v.id === ref.viewId))
          errors.push({
            path: where,
            message: `${view.name}: ${d.name} opens a missing tab "${ref.viewId}"`,
          });
        continue;
      }
      if (ref.kind === "widget") {
        if (!bp.widgets.some((w) => w.id === ref.widgetId))
          errors.push({
            path: where,
            message: `${view.name}: ${d.name} shows a missing card "${ref.widgetId}"`,
          });
        continue;
      }
      const entity = bp.entities.find((e) => e.id === ref.entityId);
      if (!entity) {
        if (ref.kind === "entity")
          errors.push({
            path: where,
            message: `${view.name}: ${d.name} uses a missing record type "${ref.entityId}"`,
          });
        continue;
      }
      if (ref.kind === "filter") checkExpr(bp, entity, ref.expr, where, errors);
      if (ref.kind !== "field") continue;
      const field = entity.fields.find((f) => f.id === ref.fieldId);
      if (!field) {
        errors.push({
          path: where,
          message: `${view.name}: ${d.name} uses "${ref.fieldId}", which isn't a field of ${entity.name}`,
        });
        continue;
      }
      const need = ref.needs ? NEEDS[ref.needs] : undefined;
      if (need && !need.ok(displayKind(bp, field)))
        errors.push({
          path: where,
          message: `${view.name}: ${d.name} needs ${need.words} for ${field.name}`,
        });
    }
  }
}

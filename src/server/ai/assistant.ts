import "server-only";
import type {
  Block,
  Blueprint,
  DataRecord,
  Entity,
  Field,
  RecordData,
  View,
  Widget,
} from "@/lib/blueprint/types";
import { validateBlueprint } from "@/lib/blueprint/validate";
import { applyOps, type ChangeOp, type ChangePlan, commitChange, type RecordOp } from "@/lib/engine/changes";
import { applyRecordOps } from "@/lib/engine/records";
import { isPublic } from "@/lib/public/resolve";
import { randomToken } from "@/lib/store/workspace-model";
import { todayKey } from "@/lib/time";
import { ASSISTANT_SYSTEM, type AssistantAnswer, assistantAnswer } from "./assistant-prompt";
import { fillNotesView, tidyBlocks, toEntity, toFieldValue, toRule, toView } from "./design";
import { generateJson } from "./gemini";

export type AssistantMessage = { role: "user" | "assistant"; text: string };
export type AssistantResult =
  | { ok: true; kind: "answer" | "plan" | "clarify"; reply: string; suggestions: string[]; plan?: ChangePlan }
  | { ok: false; message: string };

const MAX_RECORD_CHARS = 120_000;

/** Records as compact JSON lines per record type, cut off if the workspace is very large. */
function recordContext(bp: Blueprint, records: DataRecord[]) {
  const lines: string[] = [];
  let size = 0;
  let cut = false;
  for (const e of bp.entities) {
    const own = records.filter((r) => r.entityId === e.id);
    lines.push(`## ${e.pluralName} (${e.id}): ${own.length} records`);
    for (const r of own) {
      const line = JSON.stringify({ id: r.id, ...r.data });
      if (size + line.length > MAX_RECORD_CHARS) {
        cut = true;
        break;
      }
      size += line.length;
      lines.push(line);
    }
  }
  if (cut) lines.push("(Data cut off here: the workspace has more records than fit.)");
  return lines.join("\n");
}

type RawPlan = AssistantAnswer["plan"];

const DATE_TYPES = new Set(["date", "datetime", "time_range"]);

/** Fills the parts of a new view that Gemini often leaves out, from the record type's own fields. */
function fillView(view: View, entity: Entity) {
  const has = (id: string | undefined) => !!id && entity.fields.some((f) => f.id === id);
  const status = entity.fields.find((f) => f.type === "status");
  switch (view.type) {
    case "table":
      view.fieldIds = view.fieldIds.filter(has);
      if (!view.fieldIds.length)
        view.fieldIds = entity.fields
          .filter((f) => f.type !== "long_text")
          .slice(0, 6)
          .map((f) => f.id);
      break;
    case "kanban":
      if (!has(view.statusFieldId) && status) view.statusFieldId = status.id;
      view.cardFieldIds = view.cardFieldIds.filter((id) => has(id) && id !== view.statusFieldId);
      break;
    case "calendar": {
      if (!has(view.dateFieldId)) {
        const date = entity.fields.find((f) => DATE_TYPES.has(f.type));
        if (date) view.dateFieldId = date.id;
      }
      if (!has(view.titleFieldId)) view.titleFieldId = entity.primaryFieldId;
      break;
    }
    case "approval_queue":
      if (!has(view.statusFieldId) && status) view.statusFieldId = status.id;
      break;
    case "form":
      view.fieldIds = view.fieldIds.filter(has);
      break;
  }
}

/** Charts need a date to plot over or a field to group by; a donut always groups. Drops ids that don't exist. */
function fillWidget(widget: Widget, entity: Entity) {
  const has = (id: string | undefined) => !!id && entity.fields.some((f) => f.id === id);
  if (widget.metric.fieldId && !has(widget.metric.fieldId)) widget.metric = { op: "count" };
  const chart = widget.chart;
  if (widget.type !== "chart" || !chart) return;
  if (!has(chart.groupByFieldId)) delete chart.groupByFieldId;
  if (!has(chart.splitByFieldId)) delete chart.splitByFieldId;
  if (!has(chart.dateFieldId)) {
    delete chart.dateFieldId;
    if (!chart.groupByFieldId) {
      const date = entity.fields.find((f) => DATE_TYPES.has(f.type));
      if (date) chart.dateFieldId = date.id;
    }
  }
  if (chart.kind === "donut" && !chart.groupByFieldId) chart.kind = "bar";
  if (!chart.bucket) chart.bucket = "day";
}

function toDesignOps(
  bp: Blueprint,
  raw: RawPlan["ops"],
  renames: RawPlan["renames"] = [],
): { ops: ChangeOp[]; errors: string[] } {
  const ops: ChangeOp[] = [];
  const errors: string[] = [];
  // A plan that adds one new section usually means its new views and widgets go there.
  const newSystems = raw.flatMap((o) => (o.op === "add_system" && o.system ? [o.system.id] : []));
  const defaultSystem = newSystems.length === 1 ? newSystems[0] : undefined;
  for (const [i, o] of raw.entries()) {
    const at = `ops[${i}] ${o.op}`;
    const systemId = ("systemId" in o ? o.systemId : undefined) || defaultSystem;
    const newName = "name" in o ? o.name.trim() : "";
    switch (o.op) {
      case "add_field":
        if (o.entityId && o.field)
          ops.push({ op: "add_field", entityId: o.entityId, field: o.field as Field });
        else errors.push(`${at}: needs entityId and field`);
        break;
      case "update_field":
        if (o.entityId && o.fieldId && o.patch)
          ops.push({ op: "update_field", entityId: o.entityId, fieldId: o.fieldId, patch: o.patch });
        else errors.push(`${at}: needs entityId, fieldId and patch`);
        break;
      case "add_view_field":
        // Without a view, new fields are shown in their tables automatically (below).
        if (o.viewId && o.fieldId) ops.push({ op: "add_view_field", viewId: o.viewId, fieldId: o.fieldId });
        break;
      case "rename_workspace":
        if (newName) ops.push({ op: "rename_workspace", name: newName });
        else errors.push(`${at}: needs name`);
        break;
      case "add_entity":
        if (o.entity) ops.push({ op: "add_entity", entity: toEntity(o.entity) });
        else errors.push(`${at}: needs entity`);
        break;
      case "add_view":
        if (o.view && systemId) ops.push({ op: "add_view", systemId, view: toView(o.view) });
        else errors.push(`${at}: needs view and systemId`);
        break;
      case "add_widget":
        if (o.widget && systemId)
          ops.push({ op: "add_widget", systemId, widget: structuredClone(o.widget) as Widget });
        else errors.push(`${at}: needs widget and systemId`);
        break;
      case "add_system":
        if (o.system) ops.push({ op: "add_system", system: { ...o.system, viewIds: [], widgetIds: [] } });
        else errors.push(`${at}: needs system`);
        break;
      case "add_rule":
        if (o.rule) ops.push({ op: "add_rule", rule: toRule(o.rule) });
        else errors.push(`${at}: needs rule`);
        break;
      case "move_view":
        if (o.viewId && systemId) ops.push({ op: "move_view", viewId: o.viewId, systemId });
        else errors.push(`${at}: needs viewId and systemId`);
        break;
      case "update_view": {
        const patch = {
          ...(o.public !== undefined ? { public: o.public } : {}),
          ...(o.intro ? { intro: o.intro } : {}),
          ...(o.submitLabel ? { submitLabel: o.submitLabel } : {}),
          ...(o.fieldIds?.length ? { fieldIds: o.fieldIds } : {}),
        };
        if (Object.keys(patch).length) ops.push({ op: "update_view", viewId: o.viewId, patch });
        break;
      }
      case "add_block":
        ops.push({
          op: "add_block",
          viewId: o.viewId,
          block: structuredClone(o.block) as Block,
          ...(o.beforeBlockId ? { beforeBlockId: o.beforeBlockId } : {}),
        });
        break;
    }
  }
  for (const [i, r] of renames.entries()) {
    const name = r.newName.trim();
    if (!name) errors.push(`renames[${i}]: needs newName`);
    else if (r.kind === "page") ops.push({ op: "rename_system", systemId: r.id, name });
    else ops.push({ op: "rename_view", viewId: r.id, name });
  }
  // New fields show up as a column in every table of their record type.
  for (const op of [...ops]) {
    if (op.op !== "add_field") continue;
    for (const v of bp.views)
      if (
        v.type === "table" &&
        v.entityId === op.entityId &&
        !ops.some((x) => x.op === "add_view_field" && x.viewId === v.id && x.fieldId === op.field.id)
      )
        ops.push({ op: "add_view_field", viewId: v.id, fieldId: op.field.id });
  }
  // New views get sensible defaults for anything Gemini left blank (columns, the date or status to use).
  // Loose record type names ("bookings", "Booking") are pointed at the real id first.
  const allEntities = [...bp.entities, ...ops.flatMap((x) => (x.op === "add_entity" ? [x.entity] : []))];
  const norm = (x: string) =>
    x
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")
      .replace(/(es|s)$/, "");
  const resolveEntity = (id: string) =>
    allEntities.some((e) => e.id === id)
      ? id
      : (allEntities.find((e) => [e.id, e.name, e.pluralName].some((k) => norm(k) === norm(id)))?.id ?? id);
  for (const op of ops) {
    if (op.op === "add_widget") op.widget.entityId = resolveEntity(op.widget.entityId);
    if (op.op === "add_view" && op.view.type !== "document" && op.view.type !== "landing")
      op.view.entityId = resolveEntity(op.view.entityId);
  }
  // Blocks on public pages point at real record types, fields and forms.
  const fieldsOf = (id: string) =>
    new Set(allEntities.find((e) => e.id === id)?.fields.map((f) => f.id) ?? []);
  const formIds = new Set([
    ...bp.views.filter((v) => v.type === "form").map((v) => v.id),
    ...ops.flatMap((x) => (x.op === "add_view" && x.view.type === "form" ? [x.view.id] : [])),
  ]);
  const resolveLoose = (id: string | undefined) => (id === undefined ? id : resolveEntity(id));
  for (const op of ops) {
    if (op.op === "add_view" && (op.view.type === "landing" || op.view.type === "form") && op.view.blocks)
      op.view.blocks = tidyBlocks(op.view.blocks, resolveLoose, fieldsOf, formIds);
    if (op.op === "add_block") {
      const [cleaned] = tidyBlocks([op.block], resolveLoose, fieldsOf, formIds);
      if (cleaned) op.block = cleaned;
      else errors.push(`add_block: the ${op.block.type} block points at fields or forms that don't exist`);
    }
  }
  const entityFor = (id: string) => {
    const created = ops.flatMap((x) => (x.op === "add_entity" && x.entity.id === id ? [x.entity] : []))[0];
    return { entity: created ?? bp.entities.find((e) => e.id === id), isNew: !!created };
  };
  for (const op of [...ops]) {
    if (op.op === "add_widget") {
      const { entity } = entityFor(op.widget.entityId);
      if (entity) fillWidget(op.widget, entity);
      continue;
    }
    if (op.op !== "add_view") continue;
    if (op.view.type === "document" || op.view.type === "landing") {
      op.view.entityId = "";
      continue;
    }
    const { entity, isNew } = entityFor(op.view.entityId);
    if (!entity) continue;
    if (op.view.type === "notes") {
      // A notebook on an existing record type with no long text gets a Body field through its own step.
      const before = entity.fields.length;
      const target = isNew ? entity : structuredClone(entity);
      fillNotesView(op.view, target);
      if (!isNew && target.fields.length > before) {
        const added = target.fields.at(-1);
        if (
          added &&
          !ops.some((x) => x.op === "add_field" && x.entityId === entity.id && x.field.id === added.id)
        )
          ops.push({ op: "add_field", entityId: entity.id, field: added });
      }
      continue;
    }
    fillView(op.view, entity);
  }
  // Tweaks to a record type created in this same plan are folded into its definition.
  const folded = ops.filter((op) => {
    if (op.op !== "update_field") return true;
    const created = ops.find((x) => x.op === "add_entity" && x.entity.id === op.entityId);
    if (!created || created.op !== "add_entity") return true;
    const i = created.entity.fields.findIndex((f) => f.id === op.fieldId);
    if (i < 0) return true;
    created.entity.fields[i] = { ...created.entity.fields[i], ...op.patch } as Field;
    return false;
  });
  // Gemini sometimes lists the same addition twice; keep the first of each id.
  const seen = new Set<string>();
  const unique = folded.filter((op) => {
    const key =
      op.op === "add_widget"
        ? `widget:${op.widget.id}`
        : op.op === "add_view"
          ? `view:${op.view.id}`
          : op.op === "add_system"
            ? `system:${op.system.id}`
            : op.op === "add_entity"
              ? `entity:${op.entity.id}`
              : op.op === "add_field"
                ? `field:${op.entityId}.${op.field.id}`
                : JSON.stringify(op);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  // Things are created before anything that refers to them, whatever order Gemini listed them in.
  const ORDER: ChangeOp["op"][] = [
    "rename_workspace",
    "add_entity",
    "add_field",
    "update_field",
    "add_system",
    "add_view",
    "move_view",
    "update_view",
    "add_block",
    "add_view_field",
    "add_widget",
    "add_rule",
    "rename_system",
    "rename_view",
  ];
  const rank = (op: ChangeOp) => {
    const i = ORDER.indexOf(op.op);
    return i < 0 ? ORDER.length : i;
  };
  ops.splice(0, ops.length, ...unique.sort((a, b) => rank(a) - rank(b)));
  // Existing ids can't be redefined, and every new view or widget must land in a section.
  for (const op of ops) {
    const viewKnown = (id: string) =>
      bp.views.some((v) => v.id === id) || ops.some((x) => x.op === "add_view" && x.view.id === id);
    const systemKnown = (id: string) =>
      bp.systems.some((s) => s.id === id) || ops.some((x) => x.op === "add_system" && x.system.id === id);
    if (
      (op.op === "move_view" ||
        op.op === "rename_view" ||
        op.op === "update_view" ||
        op.op === "add_block") &&
      !viewKnown(op.viewId)
    )
      errors.push(`${op.op}: view "${op.viewId}" doesn't exist`);
    if ((op.op === "move_view" || op.op === "rename_system") && !systemKnown(op.systemId))
      errors.push(`${op.op}: page "${op.systemId}" doesn't exist`);
    if (op.op === "add_entity" && bp.entities.some((e) => e.id === op.entity.id))
      errors.push(`Record type "${op.entity.id}" already exists`);
    if (
      op.op === "add_field" &&
      bp.entities.find((e) => e.id === op.entityId)?.fields.some((f) => f.id === op.field.id)
    )
      errors.push(`Field "${op.field.id}" already exists on ${op.entityId}`);
    if (
      op.op === "update_field" &&
      !bp.entities.find((e) => e.id === op.entityId)?.fields.some((f) => f.id === op.fieldId) &&
      !ops.some((x) => x.op === "add_field" && x.entityId === op.entityId && x.field.id === op.fieldId)
    ) {
      const known = [
        ...(bp.entities.find((e) => e.id === op.entityId)?.fields ?? []),
        ...ops.flatMap((x) => (x.op === "add_entity" && x.entity.id === op.entityId ? x.entity.fields : [])),
      ].map((f) => f.id);
      errors.push(
        `update_field: "${op.fieldId}" isn't a field of ${op.entityId}${known.length ? ` (fields: ${known.join(", ")})` : ""}. Put new fields in add_entity or add_field instead.`,
      );
    }
  }
  return { ops, errors };
}

function toRecordOps(
  bp: Blueprint,
  records: DataRecord[],
  raw: RawPlan["recordOps"],
): { ops: RecordOp[]; errors: string[] } {
  const errors: string[] = [];
  const refs = new Map<string, string>();
  for (const o of raw)
    if (o.op === "create_record" && o.entityId)
      refs.set(o.ref ?? `r${refs.size}`, `${o.entityId}_${randomToken(3)}`);
  const resolve = (targetEntity: string | undefined) => (v: string) => {
    if (refs.has(v)) return refs.get(v);
    if (records.some((r) => r.id === v)) return v;
    // Gemini sometimes links by name: match the linked type's primary field.
    const target = bp.entities.find((e) => e.id === targetEntity);
    const hit =
      target &&
      records.find(
        (r) =>
          r.entityId === target.id &&
          String(r.data[target.primaryFieldId] ?? "").toLowerCase() === v.toLowerCase(),
      );
    return hit?.id;
  };
  const ops: RecordOp[] = [];
  let created = 0;
  for (const [i, o] of raw.entries()) {
    const entityId =
      o.op === "create_record" ? o.entityId : records.find((r) => r.id === o.recordId)?.entityId;
    const entity = bp.entities.find((e) => e.id === entityId);
    if (!entity) {
      errors.push(
        `recordOps[${i}]: ${o.op === "create_record" ? `unknown record type "${o.entityId}"` : `no record "${o.recordId}"`}`,
      );
      continue;
    }
    const data: RecordData = {};
    for (const { fieldId, value } of o.values) {
      const field = entity.fields.find((f) => f.id === fieldId);
      if (!field) {
        errors.push(`recordOps[${i}]: ${entity.name} has no field "${fieldId}"`);
        continue;
      }
      const v = toFieldValue(field, value, resolve(field.relation?.entityId));
      if (v === undefined)
        errors.push(`recordOps[${i}]: "${value}" doesn't fit ${entity.name}.${field.id} (${field.type})`);
      else data[field.id] = v;
    }
    if (o.op === "create_record") {
      const ref = o.ref ?? `r${created}`;
      ops.push({
        op: "create_record",
        id: refs.get(ref) ?? `${entity.id}_${randomToken(3)}`,
        entityId: entity.id,
        data,
      });
      created++;
    } else ops.push({ op: "update_record", recordId: o.recordId as string, patch: data });
  }
  return { ops, errors };
}

/** One assistant turn: an answer, a question back, or a plan rehearsed on a copy of the workspace. */
export async function assistantTurn(input: {
  blueprint: Blueprint;
  records: DataRecord[];
  messages: AssistantMessage[];
  page: string;
  canDesign: boolean;
  canEditRecords: boolean;
}): Promise<AssistantResult> {
  const { blueprint: bp, records } = input;
  const permissions = input.canDesign
    ? "The person can change the design and the data."
    : input.canEditRecords
      ? "The person is staff: they can change data (records) but not the design. Don't plan design changes; say an owner or admin can."
      : "The person is a viewer: answer questions only. For changes, say an owner or admin can make them.";
  const context = `Today in Manila: ${todayKey()}
Current page: ${input.page}
${permissions}

Sidebar pages (in order), with their tabs:
${bp.systems
  .map(
    (s) =>
      `- ${s.name} (${s.id}): ${
        [
          ...s.viewIds.map((id) => {
            const v = bp.views.find((x) => x.id === id);
            if (!v) return id;
            const extra =
              v.type === "form" || v.type === "landing"
                ? `${isPublic(v) ? ", public" : ", team only"}${
                    v.blocks?.length
                      ? `, blocks: ${v.blocks.map((b) => `${b.type} ${b.id}`).join(" / ")}`
                      : ""
                  }`
                : "";
            return `${v.name} (${v.id}, ${v.type}${v.entityId ? ` of ${v.entityId}` : ""}${extra})`;
          }),
          ...(s.widgetIds.length ? [`${s.widgetIds.length} dashboard widgets`] : []),
        ].join(", ") || "empty"
      }`,
  )
  .join("\n")}

Blueprint:
${JSON.stringify(bp)}

Records:
${recordContext(bp, records)}

Conversation:
${input.messages.map((m) => `${m.role === "user" ? "Person" : "You"}: ${m.text}`).join("\n\n")}`;

  let prompt = context;
  let repaired = false;
  let stalls = 0;
  for (let attempt = 0; attempt < 5; attempt++) {
    const result = await generateJson(assistantAnswer, {
      system: ASSISTANT_SYSTEM,
      prompt,
      task: "assistant",
      repair: fixOpNames,
      // Answers take 3–8 s and big plans 10–17 s. Vertex sometimes stalls a call outright, so the first try
      // gives up early and a retry (usually fast) gets more room.
      timeoutMs: stalls === 0 ? 25_000 : 35_000,
      thinking: "LOW",
    });
    if (!result.ok) {
      if (result.retryable && stalls < 2) {
        stalls++;
        continue;
      }
      return { ok: false, message: result.error };
    }
    const a = result.data;
    const suggestions = a.suggestions.slice(0, 3);
    if (a.kind !== "plan") return { ok: true, kind: a.kind, reply: a.reply, suggestions };

    const design = toDesignOps(bp, a.plan.ops, a.plan.renames);
    const errors = [...design.errors];
    if (design.ops.length && !input.canDesign)
      errors.push("This person can't change the design; plan data changes only or explain who can.");
    const next = design.ops.length ? applyOps(bp, design.ops) : bp;
    const before = new Set(validateBlueprint(bp).map((e) => `${e.path} ${e.message}`));
    for (const e of validateBlueprint(next))
      if (!before.has(`${e.path} ${e.message}`)) errors.push(`${e.path}: ${e.message}`);
    for (const op of design.ops)
      if ((op.op === "add_view" || op.op === "add_widget") && !next.systems.some((s) => s.id === op.systemId))
        errors.push(`${op.op}: section "${op.systemId}" doesn't exist`);

    const recordPart = toRecordOps(next, records, a.plan.recordOps);
    errors.push(...recordPart.errors);
    if (recordPart.ops.length && !input.canEditRecords) errors.push("This person can't change data.");
    if (!errors.length && recordPart.ops.length) {
      // Rehearse the data edits on a copy so validation, rules and booking conflicts are checked now.
      const staged = design.ops.length
        ? commitChange({ blueprint: bp, records }, next).data
        : { blueprint: bp, records };
      errors.push(...applyRecordOps(staged, recordPart.ops).errors);
    }
    if (!errors.length && (design.ops.length || recordPart.ops.length)) {
      return {
        ok: true,
        kind: "plan",
        reply: a.reply,
        suggestions,
        plan: {
          request: input.messages.at(-1)?.text ?? "",
          title: a.plan.title || "Workspace change",
          facts: a.plan.facts.slice(0, 6),
          steps: a.plan.steps.slice(0, 10),
          ops: design.ops,
          recordOps: recordPart.ops,
        },
      };
    }
    console.warn(
      JSON.stringify({
        event: "assistant_plan_rejected",
        attempt,
        errors: errors.slice(0, 12),
        ops: JSON.stringify(a.plan.ops).slice(0, 3000),
      }),
    );
    if (repaired) break;
    repaired = true;
    if (errors.some((e) => e.endsWith("needs options")))
      errors.push(
        'Every select and status field needs "options": [{ "id": "lead", "label": "Lead", "tone": "neutral" }, …] with the choices the person described, or sensible ones.',
      );
    prompt = `${context}\n\nYour previous plan:\n${JSON.stringify(a.plan)}\n\nIt was rejected:\n- ${errors.length ? errors.slice(0, 15).join("\n- ") : "it had no operations"}\nReturn a corrected answer. The person never saw the rejected plan, so write the reply as your first answer: don't mention corrections or errors.`;
  }
  return {
    ok: false,
    message: "I couldn't put together a valid change for that. Try describing it a little differently.",
  };
}

const OP_NAMES = new Set([
  "add_field",
  "add_entity",
  "add_view",
  "add_widget",
  "add_system",
  "add_rule",
  "add_block",
]);

/** Gemini sometimes drops the add_ prefix ("op": "widget"); put it back so one slip doesn't sink a whole plan. */
function fixOpNames(json: unknown): unknown {
  const ops = (json as { plan?: { ops?: { op?: unknown }[] } })?.plan?.ops;
  if (Array.isArray(ops))
    for (const o of ops)
      if (typeof o?.op === "string" && !o.op.startsWith("add_") && OP_NAMES.has(`add_${o.op}`))
        o.op = `add_${o.op}`;
  return json;
}

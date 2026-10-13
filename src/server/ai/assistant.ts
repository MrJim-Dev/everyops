import "server-only";
import type { Blueprint, DataRecord, Field, RecordData, Widget } from "@/lib/blueprint/types";
import { validateBlueprint } from "@/lib/blueprint/validate";
import { applyOps, type ChangeOp, type ChangePlan, commitChange, type RecordOp } from "@/lib/engine/changes";
import { applyRecordOps } from "@/lib/engine/records";
import { randomToken } from "@/lib/store/workspace-model";
import { todayKey } from "@/lib/time";
import { ASSISTANT_SYSTEM, type AssistantAnswer, assistantAnswer } from "./assistant-prompt";
import { toEntity, toFieldValue, toRule, toView } from "./design";
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

function toDesignOps(bp: Blueprint, raw: RawPlan["ops"]): { ops: ChangeOp[]; errors: string[] } {
  const ops: ChangeOp[] = [];
  const errors: string[] = [];
  for (const [i, o] of raw.entries()) {
    const at = `ops[${i}] ${o.op}`;
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
        if (o.name?.trim()) ops.push({ op: "rename_workspace", name: o.name.trim() });
        else errors.push(`${at}: needs name`);
        break;
      case "add_entity":
        if (o.entity) ops.push({ op: "add_entity", entity: toEntity(o.entity) });
        else errors.push(`${at}: needs entity`);
        break;
      case "add_view":
        if (o.view && o.systemId) ops.push({ op: "add_view", systemId: o.systemId, view: toView(o.view) });
        else errors.push(`${at}: needs view and systemId`);
        break;
      case "add_widget":
        if (o.widget && o.systemId)
          ops.push({ op: "add_widget", systemId: o.systemId, widget: o.widget as Widget });
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
    }
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
  ops.splice(0, ops.length, ...folded);
  // Existing ids can't be redefined, and every new view or widget must land in a section.
  for (const op of ops) {
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

Blueprint:
${JSON.stringify(bp)}

Records:
${recordContext(bp, records)}

Conversation:
${input.messages.map((m) => `${m.role === "user" ? "Person" : "You"}: ${m.text}`).join("\n\n")}`;

  let prompt = context;
  let repaired = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await generateJson(assistantAnswer, {
      system: ASSISTANT_SYSTEM,
      prompt,
      task: "assistant",
      timeoutMs: 60_000,
      thinking: "LOW",
    });
    if (!result.ok) {
      if (result.retryable && attempt < 1) continue;
      return { ok: false, message: result.error };
    }
    const a = result.data;
    const suggestions = a.suggestions.slice(0, 3);
    if (a.kind !== "plan") return { ok: true, kind: a.kind, reply: a.reply, suggestions };

    const design = toDesignOps(bp, a.plan.ops);
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
    console.warn(JSON.stringify({ event: "assistant_plan_rejected", attempt, errors: errors.slice(0, 12) }));
    if (repaired) break;
    repaired = true;
    prompt = `${context}\n\nYour previous plan:\n${JSON.stringify(a.plan)}\n\nIt was rejected:\n- ${errors.length ? errors.slice(0, 15).join("\n- ") : "it had no operations"}\nReturn a corrected answer.`;
  }
  return {
    ok: false,
    message: "I couldn't put together a valid change for that. Try describing it a little differently.",
  };
}

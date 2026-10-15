import type { Blueprint, Entity, Field } from "@/lib/blueprint/types";
import type { ChangeOp, DocOp, PlanStep } from "@/lib/engine/changes";

/*
 * What a change touches beyond the thing it names. The assistant reads the field map before it plans, so renaming a
 * price, removing a status or adding a step considers every tab, form, card, automation and formula built on it; and
 * a plan that renames something also fixes the pages that spell out the old name.
 */

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const token = (id: string) => new RegExp(`(^|[^A-Za-z0-9_])${escapeRe(id)}([^A-Za-z0-9_]|$)`);
/** An object's settings as text, without its own id and name (so a field named like the view isn't a match). */
function settingsText(o: object) {
  const { id: _id, name: _name, title: _title, entityId: _entity, ...rest } = o as Record<string, unknown>;
  return JSON.stringify(rest);
}

type Section = { items?: { component?: string; props?: Record<string, unknown> }[] };

/** Where each field is used, per record type: one line per field used anywhere. At most maxChars long. */
export function fieldUsage(bp: Blueprint, maxChars = 6000): string {
  const lines: string[] = [];
  const views = (e: Entity) => bp.views.filter((v) => v.entityId === e.id);
  const layouts = bp.views.filter((v) => v.type === "layout");
  for (const e of bp.entities) {
    const used: string[] = [];
    for (const f of e.fields) {
      const re = token(f.id);
      const places: string[] = [];
      for (const v of views(e))
        if (re.test(settingsText(v)))
          places.push(
            `${v.type === "form" ? "form" : "tab"} "${v.name}"${"public" in v && v.public ? " (public)" : ""}`,
          );
      for (const v of layouts) {
        const sections = ((v as { sections?: Section[] }).sections ?? []) as Section[];
        const hit = sections.some((s) =>
          (s.items ?? []).some((i) => i.props?.entityId === e.id && re.test(settingsText(i.props ?? {}))),
        );
        if (hit) places.push(`layout "${v.name}"`);
      }
      for (const w of bp.widgets)
        if (
          (w.entityId === e.id && re.test(settingsText(w))) ||
          w.calc?.terms?.some((t) => t.entityId === e.id && re.test(JSON.stringify(t)))
        )
          places.push(`card "${w.title}"`);
      for (const r of bp.rules)
        if (r.trigger.entityId === e.id ? re.test(settingsText(r)) : re.test(JSON.stringify(r.actions)))
          places.push(`automation "${r.name}"`);
      for (const other of e.fields)
        if (other.id !== f.id && formulaUses(other, re)) places.push(`formula "${other.name}"`);
      // Other record types reach it through a link (client.phone) or add it up (a rollup of order lines).
      for (const o of bp.entities) {
        if (o.id === e.id) continue;
        const links = o.fields.filter((x) => x.relation?.entityId === e.id).map((x) => x.id);
        for (const x of o.fields) {
          const viaLink = links.some((l) =>
            formulaUses(x, new RegExp(`${escapeRe(l)}\\.${escapeRe(f.id)}\\b`)),
          );
          const rolled =
            x.rollup?.childEntityId === e.id && (x.rollup.fieldId === f.id || x.rollup.viaFieldId === f.id);
          if (viaLink || rolled) places.push(`${o.name} "${x.name}"`);
        }
      }
      if (places.length) used.push(`${f.name} (${f.id}): ${[...new Set(places)].join(", ")}`);
    }
    if (used.length) lines.push(`- ${e.name}: ${used.join("; ")}`);
  }
  const text = lines.join("\n");
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n(more cut off)` : text;
}

function formulaUses(f: Field, re: RegExp) {
  return (
    !!f.formula && (re.test(f.formula.expr) || (!!f.formula.freezeWhen && re.test(f.formula.freezeWhen)))
  );
}

/** The names a plan changes, old to new: pages, tabs, fields, choices and the workspace itself. */
export function renamedNames(bp: Blueprint, ops: ChangeOp[]): { from: string; to: string }[] {
  const pairs: { from: string; to: string }[] = [];
  const push = (from: string | undefined, to: string | undefined) => {
    const a = from?.trim();
    const b = to?.trim();
    if (a && b && a !== b && a.length >= 3 && !pairs.some((p) => p.from === a))
      pairs.push({ from: a, to: b });
  };
  for (const op of ops) {
    if (op.op === "rename_system") push(bp.systems.find((s) => s.id === op.systemId)?.name, op.name);
    else if (op.op === "rename_view") push(bp.views.find((v) => v.id === op.viewId)?.name, op.name);
    else if (op.op === "rename_workspace") push(bp.workspaceName, op.name);
    else if (op.op === "update_field") {
      const field = bp.entities.find((e) => e.id === op.entityId)?.fields.find((f) => f.id === op.fieldId);
      if (!field) continue;
      push(field.name, op.patch.name);
      for (const o of op.patch.options ?? []) push(field.options?.find((x) => x.id === o.id)?.label, o.label);
    }
  }
  return pairs;
}

/** Replaces whole names in text, leaving longer words alone ("Court" doesn't touch "Courtyard"). */
function replaceNames(text: string, pairs: { from: string; to: string }[]) {
  let out = text;
  for (const { from, to } of pairs)
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(from)}(?![\\p{L}\\p{N}])`, "gu"), to);
  return out;
}

/** In HTML, only the words people read: never inside tags, scripts or styles. */
function replaceInHtml(html: string, pairs: { from: string; to: string }[]) {
  return html
    .split(/(<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->|<[^>]+>)/i)
    .map((part, i) => (i % 2 ? part : replaceNames(part, pairs)))
    .join("");
}

/**
 * Document and custom HTML pages that still spell out a name the plan changes get the new name, as page-text
 * changes on the same plan (undone with it). Pages the plan already rewrites are left to that rewrite.
 */
export function renameInPages(
  bp: Blueprint,
  ops: ChangeOp[],
  docs: Record<string, { body: string }> | undefined,
  already: DocOp[] = [],
): { docOps: DocOp[]; steps: PlanStep[] } {
  const pairs = renamedNames(bp, ops);
  if (!pairs.length || !docs) return { docOps: [], steps: [] };
  const docOps: DocOp[] = [];
  const steps: PlanStep[] = [];
  for (const v of bp.views) {
    if ((v.type !== "document" && v.type !== "html") || already.some((d) => d.viewId === v.id)) continue;
    const body = docs[v.id]?.body;
    if (!body) continue;
    const next = v.type === "html" ? replaceInHtml(body, pairs) : replaceNames(body, pairs);
    if (next === body) continue;
    docOps.push({ viewId: v.id, body: next });
    const changed = pairs.filter((p) => body.includes(p.from));
    steps.push({
      kind: "change",
      label: `Update the text on ${v.name}`,
      detail: changed.map((p) => `"${p.from}" → "${p.to}"`).join(", "),
    });
  }
  return { docOps, steps };
}

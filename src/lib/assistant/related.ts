import type { Blueprint, Entity, Field } from "@/lib/blueprint/types";
import { allActions } from "@/lib/engine/branches";
import type { BlockPatch, ChangeOp, DocOp, PlanStep } from "@/lib/engine/changes";

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
        if (r.trigger.entityId === e.id ? re.test(settingsText(r)) : re.test(JSON.stringify(allActions(r))))
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

/** An old name and its new one. Page, tab, workspace and record type names match in any case ("players"). */
export type NamePair = { from: string; to: string; anyCase?: boolean };

/** The names a plan changes, old to new: pages, tabs, fields, choices and the workspace itself. */
export function renamedNames(bp: Blueprint, ops: ChangeOp[]): NamePair[] {
  const pairs: NamePair[] = [];
  const push = (from: string | undefined, to: string | undefined, anyCase = false) => {
    const a = from?.trim();
    const b = to?.trim();
    if (a && b && a !== b && a.length >= 3 && !pairs.some((p) => p.from === a))
      pairs.push({ from: a, to: b, ...(anyCase ? { anyCase } : {}) });
  };
  for (const op of ops) {
    if (op.op === "rename_system") push(bp.systems.find((s) => s.id === op.systemId)?.name, op.name, true);
    else if (op.op === "rename_view") push(bp.views.find((v) => v.id === op.viewId)?.name, op.name, true);
    else if (op.op === "rename_workspace") push(bp.workspaceName, op.name, true);
    else if (op.op === "update_field") {
      const field = bp.entities.find((e) => e.id === op.entityId)?.fields.find((f) => f.id === op.fieldId);
      if (!field) continue;
      push(field.name, op.patch.name);
      for (const o of op.patch.options ?? []) push(field.options?.find((x) => x.id === o.id)?.label, o.label);
    }
  }
  return pairs;
}

const nameRe = ({ from, anyCase }: NamePair) =>
  new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(from)}(?![\\p{L}\\p{N}])`, anyCase ? "giu" : "gu");

/** The new name in the case the old one was written in: "players" → "members", "PLAYERS" → "MEMBERS". */
function inCaseOf(found: string, to: string) {
  if (found.length > 1 && found === found.toUpperCase() && found !== found.toLowerCase())
    return to.toUpperCase();
  if (found === found.toLowerCase() && found !== found.toUpperCase()) return to.toLowerCase();
  return to;
}

/** Replaces whole names in text, leaving longer words alone ("Court" doesn't touch "Courtyard"). */
function replaceNames(text: string, pairs: NamePair[]) {
  let out = text;
  for (const p of pairs) out = out.replace(nameRe(p), (found) => (p.anyCase ? inCaseOf(found, p.to) : p.to));
  return out;
}

const mentions = (text: string, p: NamePair) => nameRe(p).test(text);

/** In HTML, only the words people read: never inside tags, scripts or styles. */
function replaceInHtml(html: string, pairs: NamePair[]) {
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
    const changed = pairs.filter((p) => mentions(body, p));
    steps.push({
      kind: "change",
      label: `Update the text on ${v.name}`,
      detail: changed.map((p) => `"${p.from}" → "${p.to}"`).join(", "),
    });
  }
  return { docOps, steps };
}

/**
 * The rest of the workspace that spells out a renamed thing: other tabs ("All players"), dashboard cards
 * ("Players this month"), automation names, form intros and buttons, and website sections (hero, text, highlights,
 * steps, contact, section titles). Text the team edited on a section is updated where it lives (page text), so their
 * words are kept. What the plan already changes itself is left alone. Returns the extra changes for the same plan.
 */
export function renameInDesign(
  bp: Blueprint,
  ops: ChangeOp[],
  docs: Record<string, { body: string }> | undefined,
): { ops: ChangeOp[]; docOps: DocOp[]; steps: PlanStep[] } {
  const pairs = renamedNames(bp, ops);
  const out: ChangeOp[] = [];
  const docOps: DocOp[] = [];
  if (!pairs.length) return { ops: out, docOps, steps: [] };
  const swap = (text: string | undefined) => (text ? replaceNames(text, pairs) : text);
  const changed = (a: string | undefined, b: string | undefined) => a !== undefined && a !== b;
  const count = { tabs: 0, cards: 0, automations: 0, forms: 0, sections: 0 };

  for (const v of bp.views) {
    if (ops.some((o) => (o.op === "rename_view" || o.op === "remove_view") && o.viewId === v.id)) continue;
    const name = swap(v.name);
    if (name && name !== v.name) {
      out.push({ op: "rename_view", viewId: v.id, name });
      count.tabs++;
    }
    if (v.type === "form") {
      const planned = ops.find((o) => o.op === "update_view" && o.viewId === v.id);
      const patch: { intro?: string; submitLabel?: string } = {};
      const intro = swap(v.intro);
      const label = swap(v.submitLabel);
      if (changed(intro, v.intro) && !(planned?.op === "update_view" && planned.patch.intro !== undefined))
        patch.intro = intro;
      if (
        changed(label, v.submitLabel) &&
        !(planned?.op === "update_view" && planned.patch.submitLabel !== undefined)
      )
        patch.submitLabel = label;
      if (Object.keys(patch).length) {
        out.push({ op: "update_view", viewId: v.id, patch });
        count.forms++;
      }
    }
    if (v.type !== "landing" && v.type !== "form") continue;
    for (const b of v.blocks ?? []) {
      const touched = ops.some(
        (o) =>
          (o.op === "update_block" || o.op === "remove_block") && o.viewId === v.id && o.blockId === b.id,
      );
      if (touched) continue;
      const key = `${v.id}:${b.id}`;
      const override = docs?.[key]?.body;
      if (override) {
        // The team's own words for this section: change them where they're kept.
        let next = override;
        if (b.type === "hero") {
          try {
            const words = JSON.parse(override) as Record<string, unknown>;
            next = JSON.stringify(
              Object.fromEntries(
                Object.entries(words).map(([k, x]) => [
                  k,
                  typeof x === "string" ? replaceNames(x, pairs) : x,
                ]),
              ),
            );
          } catch {}
        } else next = b.type === "html" ? replaceInHtml(override, pairs) : replaceNames(override, pairs);
        if (next !== override) {
          docOps.push({ viewId: key, body: next });
          count.sections++;
        }
        continue;
      }
      const patch: BlockPatch = {};
      if (b.type === "hero") {
        if (changed(swap(b.heading), b.heading)) patch.heading = swap(b.heading);
        if (changed(swap(b.subheading), b.subheading)) patch.subheading = swap(b.subheading);
        if (changed(swap(b.ctaLabel), b.ctaLabel)) patch.ctaLabel = swap(b.ctaLabel);
      } else if (b.type === "text") {
        if (changed(swap(b.markdown), b.markdown)) patch.markdown = swap(b.markdown);
      } else if (b.type === "contact") {
        for (const k of ["title", "hours", "address"] as const)
          if (changed(swap(b[k]), b[k])) patch[k] = swap(b[k]);
      } else if (b.type === "highlights" || b.type === "steps") {
        if (changed(swap(b.title), b.title)) patch.title = swap(b.title);
        const items = b.items.map((i) => ({
          title: replaceNames(i.title, pairs),
          body: replaceNames(i.body, pairs),
        }));
        if (JSON.stringify(items) !== JSON.stringify(b.items)) patch.items = items;
      } else if (b.type === "records" || b.type === "form") {
        if (changed(swap(b.title), b.title)) patch.title = swap(b.title);
      }
      if (Object.keys(patch).length) {
        out.push({ op: "update_block", viewId: v.id, blockId: b.id, patch });
        count.sections++;
      }
    }
  }
  for (const w of bp.widgets) {
    const planned = ops.some(
      (o) =>
        (o.op === "update_widget" && o.widgetId === w.id && o.patch.title !== undefined) ||
        (o.op === "remove_widget" && o.widgetId === w.id),
    );
    if (planned) continue;
    const title = swap(w.title);
    if (title && title !== w.title) {
      out.push({ op: "update_widget", widgetId: w.id, patch: { title } });
      count.cards++;
    }
  }
  for (const r of bp.rules) {
    if (
      ops.some(
        (o) => (o.op === "add_rule" && o.rule.id === r.id) || (o.op === "remove_rule" && o.ruleId === r.id),
      )
    )
      continue;
    const name = swap(r.name);
    if (name && name !== r.name) {
      out.push({ op: "add_rule", rule: { ...r, name } });
      count.automations++;
    }
  }
  const parts = [
    [count.tabs, "tab", "tabs"],
    [count.forms, "form", "forms"],
    [count.sections, "website section", "website sections"],
    [count.cards, "card", "cards"],
    [count.automations, "automation", "automations"],
  ] as const;
  const detail = parts
    .filter(([n]) => n > 0)
    .map(([n, one, many]) => `${n} ${n === 1 ? one : many}`)
    .join(", ");
  return {
    ops: out,
    docOps,
    steps: detail ? [{ kind: "change", label: "Use the new name everywhere it shows", detail }] : [],
  };
}

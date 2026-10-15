import type { Blueprint } from "@/lib/blueprint/types";
import { validateBlueprint } from "@/lib/blueprint/validate";
import { formulaOrder } from "@/lib/engine/compute";
import { htmlConnectionProblems } from "@/lib/public/html-connections";

/** Something setup left out of a workspace, in the owner's words, so they can ask for it afterwards. */
export type SetupGap = { request: string; detail: string };

/** Dashboard cards that point at fields their record type doesn't have (the validator doesn't check these). */
export function widgetProblems(bp: Blueprint): { index: number; message: string }[] {
  const viewIds = new Set(bp.views.map((v) => v.id));
  const problems: { index: number; message: string }[] = [];
  bp.widgets.forEach((w, index) => {
    const entity = bp.entities.find((e) => e.id === w.entityId);
    if (!entity) return;
    const has = (id?: string) => !id || entity.fields.some((f) => f.id === id);
    const add = (message: string) => problems.push({ index, message: `Widget ${w.title}: ${message}` });
    if (!has(w.metric.fieldId)) add(`field "${w.metric.fieldId}" is missing`);
    if (w.type === "chart" && (!w.chart || !has(w.chart.dateFieldId))) add("a chart needs a date field");
    if (w.type === "list" && (!w.list || !w.list.fieldIds.every((id) => has(id))))
      add("list fields are missing");
    if (w.list?.viewId && !viewIds.has(w.list.viewId)) add("links to a missing view");
  });
  return problems;
}

const MAX_PASSES = 8;

/**
 * The last resort when repairs run out: takes out the parts that still don't work (a view, a dashboard card, a rule,
 * a broken field) until the workspace validates, and says what it took out. Record types always stay, so the
 * owner's data has somewhere to live and the missing parts can be added with Ask EveryOps. Returns null when the
 * problems can't be removed that way, or when more than half the screens would go.
 */
export function salvage(input: Blueprint): { bp: Blueprint; removed: SetupGap[] } | null {
  const bp = structuredClone(input);
  const removed: SetupGap[] = [];
  const views = bp.views.length;
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const errors = validateBlueprint(bp).map((e) => ({ path: e.path, message: e.message }));
    bp.views.forEach((v, i) => {
      if (v.type === "html" && v.html)
        for (const message of htmlConnectionProblems(bp, v.id, v.html))
          errors.push({ path: `views.${i}`, message });
    });
    for (const p of widgetProblems(bp)) errors.push({ path: `widgets.${p.index}`, message: p.message });
    if (!errors.length) return { bp, removed };

    const dropViews = new Set<number>();
    const dropWidgets = new Set<number>();
    const dropRules = new Set<number>();
    const dropFields = new Map<number, Set<number>>();
    let fixed = false;
    for (const { path, message } of errors) {
      let m = /^views\.(\d+)/.exec(path);
      if (m) {
        dropViews.add(Number(m[1]));
        continue;
      }
      m = /^widgets\.(\d+)/.exec(path);
      if (m) {
        dropWidgets.add(Number(m[1]));
        continue;
      }
      m = /^rules\.(\d+)/.exec(path);
      if (m) {
        dropRules.add(Number(m[1]));
        continue;
      }
      m = /^entities\.(\d+)\.fields\.(\d+)/.exec(path);
      if (m) {
        const set = dropFields.get(Number(m[1])) ?? new Set<number>();
        set.add(Number(m[2]));
        dropFields.set(Number(m[1]), set);
        continue;
      }
      m = /^entities\.(\d+)(\.booking)?$/.exec(path);
      if (m) {
        const entity = bp.entities[Number(m[1])];
        if (!entity) continue;
        if (m[2]) {
          delete entity.booking;
          fixed = true;
        } else if (/primary field/.test(message)) {
          const text = entity.fields.find((f) => f.type === "text");
          if (text) entity.primaryFieldId = text.id;
          else {
            const id = entity.fields.some((f) => f.id === "title") ? "record_title" : "title";
            entity.fields.unshift({ id, name: "Title", type: "text", required: true });
            entity.primaryFieldId = id;
          }
          fixed = true;
        } else if (/formula cycle/.test(message)) {
          // Formulas left out of the computed order are the ones in the loop.
          const ordered = new Set(formulaOrder(entity).map((f) => f.id));
          const looped = entity.fields.filter((f) => f.type === "formula" && !ordered.has(f.id));
          for (const f of looped)
            removed.push({ request: `${entity.name}: ${f.name}`, detail: "Its formula depended on itself." });
          entity.fields = entity.fields.filter((f) => !looped.includes(f));
          fixed = fixed || looped.length > 0;
        }
        continue;
      }
      m = /^systems\.(\d+)/.exec(path);
      if (m) {
        const system = bp.systems[Number(m[1])];
        if (!system) continue;
        const viewIds = new Set(bp.views.map((v) => v.id));
        const widgetIds = new Set(bp.widgets.map((w) => w.id));
        system.viewIds = system.viewIds.filter((id) => viewIds.has(id));
        system.widgetIds = system.widgetIds.filter((id) => widgetIds.has(id));
        fixed = true;
        continue;
      }
      // Duplicate ids: keep the first of each.
      m = /^(view|widget)$/.exec(path);
      if (m) {
        const list = m[1] === "view" ? bp.views : bp.widgets;
        const seen = new Set<string>();
        list.forEach((x, i) => {
          if (seen.has(x.id)) (m?.[1] === "view" ? dropViews : dropWidgets).add(i);
          seen.add(x.id);
        });
      }
    }
    for (const [ei, fis] of dropFields) {
      const entity = bp.entities[ei];
      if (!entity) continue;
      const going = entity.fields.filter((f, i) => fis.has(i) && f.id !== entity.primaryFieldId);
      for (const f of going)
        removed.push({ request: `${entity.name}: ${f.name}`, detail: "It couldn't be set up as described." });
      entity.fields = entity.fields.filter((f) => !going.includes(f));
      fixed = fixed || going.length > 0;
    }
    const goneViews = bp.views.filter((_, i) => dropViews.has(i));
    const goneWidgets = bp.widgets.filter((_, i) => dropWidgets.has(i));
    for (const v of goneViews)
      removed.push({ request: v.name, detail: "This screen couldn't be set up as described." });
    for (const w of goneWidgets)
      removed.push({ request: w.title, detail: "This dashboard card couldn't be set up as described." });
    for (const r of bp.rules.filter((_, i) => dropRules.has(i)))
      removed.push({ request: r.name, detail: "This automation couldn't be set up as described." });
    if (goneViews.length || goneWidgets.length || dropRules.size) fixed = true;
    const viewGone = new Set(goneViews.map((v) => v.id));
    const widgetGone = new Set(goneWidgets.map((w) => w.id));
    bp.views = bp.views.filter((_, i) => !dropViews.has(i));
    bp.widgets = bp.widgets.filter((_, i) => !dropWidgets.has(i));
    bp.rules = bp.rules.filter((_, i) => !dropRules.has(i));
    for (const s of bp.systems) {
      s.viewIds = s.viewIds.filter((id) => !viewGone.has(id));
      s.widgetIds = s.widgetIds.filter((id) => !widgetGone.has(id));
    }
    bp.systems = bp.systems.filter((s) => s.viewIds.length + s.widgetIds.length > 0);
    if (!fixed || bp.views.length < views / 2) return null;
  }
  return null;
}

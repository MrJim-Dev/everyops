/**
 * What the setup screen shows while Gemini designs a workspace: the pages, the record types and each page's views as
 * they're written, and the step the design is on. Built on the server from the partial design (and, at the end, from
 * the finished blueprint), so the browser never sees the raw answer.
 */

export type DesignStage =
  /** Gemini is writing the design; the sketch fills in as it does. */
  | "design"
  /** Gemini is fixing what EveryOps's checks found. */
  | "fix"
  /** Independent review against the setup brief. */
  | "check"
  /** Sample records and the Overview layout. */
  | "finish";

/** A view and, for record views, the record type it shows. */
export type SketchView = { id: string; name: string; type: string; entity?: string };
export type SketchPage = { id: string; name: string; icon?: string; views: SketchView[]; widgets: number };
export type DesignSketch = {
  name?: string;
  pages: SketchPage[];
  /** Each record type with its field count and the names of its first fields. */
  recordTypes: { id: string; name: string; fields: number; fieldNames: string[] }[];
  /** The part of the design being written now. */
  writing: "pages" | "records" | "views" | "widgets" | "rules" | "site" | "samples" | "done";
  /** The page whose views or cards are being written. */
  active?: string;
  rules: number;
  samples: number;
};

/** One line of the /api/ai/design stream. */
export type DesignStreamEvent =
  | {
      type: "stage";
      stage: DesignStage;
      issues?: number;
      /** On the design stage: the community system the design starts from, when there is one. */
      from?: { id: string; name: string };
    }
  | { type: "sketch"; sketch: DesignSketch }
  | { type: "ping" }
  | { type: "done"; draft: unknown }
  | { type: "error"; message: string };

const WRITING: Record<string, DesignSketch["writing"]> = {
  systems: "pages",
  entities: "records",
  views: "views",
  widgets: "widgets",
  rules: "rules",
  site: "site",
  samples: "samples",
};

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const list = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : []);
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/**
 * The sketch of a design, finished or still arriving (a partial parse), or of a finished blueprint. Items without a
 * name yet are left out, and a view shows under its page only once both are there.
 */
export function sketchOf(design: unknown, done = false): DesignSketch | undefined {
  if (!isObj(design)) return undefined;
  const keys = Object.keys(design);
  const last = keys.at(-1) ?? "";
  const views = new Map<string, SketchView>();
  for (const v of list(design.views)) {
    const id = str(v.id);
    const name = str(v.name);
    const entity = str(v.entityId);
    if (id && name) views.set(id, { id, name, type: str(v.type) ?? "table", ...(entity ? { entity } : {}) });
  }
  const widgetIds = new Set(list(design.widgets).map((w) => str(w.id)));
  const pages: SketchPage[] = [];
  for (const s of list(design.systems)) {
    const id = str(s.id);
    const name = str(s.name);
    if (!id || !name) continue;
    pages.push({
      id,
      name,
      icon: str(s.icon),
      views: ids(s.viewIds).flatMap((v) => views.get(v) ?? []),
      widgets: ids(s.widgetIds).filter((w) => widgetIds.has(w)).length,
    });
  }
  const recordTypes = list(design.entities).flatMap((e) => {
    const id = str(e.id);
    const name = str(e.pluralName) ?? str(e.name);
    const fields = list(e.fields);
    const fieldNames = fields.flatMap((f) => str(f.name) ?? []).slice(0, 8);
    return id && name ? [{ id, name, fields: fields.length, fieldNames }] : [];
  });
  const writing = done ? "done" : (WRITING[last] ?? "pages");
  // The page holding the last view (or card) written so far.
  let active: string | undefined;
  if (writing === "views") {
    const latest = [...views.keys()].at(-1);
    active = pages.find((p) => p.views.some((v) => v.id === latest))?.id;
  } else if (writing === "widgets") active = pages.find((p) => p.widgets > 0)?.id ?? pages[0]?.id;
  return {
    name: str(design.workspaceName) ?? str(design.name),
    pages,
    recordTypes,
    writing,
    ...(active ? { active } : {}),
    rules: list(design.rules).length,
    samples: list(design.samples).length,
  };
}

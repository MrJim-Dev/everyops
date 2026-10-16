import type { DesignSketch, SketchPage } from "@/lib/assistant/design-sketch";
import type { DesignBuild } from "@/lib/store/setup-build";

export const STEPS = [
  { id: "pages", label: "Pages" },
  { id: "records", label: "Record types" },
  { id: "views", label: "Views" },
  { id: "widgets", label: "Dashboard" },
  { id: "samples", label: "Sample data" },
  { id: "finish", label: "Final touches" },
] as const;

/** Where each part of the answer sits in the steps (rules and the website count as the dashboard step). */
const STEP_OF: Record<DesignSketch["writing"], number> = {
  pages: 0,
  records: 1,
  views: 2,
  widgets: 3,
  rules: 3,
  site: 3,
  samples: 4,
  done: 5,
};

/** The step a build is on; all of them are done once it's ready. */
export function stepOf(build: DesignBuild): number {
  if (build.ready) return STEPS.length;
  if (build.stage !== "design") return 5;
  return STEP_OF[build.sketch?.writing ?? "pages"];
}

/** The page body the build draws for each kind of view. */
export type Shape = "table" | "board" | "calendar" | "form" | "site" | "doc" | "dashboard" | "canvas";
export const SHAPE_OF: Record<string, Shape> = {
  table: "table",
  kanban: "board",
  approval_queue: "board",
  calendar: "calendar",
  slot_grid: "calendar",
  form: "form",
  checkout: "form",
  landing: "site",
  html: "site",
  document: "doc",
  notes: "doc",
  canvas: "canvas",
  layout: "dashboard",
};

/** A page made only of website pages, listed under Website in the sidebar like the real one. */
export const isSitePage = (p: SketchPage) =>
  p.widgets === 0 && p.views.length > 0 && p.views.every((v) => v.type === "landing" || v.type === "html");

/**
 * The page on screen: the one being built, else the newest one. Once the design is written, the Overview (the first
 * page with dashboard cards), since that's what the last step arranges.
 */
export function focusOf(sketch: DesignSketch | undefined | null, finishing: boolean): SketchPage | undefined {
  if (!sketch?.pages.length) return undefined;
  if (finishing || sketch.writing === "done")
    return sketch.pages.find((p) => p.widgets > 0) ?? sketch.pages[0];
  return sketch.pages.find((p) => p.id === sketch.active) ?? sketch.pages.at(-1);
}

/** What the build is doing, in a few words. */
export function labelOf(build: DesignBuild, focus: SketchPage | undefined): string {
  if (build.ready) return `${build.sketch?.name ?? "Your workspace"} is ready`;
  if (build.stage === "fix")
    return `Fixing ${build.issues === 1 ? "one issue" : `${build.issues ?? "a few"} issues`} the check found`;
  if (build.stage === "check") return "Checking the design against your requirements";
  if (build.stage === "finish") return "Adding sample records and arranging your Overview";
  // The template route: the community system's pages are up from the start while Gemini adapts them.
  if (build.from) return `Adapting ${build.from.name} to your business`;
  switch (build.sketch?.writing) {
    case "records": {
      const latest = build.sketch.recordTypes.at(-1);
      return latest ? `Setting up ${latest.name}` : "Setting up your records";
    }
    case "views":
      return focus ? `Building ${focus.name}` : "Building your pages";
    case "widgets":
      return "Building your Overview";
    case "rules":
      return "Adding automations";
    case "site":
      return "Writing your website";
    case "samples":
      return "Adding sample records";
    default:
      return build.sketch?.pages.length ? "Planning your pages" : "Reading your plan";
  }
}

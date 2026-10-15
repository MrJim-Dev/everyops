"use client";

import { CheckIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { LogoMarkThinking } from "@/components/brand/logo";
import { SystemIcon } from "@/components/system-icon";
import type { DesignSketch, DesignStage, SketchPage } from "@/lib/assistant/design-sketch";
import type { IconName } from "@/lib/blueprint/types";
import { cn } from "@/lib/utils";

export type DesignBuild = { stage: DesignStage; issues?: number; sketch?: DesignSketch; since: number };

const STEPS = [
  { id: "pages", label: "Pages" },
  { id: "records", label: "Record types" },
  { id: "views", label: "Views" },
  { id: "widgets", label: "Dashboard" },
  { id: "samples", label: "Sample data" },
  { id: "finish", label: "Final touches" },
] as const;
/** Where each part of the answer sits in the steps (rules and the website count as views, samples as sample data). */
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

const VIEW_WORDS: Record<string, string> = {
  table: "Table",
  kanban: "Board",
  calendar: "Calendar",
  form: "Form",
  checkout: "Register",
  landing: "Website",
  html: "Website",
  slot_grid: "Schedule",
  approval_queue: "Approvals",
  notes: "Notes",
  document: "Page",
  canvas: "Canvas",
  layout: "Overview",
};

/** The page shown in the preview: the one being built, else the newest one. */
function focusOf(sketch: DesignSketch | undefined): SketchPage | undefined {
  if (!sketch?.pages.length) return undefined;
  return sketch.pages.find((p) => p.id === sketch.active) ?? sketch.pages.at(-1);
}

function labelOf(build: DesignBuild, focus: SketchPage | undefined): string {
  if (build.stage === "fix")
    return `Fixing ${build.issues === 1 ? "one issue" : `${build.issues ?? "a few"} issues`} the check found`;
  if (build.stage === "finish") return "Adding sample records and arranging your Overview";
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
      return "Planning your pages";
  }
}

/**
 * What setup shows while Gemini designs the workspace: a small preview of the workspace that fills in as the design is
 * written (pages in the sidebar, the page being built with its views, the record types), the step it's on, and the
 * seconds so far. New parts ease in as they arrive, so a long design reads as work being done, not a hang.
 */
export function DesignProgress({ build }: { build: DesignBuild }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const seconds = Math.max(0, Math.floor((now - build.since) / 1000));
  const sketch = build.sketch;
  const focus = focusOf(sketch);
  const label = labelOf(build, focus);
  const finishing = build.stage !== "design";
  const at = finishing ? 5 : STEP_OF[sketch?.writing ?? "pages"];
  const pages = sketch?.pages ?? [];
  const focusAt = focus ? pages.indexOf(focus) : -1;
  // Pages are built once their views are being written: those before the one in progress, and all of them after.
  const building = at === 2;
  const pastViews = at >= 3;
  // On a phone the pages are one row that scrolls sideways: keep the page being built in view.
  const strip = useRef<HTMLUListElement>(null);
  const focusId = focus?.id;
  useEffect(() => {
    const list = strip.current;
    const item = focusId ? list?.querySelector<HTMLElement>(`[data-page="${focusId}"]`) : null;
    if (list && item && list.scrollWidth > list.clientWidth)
      list.scrollTo({ left: item.offsetLeft - list.offsetLeft - 8, behavior: "smooth" });
  }, [focusId]);

  return (
    <div className="flex gap-3">
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border bg-card">
        <LogoMarkThinking className="size-3.5" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-3 pt-1">
        <output aria-live="polite" className="flex flex-wrap items-baseline gap-x-2 text-[13.5px]">
          <span
            key={label}
            className="shimmer-text animate-shimmer bg-clip-text font-medium text-transparent motion-reduce:animate-none"
          >
            {label}
          </span>
          <span className="font-mono text-[11.5px] text-muted-foreground tabular">{seconds}s</span>
          {seconds >= 45 && build.stage === "design" ? (
            <span className="text-[12px] text-muted-foreground">bigger workspaces take a minute or two</span>
          ) : null}
        </output>

        <div className="enter-up overflow-hidden rounded-xl border bg-card motion-reduce:transition-none">
          <div className="flex items-center gap-2 border-b px-3 py-2">
            <span className="flex gap-1" aria-hidden>
              <span className="size-2 rounded-full bg-muted" />
              <span className="size-2 rounded-full bg-muted" />
              <span className="size-2 rounded-full bg-muted" />
            </span>
            <span className="truncate text-[12px] font-medium text-muted-foreground">
              {sketch?.name ?? "Your workspace"}
            </span>
          </div>

          <div className="grid min-h-[196px] grid-cols-1 sm:grid-cols-[164px_1fr]">
            {/* The sidebar: pages appear as Gemini names them. */}
            <ul
              ref={strip}
              aria-label="Pages"
              className="flex gap-1 overflow-x-auto border-b p-2 sm:flex-col sm:overflow-visible sm:border-r sm:border-b-0"
            >
              {pages.length
                ? pages.map((p, i) => {
                    const current = p === focus && !finishing && (building || pastViews);
                    const built = finishing || (pastViews ? p !== focus : building && i < focusAt);
                    return (
                      <li
                        key={p.id}
                        data-page={p.id}
                        className={cn(
                          "enter-up flex shrink-0 items-center gap-2 rounded-md px-2 py-1 text-[12.5px] motion-reduce:transition-none",
                          current ? "bg-muted text-foreground" : "text-muted-foreground",
                        )}
                      >
                        <SystemIcon name={(p.icon ?? "gauge") as IconName} className="size-3.5 shrink-0" />
                        <span className="truncate">{p.name}</span>
                        {built ? (
                          <CheckIcon className="ml-auto size-3 shrink-0 animate-pop text-primary" />
                        ) : current ? (
                          <span className="ml-auto size-1.5 shrink-0 animate-live rounded-full bg-primary" />
                        ) : null}
                      </li>
                    );
                  })
                : [72, 96, 64, 88].map((w) => (
                    <li key={w} className="flex shrink-0 items-center gap-2 px-2 py-1.5">
                      <span className="size-3.5 animate-pulse rounded bg-muted" />
                      <span className="h-2.5 animate-pulse rounded bg-muted" style={{ width: w }} />
                    </li>
                  ))}
            </ul>

            {/* The page being built: its name, then its views as tabs, over a placeholder of its content. */}
            <div className="flex min-w-0 flex-col gap-3 p-3">
              {focus ? (
                <div
                  key={focus.id}
                  className="enter-up flex items-center gap-2 motion-reduce:transition-none"
                >
                  <SystemIcon
                    name={(focus.icon ?? "gauge") as IconName}
                    className="size-4 text-muted-foreground"
                  />
                  <span className="truncate text-[14px] font-semibold">{focus.name}</span>
                </div>
              ) : (
                <span className="h-4 w-32 animate-pulse rounded bg-muted" />
              )}
              <div className="flex flex-wrap gap-1.5">
                {focus?.views.map((v) => (
                  <span
                    key={v.id}
                    className="enter-up rounded-md border px-2 py-0.5 text-[11.5px] text-muted-foreground motion-reduce:transition-none"
                  >
                    {v.name}
                    <span className="ml-1.5 text-muted-foreground/60">{VIEW_WORDS[v.type] ?? ""}</span>
                  </span>
                ))}
              </div>
              {focus && focus.widgets > 0 && !focus.views.length ? (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {Array.from({ length: Math.min(focus.widgets, 6) }, (_, i) => (
                    <span
                      // biome-ignore lint/suspicious/noArrayIndexKey: placeholders only grow
                      key={i}
                      className="enter-up h-12 rounded-lg border bg-muted/40 motion-reduce:transition-none"
                    />
                  ))}
                </div>
              ) : (
                <div className="flex flex-col gap-1.5" aria-hidden>
                  {[100, 92, 96, 80].map((w) => (
                    <span
                      key={w}
                      className="h-2.5 animate-pulse rounded bg-muted/70"
                      style={{ width: `${w}%` }}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          {sketch?.recordTypes.length ? (
            <div className="flex flex-wrap gap-1.5 border-t px-3 py-2.5">
              {sketch.recordTypes.map((r) => (
                <span
                  key={r.id}
                  className="enter-up rounded-full bg-muted px-2 py-0.5 text-[11.5px] motion-reduce:transition-none"
                >
                  {r.name}
                  <span className="ml-1 text-muted-foreground tabular">{r.fields}</span>
                </span>
              ))}
            </div>
          ) : null}

          <ol className="flex flex-wrap gap-x-3 gap-y-1 border-t px-3 py-2 text-[11.5px]">
            {STEPS.map((s, i) => (
              <li
                key={s.id}
                className={cn(
                  "flex items-center gap-1",
                  i < at ? "text-foreground" : i === at ? "text-foreground" : "text-muted-foreground/60",
                )}
              >
                {i < at ? (
                  <CheckIcon className="size-3 animate-pop text-primary" />
                ) : (
                  <span
                    className={cn(
                      "size-1.5 rounded-full",
                      i === at ? "animate-live bg-primary" : "bg-muted-foreground/30",
                    )}
                  />
                )}
                {s.label}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}

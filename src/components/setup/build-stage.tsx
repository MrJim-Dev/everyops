"use client";

import { CheckIcon, CursorIcon } from "@phosphor-icons/react";
import { type CSSProperties, useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { LogoMarkThinking } from "@/components/brand/logo";
import { PageHeader } from "@/components/shell/page-header";
import type { DesignSketch } from "@/lib/assistant/design-sketch";
import type { DesignBuild } from "@/lib/store/setup-build";
import { cn } from "@/lib/utils";
import { focusOf, labelOf, SHAPE_OF, type Shape, STEPS, stepOf } from "./build-model";
import { Landed } from "./build-sidebar";

const step = (i: number) => ({ "--i": i }) as CSSProperties;
const RISE = "animate-rise stagger";
/** A placeholder bar; bars brighten once sample records are being written. */
const bar = (filled: boolean, className?: string) =>
  cn(
    "block rounded-full transition-colors duration-700",
    filled ? "bg-foreground/[0.16]" : "bg-muted",
    className,
  );
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** A soft band of light that keeps sweeping across what's still being built. Constant motion, so linear. */
function Sweep() {
  return (
    <span aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden motion-reduce:hidden">
      <span className="absolute inset-y-0 -left-1/2 w-1/2 animate-sweep bg-linear-to-r from-transparent via-foreground/[0.06] to-transparent" />
    </span>
  );
}

/** The body of the page being built at full size, shaped like the view being written. Real field names when known. */
function StageBody({
  shape,
  filled,
  fields,
  still,
}: {
  shape: Shape;
  filled: boolean;
  fields: string[];
  /** The design is ready: the chart stops moving. */
  still: boolean;
}) {
  switch (shape) {
    case "board":
      return (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[3, 2, 4, 1].map((cards, col) => (
            <div
              key={cards}
              className={cn(
                RISE,
                "flex flex-col gap-2 rounded-xl bg-muted/30 p-2",
                col > 1 && "max-lg:hidden",
              )}
              style={step(col)}
            >
              <div className="flex items-center gap-2 px-1 py-1">
                <span className={bar(filled, "h-2.5 w-20")} />
                <span className="ml-auto text-[11px] text-muted-foreground tabular">{cards}</span>
              </div>
              {Array.from({ length: cards }, (_, i) => (
                <div
                  // biome-ignore lint/suspicious/noArrayIndexKey: fixed placeholders
                  key={i}
                  className={cn(RISE, "flex flex-col gap-2 rounded-lg border bg-card p-3")}
                  style={step(col + i + 1)}
                >
                  <span className={bar(filled, "h-2.5 w-4/5")} />
                  <span className={bar(filled, "h-2 w-1/2")} />
                  <div className="mt-1 flex items-center gap-2">
                    <span className="size-5 rounded-full bg-muted" />
                    <span className={bar(filled, "h-2 w-12")} />
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      );
    case "calendar":
      return (
        <div className="overflow-hidden rounded-xl border">
          <div className="grid grid-cols-7 border-b bg-muted/30">
            {WEEKDAYS.map((d) => (
              <span key={d} className="px-2 py-2 text-[11.5px] text-muted-foreground">
                {d}
              </span>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {Array.from({ length: 35 }, (_, i) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: fixed placeholders
                key={i}
                className={cn(
                  RISE,
                  "flex h-20 flex-col gap-1 border-r border-b p-1.5 [&:nth-child(7n)]:border-r-0",
                )}
                style={step(Math.floor(i / 7) + (i % 7))}
              >
                <span className="text-[10.5px] text-muted-foreground/70 tabular">
                  {i + 1 <= 31 ? i + 1 : ""}
                </span>
                {i % 3 === 1 || i % 5 === 0 ? (
                  <span
                    className={cn(
                      "h-4 rounded border-l-2 transition-colors duration-700",
                      filled ? "border-primary bg-primary/15" : "border-muted-foreground/30 bg-muted",
                    )}
                  />
                ) : null}
              </div>
            ))}
          </div>
        </div>
      );
    case "form": {
      const labels = fields.length ? fields.slice(0, 5) : ["", "", "", ""];
      return (
        <div className="mx-auto flex w-full max-w-md flex-col gap-4 rounded-xl border bg-card p-6">
          <span className={cn(RISE, bar(filled, "h-4 w-2/5"))} style={step(0)} />
          {labels.map((label, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: labels can repeat
            <div key={i} className={cn(RISE, "flex flex-col gap-1.5 rounded-md")} style={step(i + 1)}>
              {label ? (
                <span className="text-[12.5px] font-medium">{label}</span>
              ) : (
                <span className={bar(filled, "h-2.5 w-24")} />
              )}
              <span className="h-9 rounded-md border bg-background" />
            </div>
          ))}
          <span className={cn(RISE, "h-9 w-full rounded-md bg-primary/85")} style={step(labels.length + 1)} />
        </div>
      );
    }
    case "site":
      return (
        <div className="flex flex-col gap-4">
          <div
            className={cn(
              RISE,
              "flex flex-col items-center gap-3 rounded-2xl bg-linear-to-b from-primary/10 to-muted/20 px-6 py-14",
            )}
            style={step(0)}
          >
            <span className={bar(filled, "h-2 w-24")} />
            <span className={bar(filled, "h-6 w-2/3 max-w-md")} />
            <span className={bar(filled, "h-3 w-1/2 max-w-sm")} />
            <div className="mt-3 flex gap-2">
              <span className="h-9 w-32 rounded-full bg-primary/85" />
              <span className="h-9 w-28 rounded-full border" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className={cn(RISE, "flex flex-col gap-2 rounded-xl border p-4")} style={step(i)}>
                <span className="size-7 rounded-lg bg-primary/15" />
                <span className={bar(filled, "h-3 w-3/5")} />
                <span className={bar(filled, "h-2 w-4/5")} />
              </div>
            ))}
          </div>
        </div>
      );
    case "doc":
      return (
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-3">
          <span className={cn(RISE, bar(filled, "mb-2 h-6 w-2/5"))} style={step(0)} />
          {[100, 94, 97, 60, 0, 100, 88, 92, 40].map((w, i) =>
            w ? (
              <span
                // biome-ignore lint/suspicious/noArrayIndexKey: fixed placeholders
                key={i}
                className={cn(RISE, bar(filled, "h-2.5"))}
                style={{ ...step(i + 1), width: `${w}%` }}
              />
            ) : (
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed placeholders
              <span key={i} className="h-3" />
            ),
          )}
        </div>
      );
    case "dashboard":
      return (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className={cn(RISE, "flex flex-col gap-3 rounded-xl border p-4")} style={step(i)}>
                <span className={bar(filled, "h-2.5 w-1/2")} />
                <span className={bar(filled, "h-6 w-2/3")} />
                <span
                  className={cn(
                    "h-1 w-full origin-left rounded-full transition-colors duration-700",
                    filled ? "bg-primary/40" : "bg-muted",
                  )}
                />
              </div>
            ))}
          </div>
          <div className="grid gap-3 lg:grid-cols-[2fr_1fr]">
            <div className={cn(RISE, "flex flex-col gap-3 rounded-xl border p-4")} style={step(4)}>
              <span className={bar(filled, "h-3 w-32")} />
              <div className="flex h-40 items-end gap-1.5">
                {[40, 62, 48, 80, 55, 92, 70, 58, 86, 74, 64, 96, 78, 68].map((h, i) => (
                  <span
                    // biome-ignore lint/suspicious/noArrayIndexKey: fixed placeholders
                    key={i}
                    className={cn(
                      "flex-1 origin-bottom rounded-t-md transition-colors duration-700 motion-reduce:animate-none",
                      filled ? "bg-primary/60" : "bg-muted",
                      !still && "animate-breathe",
                    )}
                    style={{
                      height: `${h}%`,
                      transitionDelay: filled ? `${i * 40}ms` : undefined,
                      animationDelay: `${i * 110}ms`,
                    }}
                  />
                ))}
              </div>
            </div>
            <div className={cn(RISE, "flex flex-col gap-3 rounded-xl border p-4")} style={step(5)}>
              <span className={bar(filled, "h-3 w-24")} />
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="flex items-center gap-2.5 rounded-md">
                  <span className="size-6 rounded-full bg-muted" />
                  <span className={bar(filled, "h-2.5 flex-1")} />
                  <span className={bar(filled, "h-2.5 w-10")} />
                </div>
              ))}
            </div>
          </div>
        </div>
      );
    case "canvas":
      return (
        <div className="relative h-80 rounded-xl border bg-[radial-gradient(var(--border)_1px,transparent_1px)] [background-size:16px_16px]">
          <span
            className={cn(RISE, "absolute top-10 left-12 h-20 w-36 rounded-xl border bg-card")}
            style={step(0)}
          />
          <span
            className={cn(RISE, "absolute top-24 left-64 size-24 rounded-full border bg-card")}
            style={step(1)}
          />
          <span
            className={cn(RISE, "absolute right-16 bottom-12 h-16 w-44 rounded-xl border bg-card")}
            style={step(2)}
          />
        </div>
      );
    default: {
      const cols = (fields.length ? fields : ["", "", "", "", ""]).slice(0, 5);
      const template = { gridTemplateColumns: `1.6fr ${"1fr ".repeat(cols.length - 1)}` };
      return (
        <div className="overflow-hidden rounded-xl border">
          <div className="grid gap-4 border-b bg-muted/30 px-4 py-2.5" style={template}>
            {cols.map((c, i) =>
              c ? (
                <span
                  // biome-ignore lint/suspicious/noArrayIndexKey: names can repeat
                  key={i}
                  className="animate-drop-in stagger truncate text-[12px] font-medium text-muted-foreground"
                  style={step(i)}
                >
                  {c}
                </span>
              ) : (
                // biome-ignore lint/suspicious/noArrayIndexKey: fixed placeholders
                <span key={i} className="my-1 h-2 w-3/5 rounded-full bg-muted-foreground/25" />
              ),
            )}
          </div>
          {Array.from({ length: 9 }, (_, r) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed placeholders
              key={r}
              className={cn(RISE, "grid items-center gap-4 border-b px-4 py-3.5 last:border-b-0")}
              style={{ ...template, ...step(r) }}
            >
              {cols.map((_, c) => (
                <span
                  // biome-ignore lint/suspicious/noArrayIndexKey: fixed placeholders
                  key={c}
                  className={bar(filled, "h-2.5")}
                  style={{ width: `${82 - ((r * 17 + c * 11) % 40)}%` }}
                />
              ))}
            </div>
          ))}
        </div>
      );
    }
  }
}

/** While record types are written: each one lands as a card and its fields drop in under it, as they're named. */
function SchemaBoard({ sketch }: { sketch: DesignSketch }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Record types" description="What your workspace keeps track of" />
      <div className="border-b" />
      <div className="relative min-h-0 flex-1 overflow-hidden px-5 py-5">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {sketch.recordTypes.map((r) => (
            <div key={r.id} data-build-target={`record:${r.id}`}>
              <div className="relative isolate flex animate-throw-in flex-col gap-3 rounded-xl border bg-card p-4">
                <Landed />
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-[14px] font-semibold">{r.name}</span>
                  <span className="shrink-0 text-[12px] text-muted-foreground tabular">
                    {r.fields} {r.fields === 1 ? "field" : "fields"}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {r.fieldNames.map((f, i) => (
                    <span
                      // biome-ignore lint/suspicious/noArrayIndexKey: names can repeat
                      key={i}
                      className="animate-drop-in stagger rounded-md border bg-background px-2 py-0.5 text-[12px] text-muted-foreground"
                      style={step(i)}
                    >
                      {f}
                    </span>
                  ))}
                  {r.fields > r.fieldNames.length ? (
                    <span className="px-1 py-0.5 text-[12px] text-muted-foreground/60 tabular">
                      +{r.fields - r.fieldNames.length}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * The EveryOps cursor: glides across the whole screen to whatever was just added (a page in the sidebar, a record
 * type, a tab) and taps it. It measures still wrappers, so a part that's still flying in is found where it lands.
 * Between additions it fades where it is; it never pokes at placeholders. Hidden with reduced motion.
 */
function BuildCursor({ target, layout }: { target: string | null; layout: string }) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure whenever the screen's arrangement changes
  useLayoutEffect(() => {
    if (!target) return;
    const place = () => {
      const rect = document.querySelector(`[data-build-target="${target}"]`)?.getBoundingClientRect();
      if (rect?.width && rect.height)
        setAt({
          x: rect.left + Math.min(rect.width * 0.72, rect.width - 10),
          y: rect.top + rect.height * 0.62,
        });
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(document.body);
    return () => observer.disconnect();
  }, [target, layout]);
  if (!at) return null;
  return createPortal(
    <span
      aria-hidden
      className={cn(
        "pointer-events-none fixed top-0 left-0 z-40 transition-[transform,opacity] duration-[640ms] ease-(--ease-in-out-strong) starting:opacity-0 motion-reduce:hidden",
        !target && "opacity-0 duration-300",
      )}
      style={{ transform: `translate(${at.x}px, ${at.y}px)` }}
    >
      <span
        key={target ?? "away"}
        className={cn("flex origin-top-left items-start", target && "animate-tap")}
      >
        <CursorIcon weight="fill" className="size-5 text-primary drop-shadow-[0_2px_6px_rgb(0_0_0/0.5)]" />
        <span className="mt-4 -ml-1.5 rounded-full bg-primary px-2 py-0.5 text-[11px] font-medium text-primary-foreground shadow-lg">
          EveryOps
        </span>
      </span>
    </span>,
    document.body,
  );
}

/**
 * The workspace being built, in place of the setup chat while Gemini designs it: the page being built at full size
 * (its header, tabs dropping in, a body shaped like the view being written, with its real field names), a board of
 * record types while those are written, and the pages landing in the real sidebar beside it (see BuildPages). One
 * cursor travels between them, and a floating bar where the composer was says what's happening and how long it's
 * been. Nothing here is interactive: it's a show while the design is written. In review (the design is done and
 * the review dialog is over it) the bar and the cursor step aside.
 */
export function BuildStage({ build, review = false }: { build: DesignBuild; review?: boolean }) {
  // The clock starts in an effect: reading the time while rendering breaks prerendering.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const seconds = now ? Math.max(0, Math.floor((now - build.since) / 1000)) : 0;
  const sketch = build.sketch;
  const finishing = build.stage !== "design" || !!build.ready;
  const writing = sketch?.writing ?? "pages";
  const at = stepOf(build);
  const focus = focusOf(sketch, finishing);
  const label = labelOf(build, focus);
  const schema = !finishing && writing === "records" && !!sketch?.recordTypes.length;
  const tab = focus?.views.at(-1);
  const dashboard =
    !!focus && focus.widgets > 0 && (finishing || writing === "widgets" || !focus.views.length);
  const shape: Shape | undefined = dashboard
    ? "dashboard"
    : tab
      ? (SHAPE_OF[tab.type] ?? "table")
      : undefined;
  const filled = finishing || writing === "samples";
  const fields = sketch?.recordTypes.find((r) => r.id === tab?.entity)?.fieldNames ?? [];
  const pages = sketch?.pages ?? [];
  const records = sketch?.recordTypes ?? [];

  // What the cursor points at: the newest page, record type or tab while those are written, else the page body.
  const target =
    finishing || review
      ? null
      : writing === "pages" && pages.length
        ? `page:${pages.at(-1)?.id}`
        : schema
          ? `record:${records.at(-1)?.id}`
          : writing === "views" && tab
            ? `tab:${tab.id}`
            : null;
  const layout = `${schema}:${focus?.id}:${focus?.views.length}:${pages.length}:${records.length}:${shape}`;

  // The tab underline follows the newest tab.
  const [underline, setUnderline] = useState<{ x: number; w: number } | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure when the tabs change
  useLayoutEffect(() => {
    const el = tab ? document.querySelector<HTMLElement>(`[data-build-target="tab:${tab.id}"]`) : null;
    setUnderline(el ? { x: el.offsetLeft, w: el.offsetWidth } : null);
  }, [tab?.id, focus?.id, focus?.views.length]);

  return (
    <div aria-busy={!build.ready} className="relative flex min-h-0 flex-1 animate-rise flex-col">
      {schema && sketch ? (
        <SchemaBoard key="schema" sketch={sketch} />
      ) : (
        <div key="page" className="flex min-h-0 flex-1 animate-rise flex-col">
          <PageHeader
            title={
              focus ? (
                <span key={focus.id} className="inline-block animate-step-next">
                  {focus.name}
                </span>
              ) : (
                <span className="inline-block h-4 w-40 animate-pulse rounded bg-muted align-middle" />
              )
            }
            actions={
              focus && tab && !dashboard ? (
                <span key={tab.id} className="h-8 w-28 animate-pop rounded-md bg-primary/85" aria-hidden />
              ) : null
            }
          />
          <nav aria-hidden className="relative flex min-h-[41px] shrink-0 gap-5 border-b px-5">
            {focus?.views.map((v) => (
              <span
                key={v.id}
                data-build-target={`tab:${v.id}`}
                className={cn(
                  "relative py-2.5 text-[13px]",
                  v === tab ? "text-foreground" : "text-muted-foreground",
                )}
              >
                <span className="relative isolate block animate-drop-in rounded-md">
                  <Landed />
                  {v.name}
                </span>
              </span>
            ))}
            {underline ? (
              <span
                aria-hidden
                className="absolute -bottom-px left-0 h-0.5 w-px origin-left rounded-full bg-primary transition-transform duration-300 ease-(--ease-in-out-strong)"
                style={{ transform: `translateX(${underline.x}px) scaleX(${underline.w})` }}
              />
            ) : null}
          </nav>
          <div data-build-target="body" className="relative min-h-0 flex-1 overflow-hidden px-5 py-5">
            {shape ? (
              <StageBody
                key={`${focus?.id}:${shape}`}
                shape={shape}
                filled={filled}
                fields={fields}
                still={!!build.ready}
              />
            ) : (
              <div className="flex flex-col gap-3">
                <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                  {[0, 1, 2, 3].map((i) => (
                    <span key={i} className="h-24 animate-pulse rounded-xl bg-muted/50" />
                  ))}
                </div>
                <span className="h-64 animate-pulse rounded-xl bg-muted/40" />
              </div>
            )}
            {build.ready ? null : <Sweep />}
            <span className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-linear-to-t from-background to-transparent" />
          </div>
        </div>
      )}

      {/* Where the composer was: what's happening, the seconds so far, and the steps as a row of segments. */}
      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 bottom-5 flex justify-center px-4 transition-[opacity,transform] duration-200 ease-(--ease-out-strong)",
          review && "translate-y-2 opacity-0",
        )}
      >
        <output
          aria-live="polite"
          className="flex max-w-full animate-rise items-center gap-3 rounded-full border bg-popover/90 py-1.5 pr-4 pl-1.5 shadow-[0_12px_40px_-12px_rgb(0_0_0/0.6)] backdrop-blur-md [animation-delay:120ms]"
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full border bg-card">
            {build.ready ? (
              <CheckIcon weight="bold" className="size-3.5 animate-pop text-primary" />
            ) : (
              <LogoMarkThinking className="size-3.5" />
            )}
          </span>
          <span
            key={label}
            className={cn(
              "min-w-0 animate-swap truncate text-[13.5px] font-medium",
              build.ready
                ? "text-foreground"
                : "shimmer-text animate-shimmer bg-clip-text text-transparent motion-reduce:animate-none",
            )}
          >
            {label}
          </span>
          <span className="shrink-0 font-mono text-[11.5px] text-muted-foreground tabular">{seconds}s</span>
          <span className="hidden shrink-0 items-center gap-1 sm:flex" title={STEPS[Math.min(at, 5)]?.label}>
            {STEPS.map((s, i) => (
              <span
                key={s.id}
                className={cn(
                  "h-1 w-4 rounded-full transition-colors duration-300",
                  i < at ? "bg-primary" : i === at ? "animate-pulse bg-primary/50" : "bg-muted",
                )}
              />
            ))}
          </span>
        </output>
      </div>

      <BuildCursor target={target} layout={layout} />
    </div>
  );
}

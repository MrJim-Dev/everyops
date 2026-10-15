"use client";

import type { ReactNode } from "react";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { getEntity } from "@/lib/blueprint/lookup";
import type { DataRecord, Sort } from "@/lib/blueprint/types";
import { componentDef } from "@/lib/components/registry";
import { applyFilter, sortRecords } from "@/lib/engine/query";
import { cn } from "@/lib/utils";

/**
 * Layout pages look like EveryOps's dashboards: parts sit edge to edge in a grid separated by hairlines (the grid's
 * background shows through a 1px gap), each with a slim title row, compact rows and 13px text. No floating cards.
 */

export const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];
export const chartColor = (i: number) => CHART_COLORS[i % CHART_COLORS.length];

/** One record type's records, filtered and sorted the way the component asks. */
export function useRows(entityId: string, filter?: string, sort?: Sort[]): DataRecord[] {
  const { blueprint, records } = useWorkspace();
  const entity = getEntity(blueprint, entityId);
  return sortRecords(applyFilter(blueprint, entity, records, filter), sort);
}

/** A part's frame, like a dashboard card's: a 44px title row ("Needs payment · 17"), then its content. */
export function PartCard({
  title,
  description,
  action,
  footer,
  children,
  className,
  contentClassName,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  const head = !!(title || description || action);
  return (
    <section className={cn("flex h-full min-w-0 flex-col bg-background", className)}>
      {head ? (
        <header className="flex min-h-11 items-center gap-3 px-5 py-2">
          <div className="flex min-w-0 flex-1 items-baseline gap-2">
            {title ? <h2 className="truncate text-[13.5px] font-semibold">{title}</h2> : null}
            {description ? (
              <span
                className={cn("truncate text-[12px] text-muted-foreground", action && "hidden sm:inline")}
              >
                {description}
              </span>
            ) : null}
          </div>
          {action}
        </header>
      ) : null}
      <div className={cn("min-w-0 flex-1 px-5 pb-4", !head && "pt-4", contentClassName)}>{children}</div>
      {footer ? (
        <footer className="flex min-h-9 items-center px-5 pb-3 text-[12px] text-muted-foreground">
          {footer}
        </footer>
      ) : null}
    </section>
  );
}

export function Nothing({ children = "Nothing here yet." }: { children?: ReactNode }) {
  return <p className="py-1 text-[13px] text-muted-foreground">{children}</p>;
}

/** Where a tab of this workspace lives, for buttons and "View all" links. */
export function useViewHref() {
  const { blueprint, basePath } = useWorkspace();
  return (viewId: string | undefined) => {
    if (!viewId) return undefined;
    const system = blueprint.systems.find((s) => s.viewIds.includes(viewId));
    return system ? `${basePath}/${system.id}/${viewId}` : undefined;
  };
}

type Placed = { id: string; component: string; span?: number };

/**
 * Spans that fill every row, so the hairline grid never shows an empty cell: a part that doesn't fit the rest of a
 * row widens the one before it to the row's end, and the last part fills its row. Wide parts take the whole row
 * unless they were given a span.
 */
export function packSpans(items: Placed[], columns: number): number[] {
  const spans = items.map((i) =>
    Math.min(columns, Math.max(1, i.span ?? (componentDef(i.component)?.wide ? columns : 1))),
  );
  let used = 0;
  for (let k = 0; k < spans.length; k++) {
    if (used && used + spans[k] > columns) {
      spans[k - 1] += columns - used;
      used = 0;
    }
    used = (used + spans[k]) % columns;
  }
  if (used && spans.length) spans[spans.length - 1] += columns - used;
  return spans;
}

/** Static classes so Tailwind keeps them. Below lg a layout is one column, like the dashboard. */
const COLS: Record<number, string> = { 1: "", 2: "lg:grid-cols-2", 3: "lg:grid-cols-3", 4: "lg:grid-cols-4" };
const SPAN: Record<number, string> = { 1: "", 2: "lg:col-span-2", 3: "lg:col-span-3", 4: "lg:col-span-4" };

/** Parts edge to edge with hairlines between them. */
export function PartGrid<T extends Placed>({
  items,
  columns,
  render,
  className,
}: {
  items: T[];
  columns: number;
  render: (item: T) => ReactNode;
  className?: string;
}) {
  const cols = Math.min(4, Math.max(1, columns || 1));
  const spans = packSpans(items, cols);
  return (
    <div className={cn("grid grid-cols-1 gap-px bg-border", COLS[cols], className)}>
      {items.map((item, i) => (
        <div key={item.id} className={cn("min-w-0 bg-background", SPAN[spans[i]])}>
          {render(item)}
        </div>
      ))}
    </div>
  );
}

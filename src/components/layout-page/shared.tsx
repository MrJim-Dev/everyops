"use client";

import type { ReactNode } from "react";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { getEntity } from "@/lib/blueprint/lookup";
import type { Blueprint, DataRecord, Sort, Widget } from "@/lib/blueprint/types";
import { metricFormatter } from "@/lib/engine/metric-format";
import { applyFilter, sortRecords } from "@/lib/engine/query";
import { formatMoney, formatNumber, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

/** A total over one record type, as layout components describe it. */
export type Metric = { entityId: string; op: "count" | "sum" | "avg"; fieldId?: string; filter?: string };

/**
 * Layout components reuse the dashboard engine (chartData, widgetValue, compareStat, metricFormatter), so a number on
 * a layout page is worked out exactly like the same number on a dashboard card.
 */
export function metricWidget(title: string, m: Metric, extra: Partial<Widget> = {}): Widget {
  return {
    id: "layout_part",
    title,
    entityId: m.entityId,
    ...(m.filter ? { filter: m.filter } : {}),
    type: "stat",
    metric: { op: m.op, ...(m.fieldId ? { fieldId: m.fieldId } : {}) },
    ...extra,
  };
}

export function formatterFor(bp: Blueprint, widget: Widget, format?: "money" | "number" | "percent") {
  if (format === "money") return (v: number) => formatMoney(Math.round(v));
  if (format === "percent") return (v: number) => formatPercent(Math.round(v * 10) / 10);
  if (format === "number") return (v: number) => formatNumber(Math.round(v * 10) / 10);
  return metricFormatter(bp, widget);
}

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

/** The shadcn card every data component sits in, so a layout reads as one set. */
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
  return (
    <Card className={cn("h-full min-w-0", className)}>
      {title || description || action ? (
        <CardHeader>
          {title ? <CardTitle>{title}</CardTitle> : null}
          {description ? <CardDescription>{description}</CardDescription> : null}
          {action ? <CardAction>{action}</CardAction> : null}
        </CardHeader>
      ) : null}
      <CardContent className={cn("min-w-0", contentClassName)}>{children}</CardContent>
      {footer ? <CardFooter className="text-[12.5px] text-muted-foreground">{footer}</CardFooter> : null}
    </Card>
  );
}

export function Nothing({ children = "Nothing here yet." }: { children?: ReactNode }) {
  return <p className="py-2 text-[13px] text-muted-foreground">{children}</p>;
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

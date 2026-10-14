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
import type { DataRecord, Sort } from "@/lib/blueprint/types";
import { applyFilter, sortRecords } from "@/lib/engine/query";
import { cn } from "@/lib/utils";

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

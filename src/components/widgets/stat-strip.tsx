"use client";

import { useWorkspace } from "@/components/workspace/workspace-context";
import type { Widget } from "@/lib/blueprint/types";
import { widgetValue } from "@/lib/engine/aggregate";
import { cn } from "@/lib/utils";
import { metricFormatter } from "./metric-format";

/** Key numbers in one row, divided by thin vertical rules. */
export function StatStrip({ widgets }: { widgets: Widget[] }) {
  const { blueprint, records } = useWorkspace();
  return (
    <dl className="grid grid-cols-2 border-b sm:flex">
      {widgets.map((w, i) => {
        const value = widgetValue(blueprint, w, records);
        const format = metricFormatter(blueprint, w);
        return (
          <div
            key={w.id}
            className={cn("flex min-w-0 flex-1 flex-col gap-1 px-5 py-4", i > 0 && "sm:border-l")}
          >
            <dt className="truncate text-[12.5px] text-muted-foreground">{w.title}</dt>
            <dd
              className={cn(
                "font-mono text-[24px] font-medium tracking-tight tabular",
                value < 0 && "text-destructive",
              )}
            >
              {format(value)}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

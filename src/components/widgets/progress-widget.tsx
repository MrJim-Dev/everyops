"use client";

import { AnimatedValue } from "@/components/motion/animated-value";
import { Progress } from "@/components/ui/progress";
import { useWorkspace } from "@/components/workspace/workspace-context";
import type { Widget } from "@/lib/blueprint/types";
import { widgetValue } from "@/lib/engine/aggregate";
import { metricFormatter } from "@/lib/engine/metric-format";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { WidgetFrame } from "./widget-frame";

export function ProgressWidget({ widget }: { widget: Widget }) {
  const { blueprint, records } = useWorkspace();
  const value = widgetValue(blueprint, widget, records);
  const target = widget.target ?? 0;
  const format = metricFormatter(blueprint, widget);
  const percent = target > 0 ? (value / target) * 100 : 0;
  return (
    <WidgetFrame title={widget.title}>
      <div className="flex flex-col gap-3 px-5 pb-5">
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-mono text-[15px] tabular">
            <AnimatedValue value={format(value)} />{" "}
            <span className="text-muted-foreground">of {format(target)}</span>
          </span>
          <span
            className={cn("text-[12.5px] tabular", percent > 100 ? "text-warning" : "text-muted-foreground")}
          >
            {formatNumber(Math.round(percent * 10) / 10)}% used
          </span>
        </div>
        <Progress
          value={Math.min(100, percent)}
          aria-label={`${widget.title}: ${Math.round(percent)}% used`}
        />
      </div>
    </WidgetFrame>
  );
}

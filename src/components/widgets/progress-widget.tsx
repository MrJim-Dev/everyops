"use client";

import { AnimatedValue } from "@/components/motion/animated-value";
import { Progress } from "@/components/ui/progress";
import { useWorkspace } from "@/components/workspace/workspace-context";
import type { Widget } from "@/lib/blueprint/types";
import { widgetValue } from "@/lib/engine/aggregate";
import { metricFormatter } from "@/lib/engine/metric-format";
import { widgetLook } from "@/lib/engine/widget-look";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { WidgetFrame } from "./widget-frame";
import { toneStyle } from "./widget-look";

export function ProgressWidget({ widget }: { widget: Widget }) {
  const { blueprint, records } = useWorkspace();
  const value = widgetValue(blueprint, widget, records);
  const target = widget.target ?? 0;
  const format = metricFormatter(blueprint, widget);
  const percent = target > 0 ? (value / target) * 100 : 0;
  const look = widgetLook(blueprint, widget);
  return (
    <WidgetFrame title={widget.title} look={look}>
      <div className="flex flex-col gap-3 px-5 pb-5" style={toneStyle(look)}>
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[15px] tabular-nums">
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
          className="[&_[data-slot=progress-indicator]]:bg-(--tone) [&_[data-slot=progress-track]]:h-2 [&_[data-slot=progress-track]]:bg-(--tone-soft)"
        />
      </div>
    </WidgetFrame>
  );
}

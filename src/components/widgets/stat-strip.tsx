"use client";

import { ArrowDownRightIcon, ArrowUpRightIcon } from "@phosphor-icons/react";
import { AnimatedValue } from "@/components/motion/animated-value";
import { useWorkspace } from "@/components/workspace/workspace-context";
import type { Widget } from "@/lib/blueprint/types";
import { widgetValue } from "@/lib/engine/aggregate";
import { compareStat } from "@/lib/engine/dashboard";
import { metricFormatter } from "@/lib/engine/metric-format";
import { cn } from "@/lib/utils";

/** Key numbers in one row, divided by thin vertical rules. Stats with a comparison show the change and a trend. */
export function StatStrip({ widgets }: { widgets: Widget[] }) {
  const { blueprint, records } = useWorkspace();
  return (
    <dl className="grid grid-cols-2 border-b sm:flex">
      {widgets.map((w, i) => {
        const comparison = compareStat(blueprint, w, records);
        const value = comparison ? comparison.current : widgetValue(blueprint, w, records);
        const format = metricFormatter(blueprint, w);
        return (
          <div
            key={w.id}
            className={cn("flex min-w-0 flex-1 flex-col gap-1 px-5 py-4", i > 0 && "sm:border-l")}
          >
            <dt className="truncate text-[12.5px] text-muted-foreground">{w.title}</dt>
            <dd className="flex items-end justify-between gap-3">
              <span
                className={cn(
                  "text-[24px] font-semibold tracking-[-0.02em] tabular-nums",
                  value < 0 && "text-destructive",
                )}
              >
                <AnimatedValue value={format(value)} />
              </span>
              {comparison && w.sparkline ? <Sparkline values={comparison.spark} /> : null}
            </dd>
            {comparison ? <Change change={comparison.change} against={comparison.against} /> : null}
          </div>
        );
      })}
    </dl>
  );
}

function Change({ change, against }: { change: number | null; against: string }) {
  if (change === null)
    return <span className="truncate text-[12px] text-muted-foreground">Nothing {against} to compare</span>;
  const pct = Math.round(Math.abs(change) * 100);
  const flat = pct === 0;
  const up = change > 0;
  return (
    <span className="flex min-w-0 items-center gap-1 text-[12px] text-muted-foreground">
      {flat ? null : up ? (
        <ArrowUpRightIcon aria-hidden="true" className="size-3.5 shrink-0 text-primary" />
      ) : (
        <ArrowDownRightIcon aria-hidden="true" className="size-3.5 shrink-0 text-destructive" />
      )}
      <span className={cn("tabular-nums", !flat && (up ? "text-primary" : "text-destructive"))}>
        {flat ? "No change" : `${up ? "Up" : "Down"} ${pct}%`}
      </span>
      <span className="truncate">vs {against}</span>
    </span>
  );
}

/** A tiny line of daily values; the last point is today. */
export function Sparkline({ values, className }: { values: number[]; className?: string }) {
  if (values.length < 2) return null;
  const w = 72;
  const h = 24;
  const max = Math.max(...values);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const points = values.map((v, i) => [(i / (values.length - 1)) * w, h - 2 - ((v - min) / span) * (h - 4)]);
  const line = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const [lx, ly] = points[points.length - 1];
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      width={w}
      height={h}
      aria-hidden="true"
      className={cn("mb-1 hidden shrink-0 overflow-visible text-primary min-[480px]:block", className)}
    >
      <polyline points={`0,${h} ${line} ${w},${h}`} fill="currentColor" opacity={0.12} stroke="none" />
      <polyline points={line} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" />
      <circle cx={lx} cy={ly} r={2} fill="currentColor" />
    </svg>
  );
}

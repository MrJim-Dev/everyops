"use client";

import { useWorkspace } from "@/components/workspace/workspace-context";
import type { Widget } from "@/lib/blueprint/types";
import { heatmapData } from "@/lib/engine/dashboard";
import { metricFormatter } from "@/lib/engine/metric-format";
import { WidgetFrame } from "./widget-frame";

const hourLabel = (h: number) => (h === 0 ? "12a" : h < 12 ? `${h}a` : h === 12 ? "12p" : `${h - 12}p`);

/** Busy times at a glance: one row per weekday, one column per hour, darker means more. */
export function HeatmapWidget({ widget }: { widget: Widget }) {
  const { blueprint, records } = useWorkspace();
  const data = heatmapData(blueprint, widget, records);
  const format = metricFormatter(blueprint, widget);
  const weeks = widget.heatmap?.weeks ?? 8;
  const shade = (v: number) => (data.max ? 0.08 + 0.92 * (v / data.max) : 0);
  return (
    <WidgetFrame
      title={widget.title}
      aside={<span className="text-[12px] text-muted-foreground">Last {weeks} weeks</span>}
    >
      <div className="overflow-x-auto px-5 pb-4">
        <table className="w-full border-separate border-spacing-[3px] text-[11px]">
          <thead>
            <tr>
              <th className="w-9" />
              {data.hours.map((h) => (
                <th key={h} scope="col" className="min-w-6 font-normal text-muted-foreground">
                  {h % 2 === data.hours[0] % 2 ? hourLabel(h) : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.days.map((day, d) => (
              <tr key={day}>
                <th scope="row" className="pr-1 text-left font-normal text-muted-foreground">
                  {day}
                </th>
                {data.hours.map((h, i) => {
                  const v = data.cells[d][i];
                  return (
                    <td
                      key={h}
                      title={`${day} ${hourLabel(h)}: ${format(v)}`}
                      className="h-6 rounded-[3px] bg-muted/40"
                      style={
                        v
                          ? {
                              backgroundColor: `color-mix(in oklab, var(--primary) ${Math.round(shade(v) * 100)}%, transparent)`,
                            }
                          : undefined
                      }
                    >
                      <span className="sr-only">{format(v)}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-2 flex items-center justify-end gap-1.5 text-[11px] text-muted-foreground">
          Less
          {[0.15, 0.4, 0.7, 1].map((s) => (
            <span
              key={s}
              aria-hidden="true"
              className="size-3 rounded-[3px]"
              style={{ backgroundColor: `color-mix(in oklab, var(--primary) ${s * 100}%, transparent)` }}
            />
          ))}
          More
        </div>
      </div>
    </WidgetFrame>
  );
}

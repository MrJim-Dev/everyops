"use client";

import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { useWorkspace } from "@/components/workspace/workspace-context";
import type { Widget } from "@/lib/blueprint/types";
import { chartData } from "@/lib/engine/aggregate";
import { formatNumber } from "@/lib/format";
import { metricFormatter } from "./metric-format";
import { WidgetFrame } from "./widget-frame";

const COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)"];
const compact = (v: number) =>
  Math.abs(v) >= 1000 ? `${formatNumber(Math.round(v / 100) / 10)}k` : formatNumber(v);

export function ChartWidget({ widget }: { widget: Widget }) {
  const { blueprint, records } = useWorkspace();
  const { points, series } = chartData(blueprint, widget, records);
  const format = metricFormatter(blueprint, widget);
  const config: ChartConfig = Object.fromEntries(
    series.map((s, i) => [s.key, { label: s.label, color: COLORS[i % COLORS.length] }]),
  );
  const kind = widget.chart?.kind ?? "line";

  const legend =
    series.length > 1 ? (
      <div className="flex items-center gap-3 text-[12px] text-muted-foreground">
        {series.map((s, i) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="size-2 rounded-full"
              style={{ background: COLORS[i % COLORS.length] }}
            />
            {s.label}
          </span>
        ))}
      </div>
    ) : null;

  const axes = (
    <>
      <CartesianGrid vertical={false} strokeDasharray="0" />
      <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={16} />
      <YAxis tickLine={false} axisLine={false} width={44} tickFormatter={compact} />
      <ChartTooltip
        cursor={kind === "bar" ? { fill: "var(--muted)" } : true}
        content={
          <ChartTooltipContent
            formatter={(v, name) => (
              <div className="flex w-full items-center justify-between gap-4">
                <span className="text-muted-foreground">{config[String(name)]?.label}</span>
                <span className="font-mono tabular">{format(Number(v))}</span>
              </div>
            )}
          />
        }
      />
    </>
  );

  return (
    <WidgetFrame title={widget.title} aside={legend}>
      <ChartContainer config={config} className="aspect-auto h-[220px] w-full px-3 pb-3">
        {kind === "bar" ? (
          <BarChart data={points} margin={{ left: 4, right: 8 }}>
            {axes}
            {series.map((s) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                fill={`var(--color-${s.key})`}
                radius={[3, 3, 0, 0]}
                maxBarSize={18}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        ) : (
          <LineChart data={points} margin={{ left: 4, right: 8 }}>
            {axes}
            {series.map((s) => (
              <Line
                key={s.key}
                dataKey={s.key}
                type="monotone"
                stroke={`var(--color-${s.key})`}
                strokeWidth={1.75}
                dot={false}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        )}
      </ChartContainer>
    </WidgetFrame>
  );
}

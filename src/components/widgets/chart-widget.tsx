"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from "recharts";
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { useWorkspace } from "@/components/workspace/workspace-context";
import type { Widget } from "@/lib/blueprint/types";
import { chartData } from "@/lib/engine/aggregate";
import { metricFormatter } from "@/lib/engine/metric-format";
import { TONE_COLOR, type WidgetLook, widgetLook } from "@/lib/engine/widget-look";
import { formatNumber, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { WidgetFrame } from "./widget-frame";

const COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];
/** The palette starting from the widget's own colour, so a revenue chart leads in teal and a costs chart in rose. */
const paletteFrom = (look: WidgetLook) => {
  const start = Math.max(0, COLORS.indexOf(TONE_COLOR[look.tone]));
  return (i: number) => COLORS[(start + i) % COLORS.length];
};
const compact = (v: number) =>
  Math.abs(v) >= 1000 ? `${formatNumber(Math.round(v / 100) / 10)}k` : formatNumber(v);

export function ChartWidget({ widget }: { widget: Widget }) {
  const { blueprint, records } = useWorkspace();
  const { points, series } = chartData(blueprint, widget, records);
  const format = metricFormatter(blueprint, widget);
  const look = widgetLook(blueprint, widget);
  const color = paletteFrom(look);
  const config: ChartConfig = Object.fromEntries(
    series.map((s, i) => [s.key, { label: s.label, color: color(i) }]),
  );
  const byCategory = !!widget.chart?.groupByFieldId;
  const kind = widget.chart?.kind ?? "line";

  if (kind === "donut")
    return <DonutChart widget={widget} points={points} format={format} look={look} color={color} />;

  const legend =
    series.length > 1 ? (
      <div className="flex items-center gap-3 text-[12px] text-muted-foreground">
        {series.map((s, i) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="size-2 rounded-full" style={{ background: color(i) }} />
            {s.label}
          </span>
        ))}
      </div>
    ) : null;

  const tooltip = (
    <ChartTooltip
      cursor={kind === "bar" || byCategory ? { fill: "var(--muted)" } : true}
      content={
        <ChartTooltipContent
          formatter={(v, name) => (
            <div className="flex w-full items-center justify-between gap-4">
              <span className="text-muted-foreground">{config[String(name)]?.label}</span>
              <span className="tabular-nums">{format(Number(v))}</span>
            </div>
          )}
        />
      }
    />
  );
  // Many categories read better as horizontal bars, with their names down the side.
  const horizontal = byCategory && points.length > 6;
  const axes = horizontal ? (
    <>
      <CartesianGrid horizontal={false} strokeDasharray="0" />
      <XAxis type="number" tickLine={false} axisLine={false} tickFormatter={compact} />
      <YAxis type="category" dataKey="label" tickLine={false} axisLine={false} width={110} />
      {tooltip}
    </>
  ) : (
    <>
      <CartesianGrid vertical={false} strokeDasharray="0" />
      <XAxis
        dataKey="label"
        tickLine={false}
        axisLine={false}
        tickMargin={8}
        minTickGap={byCategory ? 4 : 16}
      />
      <YAxis tickLine={false} axisLine={false} width={44} tickFormatter={compact} />
      {tooltip}
    </>
  );
  // Horizontal bars take the height their categories need; a time chart fills what the dashboard gives it.
  const height = horizontal ? Math.max(220, points.length * 30 + 40) : undefined;
  // One series split by category: each category gets its own colour, so the bars read apart at a glance.
  const colourful = byCategory && series.length === 1;

  return (
    <WidgetFrame title={widget.title} look={look} aside={legend} className={height ? undefined : "flex-1"}>
      <ChartContainer
        config={config}
        // A definite height: inside the dashboard grid a min-height alone left the chart 0 px tall and blank.
        className={cn("aspect-auto w-full px-3 pb-3", !height && "h-60")}
        style={height ? { height } : undefined}
      >
        {kind === "bar" || byCategory ? (
          <BarChart
            data={points}
            layout={horizontal ? "vertical" : "horizontal"}
            margin={{ left: 4, right: 8 }}
          >
            {axes}
            {series.map((s) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                stackId={byCategory && series.length > 1 ? "split" : undefined}
                fill={`var(--color-${s.key})`}
                radius={horizontal ? [0, 3, 3, 0] : [3, 3, 0, 0]}
                maxBarSize={byCategory ? 32 : 18}
                isAnimationActive={false}
              >
                {colourful
                  ? points.map((p, i) => <Cell key={String(p.bucket ?? i)} fill={color(i)} />)
                  : null}
              </Bar>
            ))}
          </BarChart>
        ) : kind === "area" ? (
          <AreaChart data={points} margin={{ left: 4, right: 8 }}>
            <defs>
              {series.map((s) => (
                <linearGradient key={s.key} id={`fill-${widget.id}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={`var(--color-${s.key})`} stopOpacity={0.45} />
                  <stop offset="100%" stopColor={`var(--color-${s.key})`} stopOpacity={0.02} />
                </linearGradient>
              ))}
            </defs>
            {axes}
            {series.map((s) => (
              <Area
                key={s.key}
                dataKey={s.key}
                type="monotone"
                stroke={`var(--color-${s.key})`}
                fill={`url(#fill-${widget.id}-${s.key})`}
                strokeWidth={2}
                isAnimationActive={false}
              />
            ))}
          </AreaChart>
        ) : (
          <LineChart data={points} margin={{ left: 4, right: 8 }}>
            {axes}
            {series.map((s) => (
              <Line
                key={s.key}
                dataKey={s.key}
                type="monotone"
                stroke={`var(--color-${s.key})`}
                strokeWidth={2}
                dot={points.length <= 16 ? { r: 2.5, strokeWidth: 0, fill: `var(--color-${s.key})` } : false}
                activeDot={{ r: 4 }}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        )}
      </ChartContainer>
    </WidgetFrame>
  );
}

/** Share of the total per category, with the numbers listed beside the ring so it never relies on colour alone. */
function DonutChart({
  widget,
  points,
  format,
  look,
  color,
}: {
  widget: Widget;
  points: ReturnType<typeof chartData>["points"];
  format: (v: number) => string;
  look: WidgetLook;
  color: (i: number) => string;
}) {
  const slices = points
    .map((p) => ({ key: p.bucket, label: p.label, value: Number(p.value ?? 0) }))
    .filter((s) => s.value > 0);
  const total = slices.reduce((a, s) => a + s.value, 0);
  const config: ChartConfig = Object.fromEntries(
    slices.map((s, i) => [s.key, { label: s.label, color: color(i) }]),
  );

  return (
    <WidgetFrame title={widget.title} look={look}>
      {total ? (
        <div className="flex flex-col items-center gap-4 px-5 pb-5 sm:flex-row">
          <ChartContainer config={config} className="aspect-square h-[180px] shrink-0">
            <PieChart>
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    hideLabel
                    formatter={(v, name) => (
                      <div className="flex w-full items-center justify-between gap-4">
                        <span className="text-muted-foreground">{String(name)}</span>
                        <span className="tabular-nums">{format(Number(v))}</span>
                      </div>
                    )}
                  />
                }
              />
              <Pie
                data={slices}
                dataKey="value"
                nameKey="label"
                innerRadius={52}
                outerRadius={80}
                strokeWidth={2}
                stroke="var(--background)"
                isAnimationActive={false}
              >
                {slices.map((s, i) => (
                  <Cell key={s.key} fill={color(i)} />
                ))}
              </Pie>
            </PieChart>
          </ChartContainer>
          <ul className="flex w-full min-w-0 flex-col gap-1.5 text-[13px]">
            {slices.map((s, i) => (
              <li key={s.key} className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="size-2 shrink-0 rounded-full"
                  style={{ background: color(i) }}
                />
                <span className="min-w-0 flex-1 truncate">{s.label}</span>
                <span className="tabular-nums text-[12.5px]">{format(s.value)}</span>
                <span className="w-12 text-right tabular-nums text-[12px] text-muted-foreground">
                  {formatPercent(Math.round((s.value / total) * 100))}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="px-5 pb-5 text-[13px] text-muted-foreground">Nothing to chart yet.</p>
      )}
    </WidgetFrame>
  );
}

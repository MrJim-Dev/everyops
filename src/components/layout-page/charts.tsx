"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Label,
  Line,
  LineChart,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  RadialBar,
  RadialBarChart,
  XAxis,
  YAxis,
} from "recharts";
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { useWorkspace } from "@/components/workspace/workspace-context";
import type { Widget } from "@/lib/blueprint/types";
import { chartData, widgetValue } from "@/lib/engine/aggregate";
import { formatNumber, formatPercent } from "@/lib/format";
import { chartColor, formatterFor, type Metric, metricWidget, Nothing, PartCard } from "./shared";

type P<T> = { props: T };
type ChartProps = Metric & {
  title: string;
  description?: string;
  dateFieldId?: string;
  bucket: "day" | "week" | "month";
  groupByFieldId?: string;
  splitByFieldId?: string;
  stacked?: boolean;
};

const compact = (v: number) =>
  Math.abs(v) >= 1000 ? `${formatNumber(Math.round(v / 100) / 10)}k` : formatNumber(v);

function useChart(p: ChartProps, kind: "line" | "bar" | "area" | "donut") {
  const { blueprint, records } = useWorkspace();
  const widget: Widget = metricWidget(p.title, p, {
    type: "chart",
    chart: {
      kind,
      bucket: p.bucket ?? "day",
      ...(p.dateFieldId ? { dateFieldId: p.dateFieldId } : {}),
      ...(p.groupByFieldId ? { groupByFieldId: p.groupByFieldId } : {}),
      ...(p.splitByFieldId ? { splitByFieldId: p.splitByFieldId } : {}),
    },
  });
  const { points, series } = chartData(blueprint, widget, records);
  const config: ChartConfig = Object.fromEntries(
    series.map((s, i) => [s.key, { label: s.label, color: chartColor(i) }]),
  );
  const empty = !points.some((pt) => series.some((s) => Number(pt[s.key] ?? 0) !== 0));
  return { points, series, config, format: formatterFor(blueprint, widget), empty };
}

/** Area, bar and line charts: the shadcn chart look over the dashboard engine's buckets. */
export function CartesianPart({ props, kind }: P<ChartProps> & { kind: "area" | "bar" | "line" }) {
  const { points, series, config, format, empty } = useChart(props, kind);
  const tooltip = (
    <ChartTooltip
      cursor={kind === "bar" ? { fill: "var(--muted)" } : true}
      content={
        <ChartTooltipContent
          indicator={kind === "line" ? "line" : "dot"}
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
  const axes = (
    <>
      <CartesianGrid vertical={false} />
      <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={16} />
      <YAxis tickLine={false} axisLine={false} width={44} tickFormatter={compact} />
      {tooltip}
    </>
  );
  const stack = props.stacked ? "a" : undefined;
  // Several series (split by an option) get a legend, so each colour reads as its option.
  const legend =
    series.length > 1 ? (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
        {series.map((s, i) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="size-2 rounded-full" style={{ background: chartColor(i) }} />
            {s.label}
          </span>
        ))}
      </div>
    ) : undefined;
  return (
    <PartCard title={props.title} description={props.description} footer={empty ? undefined : legend}>
      {empty ? (
        <Nothing>No data in this period yet.</Nothing>
      ) : (
        <ChartContainer config={config} className="aspect-auto h-[240px] w-full">
          {kind === "bar" ? (
            <BarChart data={points} margin={{ left: 0, right: 4 }}>
              {axes}
              {series.map((s, i) => (
                <Bar
                  key={s.key}
                  dataKey={s.key}
                  fill={chartColor(i)}
                  radius={stack ? 0 : 4}
                  stackId={stack}
                />
              ))}
            </BarChart>
          ) : kind === "line" ? (
            <LineChart data={points} margin={{ left: 0, right: 8 }}>
              {axes}
              {series.map((s, i) => (
                <Line
                  key={s.key}
                  dataKey={s.key}
                  type="monotone"
                  stroke={chartColor(i)}
                  strokeWidth={2}
                  dot={false}
                />
              ))}
            </LineChart>
          ) : (
            <AreaChart data={points} margin={{ left: 0, right: 8 }}>
              <defs>
                {series.map((s, i) => (
                  <linearGradient key={s.key} id={`fill-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={chartColor(i)} stopOpacity={0.5} />
                    <stop offset="95%" stopColor={chartColor(i)} stopOpacity={0.05} />
                  </linearGradient>
                ))}
              </defs>
              {axes}
              {series.map((s, i) => (
                <Area
                  key={s.key}
                  dataKey={s.key}
                  type="monotone"
                  stroke={chartColor(i)}
                  fill={`url(#fill-${s.key})`}
                  stackId={stack}
                />
              ))}
            </AreaChart>
          )}
        </ChartContainer>
      )}
    </PartCard>
  );
}

export function PiePart({ props }: P<ChartProps & { groupByFieldId: string; donut: boolean }>) {
  const { points, format, empty } = useChart(props, "donut");
  const data = points
    .map((p, i) => ({ label: p.label, value: Number(p.value ?? 0), fill: chartColor(i) }))
    .filter((d) => d.value > 0);
  const total = data.reduce((a, d) => a + d.value, 0);
  const config: ChartConfig = Object.fromEntries(
    data.map((d) => [d.label, { label: d.label, color: d.fill }]),
  );
  return (
    <PartCard title={props.title} description={props.description}>
      {empty ? (
        <Nothing />
      ) : (
        <div className="flex flex-col items-center gap-4 sm:flex-row">
          <ChartContainer config={config} className="aspect-square h-[200px] shrink-0">
            <PieChart>
              <ChartTooltip
                content={<ChartTooltipContent hideLabel formatter={(v, n) => `${n}: ${format(Number(v))}`} />}
              />
              <Pie
                data={data}
                dataKey="value"
                nameKey="label"
                innerRadius={props.donut ? 56 : 0}
                strokeWidth={2}
              >
                {data.map((d) => (
                  <Cell key={d.label} fill={d.fill} />
                ))}
                {props.donut ? (
                  <Label
                    content={({ viewBox }) =>
                      viewBox && "cx" in viewBox ? (
                        <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle" dominantBaseline="middle">
                          <tspan
                            x={viewBox.cx}
                            y={viewBox.cy}
                            className="fill-foreground text-[18px] font-semibold"
                          >
                            {format(total)}
                          </tspan>
                          <tspan
                            x={viewBox.cx}
                            y={(viewBox.cy ?? 0) + 18}
                            className="fill-muted-foreground text-[11px]"
                          >
                            Total
                          </tspan>
                        </text>
                      ) : null
                    }
                  />
                ) : null}
              </Pie>
            </PieChart>
          </ChartContainer>
          <ul className="flex w-full min-w-0 flex-col gap-1.5 text-[12.5px]">
            {data.map((d) => (
              <li key={d.label} className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="size-2 shrink-0 rounded-full"
                  style={{ background: d.fill }}
                />
                <span className="flex-1 truncate">{d.label}</span>
                <span className="tabular-nums text-muted-foreground">
                  {formatPercent(Math.round((d.value / total) * 1000) / 10)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </PartCard>
  );
}

export function RadarPart({ props }: P<ChartProps & { groupByFieldId: string }>) {
  const { points, config, format, empty } = useChart(props, "bar");
  return (
    <PartCard title={props.title} description={props.description}>
      {empty ? (
        <Nothing />
      ) : (
        <ChartContainer config={config} className="mx-auto aspect-square h-[240px]">
          <RadarChart data={points}>
            <ChartTooltip content={<ChartTooltipContent formatter={(v) => format(Number(v))} />} />
            <PolarAngleAxis dataKey="label" />
            <PolarGrid />
            <Radar dataKey="value" fill={chartColor(0)} fillOpacity={0.5} stroke={chartColor(0)} />
          </RadarChart>
        </ChartContainer>
      )}
    </PartCard>
  );
}

export function RadialPart({ props }: P<Metric & { title: string; description?: string; target: number }>) {
  const { blueprint, records } = useWorkspace();
  const widget = metricWidget(props.title, props);
  const value = widgetValue(blueprint, widget, records);
  const format = formatterFor(blueprint, widget);
  const ratio = Math.max(0, Math.min(1, value / props.target));
  const config: ChartConfig = { value: { label: props.title, color: chartColor(0) } };
  return (
    <PartCard
      title={props.title}
      description={props.description}
      footer={`${Math.round(ratio * 100)}% of ${format(props.target)}`}
    >
      <ChartContainer config={config} className="mx-auto aspect-square h-[200px]">
        <RadialBarChart
          data={[{ value: ratio * 100, fill: chartColor(0) }]}
          startAngle={90}
          endAngle={90 - 360 * ratio}
          innerRadius={70}
          outerRadius={100}
        >
          <PolarGrid
            gridType="circle"
            radialLines={false}
            stroke="none"
            className="first:fill-muted last:fill-background"
            polarRadius={[76, 64]}
          />
          <RadialBar dataKey="value" background cornerRadius={10} />
          <PolarRadiusAxis tick={false} tickLine={false} axisLine={false}>
            <Label
              content={({ viewBox }) =>
                viewBox && "cx" in viewBox ? (
                  <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle" dominantBaseline="middle">
                    <tspan
                      x={viewBox.cx}
                      y={viewBox.cy}
                      className="fill-foreground text-[20px] font-semibold"
                    >
                      {format(value)}
                    </tspan>
                    <tspan
                      x={viewBox.cx}
                      y={(viewBox.cy ?? 0) + 20}
                      className="fill-muted-foreground text-[11px]"
                    >
                      of {format(props.target)}
                    </tspan>
                  </text>
                ) : null
              }
            />
          </PolarRadiusAxis>
        </RadialBarChart>
      </ChartContainer>
    </PartCard>
  );
}

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
import {
  type ChartData,
  type ChartProps,
  chartOf,
  formatValue,
  type GoalData,
  goalOf,
  type Metric,
} from "@/lib/components/compute";
import { formatNumber, formatPercent } from "@/lib/format";
import { chartColor, Nothing, PartCard } from "./shared";

type P<T> = { props: T };
type Head = { title: string; description?: string };

const compact = (v: number) =>
  Math.abs(v) >= 1000 ? `${formatNumber(Math.round(v / 100) / 10)}k` : formatNumber(v);
const isEmpty = (d: ChartData) => !d.points.some((pt) => d.series.some((s) => Number(pt[s.key] ?? 0) !== 0));
const configOf = (d: ChartData): ChartConfig =>
  Object.fromEntries(d.series.map((s, i) => [s.key, { label: s.label, color: chartColor(i) }]));

/** Area, bar and line charts: the shadcn chart look over points worked out by the dashboard engine. */
export function CartesianView({
  head,
  data,
  shape,
  stacked,
}: {
  head: Head;
  data: ChartData;
  shape: "area" | "bar" | "line";
  stacked?: boolean;
}) {
  const config = configOf(data);
  const format = (v: number) => formatValue(data.kind, v);
  const tooltip = (
    <ChartTooltip
      cursor={shape === "bar" ? { fill: "var(--muted)" } : true}
      content={
        <ChartTooltipContent
          indicator={shape === "line" ? "line" : "dot"}
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
  const stack = stacked ? "a" : undefined;
  const empty = isEmpty(data);
  // Several series (split by an option) get a legend, so each colour reads as its option.
  const legend =
    data.series.length > 1 && !empty ? (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
        {data.series.map((s, i) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="size-2 rounded-full" style={{ background: chartColor(i) }} />
            {s.label}
          </span>
        ))}
      </div>
    ) : undefined;
  return (
    <PartCard title={head.title} description={head.description} footer={legend}>
      {empty ? (
        <Nothing>No data in this period yet.</Nothing>
      ) : (
        <ChartContainer config={config} className="aspect-auto h-[240px] w-full">
          {shape === "bar" ? (
            <BarChart data={data.points} margin={{ left: 0, right: 4 }}>
              {axes}
              {data.series.map((s, i) => (
                <Bar
                  key={s.key}
                  dataKey={s.key}
                  fill={chartColor(i)}
                  radius={stack ? 0 : 4}
                  stackId={stack}
                />
              ))}
            </BarChart>
          ) : shape === "line" ? (
            <LineChart data={data.points} margin={{ left: 0, right: 8 }}>
              {axes}
              {data.series.map((s, i) => (
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
            <AreaChart data={data.points} margin={{ left: 0, right: 8 }}>
              <defs>
                {data.series.map((s, i) => (
                  <linearGradient key={s.key} id={`fill-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={chartColor(i)} stopOpacity={0.5} />
                    <stop offset="95%" stopColor={chartColor(i)} stopOpacity={0.05} />
                  </linearGradient>
                ))}
              </defs>
              {axes}
              {data.series.map((s, i) => (
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

export function CartesianPart({
  props,
  kind,
}: P<ChartProps & { stacked?: boolean }> & { kind: "area" | "bar" | "line" }) {
  const { blueprint, records } = useWorkspace();
  return (
    <CartesianView
      head={props}
      data={chartOf(blueprint, records, props, kind)}
      shape={kind}
      stacked={props.stacked}
    />
  );
}

export function PieView({ head, data, donut }: { head: Head; data: ChartData; donut: boolean }) {
  const format = (v: number) => formatValue(data.kind, v);
  const slices = data.points
    .map((p, i) => ({ label: p.label, value: Number(p.value ?? 0), fill: chartColor(i) }))
    .filter((d) => d.value > 0);
  const total = slices.reduce((a, d) => a + d.value, 0);
  const config: ChartConfig = Object.fromEntries(
    slices.map((d) => [d.label, { label: d.label, color: d.fill }]),
  );
  return (
    <PartCard title={head.title} description={head.description}>
      {!slices.length ? (
        <Nothing />
      ) : (
        <div className="flex flex-col items-center gap-4 sm:flex-row">
          <ChartContainer config={config} className="aspect-square h-[200px] shrink-0">
            <PieChart>
              <ChartTooltip
                content={<ChartTooltipContent hideLabel formatter={(v, n) => `${n}: ${format(Number(v))}`} />}
              />
              <Pie data={slices} dataKey="value" nameKey="label" innerRadius={donut ? 56 : 0} strokeWidth={2}>
                {slices.map((d) => (
                  <Cell key={d.label} fill={d.fill} />
                ))}
                {donut ? (
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
            {slices.map((d) => (
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

export function PiePart({ props }: P<ChartProps & { donut: boolean }>) {
  const { blueprint, records } = useWorkspace();
  return <PieView head={props} data={chartOf(blueprint, records, props, "donut")} donut={props.donut} />;
}

export function RadarView({ head, data }: { head: Head; data: ChartData }) {
  return (
    <PartCard title={head.title} description={head.description}>
      {isEmpty(data) ? (
        <Nothing />
      ) : (
        <ChartContainer config={configOf(data)} className="mx-auto aspect-square h-[240px]">
          <RadarChart data={data.points}>
            <ChartTooltip
              content={<ChartTooltipContent formatter={(v) => formatValue(data.kind, Number(v))} />}
            />
            <PolarAngleAxis dataKey="label" />
            <PolarGrid />
            <Radar dataKey="value" fill={chartColor(0)} fillOpacity={0.5} stroke={chartColor(0)} />
          </RadarChart>
        </ChartContainer>
      )}
    </PartCard>
  );
}

export function RadarPart({ props }: P<ChartProps>) {
  const { blueprint, records } = useWorkspace();
  return <RadarView head={props} data={chartOf(blueprint, records, props, "bar")} />;
}

export function RadialView({ data }: { data: GoalData }) {
  const ratio = Math.max(0, Math.min(1, data.value / data.target));
  const format = (v: number) => formatValue(data.kind, v);
  const config: ChartConfig = { value: { label: data.title, color: chartColor(0) } };
  return (
    <PartCard
      title={data.title}
      description={data.description}
      footer={`${Math.round(ratio * 100)}% of ${format(data.target)}`}
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
                      {format(data.value)}
                    </tspan>
                    <tspan
                      x={viewBox.cx}
                      y={(viewBox.cy ?? 0) + 20}
                      className="fill-muted-foreground text-[11px]"
                    >
                      of {format(data.target)}
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

export function RadialPart({ props }: P<Metric & { title: string; description?: string; target: number }>) {
  const { blueprint, records } = useWorkspace();
  return <RadialView data={goalOf(blueprint, records, props)} />;
}

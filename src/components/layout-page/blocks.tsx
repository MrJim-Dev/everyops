"use client";

import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { useRecordPanels } from "@/components/records/record-panels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Input } from "@/components/ui/input";
import { Pagination, PaginationContent, PaginationItem } from "@/components/ui/pagination";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { getEntity, getField } from "@/lib/blueprint/lookup";
import type { Sort } from "@/lib/blueprint/types";
import { chartData, metricOf, widgetRows } from "@/lib/engine/aggregate";
import { startOf } from "@/lib/engine/dashboard";
import { valueText } from "@/lib/engine/value-text";
import { formatNumber, formatPercent } from "@/lib/format";
import { addDays, dateKey, todayKey } from "@/lib/time";
import { cn } from "@/lib/utils";
import { RecordTable, Trend, useStat } from "./data";
import { chartColor, formatterFor, type Metric, metricWidget, Nothing, PartCard, useRows } from "./shared";

type P<T> = { props: T };
type StatProps = Metric & {
  title: string;
  compare?: { dateFieldId: string; period: "day" | "week" | "month" };
  format?: "money" | "number" | "percent";
};

/** shadcn's dashboard section cards: each key number with its trend as a badge and a line under it. */
export function StatCardsPart({ props }: P<{ stats: StatProps[] }>) {
  const cols = props.stats.length;
  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-4 sm:grid-cols-2",
        cols >= 3 && "xl:grid-cols-3",
        cols >= 4 && "xl:grid-cols-4",
      )}
    >
      {props.stats.map((s) => (
        <StatCard key={s.title} stat={s} />
      ))}
    </div>
  );
}

function StatCard({ stat }: { stat: StatProps }) {
  const { value, comparison, format } = useStat(stat);
  const pct = comparison?.change === null || !comparison ? null : Math.round(comparison.change * 100);
  return (
    <Card className="bg-gradient-to-t from-primary/5 to-card">
      <CardHeader>
        <CardDescription>{stat.title}</CardDescription>
        <CardTitle className="text-[26px] font-semibold tracking-[-0.02em] tabular-nums">
          {format(value)}
        </CardTitle>
        {pct !== null ? (
          <CardAction>
            <Badge
              variant="outline"
              className={cn("tabular-nums", pct > 0 ? "text-primary" : pct < 0 ? "text-destructive" : "")}
            >
              {pct > 0 ? "+" : ""}
              {pct}%
            </Badge>
          </CardAction>
        ) : null}
      </CardHeader>
      {comparison ? (
        <CardFooter className="text-[12.5px]">
          <Trend change={comparison.change} against={comparison.against} />
        </CardFooter>
      ) : null}
    </Card>
  );
}

const RANGES = { "7d": 7, "30d": 30, "90d": 90 } as const;

/** shadcn's interactive area chart: the last 7, 30 or 90 days, one point a day, optionally split by an option. */
export function ChartInteractivePart({
  props,
}: P<Metric & { title: string; description?: string; dateFieldId: string; splitByFieldId?: string }>) {
  const { blueprint, records } = useWorkspace();
  const [range, setRange] = useState<keyof typeof RANGES>("30d");
  const widget = metricWidget(props.title, props);
  const format = formatterFor(blueprint, widget);
  const entity = getEntity(blueprint, props.entityId);
  const split = props.splitByFieldId ? entity.fields.find((f) => f.id === props.splitByFieldId) : undefined;
  const series = split?.options?.map((o) => ({ key: o.id, label: o.label })) ?? [
    { key: "value", label: props.title },
  ];
  const points = (() => {
    const rows = widgetRows(blueprint, widget, records);
    const today = todayKey();
    const days = RANGES[range];
    const byDay = new Map<string, typeof rows>();
    for (const r of rows) {
      const start = startOf(r.data[props.dateFieldId]);
      if (start) byDay.set(dateKey(start), [...(byDay.get(dateKey(start)) ?? []), r]);
    }
    return Array.from({ length: days }, (_, i) => {
      const key = addDays(today, i - days + 1);
      const list = byDay.get(key) ?? [];
      const point: Record<string, string | number> = {
        bucket: key,
        label: `${Number(key.slice(5, 7))}/${Number(key.slice(8))}`,
      };
      for (const s of series)
        point[s.key] = metricOf(
          widget,
          split ? list.filter((r) => String(r.data[split.id] ?? "") === s.key) : list,
        );
      return point;
    });
  })();
  const config: ChartConfig = Object.fromEntries(
    series.map((s, i) => [s.key, { label: s.label, color: chartColor(i) }]),
  );
  return (
    <PartCard
      title={props.title}
      description={props.description ?? `Last ${RANGES[range]} days`}
      action={
        <Tabs value={range} onValueChange={(v) => setRange(v as keyof typeof RANGES)}>
          <TabsList>
            {Object.keys(RANGES).map((k) => (
              <TabsTrigger key={k} value={k} className="px-2.5 text-[12px]">
                {k}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      }
    >
      <ChartContainer config={config} className="aspect-auto h-[260px] w-full">
        <AreaChart data={points} margin={{ left: 0, right: 8 }}>
          <defs>
            {series.map((s, i) => (
              <linearGradient key={s.key} id={`ia-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={chartColor(i)} stopOpacity={0.6} />
                <stop offset="95%" stopColor={chartColor(i)} stopOpacity={0.05} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={44}
            tickFormatter={(v) => formatNumber(Number(v))}
          />
          <ChartTooltip
            cursor={false}
            content={
              <ChartTooltipContent
                indicator="dot"
                formatter={(v, n) => `${config[String(n)]?.label}: ${format(Number(v))}`}
              />
            }
          />
          {series.map((s, i) => (
            <Area
              key={s.key}
              dataKey={s.key}
              type="natural"
              stroke={chartColor(i)}
              fill={`url(#ia-${s.key})`}
              stackId="a"
            />
          ))}
        </AreaChart>
      </ChartContainer>
    </PartCard>
  );
}

/** shadcn's data table: search, sortable columns and pages over live records. */
export function DataTablePart({
  props,
}: P<{
  title: string;
  entityId: string;
  fieldIds: string[];
  filter?: string;
  sort?: Sort[];
  pageSize: number;
}>) {
  const { blueprint, records } = useWorkspace();
  const { openRecord } = useRecordPanels();
  const entity = getEntity(blueprint, props.entityId);
  const fields = props.fieldIds.map((id) => getField(entity, id));
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort | undefined>(props.sort?.[0]);
  const [page, setPage] = useState(0);
  const rows = useRows(props.entityId, props.filter, sort ? [sort] : undefined);
  const matching = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      fields.some((f) => valueText(blueprint, records, f, r.data[f.id]).toLowerCase().includes(q)),
    );
  }, [rows, query, fields, blueprint, records]);
  const pages = Math.max(1, Math.ceil(matching.length / props.pageSize));
  const at = Math.min(page, pages - 1);
  const shown = matching.slice(at * props.pageSize, (at + 1) * props.pageSize);
  const onSort = (fieldId: string) =>
    setSort((s) =>
      s?.fieldId === fieldId
        ? s.dir === "asc"
          ? { fieldId, dir: "desc" }
          : undefined
        : { fieldId, dir: "asc" },
    );
  return (
    <PartCard
      title={props.title}
      description={`${matching.length} of ${rows.length}`}
      action={
        <div className="relative w-44 sm:w-56">
          <MagnifyingGlassIcon
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
            placeholder={`Search ${entity.pluralName.toLowerCase()}`}
            aria-label={`Search ${entity.pluralName.toLowerCase()}`}
            className="h-8 pl-8 text-[13px]"
          />
        </div>
      }
      contentClassName="px-0"
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <span>
            Page {at + 1} of {pages}
          </span>
          <Pagination className="mx-0 w-auto">
            <PaginationContent>
              <PaginationItem>
                <Button variant="outline" size="sm" disabled={at === 0} onClick={() => setPage(at - 1)}>
                  Previous
                </Button>
              </PaginationItem>
              <PaginationItem>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={at >= pages - 1}
                  onClick={() => setPage(at + 1)}
                >
                  Next
                </Button>
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      }
    >
      {shown.length ? (
        <RecordTable rows={shown} fields={fields} onOpen={openRecord} sort={sort} onSort={onSort} />
      ) : (
        <div className="px-6">
          <Nothing>{query ? "Nothing matches." : undefined}</Nothing>
        </div>
      )}
    </PartCard>
  );
}

/** Top categories or linked records by a total, ranked, each with a bar for its share of the leader. */
export function LeaderboardPart({
  props,
}: P<Metric & { title: string; groupByFieldId: string; limit: number }>) {
  const { blueprint, records } = useWorkspace();
  const widget = metricWidget(props.title, props, {
    type: "chart",
    chart: { kind: "bar", bucket: "day", groupByFieldId: props.groupByFieldId },
  });
  const format = formatterFor(blueprint, widget);
  const ranked = chartData(blueprint, widget, records)
    // Past the top nine, chartData folds the rest into "Other", which is never a place on a leaderboard.
    .points.filter((p) => p.bucket !== "__other")
    .map((p) => ({ label: p.label, value: Number(p.value ?? 0) }))
    .filter((p) => p.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, props.limit);
  const top = ranked[0]?.value ?? 1;
  return (
    <PartCard title={props.title}>
      {ranked.length ? (
        <ol className="flex flex-col gap-3">
          {ranked.map((r, i) => (
            <li key={r.label} className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2 text-[13px]">
                <span className="w-4 text-muted-foreground tabular-nums">{i + 1}</span>
                <span className="flex-1 truncate">{r.label}</span>
                <span className="tabular-nums">{format(r.value)}</span>
              </div>
              <div className="ml-6 h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${(r.value / top) * 100}%`, background: chartColor(i) }}
                />
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <Nothing />
      )}
    </PartCard>
  );
}

/** Each stage of a status with how many records sit there and their share. */
export function StatusOverviewPart({
  props,
}: P<{ title: string; entityId: string; statusFieldId: string; filter?: string }>) {
  const { blueprint } = useWorkspace();
  const entity = getEntity(blueprint, props.entityId);
  const field = getField(entity, props.statusFieldId);
  const rows = useRows(props.entityId, props.filter);
  const total = rows.length || 1;
  return (
    <PartCard title={props.title} description={`${rows.length} ${entity.pluralName.toLowerCase()}`}>
      <ul className="flex flex-col gap-3">
        {(field.options ?? []).map((o) => {
          const n = rows.filter((r) => r.data[field.id] === o.id).length;
          return (
            <li key={o.id} className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-[13px]">
                <span>{o.label}</span>
                <span className="tabular-nums text-muted-foreground">
                  {formatNumber(n)} · {formatPercent(Math.round((n / total) * 1000) / 10)}
                </span>
              </div>
              <Progress value={(n / total) * 100} aria-label={o.label} />
            </li>
          );
        })}
      </ul>
    </PartCard>
  );
}

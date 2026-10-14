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
import {
  type ChartData,
  type Counted,
  dailyOf,
  formatValue,
  type Metric,
  type Ranked,
  rankedOf,
  type StatData,
  type StatProps,
  stagesOf,
  statOf,
  type ValueKind,
} from "@/lib/components/compute";
import { valueText } from "@/lib/engine/value-text";
import { formatNumber, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { RecordTable, Trend } from "./data";
import { chartColor, Nothing, PartCard, useRows } from "./shared";

type P<T> = { props: T };

/** shadcn's dashboard section cards: each key number with its trend as a badge and a line under it. */
export function StatCardsView({ stats }: { stats: StatData[] }) {
  const cols = stats.length;
  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-4 sm:grid-cols-2",
        cols >= 3 && "xl:grid-cols-3",
        cols >= 4 && "xl:grid-cols-4",
      )}
    >
      {stats.map((s) => {
        const c = s.comparison;
        const pct = !c || c.change === null ? null : Math.round(c.change * 100);
        return (
          <Card key={s.title} className="bg-gradient-to-t from-primary/5 to-card">
            <CardHeader>
              <CardDescription>{s.title}</CardDescription>
              <CardTitle className="text-[26px] font-semibold tracking-[-0.02em] tabular-nums">
                {formatValue(s.kind, s.value)}
              </CardTitle>
              {pct !== null ? (
                <CardAction>
                  <Badge
                    variant="outline"
                    className={cn(
                      "tabular-nums",
                      pct > 0 ? "text-primary" : pct < 0 ? "text-destructive" : "",
                    )}
                  >
                    {pct > 0 ? "+" : ""}
                    {pct}%
                  </Badge>
                </CardAction>
              ) : null}
            </CardHeader>
            {c ? (
              <CardFooter className="text-[12.5px]">
                <Trend change={c.change} against={c.against} />
              </CardFooter>
            ) : null}
          </Card>
        );
      })}
    </div>
  );
}

export function StatCardsPart({ props }: P<{ stats: StatProps[] }>) {
  const { blueprint, records } = useWorkspace();
  return <StatCardsView stats={props.stats.map((s) => statOf(blueprint, records, s))} />;
}

const RANGES = { "7d": 7, "30d": 30, "90d": 90 } as const;

/** shadcn's interactive area chart over the last 90 days of points; the switch shows the last 7, 30 or 90. */
export function DailyChartView({
  title,
  description,
  data,
}: {
  title: string;
  description?: string;
  data: ChartData;
}) {
  const [range, setRange] = useState<keyof typeof RANGES>("30d");
  const points = data.points.slice(-RANGES[range]);
  const config: ChartConfig = Object.fromEntries(
    data.series.map((s, i) => [s.key, { label: s.label, color: chartColor(i) }]),
  );
  return (
    <PartCard
      title={title}
      description={description ?? `Last ${RANGES[range]} days`}
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
            {data.series.map((s, i) => (
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
                formatter={(v, n) => `${config[String(n)]?.label}: ${formatValue(data.kind, Number(v))}`}
              />
            }
          />
          {data.series.map((s, i) => (
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

export function ChartInteractivePart({
  props,
}: P<Metric & { title: string; description?: string; dateFieldId: string; splitByFieldId?: string }>) {
  const { blueprint, records } = useWorkspace();
  return (
    <DailyChartView
      title={props.title}
      description={props.description}
      data={dailyOf(blueprint, records, props)}
    />
  );
}

/** shadcn's data table: search, sortable columns and pages over live records; rows open the record. */
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
        <SearchBox
          value={query}
          onChange={(v) => {
            setQuery(v);
            setPage(0);
          }}
          label={`Search ${entity.pluralName.toLowerCase()}`}
        />
      }
      contentClassName="px-0"
      footer={<Pager at={at} pages={pages} onPage={setPage} />}
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

export function SearchBox({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
}) {
  return (
    <div className="relative w-44 sm:w-56">
      <MagnifyingGlassIcon
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={label}
        aria-label={label}
        className="h-8 pl-8 text-[13px]"
      />
    </div>
  );
}

export function Pager({ at, pages, onPage }: { at: number; pages: number; onPage: (n: number) => void }) {
  return (
    <div className="flex w-full items-center justify-between gap-3">
      <span>
        Page {at + 1} of {pages}
      </span>
      <Pagination className="mx-0 w-auto">
        <PaginationContent>
          <PaginationItem>
            <Button variant="outline" size="sm" disabled={at === 0} onClick={() => onPage(at - 1)}>
              Previous
            </Button>
          </PaginationItem>
          <PaginationItem>
            <Button variant="outline" size="sm" disabled={at >= pages - 1} onClick={() => onPage(at + 1)}>
              Next
            </Button>
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    </div>
  );
}

export function LeaderboardView({ title, ranked, kind }: { title: string; ranked: Ranked; kind: ValueKind }) {
  const top = ranked[0]?.value ?? 1;
  return (
    <PartCard title={title}>
      {ranked.length ? (
        <ol className="flex flex-col gap-3">
          {ranked.map((r, i) => (
            <li key={r.label} className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2 text-[13px]">
                <span className="w-4 text-muted-foreground tabular-nums">{i + 1}</span>
                <span className="flex-1 truncate">{r.label}</span>
                <span className="tabular-nums">{formatValue(kind, r.value)}</span>
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

export function LeaderboardPart({
  props,
}: P<Metric & { title: string; groupByFieldId: string; limit: number }>) {
  const { blueprint, records } = useWorkspace();
  const { ranked, kind } = rankedOf(blueprint, records, props);
  return <LeaderboardView title={props.title} ranked={ranked} kind={kind} />;
}

export function StagesView({
  title,
  total,
  plural,
  stages,
}: {
  title: string;
  total: number;
  plural: string;
  stages: Counted;
}) {
  const of = total || 1;
  return (
    <PartCard title={title} description={`${total} ${plural}`}>
      <ul className="flex flex-col gap-3">
        {stages.map((s) => (
          <li key={s.label} className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-[13px]">
              <span>{s.label}</span>
              <span className="tabular-nums text-muted-foreground">
                {formatNumber(s.count)} · {formatPercent(Math.round((s.count / of) * 1000) / 10)}
              </span>
            </div>
            <Progress value={(s.count / of) * 100} aria-label={s.label} />
          </li>
        ))}
      </ul>
    </PartCard>
  );
}

export function StatusOverviewPart({
  props,
}: P<{ title: string; entityId: string; statusFieldId: string; filter?: string }>) {
  const { blueprint, records } = useWorkspace();
  return <StagesView title={props.title} {...stagesOf(blueprint, records, props)} />;
}

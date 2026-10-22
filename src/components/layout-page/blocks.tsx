"use client";

import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { useRecordPanels } from "@/components/records/record-panels";
import { Button } from "@/components/ui/button";
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useCurrency } from "@/components/workspace/currency";
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
import { counted, RecordTable, StatCell } from "./data";
import { chartColor, Nothing, PartCard, useRows } from "./shared";

type P<T> = { props: T };

/** Key numbers in one row divided by thin rules, exactly like the dashboard's stat strip. */
export function StatCardsView({ stats }: { stats: StatData[] }) {
  return (
    <dl className="grid h-full grid-cols-2 bg-background sm:flex">
      {stats.map((s, i) => (
        <StatCell
          key={s.title}
          data={s}
          className={cn(
            i > 0 && "sm:border-l",
            i % 2 === 1 && "border-l sm:border-l",
            i > 1 && "border-t sm:border-t-0",
          )}
        />
      ))}
    </dl>
  );
}

export function StatCardsPart({ props }: P<{ stats: StatProps[] }>) {
  const { blueprint, records } = useWorkspace();
  return <StatCardsView stats={props.stats.map((s) => statOf(blueprint, records, s))} />;
}

const RANGES = { "7d": 7, "30d": 30, "90d": 90 } as const;

/** A total over the last 7, 30 or 90 days as an area chart, with a small range switch in its title row. */
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
  const currency = useCurrency();
  const points = data.points.slice(-RANGES[range]);
  const config: ChartConfig = Object.fromEntries(
    data.series.map((s, i) => [s.key, { label: s.label, color: chartColor(i) }]),
  );
  return (
    <PartCard
      title={title}
      description={description ?? `Last ${RANGES[range]} days`}
      action={
        <ToggleGroup
          value={[range]}
          onValueChange={(v: string[]) => v[0] && setRange(v[0] as keyof typeof RANGES)}
          size="sm"
          variant="outline"
          aria-label="Period"
        >
          {Object.keys(RANGES).map((k) => (
            <ToggleGroupItem key={k} value={k} className="h-7 px-2 text-[12px]">
              {k}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      }
    >
      <ChartContainer config={config} className="aspect-auto h-[220px] w-full">
        <AreaChart data={points} margin={{ left: 0, right: 8, top: 4 }}>
          <defs>
            {data.series.map((s, i) => (
              <linearGradient key={s.key} id={`ia-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={chartColor(i)} stopOpacity={0.5} />
                <stop offset="95%" stopColor={chartColor(i)} stopOpacity={0.04} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={40}
            tickFormatter={(v) => formatNumber(Number(v))}
          />
          <ChartTooltip
            cursor={false}
            content={
              <ChartTooltipContent
                indicator="dot"
                formatter={(v, n) =>
                  `${config[String(n)]?.label}: ${formatValue(data.kind, Number(v), currency)}`
                }
              />
            }
          />
          {data.series.map((s, i) => (
            <Area
              key={s.key}
              dataKey={s.key}
              type="monotone"
              stroke={chartColor(i)}
              strokeWidth={1.5}
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

/** The app's table with search in its title row and pages at the foot; rows open the record. */
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
      title={counted(props.title, matching.length)}
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
      contentClassName="px-0 pb-0"
      footer={pages > 1 ? <Pager at={at} pages={pages} onPage={setPage} /> : undefined}
    >
      {shown.length ? (
        <RecordTable rows={shown} fields={fields} onOpen={openRecord} sort={sort} onSort={onSort} />
      ) : (
        <div className="px-5 pb-3">
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
    <div className="relative w-40 sm:w-52">
      <MagnifyingGlassIcon
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={label}
        aria-label={label}
        className="h-7 pl-7 text-[12.5px]"
      />
    </div>
  );
}

export function Pager({ at, pages, onPage }: { at: number; pages: number; onPage: (n: number) => void }) {
  return (
    <nav aria-label="Pages" className="flex w-full items-center justify-between gap-3 border-t pt-3">
      <span className="tabular-nums">
        Page {at + 1} of {pages}
      </span>
      <span className="flex gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-[12px]"
          disabled={at === 0}
          onClick={() => onPage(at - 1)}
        >
          Previous
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-[12px]"
          disabled={at >= pages - 1}
          onClick={() => onPage(at + 1)}
        >
          Next
        </Button>
      </span>
    </nav>
  );
}

/** A thin bar under a label and its value, used by rankings and stages. */
function BarRow({
  label,
  value,
  ratio,
  color,
  lead,
}: {
  label: string;
  value: string;
  ratio: number;
  color: string;
  lead?: string;
}) {
  return (
    <li className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 text-[13px]">
        {lead ? <span className="w-4 text-[12px] text-muted-foreground tabular-nums">{lead}</span> : null}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <span className="shrink-0 text-[12.5px] tabular-nums text-muted-foreground">{value}</span>
      </div>
      <div className={cn("h-1 overflow-hidden rounded-full bg-muted", lead && "ml-6")}>
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.max(0, Math.min(1, ratio)) * 100}%`, background: color }}
        />
      </div>
    </li>
  );
}

export function LeaderboardView({ title, ranked, kind }: { title: string; ranked: Ranked; kind: ValueKind }) {
  const currency = useCurrency();
  const top = ranked[0]?.value || 1;
  return (
    <PartCard title={title}>
      {ranked.length ? (
        <ol className="flex flex-col gap-2.5">
          {ranked.map((r, i) => (
            <BarRow
              key={r.label}
              lead={String(i + 1)}
              label={r.label}
              value={formatValue(kind, r.value, currency)}
              ratio={r.value / top}
              color={chartColor(i)}
            />
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
    <PartCard title={title} description={`${formatNumber(total)} ${plural}`}>
      <ul className="flex flex-col gap-2.5">
        {stages.map((s) => (
          <BarRow
            key={s.label}
            label={s.label}
            value={`${formatNumber(s.count)} · ${formatPercent(Math.round((s.count / of) * 1000) / 10)}`}
            ratio={s.count / of}
            color={
              s.tone === "danger"
                ? "var(--destructive)"
                : s.tone === "warning"
                  ? "var(--color-amber-500)"
                  : "var(--primary)"
            }
          />
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

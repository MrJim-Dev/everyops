"use client";

import { ArrowDownRightIcon, ArrowUpRightIcon, CaretDownIcon, CaretUpIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { type ReactNode, useState } from "react";
import { AnimatedValue } from "@/components/motion/animated-value";
import { FieldValue } from "@/components/records/field-value";
import { useRecordPanels } from "@/components/records/record-panels";
import { Avatar, AvatarFallback, AvatarGroup, AvatarGroupCount, AvatarImage } from "@/components/ui/avatar";
import { Calendar } from "@/components/ui/calendar";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sparkline } from "@/components/widgets/stat-strip";
import { useCurrency } from "@/components/workspace/currency";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { displayKind, isNumericKind } from "@/lib/blueprint/field-kind";
import { getEntity, getField, recordTitle } from "@/lib/blueprint/lookup";
import type { DataRecord, Field, Sort } from "@/lib/blueprint/types";
import {
  type Counted,
  countsOf,
  daysOf,
  formatValue,
  type GoalData,
  goalOf,
  type Metric,
  type StatData,
  type StatProps,
  statOf,
} from "@/lib/components/compute";
import { isImagePath } from "@/lib/engine/records";
import { valueText } from "@/lib/engine/value-text";
import { formatDate, formatNumber, initials } from "@/lib/format";
import { dateKey } from "@/lib/time";
import { cn } from "@/lib/utils";
import { Nothing, PartCard, useRows, useViewHref } from "./shared";

type P<T> = { props: T };

/** "Up 18% vs the previous 7 days", as the dashboard's stat strip says it. */
export function Trend({ change, against }: { change: number | null; against: string }) {
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

/** One key number in the stat strip's look: label, the number with its sparkline, and the change under it. */
export function StatCell({ data, className }: { data: StatData; className?: string }) {
  const currency = useCurrency();
  return (
    <div className={cn("flex h-full min-w-0 flex-1 flex-col gap-1 bg-background px-5 py-4", className)}>
      <span className="truncate text-[12.5px] text-muted-foreground">{data.title}</span>
      <span className="flex items-end justify-between gap-3">
        <span
          className={cn(
            "text-[24px] font-semibold tracking-[-0.02em] tabular-nums",
            data.value < 0 && "text-destructive",
          )}
        >
          <AnimatedValue value={formatValue(data.kind, data.value, currency)} />
        </span>
        {data.comparison?.spark.some((v) => v !== 0) ? <Sparkline values={data.comparison.spark} /> : null}
      </span>
      {data.comparison ? <Trend change={data.comparison.change} against={data.comparison.against} /> : null}
    </div>
  );
}

export function StatView({ data }: { data: StatData }) {
  return <StatCell data={data} />;
}

export function StatPart({ props }: P<StatProps>) {
  const { blueprint, records } = useWorkspace();
  return <StatView data={statOf(blueprint, records, props)} />;
}

export function GoalBarView({ data }: { data: GoalData }) {
  const currency = useCurrency();
  const pct = Math.max(0, Math.min(100, (data.value / data.target) * 100));
  return (
    <PartCard
      title={data.title}
      description={`${Math.round(pct)}% of ${formatValue(data.kind, data.target, currency)}`}
    >
      <div className="flex flex-col gap-2.5">
        <span className="text-[22px] font-semibold tracking-[-0.02em] tabular-nums">
          {formatValue(data.kind, data.value, currency)}
        </span>
        <Progress value={pct} aria-label={data.title} />
      </div>
    </PartCard>
  );
}

export function ProgressPart({ props }: P<Metric & { title: string; target: number }>) {
  const { blueprint, records } = useWorkspace();
  return <GoalBarView data={goalOf(blueprint, records, props)} />;
}

const TONE: Record<string, string> = {
  accent: "bg-primary",
  success: "bg-primary",
  warning: "bg-amber-500",
  danger: "bg-destructive",
  neutral: "bg-muted-foreground/60",
};

/** Counts per option as small chips with the option's colour dot, like status pills. */
export function BadgesView({ title, items }: { title: string; items: Counted }) {
  return (
    <PartCard title={title}>
      {items.length ? (
        <div className="flex flex-wrap gap-1.5">
          {items.map((p) => (
            <span
              key={p.label}
              className="inline-flex h-6 items-center gap-1.5 rounded-md border px-2 text-[12px]"
            >
              <span
                aria-hidden="true"
                className={cn("size-1.5 rounded-full", TONE[p.tone ?? "neutral"] ?? TONE.neutral)}
              />
              {p.label}
              <span className="text-muted-foreground tabular-nums">{formatNumber(p.count)}</span>
            </span>
          ))}
        </div>
      ) : (
        <Nothing />
      )}
    </PartCard>
  );
}

export function BadgesPart({
  props,
}: P<{ title?: string; entityId: string; fieldId: string; filter?: string }>) {
  const { blueprint, records } = useWorkspace();
  const entity = getEntity(blueprint, props.entityId);
  const field = getField(entity, props.fieldId);
  return (
    <BadgesView
      title={props.title ?? `${entity.pluralName} by ${field.name.toLowerCase()}`}
      items={countsOf(blueprint, records, props)}
    />
  );
}

/** "Needs payment · 17": a title with its count, as dashboard cards name their lists. */
export const counted = (title: string, n: number) => (n ? `${title} · ${n}` : title);

export function ViewAll({ href }: { href?: string }) {
  return href ? (
    <Link
      href={href}
      className="rounded-sm text-[12px] text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      View all
    </Link>
  ) : null;
}

export function TablePart({
  props,
}: P<{
  title?: string;
  entityId: string;
  fieldIds: string[];
  filter?: string;
  sort?: Sort[];
  limit: number;
  viewId?: string;
}>) {
  const { blueprint } = useWorkspace();
  const { openRecord } = useRecordPanels();
  const entity = getEntity(blueprint, props.entityId);
  const all = useRows(props.entityId, props.filter, props.sort);
  const rows = all.slice(0, props.limit);
  const fields = props.fieldIds.map((id) => getField(entity, id));
  const href = useViewHref()(props.viewId);
  return (
    <PartCard
      title={counted(props.title ?? entity.pluralName, all.length)}
      action={<ViewAll href={href} />}
      contentClassName="px-0 pb-1"
    >
      {rows.length ? (
        <RecordTable rows={rows} fields={fields} onOpen={openRecord} />
      ) : (
        <div className="px-5 pb-3">
          <Nothing />
        </div>
      )}
    </PartCard>
  );
}

/** Head and row sizes of the app's tables: 36px muted headers, 40px rows, 13px text, numbers on the right. */
export const TABLE = {
  table: "text-[13px]",
  headRow: "hover:bg-transparent",
  head: "h-9 text-[12px] font-normal text-muted-foreground first:pl-5 last:pr-5",
  row: "h-10",
  cell: "max-w-[280px] truncate py-2 first:pl-5 first:font-medium last:pr-5",
};

export function SortHead({
  name,
  dir,
  numeric,
  onSort,
}: {
  name: string;
  dir?: "asc" | "desc";
  numeric?: boolean;
  onSort?: () => void;
}) {
  if (!onSort) return <>{name}</>;
  return (
    <button
      type="button"
      onClick={onSort}
      className={cn(
        "inline-flex items-center gap-1 rounded-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
        numeric && "flex-row-reverse",
      )}
    >
      {name}
      {dir === "asc" ? (
        <CaretUpIcon className="size-3" />
      ) : dir === "desc" ? (
        <CaretDownIcon className="size-3" />
      ) : null}
    </button>
  );
}

export function RecordTable({
  rows,
  fields,
  onOpen,
  sort,
  onSort,
}: {
  rows: DataRecord[];
  fields: Field[];
  onOpen: (id: string) => void;
  sort?: Sort;
  onSort?: (fieldId: string) => void;
}) {
  const { blueprint } = useWorkspace();
  const numeric = (f: Field) => isNumericKind(displayKind(blueprint, f));
  return (
    <Table className={TABLE.table}>
      <TableHeader>
        <TableRow className={TABLE.headRow}>
          {fields.map((f) => (
            <TableHead key={f.id} className={cn(TABLE.head, numeric(f) && "text-right")}>
              <SortHead
                name={f.name}
                numeric={numeric(f)}
                dir={sort?.fieldId === f.id ? sort.dir : undefined}
                onSort={onSort ? () => onSort(f.id) : undefined}
              />
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.id} className={cn(TABLE.row, "cursor-default")} onClick={() => onOpen(r.id)}>
            {fields.map((f) => (
              <TableCell key={f.id} className={cn(TABLE.cell, numeric(f) && "text-right")}>
                <FieldValue field={f} value={r.data[f.id]} />
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** A list row in the dashboard's look: name over a muted line, a value on the right; 44px tall. */
export function ListRow({
  title,
  description,
  image,
  right,
  onClick,
}: {
  title: string;
  description?: ReactNode;
  image?: string;
  right?: ReactNode;
  onClick?: () => void;
}) {
  const body = (
    <>
      {image ? (
        // biome-ignore lint/performance/noImgElement: uploads are served by our own route
        <img src={image} alt="" className="size-8 shrink-0 rounded-md border object-cover" />
      ) : null}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{title}</span>
        {description ? (
          <span className="block truncate text-[12px] text-muted-foreground">{description}</span>
        ) : null}
      </span>
      {right ? <span className="shrink-0 text-right">{right}</span> : null}
    </>
  );
  const row = "flex min-h-11 w-full items-center gap-3 px-5 py-1.5 text-left text-[13px]";
  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      className={cn(row, "outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted")}
    >
      {body}
    </button>
  ) : (
    <div className={row}>{body}</div>
  );
}

export function ListPart({
  props,
}: P<{
  title?: string;
  entityId: string;
  descriptionFieldId?: string;
  badgeFieldId?: string;
  imageFieldId?: string;
  filter?: string;
  sort?: Sort[];
  limit: number;
}>) {
  const { blueprint, records } = useWorkspace();
  const { openRecord } = useRecordPanels();
  const entity = getEntity(blueprint, props.entityId);
  const all = useRows(props.entityId, props.filter, props.sort);
  const rows = all.slice(0, props.limit);
  const desc = props.descriptionFieldId ? getField(entity, props.descriptionFieldId) : undefined;
  const badge = props.badgeFieldId ? getField(entity, props.badgeFieldId) : undefined;
  return (
    <PartCard title={counted(props.title ?? entity.pluralName, all.length)} contentClassName="px-0 pb-2">
      {rows.length ? (
        <ul>
          {rows.map((r) => {
            const image = props.imageFieldId ? r.data[props.imageFieldId] : undefined;
            return (
              <li key={r.id}>
                <ListRow
                  title={recordTitle(entity, r)}
                  description={
                    desc ? valueText(blueprint, records, desc, r.data[desc.id]) || undefined : undefined
                  }
                  image={isImagePath(image) ? image : undefined}
                  right={
                    badge ? (
                      <FieldValue field={badge} value={r.data[badge.id]} className="font-sans tabular-nums" />
                    ) : undefined
                  }
                  onClick={() => openRecord(r.id)}
                />
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="px-5 pb-2">
          <Nothing>Nothing here right now.</Nothing>
        </div>
      )}
    </PartCard>
  );
}

export function AvatarsPart({
  props,
}: P<{ title?: string; entityId: string; imageFieldId?: string; filter?: string; limit: number }>) {
  const { blueprint } = useWorkspace();
  const entity = getEntity(blueprint, props.entityId);
  const rows = useRows(props.entityId, props.filter);
  const shown = rows.slice(0, props.limit);
  return (
    <PartCard title={counted(props.title ?? entity.pluralName, rows.length)}>
      {shown.length ? (
        <div className="flex flex-col gap-2">
          <AvatarGroup>
            {shown.map((r) => {
              const image = props.imageFieldId ? r.data[props.imageFieldId] : undefined;
              const name = recordTitle(entity, r);
              return (
                <Avatar key={r.id} title={name} className="size-7">
                  {isImagePath(image) ? <AvatarImage src={image} alt={name} /> : null}
                  <AvatarFallback className="text-[11px]">{initials(name)}</AvatarFallback>
                </Avatar>
              );
            })}
            {rows.length > shown.length ? (
              <AvatarGroupCount className="size-7 text-[11px]">
                +{rows.length - shown.length}
              </AvatarGroupCount>
            ) : null}
          </AvatarGroup>
          <p className="truncate text-[12px] text-muted-foreground">
            {shown.map((r) => recordTitle(entity, r)).join(", ")}
          </p>
        </div>
      ) : (
        <Nothing />
      )}
    </PartCard>
  );
}

const keyToDate = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const dateToKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** A month calendar marking the days that have records; the picked day lists them (in the app) or counts them. */
export function CalendarView({
  title,
  plural,
  counts,
  listFor,
}: {
  title: string;
  plural: { one: string; many: string };
  counts: Record<string, number>;
  listFor?: (day: string) => ReactNode;
}) {
  const [day, setDay] = useState<string>(() => dateKey(new Date()));
  const n = counts[day] ?? 0;
  return (
    <PartCard
      title={title}
      description={`${formatDate(day)} · ${n} ${n === 1 ? plural.one : plural.many}`}
      contentClassName="px-3 pb-3"
    >
      <Calendar
        mode="single"
        selected={keyToDate(day)}
        onSelect={(d) => d && setDay(dateToKey(d))}
        modifiers={{ busy: Object.keys(counts).map(keyToDate) }}
        modifiersClassNames={{
          busy: "[&>button]:font-semibold [&>button]:underline [&>button]:decoration-primary [&>button]:decoration-2 [&>button]:underline-offset-4",
        }}
        className="mx-auto p-0"
      />
      {listFor ? <div className="mt-2 flex flex-col">{listFor(day)}</div> : null}
    </PartCard>
  );
}

export function CalendarPart({
  props,
}: P<{ title?: string; entityId: string; dateFieldId: string; filter?: string }>) {
  const { blueprint, records } = useWorkspace();
  const { openRecord } = useRecordPanels();
  const entity = getEntity(blueprint, props.entityId);
  const byDay = daysOf(blueprint, records, props);
  const counts = Object.fromEntries([...byDay].map(([k, v]) => [k, v.length]));
  return (
    <CalendarView
      title={props.title ?? entity.pluralName}
      plural={{ one: entity.name.toLowerCase(), many: entity.pluralName.toLowerCase() }}
      counts={counts}
      listFor={(day) =>
        (byDay.get(day) ?? []).slice(0, 5).map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => openRecord(r.id)}
            className="truncate rounded-md px-2 py-1.5 text-left text-[13px] outline-none hover:bg-muted/50 focus-visible:bg-muted"
          >
            {recordTitle(entity, r)}
          </button>
        ))
      }
    />
  );
}

/** Pictures to swipe through; each opens its record in the app, or is just a picture on a public page. */
export function CarouselView({
  title,
  items,
  onOpen,
}: {
  title: string;
  items: { id: string; title: string; image: string }[];
  onOpen?: (id: string) => void;
}) {
  return (
    <PartCard title={counted(title, items.length)}>
      {items.length ? (
        <Carousel opts={{ align: "start" }} className="px-9">
          <CarouselContent className="-ml-3">
            {items.map((it) => (
              <CarouselItem key={it.id} className="basis-1/2 pl-3 lg:basis-1/3">
                <button
                  type="button"
                  disabled={!onOpen}
                  onClick={() => onOpen?.(it.id)}
                  className="flex w-full flex-col gap-1 text-left outline-none disabled:cursor-default"
                >
                  {/* biome-ignore lint/performance/noImgElement: uploads are served by our own route */}
                  <img src={it.image} alt="" className="aspect-[4/3] w-full rounded-md border object-cover" />
                  <span className="truncate text-[12.5px]">{it.title}</span>
                </button>
              </CarouselItem>
            ))}
          </CarouselContent>
          <CarouselPrevious className="left-0 size-7" />
          <CarouselNext className="right-0 size-7" />
        </Carousel>
      ) : (
        <Nothing>No pictures yet.</Nothing>
      )}
    </PartCard>
  );
}

export function CarouselPart({
  props,
}: P<{ title?: string; entityId: string; imageFieldId: string; filter?: string; limit: number }>) {
  const { blueprint } = useWorkspace();
  const { openRecord } = useRecordPanels();
  const entity = getEntity(blueprint, props.entityId);
  const items = useRows(props.entityId, props.filter)
    .filter((r) => isImagePath(r.data[props.imageFieldId]))
    .slice(0, props.limit)
    .map((r) => ({ id: r.id, title: recordTitle(entity, r), image: String(r.data[props.imageFieldId]) }));
  return <CarouselView title={props.title ?? entity.pluralName} items={items} onOpen={openRecord} />;
}

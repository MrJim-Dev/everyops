"use client";

import { ArrowDownRightIcon, ArrowUpRightIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { FieldValue } from "@/components/records/field-value";
import { useRecordPanels } from "@/components/records/record-panels";
import { Avatar, AvatarFallback, AvatarGroup, AvatarGroupCount, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { getEntity, getField, recordTitle } from "@/lib/blueprint/lookup";
import type { DataRecord, Sort } from "@/lib/blueprint/types";
import { chartData, widgetValue } from "@/lib/engine/aggregate";
import { compareStat, startOf } from "@/lib/engine/dashboard";
import { isImagePath } from "@/lib/engine/records";
import { valueText } from "@/lib/engine/value-text";
import { formatDate, formatNumber, initials } from "@/lib/format";
import { dateKey } from "@/lib/time";
import { cn } from "@/lib/utils";
import { formatterFor, type Metric, metricWidget, Nothing, PartCard, useRows, useViewHref } from "./shared";

type P<T> = { props: T };
type StatProps = Metric & {
  title: string;
  compare?: { dateFieldId: string; period: "day" | "week" | "month" };
  format?: "money" | "number" | "percent";
};

/** A stat's number and, with compare, its change: shared by the stat component and the stat cards block. */
export function useStat(p: StatProps) {
  const { blueprint, records } = useWorkspace();
  const widget = metricWidget(p.title, p, p.compare ? { compare: p.compare } : {});
  const comparison = compareStat(blueprint, widget, records);
  const value = comparison ? comparison.current : widgetValue(blueprint, widget, records);
  return { value, comparison, format: formatterFor(blueprint, widget, p.format) };
}

export function Trend({ change, against }: { change: number | null; against: string }) {
  if (change === null) return <span className="text-muted-foreground">Nothing {against} to compare</span>;
  const pct = Math.round(Math.abs(change) * 100);
  const up = change > 0;
  return (
    <span className="inline-flex items-center gap-1 text-muted-foreground">
      {pct === 0 ? null : up ? (
        <ArrowUpRightIcon aria-hidden="true" className="size-3.5 text-primary" />
      ) : (
        <ArrowDownRightIcon aria-hidden="true" className="size-3.5 text-destructive" />
      )}
      <span className={cn("tabular-nums", pct && (up ? "text-primary" : "text-destructive"))}>
        {pct === 0 ? "No change" : `${up ? "Up" : "Down"} ${pct}%`}
      </span>{" "}
      vs {against}
    </span>
  );
}

export function StatPart({ props }: P<StatProps>) {
  const { value, comparison, format } = useStat(props);
  return (
    <PartCard description={props.title} footer={comparison ? <Trend {...comparison} /> : undefined}>
      <span
        className={cn(
          "text-[26px] font-semibold tracking-[-0.02em] tabular-nums",
          value < 0 && "text-destructive",
        )}
      >
        {format(value)}
      </span>
    </PartCard>
  );
}

export function ProgressPart({ props }: P<Metric & { title: string; target: number }>) {
  const { blueprint, records } = useWorkspace();
  const widget = metricWidget(props.title, props);
  const value = widgetValue(blueprint, widget, records);
  const format = formatterFor(blueprint, widget);
  const pct = Math.max(0, Math.min(100, (value / props.target) * 100));
  return (
    <PartCard title={props.title} footer={`${Math.round(pct)}% of ${format(props.target)}`}>
      <div className="flex flex-col gap-3">
        <span className="text-[22px] font-semibold tabular-nums">{format(value)}</span>
        <Progress value={pct} aria-label={props.title} />
      </div>
    </PartCard>
  );
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
      title={props.title ?? entity.pluralName}
      description={`${all.length} ${all.length === 1 ? entity.name.toLowerCase() : entity.pluralName.toLowerCase()}`}
      action={
        href ? (
          <Link href={href} className="text-[12.5px] text-primary hover:underline">
            View all
          </Link>
        ) : undefined
      }
      contentClassName="px-0"
    >
      {rows.length ? (
        <RecordTable rows={rows} fields={fields} onOpen={openRecord} />
      ) : (
        <div className="px-6">
          <Nothing />
        </div>
      )}
    </PartCard>
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
  fields: ReturnType<typeof getField>[];
  onOpen: (id: string) => void;
  sort?: Sort;
  onSort?: (fieldId: string) => void;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {fields.map((f) => (
            <TableHead key={f.id} className="first:pl-6 last:pr-6">
              {onSort ? (
                <button
                  type="button"
                  onClick={() => onSort(f.id)}
                  className="inline-flex items-center gap-1 hover:text-foreground"
                >
                  {f.name}
                  {sort?.fieldId === f.id ? (
                    <span aria-hidden="true">{sort.dir === "asc" ? "↑" : "↓"}</span>
                  ) : null}
                </button>
              ) : (
                f.name
              )}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.id} className="cursor-pointer" onClick={() => onOpen(r.id)}>
            {fields.map((f) => (
              <TableCell key={f.id} className="max-w-[260px] truncate first:pl-6 last:pr-6">
                <FieldValue field={f} value={r.data[f.id]} />
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
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
    <PartCard
      title={props.title ?? entity.pluralName}
      description={`${all.length} in total`}
      contentClassName="px-3"
    >
      {rows.length ? (
        <ItemGroup>
          {rows.map((r) => {
            const title = recordTitle(entity, r);
            const image = props.imageFieldId ? r.data[props.imageFieldId] : undefined;
            return (
              <Item
                key={r.id}
                size="sm"
                render={<button type="button" onClick={() => openRecord(r.id)} />}
                className="w-full text-left"
              >
                <ItemMedia>
                  <Avatar className="size-8">
                    {isImagePath(image) ? <AvatarImage src={image} alt="" /> : null}
                    <AvatarFallback>{initials(title)}</AvatarFallback>
                  </Avatar>
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>{title}</ItemTitle>
                  {desc ? (
                    <ItemDescription>
                      {valueText(blueprint, records, desc, r.data[desc.id]) || "—"}
                    </ItemDescription>
                  ) : null}
                </ItemContent>
                {badge ? (
                  <ItemActions>
                    <FieldValue field={badge} value={r.data[badge.id]} />
                  </ItemActions>
                ) : null}
              </Item>
            );
          })}
        </ItemGroup>
      ) : (
        <div className="px-3">
          <Nothing />
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
    <PartCard
      title={props.title ?? entity.pluralName}
      description={`${rows.length} ${rows.length === 1 ? entity.name.toLowerCase() : entity.pluralName.toLowerCase()}`}
    >
      {shown.length ? (
        <div className="flex flex-col gap-3">
          <AvatarGroup>
            {shown.map((r) => {
              const image = props.imageFieldId ? r.data[props.imageFieldId] : undefined;
              const name = recordTitle(entity, r);
              return (
                <Avatar key={r.id} title={name}>
                  {isImagePath(image) ? <AvatarImage src={image} alt={name} /> : null}
                  <AvatarFallback>{initials(name)}</AvatarFallback>
                </Avatar>
              );
            })}
            {rows.length > shown.length ? (
              <AvatarGroupCount>+{rows.length - shown.length}</AvatarGroupCount>
            ) : null}
          </AvatarGroup>
          <p className="truncate text-[12.5px] text-muted-foreground">
            {shown.map((r) => recordTitle(entity, r)).join(", ")}
          </p>
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
  const widget = metricWidget(props.title ?? field.name, props as Metric & { op: "count" }, {
    type: "chart",
    metric: { op: "count" },
    chart: { kind: "bar", bucket: "day", groupByFieldId: props.fieldId },
  });
  const { points } = chartData(blueprint, widget, records);
  const tone = (key: string) => field.options?.find((o) => o.id === key)?.tone;
  return (
    <PartCard title={props.title ?? `${entity.pluralName} by ${field.name.toLowerCase()}`}>
      {points.length ? (
        <div className="flex flex-wrap gap-2">
          {points.map((p) => (
            <Badge
              key={p.bucket}
              variant={
                tone(p.bucket) === "danger"
                  ? "destructive"
                  : tone(p.bucket) === "accent" || tone(p.bucket) === "success"
                    ? "default"
                    : "secondary"
              }
              className="gap-1.5"
            >
              {p.label}
              <span className="tabular-nums opacity-80">{formatNumber(Number(p.value ?? 0))}</span>
            </Badge>
          ))}
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

export function CalendarPart({
  props,
}: P<{ title?: string; entityId: string; dateFieldId: string; filter?: string }>) {
  const { blueprint } = useWorkspace();
  const { openRecord } = useRecordPanels();
  const entity = getEntity(blueprint, props.entityId);
  const rows = useRows(props.entityId, props.filter);
  const byDay = useMemo(() => {
    const map = new Map<string, DataRecord[]>();
    for (const r of rows) {
      const start = startOf(r.data[props.dateFieldId]);
      if (!start) continue;
      const key = dateKey(start);
      map.set(key, [...(map.get(key) ?? []), r]);
    }
    return map;
  }, [rows, props.dateFieldId]);
  const [day, setDay] = useState<string>(() => dateKey(new Date()));
  const onDay = byDay.get(day) ?? [];
  return (
    <PartCard title={props.title ?? entity.pluralName} contentClassName="flex flex-col gap-3">
      <Calendar
        mode="single"
        selected={keyToDate(day)}
        onSelect={(d) => d && setDay(dateToKey(d))}
        modifiers={{ busy: [...byDay.keys()].map(keyToDate) }}
        modifiersClassNames={{
          busy: "[&>button]:font-semibold [&>button]:underline [&>button]:decoration-primary [&>button]:decoration-2 [&>button]:underline-offset-4",
        }}
        className="mx-auto rounded-md border p-2"
      />
      <div className="flex flex-col gap-1">
        <p className="text-[12.5px] text-muted-foreground">
          {formatDate(day)} · {onDay.length}{" "}
          {onDay.length === 1 ? entity.name.toLowerCase() : entity.pluralName.toLowerCase()}
        </p>
        {onDay.slice(0, 5).map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => openRecord(r.id)}
            className="truncate rounded-md px-2 py-1 text-left text-[13px] hover:bg-muted"
          >
            {recordTitle(entity, r)}
          </button>
        ))}
      </div>
    </PartCard>
  );
}

export function CarouselPart({
  props,
}: P<{ title?: string; entityId: string; imageFieldId: string; filter?: string; limit: number }>) {
  const { blueprint } = useWorkspace();
  const { openRecord } = useRecordPanels();
  const entity = getEntity(blueprint, props.entityId);
  const rows = useRows(props.entityId, props.filter)
    .filter((r) => isImagePath(r.data[props.imageFieldId]))
    .slice(0, props.limit);
  return (
    <PartCard title={props.title ?? entity.pluralName}>
      {rows.length ? (
        <Carousel opts={{ align: "start" }} className="px-10">
          <CarouselContent>
            {rows.map((r) => (
              <CarouselItem key={r.id} className="basis-1/2 lg:basis-1/3">
                <button
                  type="button"
                  onClick={() => openRecord(r.id)}
                  className="flex w-full flex-col gap-1.5 text-left"
                >
                  {/* biome-ignore lint/performance/noImgElement: uploads are served by our own route */}
                  <img
                    src={String(r.data[props.imageFieldId])}
                    alt=""
                    className="aspect-[4/3] w-full rounded-md border object-cover"
                  />
                  <span className="truncate text-[12.5px]">{recordTitle(entity, r)}</span>
                </button>
              </CarouselItem>
            ))}
          </CarouselContent>
          <CarouselPrevious className="left-0" />
          <CarouselNext className="right-0" />
        </Carousel>
      ) : (
        <Nothing>No pictures yet.</Nothing>
      )}
    </PartCard>
  );
}

"use client";

import { PlusIcon } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { useRecordPanels } from "@/components/records/record-panels";
import { StatusMenu } from "@/components/records/status-menu";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { getEntity, getField, optionOf, recordTitle } from "@/lib/blueprint/lookup";
import type { CalendarView as CalendarConfig, DataRecord, FieldValue } from "@/lib/blueprint/types";
import { applyFilter } from "@/lib/engine/query";
import { formatDate, formatMonth, formatRange, formatTime, isTimeRange } from "@/lib/format";
import { useFreshStore } from "@/lib/motion/fresh";
import { addDays, at, dateKey, daysBetween, startOfMonthKey, todayKey } from "@/lib/time";
import { cn } from "@/lib/utils";
import { DateStepper } from "./date-stepper";
import { ToolbarSummary, ViewToolbar } from "./view-toolbar";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MAX_PER_DAY = 3;
type Mode = "month" | "week" | "day";

const DOT = {
  neutral: "bg-muted-foreground/60",
  accent: "bg-primary",
  success: "bg-primary/70",
  warning: "bg-warning",
  danger: "bg-destructive",
} as const;

function monthShift(key: string, delta: number): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 10);
}
const weekStart = (key: string) => addDays(key, -new Date(`${key}T12:00:00Z`).getUTCDay());

/** Days a record covers. Bookable stays end on checkout day, so that day is excluded. */
function daysOf(value: FieldValue | undefined, exclusiveEnd: boolean): string[] {
  if (isTimeRange(value ?? null)) {
    const range = value as { start: string; end: string };
    const start = dateKey(range.start);
    const end = dateKey(range.end);
    const span = Math.max(0, daysBetween(start, end) - (exclusiveEnd && end > start ? 1 : 0));
    return Array.from({ length: span + 1 }, (_, i) => addDays(start, i));
  }
  return typeof value === "string" && value ? [dateKey(value)] : [];
}

/** A calendar by month, week or day, filtered by status if the record type has one. */
export function CalendarView({ view }: { view: CalendarConfig }) {
  const { blueprint, records } = useWorkspace();
  const { openRecord, openCreate } = useRecordPanels();
  const entity = getEntity(blueprint, view.entityId);
  const dateField = getField(entity, view.dateFieldId);
  const status = entity.fields.find((f) => f.type === "status");
  const fresh = useFreshStore((s) => s.ids);
  const today = todayKey();
  const [mode, setMode] = useState<Mode>("month");
  const [cursor, setCursor] = useState(today);
  // By default cancelled records are hidden; picking a status shows only that one.
  const [statusFilter, setStatusFilter] = useState<string>("active");

  const byDay = useMemo(() => {
    const map = new Map<string, DataRecord[]>();
    for (const r of applyFilter(blueprint, entity, records, view.filter)) {
      const s = status ? r.data[status.id] : undefined;
      if (status && statusFilter === "active" && s === "cancelled") continue;
      if (status && statusFilter !== "active" && statusFilter !== "all" && s !== statusFilter) continue;
      for (const d of daysOf(r.data[dateField.id], !!entity.booking)) map.set(d, [...(map.get(d) ?? []), r]);
    }
    for (const list of map.values())
      list.sort((a, b) =>
        JSON.stringify(a.data[dateField.id]).localeCompare(JSON.stringify(b.data[dateField.id])),
      );
    return map;
  }, [blueprint, entity, records, view.filter, dateField.id, status, statusFilter]);

  const month = startOfMonthKey(cursor);
  const week = weekStart(cursor);
  const shown =
    mode === "month"
      ? (() => {
          const gridStart = addDays(month, -new Date(`${month}T12:00:00Z`).getUTCDay());
          return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
        })()
      : mode === "week"
        ? Array.from({ length: 7 }, (_, i) => addDays(week, i))
        : [cursor];
  const inRange = (d: string) => (mode === "month" ? d.slice(0, 7) === month.slice(0, 7) : true);
  const count = shown.filter(inRange).reduce((n, d) => n + (byDay.get(d)?.length ?? 0), 0);

  const step = (dir: 1 | -1) =>
    setCursor((c) =>
      mode === "month" ? monthShift(startOfMonthKey(c), dir) : addDays(c, dir * (mode === "week" ? 7 : 1)),
    );
  const label =
    mode === "month"
      ? formatMonth(month)
      : mode === "week"
        ? `${formatDate(week)} – ${formatDate(addDays(week, 6))}`
        : new Date(`${cursor}T12:00:00+08:00`).toLocaleDateString("en-PH", {
            weekday: "long",
            month: "short",
            day: "numeric",
            timeZone: "Asia/Manila",
          });
  const isCurrent =
    mode === "month"
      ? month === startOfMonthKey(today)
      : mode === "week"
        ? week === weekStart(today)
        : cursor === today;

  const prefillFor = (day: string) => {
    if (dateField.type === "time_range")
      return {
        [dateField.id]:
          dateField.range === "dates"
            ? { start: day, end: addDays(day, 1) }
            : { start: at(day, "09:00"), end: at(day, "10:00") },
      };
    return { [dateField.id]: day };
  };
  const timeOf = (r: DataRecord) => {
    const value = r.data[dateField.id];
    return isTimeRange(value ?? null) && dateField.range !== "dates"
      ? formatTime((value as { start: string }).start)
      : null;
  };
  const chip = (r: DataRecord) => {
    const option = status ? optionOf(status, r.data[status.id]) : undefined;
    const time = timeOf(r);
    return (
      <button
        key={r.id}
        type="button"
        onClick={() => openRecord(r.id)}
        className={cn(
          "flex min-w-0 items-center gap-1.5 rounded-sm px-1 py-0.5 text-left text-[12px] outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50",
          fresh[r.id] && "animate-flash",
        )}
      >
        <span
          aria-hidden="true"
          className={cn("size-1.5 shrink-0 rounded-full", DOT[option?.tone ?? "accent"])}
        />
        {time ? (
          <span className="shrink-0 font-mono text-[11px] text-muted-foreground tabular">{time}</span>
        ) : null}
        <span className="truncate">{recordTitle(entity, r)}</span>
      </button>
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ViewToolbar>
        <DateStepper
          label={label}
          onPrev={() => step(-1)}
          onNext={() => step(1)}
          onToday={() => setCursor(today)}
          isToday={isCurrent}
        />
        <fieldset
          aria-label="Calendar range"
          className="ml-2 flex border-0 items-center rounded-md bg-muted p-0.5"
        >
          {(["month", "week", "day"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
              className={cn(
                "h-6 rounded px-2.5 text-[12px] capitalize text-muted-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50",
                mode === m && "bg-background text-foreground shadow-sm",
              )}
            >
              {m}
            </button>
          ))}
        </fieldset>
        {status?.options?.length ? (
          <select
            aria-label={`Filter by ${status.name.toLowerCase()}`}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-7 rounded-md border bg-transparent px-2 text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <option value="active">All but cancelled</option>
            <option value="all">Everything</option>
            {status.options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label} only
              </option>
            ))}
          </select>
        ) : null}
        <ToolbarSummary>
          {count} {count === 1 ? entity.name.toLowerCase() : entity.pluralName.toLowerCase()}
        </ToolbarSummary>
      </ViewToolbar>

      {mode === "day" ? (
        <DayAgenda
          items={byDay.get(cursor) ?? []}
          entityName={entity.name}
          onAdd={() => openCreate(entity.id, prefillFor(cursor))}
          render={(r) => {
            const value = r.data[dateField.id];
            return (
              <li
                key={r.id}
                className={cn("flex items-center gap-4 px-5 py-3", fresh[r.id] && "animate-flash")}
              >
                <span className="w-36 shrink-0 font-mono text-[12.5px] text-muted-foreground tabular">
                  {isTimeRange(value ?? null) && dateField.range !== "dates"
                    ? formatRange(value as { start: string; end: string })
                    : "All day"}
                </span>
                <button
                  type="button"
                  onClick={() => openRecord(r.id)}
                  className="min-w-0 flex-1 truncate text-left text-[13.5px] font-medium outline-none hover:underline focus-visible:underline"
                >
                  {recordTitle(entity, r)}
                </button>
                {status ? <StatusMenu record={r} field={status} /> : null}
              </li>
            );
          }}
        />
      ) : (
        <>
          <div className="grid shrink-0 grid-cols-7 border-b">
            {shown.slice(0, 7).map((d, i) => (
              <div key={d} className="px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground">
                {WEEKDAYS[i]}
                {mode === "week" ? (
                  <span className="ml-1 font-mono tabular">{Number(d.slice(8))}</span>
                ) : null}
              </div>
            ))}
          </div>
          <div
            className={cn(
              "grid min-h-0 flex-1 grid-cols-7 overflow-y-auto",
              mode === "month" ? "auto-rows-[minmax(104px,1fr)]" : "auto-rows-[minmax(420px,1fr)]",
            )}
          >
            {shown.map((d) => {
              const items = byDay.get(d) ?? [];
              const limit = mode === "month" ? MAX_PER_DAY : items.length;
              return (
                <div
                  key={d}
                  className={cn(
                    "group/day flex min-w-0 flex-col gap-0.5 border-b border-r p-1.5",
                    !inRange(d) && "bg-muted/25",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => openCreate(entity.id, prefillFor(d))}
                    aria-label={`Add on ${d}`}
                    className="flex items-center justify-between rounded-sm px-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                  >
                    <span
                      className={cn(
                        "flex size-6 items-center justify-center rounded-full font-mono text-[11.5px] tabular",
                        d === today
                          ? "bg-primary font-semibold text-primary-foreground"
                          : inRange(d)
                            ? "text-foreground"
                            : "text-muted-foreground/60",
                      )}
                    >
                      {Number(d.slice(8))}
                    </span>
                    <span className="text-[11px] text-muted-foreground opacity-0 transition-opacity group-hover/day:opacity-100">
                      + Add
                    </span>
                  </button>
                  {items.slice(0, limit).map(chip)}
                  {items.length > limit ? (
                    <button
                      type="button"
                      onClick={() => {
                        setCursor(d);
                        setMode("day");
                      }}
                      className="px-1 text-left text-[11px] text-muted-foreground hover:text-foreground"
                    >
                      {items.length - limit} more
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function DayAgenda({
  items,
  entityName,
  onAdd,
  render,
}: {
  items: DataRecord[];
  entityName: string;
  onAdd: () => void;
  render: (r: DataRecord) => React.ReactNode;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {items.length ? (
        <ul className="divide-y">{items.map(render)}</ul>
      ) : (
        <p className="px-5 py-10 text-center text-[13px] text-muted-foreground">Nothing on this day.</p>
      )}
      <div className="px-5 py-3">
        <Button size="sm" variant="outline" onClick={onAdd}>
          <PlusIcon data-icon="inline-start" />
          New {entityName.toLowerCase()}
        </Button>
      </div>
    </div>
  );
}

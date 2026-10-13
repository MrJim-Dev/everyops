"use client";

import { useMemo, useState } from "react";
import { useRecordPanels } from "@/components/records/record-panels";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { getEntity, getField, optionOf, recordTitle } from "@/lib/blueprint/lookup";
import type { CalendarView as CalendarConfig, DataRecord, FieldValue } from "@/lib/blueprint/types";
import { applyFilter } from "@/lib/engine/query";
import { formatMonth, formatTime, isTimeRange } from "@/lib/format";
import { addDays, at, dateKey, daysBetween, startOfMonthKey, todayKey } from "@/lib/time";
import { cn } from "@/lib/utils";
import { DateStepper } from "./date-stepper";
import { ToolbarSummary, ViewToolbar } from "./view-toolbar";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MAX_PER_DAY = 3;

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

export function CalendarView({ view }: { view: CalendarConfig }) {
  const { blueprint, records } = useWorkspace();
  const { openRecord, openCreate } = useRecordPanels();
  const entity = getEntity(blueprint, view.entityId);
  const dateField = getField(entity, view.dateFieldId);
  const status = entity.fields.find((f) => f.type === "status");
  const today = todayKey();
  const [month, setMonth] = useState(startOfMonthKey(today));

  const byDay = useMemo(() => {
    const map = new Map<string, DataRecord[]>();
    for (const r of applyFilter(blueprint, entity, records, view.filter)) {
      if (status && r.data[status.id] === "cancelled") continue;
      for (const d of daysOf(r.data[dateField.id], !!entity.booking)) map.set(d, [...(map.get(d) ?? []), r]);
    }
    for (const list of map.values())
      list.sort((a, b) =>
        JSON.stringify(a.data[dateField.id]).localeCompare(JSON.stringify(b.data[dateField.id])),
      );
    return map;
  }, [blueprint, entity, records, view.filter, dateField.id, status]);

  const first = new Date(`${month}T12:00:00Z`).getUTCDay();
  const gridStart = addDays(month, -first);
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const inMonth = (d: string) => d.slice(0, 7) === month.slice(0, 7);
  const monthCount = days.filter(inMonth).reduce((n, d) => n + (byDay.get(d)?.length ?? 0), 0);

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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ViewToolbar>
        <DateStepper
          label={formatMonth(month)}
          onPrev={() => setMonth((m) => monthShift(m, -1))}
          onNext={() => setMonth((m) => monthShift(m, 1))}
          onToday={() => setMonth(startOfMonthKey(today))}
          isToday={month === startOfMonthKey(today)}
        />
        <ToolbarSummary>
          {monthCount} in {formatMonth(month).split(" ")[0]}
        </ToolbarSummary>
      </ViewToolbar>
      <div className="grid shrink-0 grid-cols-7 border-b">
        {WEEKDAYS.map((d) => (
          <div key={d} className="px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground">
            {d}
          </div>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 auto-rows-[minmax(104px,1fr)] grid-cols-7 overflow-y-auto">
        {days.map((d) => {
          const items = byDay.get(d) ?? [];
          const isToday = d === today;
          return (
            <div
              key={d}
              className={cn(
                "group/day flex min-w-0 flex-col gap-0.5 border-b border-r p-1.5",
                !inMonth(d) && "bg-muted/25",
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
                    isToday
                      ? "bg-primary font-semibold text-primary-foreground"
                      : inMonth(d)
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
              {items.slice(0, MAX_PER_DAY).map((r) => {
                const option = status ? optionOf(status, r.data[status.id]) : undefined;
                const value = r.data[dateField.id];
                const time =
                  isTimeRange(value ?? null) && dateField.range !== "dates"
                    ? formatTime((value as { start: string }).start)
                    : null;
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => openRecord(r.id)}
                    className="flex min-w-0 items-center gap-1.5 rounded-sm px-1 py-0.5 text-left text-[12px] outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50"
                  >
                    <span
                      aria-hidden="true"
                      className={cn("size-1.5 shrink-0 rounded-full", DOT[option?.tone ?? "accent"])}
                    />
                    {time ? (
                      <span className="shrink-0 font-mono text-[11px] text-muted-foreground tabular">
                        {time}
                      </span>
                    ) : null}
                    <span className="truncate">{recordTitle(entity, r)}</span>
                  </button>
                );
              })}
              {items.length > MAX_PER_DAY ? (
                <span className="px-1 text-[11px] text-muted-foreground">
                  {items.length - MAX_PER_DAY} more
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

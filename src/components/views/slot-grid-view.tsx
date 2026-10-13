"use client";

import { PlusIcon } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { useRecordPanels } from "@/components/records/record-panels";
import { StatusBadge } from "@/components/records/status-badge";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { getEntity, getField, optionOf, recordsOf, recordTitle } from "@/lib/blueprint/lookup";
import type { SlotGridView as SlotGridConfig, TimeRange } from "@/lib/blueprint/types";
import { formatDate, formatRange, formatTime, isTimeRange } from "@/lib/format";
import { addDays, at, dateKey, hhmm, manilaParts, minutesOf, todayKey } from "@/lib/time";
import { cn } from "@/lib/utils";
import { DateStepper } from "./date-stepper";
import { ToolbarSummary, ViewToolbar } from "./view-toolbar";

const ROW = 44; // px per slot; also the touch target for staff tablets.

const TONE_BAR = {
  neutral: "bg-muted-foreground/40",
  accent: "bg-primary",
  success: "bg-primary/70",
  warning: "bg-warning",
  danger: "bg-destructive",
} as const;

export function SlotGridView({ view }: { view: SlotGridConfig }) {
  const { blueprint, records } = useWorkspace();
  const { openRecord, openCreate } = useRecordPanels();
  const entity = getEntity(blueprint, view.entityId);
  const booking = entity.booking;
  if (!booking) throw new Error(`${entity.name} has no booking settings`);
  const resourceField = getField(entity, booking.resourceFieldId);
  const resourceEntity = getEntity(blueprint, resourceField.relation?.entityId ?? "");
  const config = resourceEntity.resource ?? { opensAt: "08:00", closesAt: "20:00", slotMinutes: 60 };
  const status = getField(entity, booking.statusFieldId);

  const today = todayKey();
  const [day, setDay] = useState(today);
  const opens = minutesOf(config.opensAt);
  const closes = minutesOf(config.closesAt);
  const step = config.slotMinutes;
  const slots = useMemo(() => {
    const list: number[] = [];
    for (let m = opens; m + step <= closes; m += step) list.push(m);
    return list;
  }, [opens, closes, step]);

  const resources = useMemo(
    () =>
      recordsOf(records, resourceEntity.id).sort((a, b) =>
        recordTitle(resourceEntity, a).localeCompare(recordTitle(resourceEntity, b), undefined, {
          numeric: true,
        }),
      ),
    [records, resourceEntity],
  );
  const bookings = useMemo(
    () =>
      recordsOf(records, entity.id).filter((r) => {
        const range = r.data[booking.timeFieldId];
        return (
          isTimeRange(range) && dateKey(range.start) === day && r.data[booking.statusFieldId] !== "cancelled"
        );
      }),
    [records, entity.id, booking, day],
  );
  const unpaid = bookings.filter((b) => optionOf(status, b.data[status.id])?.tone === "warning").length;

  const now = new Date();
  const nowParts = manilaParts(now);
  const nowMinutes = nowParts.hour * 60 + nowParts.minute;
  const isToday = day === today;
  const isPast = (minute: number) => day < today || (isToday && minute + step <= nowMinutes);
  const offset = (iso: string) => {
    const p = manilaParts(iso);
    return ((p.hour * 60 + p.minute - opens) / step) * ROW;
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ViewToolbar>
        <DateStepper
          label={formatDate(day, { withYear: true })}
          onPrev={() => setDay((d) => addDays(d, -1))}
          onNext={() => setDay((d) => addDays(d, 1))}
          onToday={() => setDay(today)}
          isToday={isToday}
        />
        <ToolbarSummary>
          {bookings.length} {bookings.length === 1 ? "booking" : "bookings"}
          {unpaid ? ` · ${unpaid} unpaid` : ""}
        </ToolbarSummary>
      </ViewToolbar>

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="min-w-fit">
          <div className="sticky top-0 z-20 flex border-b bg-background">
            <div className="w-[76px] shrink-0" />
            {resources.map((r) => (
              <div
                key={r.id}
                className="min-w-[160px] flex-1 border-l px-3 py-2 text-center text-[12px] font-medium"
              >
                {recordTitle(resourceEntity, r)}
              </div>
            ))}
          </div>

          <div className="relative flex">
            <div className="w-[76px] shrink-0">
              {slots.map((m) => (
                <div
                  key={m}
                  style={{ height: ROW }}
                  className="flex items-start justify-end whitespace-nowrap pr-3 pt-1.5 text-[11.5px] text-muted-foreground tabular"
                >
                  {formatTime(at(day, hhmm(m)))}
                </div>
              ))}
            </div>

            {resources.map((resource) => {
              const own = bookings.filter((b) => b.data[booking.resourceFieldId] === resource.id);
              return (
                <div key={resource.id} className="relative min-w-[160px] flex-1 border-l">
                  {slots.map((m) => {
                    const range: TimeRange = { start: at(day, hhmm(m)), end: at(day, hhmm(m + step)) };
                    const taken = own.some((b) => {
                      const r = b.data[booking.timeFieldId] as TimeRange;
                      return (
                        Date.parse(r.start) < Date.parse(range.end) &&
                        Date.parse(range.start) < Date.parse(r.end)
                      );
                    });
                    const past = isPast(m);
                    return (
                      <div
                        key={m}
                        style={{ height: ROW }}
                        className={cn("border-b border-border/60", past && "bg-muted/30")}
                      >
                        {!taken && !past ? (
                          <button
                            type="button"
                            aria-label={`Book ${recordTitle(resourceEntity, resource)} at ${formatTime(range.start)}`}
                            onClick={() =>
                              openCreate(entity.id, {
                                [booking.resourceFieldId]: resource.id,
                                [booking.timeFieldId]: range,
                              })
                            }
                            className="group/slot flex size-full items-center justify-center rounded-md text-[12px] text-muted-foreground opacity-0 outline-none transition-opacity duration-150 hover:bg-muted/60 hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50"
                          >
                            <PlusIcon className="mr-1 size-3" />
                            Book
                          </button>
                        ) : null}
                      </div>
                    );
                  })}

                  {own.map((b) => {
                    const range = b.data[booking.timeFieldId] as TimeRange;
                    const option = optionOf(status, b.data[status.id]);
                    const top = offset(range.start);
                    const height = offset(range.end) - top;
                    return (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() => openRecord(b.id)}
                        style={{ top: top + 2, height: height - 4 }}
                        className="absolute inset-x-1.5 flex overflow-hidden rounded-md border bg-card text-left outline-none transition-[border-color,transform] duration-150 hover:border-foreground/25 focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.98]"
                      >
                        <span
                          aria-hidden="true"
                          className={cn("w-[3px] shrink-0", TONE_BAR[option?.tone ?? "neutral"])}
                        />
                        <span className="flex min-w-0 flex-1 items-center gap-2 px-2.5">
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[12.5px] font-medium">
                              {recordTitle(entity, b)}
                            </span>
                            <span className="block truncate text-[11.5px] text-muted-foreground tabular">
                              {formatRange(range)}
                            </span>
                          </span>
                          {option && option.tone === "warning" ? (
                            <StatusBadge label={option.label} tone={option.tone} className="text-[11px]" />
                          ) : null}
                        </span>
                      </button>
                    );
                  })}
                </div>
              );
            })}

            {isToday && nowMinutes >= opens && nowMinutes <= closes ? (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute right-0 left-[70px] z-10 flex items-center"
                style={{ top: ((nowMinutes - opens) / step) * ROW }}
              >
                <span className="size-1.5 rounded-full bg-primary" />
                <span className="h-px flex-1 bg-primary/70" />
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <p className="shrink-0 border-t px-5 py-2 text-[12px] text-muted-foreground">
        Click a free slot to book it. Double bookings are blocked automatically.
      </p>
    </div>
  );
}

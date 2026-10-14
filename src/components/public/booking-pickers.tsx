"use client";

import { CaretLeftIcon, CaretRightIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import type { FieldValue } from "@/lib/blueprint/types";
import { formatDate, formatMonth, formatRange, formatTime, isTimeRange } from "@/lib/format";
import type { PublicForm } from "@/lib/public/resolve";
import { type DayFree, nextRange, nextStay, type Slot } from "@/lib/public/slots";
import { addDays, dateKey, daysBetween, hoursBetween, todayKey } from "@/lib/time";
import { cn } from "@/lib/utils";

type Booking = NonNullable<PublicForm["booking"]>;
type Range = { start: string; end: string };

/** Pressable cells: instant colour feedback and a slight press, never longer than 160 ms (Emil Kowalski's rules). */
const press =
  "outline-none transition-[transform,background-color,border-color,color] duration-150 ease-(--ease-out-strong) focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.97] motion-reduce:active:scale-100 disabled:active:scale-100";

/**
 * How a public booking form picks when, in the layout the business chose: a strip of days, one day as a grid of
 * every resource (courts side by side), or a month calendar. Bookings of whole days pick a stay on the calendar.
 */
export function BookingPicker(props: {
  slug: string;
  viewId: string;
  booking: Booking;
  resourceId: string;
  value: FieldValue | undefined;
  error?: string;
  preview?: boolean;
  onChange: (v: FieldValue) => void;
  /** The grid picks the resource too (a court is a column). */
  onResource: (id: string) => void;
}) {
  const { booking } = props;
  if (booking.dates) return <StayCalendar {...props} />;
  if (booking.layout === "grid") return <ResourceGrid {...props} />;
  return <DaySlots {...props} month={booking.layout === "month"} />;
}

const pickedRange = (value: FieldValue | undefined) => (isTimeRange(value ?? null) ? (value as Range) : null);

function hoursText(range: Range) {
  const h = Math.round(hoursBetween(range.start, range.end) * 100) / 100;
  return h === 1 ? "1 hour" : `${h} hours`;
}

/** The slots of one resource on one day, refetched when either changes. */
function useSlots(slug: string, viewId: string, resourceIds: string[], day: string, preview?: boolean) {
  const [slots, setSlots] = useState<Record<string, Slot[]> | null>(null);
  const [loading, setLoading] = useState(false);
  const key = resourceIds.join(",");
  useEffect(() => {
    const ids = key ? key.split(",") : [];
    if (!ids.length || preview) return setSlots(null);
    let live = true;
    setLoading(true);
    Promise.all(
      ids.map((id) =>
        fetch(`/api/public/${slug}/${viewId}/slots?resource=${encodeURIComponent(id)}&date=${day}`, {
          cache: "no-store",
        })
          .then((r) => r.json())
          .then((b: { ok: boolean; slots?: Slot[] }) => [id, b.ok ? (b.slots ?? []) : []] as const)
          .catch(() => [id, [] as Slot[]] as const),
      ),
    )
      .then((all) => live && setSlots(Object.fromEntries(all)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [slug, viewId, key, day, preview]);
  return { slots, loading };
}

function Frame({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-2 flex flex-col gap-3 rounded-lg border p-3">
      <div className="flex min-h-8 items-center justify-between gap-3">
        <span className="text-[13px] font-medium">{title}</span>
        {aside}
      </div>
      {children}
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="text-[12.5px] text-muted-foreground">{children}</p>;
}

function Summary({ picked, multiple, unit }: { picked: Range | null; multiple: boolean; unit?: string }) {
  return (
    <p className="text-[12.5px] text-muted-foreground" aria-live="polite">
      {picked ? (
        <>
          <span className="text-foreground">
            {unit ? `${unit} · ` : ""}
            {formatDate(picked.start)} · {formatRange(picked)}
          </span>{" "}
          · {hoursText(picked)}
          {multiple ? ". Tap the next time to add more." : ""}
        </>
      ) : multiple ? (
        "Tap a start time. Tap the times after it to book longer."
      ) : (
        "Tap a time to book it."
      )}
    </p>
  );
}

/** A date box: picks any day from today, including days past what's on screen. */
function DateBox({ day, onPick }: { day: string; onPick: (d: string) => void }) {
  return (
    <Input
      type="date"
      aria-label="Date"
      min={todayKey()}
      value={day}
      onChange={(e) => /^\d{4}-\d{2}-\d{2}$/.test(e.target.value) && onPick(e.target.value)}
      className="h-8 w-auto text-[13px]"
    />
  );
}

function SlotButtons({
  slots,
  picked,
  onPick,
}: {
  slots: Slot[];
  picked: Range | null;
  onPick: (s: Slot) => void;
}) {
  const inPicked = (s: Slot) =>
    !!picked &&
    Date.parse(s.start) >= Date.parse(picked.start) &&
    Date.parse(s.end) <= Date.parse(picked.end);
  return (
    <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
      {slots.map((s) => {
        const on = inPicked(s);
        return (
          <button
            key={s.start}
            type="button"
            disabled={!s.free}
            aria-pressed={on}
            onClick={() => onPick(s)}
            className={cn(
              press,
              "rounded-md border px-2 py-2 font-mono text-[12.5px] tabular disabled:cursor-not-allowed disabled:opacity-35 disabled:line-through",
              on ? "border-primary bg-primary text-primary-foreground" : "hover:border-foreground/30",
            )}
          >
            {formatTime(s.start)}
          </button>
        );
      })}
    </div>
  );
}

/** "days": a strip of two weeks, or "month": a month calendar; then the picked day's times. */
function DaySlots({
  slug,
  viewId,
  booking,
  resourceId,
  value,
  error,
  preview,
  onChange,
  month,
}: Parameters<typeof BookingPicker>[0] & { month: boolean }) {
  const today = todayKey();
  const picked = pickedRange(value);
  const pickedDay = picked ? dateKey(picked.start) : null;
  const [day, setDay] = useState(() => pickedDay ?? today);
  const [from, setFrom] = useState(() => (pickedDay && pickedDay > addDays(today, 13) ? pickedDay : today));
  const { slots, loading } = useSlots(slug, viewId, resourceId ? [resourceId] : [], day, preview);
  const list = slots?.[resourceId] ?? null;
  const pickDay = (d: string) => {
    if (d < today || d === day) return;
    setDay(d);
    if (d < from || d > addDays(from, 13)) setFrom(d);
    onChange(null);
  };
  const choose = (s: Slot) =>
    onChange(nextRange(pickedDay === day ? picked : null, s, list ?? [], booking.multiple));

  return (
    <Frame title="Day and time *" aside={month ? null : <DateBox day={day} onPick={pickDay} />}>
      {month ? (
        <MonthGrid selected={{ start: day, end: day }} onPick={pickDay} />
      ) : (
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {Array.from({ length: 14 }, (_, i) => addDays(from, i)).map((d) => {
            const date = new Date(`${d}T12:00:00+08:00`);
            return (
              <button
                key={d}
                type="button"
                aria-pressed={d === day}
                aria-label={formatDate(d)}
                onClick={() => pickDay(d)}
                className={cn(
                  press,
                  "flex w-14 shrink-0 flex-col items-center rounded-md border py-1.5 text-[12px]",
                  d === day
                    ? "border-primary bg-primary/15 text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span>{date.toLocaleDateString("en-PH", { weekday: "short", timeZone: "Asia/Manila" })}</span>
                <span className="font-mono text-[14px] tabular text-foreground">{Number(d.slice(8))}</span>
              </button>
            );
          })}
        </div>
      )}
      {!resourceId ? (
        <Note>Choose a court first to see open times.</Note>
      ) : preview ? (
        <Note>Open times show on the public page.</Note>
      ) : loading && !list ? (
        <Note>Checking open times…</Note>
      ) : list?.some((s) => s.free) ? (
        <>
          {month ? <p className="text-[13px] font-medium">{formatDate(day)}</p> : null}
          <SlotButtons slots={list} picked={pickedDay === day ? picked : null} onPick={choose} />
          <Summary picked={pickedDay === day ? picked : null} multiple={booking.multiple} />
        </>
      ) : (
        <Note>No open times on {day === today ? "today" : "this day"}. Try another day.</Note>
      )}
      {error ? <p className="text-[12.5px] text-destructive">{error}</p> : null}
    </Frame>
  );
}

/** "grid": one day with every resource side by side; a cell is one resource at one time. */
function ResourceGrid({
  slug,
  viewId,
  booking,
  resourceId,
  value,
  error,
  preview,
  onChange,
  onResource,
}: Parameters<typeof BookingPicker>[0]) {
  const today = todayKey();
  const picked = pickedRange(value);
  const [day, setDay] = useState(() => (picked ? dateKey(picked.start) : today));
  const ids = booking.resources.map((r) => r.id);
  const { slots, loading } = useSlots(slug, viewId, ids, day, preview);
  const pickDay = (d: string) => {
    if (d < today || d === day) return;
    setDay(d);
    onChange(null);
  };
  const times = [...new Set(Object.values(slots ?? {}).flatMap((list) => list.map((s) => s.start)))].sort();
  const choose = (id: string, s: Slot) => {
    const same = id === resourceId && picked && dateKey(picked.start) === day;
    if (id !== resourceId) onResource(id);
    onChange(nextRange(same ? picked : null, s, slots?.[id] ?? [], booking.multiple));
  };
  const unit = booking.resources.find((r) => r.id === resourceId)?.title;

  return (
    <Frame
      title="Pick a court and time *"
      aside={
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Previous day"
            disabled={day <= today}
            onClick={() => pickDay(addDays(day, -1))}
            className={cn(press, "grid size-8 place-items-center rounded-md border disabled:opacity-35")}
          >
            <CaretLeftIcon className="size-3.5" />
          </button>
          <DateBox day={day} onPick={pickDay} />
          <button
            type="button"
            aria-label="Next day"
            onClick={() => pickDay(addDays(day, 1))}
            className={cn(press, "grid size-8 place-items-center rounded-md border")}
          >
            <CaretRightIcon className="size-3.5" />
          </button>
        </div>
      }
    >
      {preview ? (
        <Note>Open times show on the public page.</Note>
      ) : loading && !slots ? (
        <Note>Checking open times…</Note>
      ) : !times.length ? (
        <Note>No open times on {day === today ? "today" : "this day"}. Try another day.</Note>
      ) : (
        <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <table className="w-full min-w-[420px] border-separate border-spacing-1 text-[12px]">
            <thead>
              <tr>
                <th className="w-20 text-left text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                  Time
                </th>
                {booking.resources.map((r) => (
                  <th
                    key={r.id}
                    className={cn(
                      "rounded-md border py-1.5 text-[11px] font-medium tracking-wide uppercase transition-colors duration-150",
                      r.id === resourceId && picked
                        ? "border-primary/60 text-foreground"
                        : "text-muted-foreground",
                    )}
                  >
                    {r.title}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {times.map((start) => (
                <tr key={start}>
                  <td className="pr-1 font-mono text-[11.5px] whitespace-nowrap text-muted-foreground tabular">
                    {formatTime(start)}
                  </td>
                  {booking.resources.map((r) => {
                    const s = slots?.[r.id]?.find((x) => x.start === start);
                    const on =
                      !!s &&
                      r.id === resourceId &&
                      !!picked &&
                      Date.parse(s.start) >= Date.parse(picked.start) &&
                      Date.parse(s.end) <= Date.parse(picked.end);
                    return (
                      <td key={r.id} className="p-0">
                        <button
                          type="button"
                          disabled={!s?.free}
                          aria-pressed={on}
                          aria-label={`${r.title} ${formatTime(start)}${s?.free ? "" : " booked"}`}
                          onClick={() => s && choose(r.id, s)}
                          className={cn(
                            press,
                            "h-9 w-full rounded-md border text-[11.5px] font-medium disabled:cursor-not-allowed",
                            on
                              ? "border-primary bg-primary text-primary-foreground"
                              : s?.free
                                ? "border-primary/25 bg-primary/[0.06] text-primary hover:border-primary/60"
                                : "bg-muted/40 text-muted-foreground/70",
                          )}
                        >
                          {on ? "Selected" : s?.free ? "Open" : s ? "Booked" : "—"}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-muted-foreground">
        <Legend className="border-primary/25 bg-primary/[0.06]" label="Open" />
        <Legend className="border-primary bg-primary" label="Selected" />
        <Legend className="bg-muted/40" label="Booked" />
      </div>
      <Summary
        picked={picked && dateKey(picked.start) === day ? picked : null}
        multiple={booking.multiple}
        unit={unit}
      />
      {error ? <p className="text-[12.5px] text-destructive">{error}</p> : null}
    </Frame>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden="true" className={cn("size-2.5 rounded-[3px] border", className)} />
      {label}
    </span>
  );
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** A month of days to tap. Days before today can't be picked; taken days show struck through. */
function MonthGrid({
  selected,
  draft,
  taken,
  onPick,
}: {
  selected: { start: string; end: string } | null;
  draft?: string;
  taken?: (day: string) => boolean;
  onPick: (day: string) => void;
}) {
  const today = todayKey();
  const [month, setMonth] = useState(() => (selected?.start ?? today).slice(0, 7));
  const first = `${month}-01`;
  const lead = new Date(`${first}T12:00:00+08:00`).getUTCDay();
  const length = daysBetween(first, `${addDays(first, 31).slice(0, 7)}-01`);
  const shift = (n: number) => {
    const d = new Date(`${first}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + n);
    setMonth(d.toISOString().slice(0, 7));
  };
  const inRange = (d: string) => !!selected && d >= selected.start && d <= selected.end;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <button
          type="button"
          aria-label="Previous month"
          disabled={month <= today.slice(0, 7)}
          onClick={() => shift(-1)}
          className={cn(press, "grid size-8 place-items-center rounded-md disabled:opacity-35")}
        >
          <CaretLeftIcon className="size-3.5" />
        </button>
        <span className="text-[13.5px] font-medium">{formatMonth(first)}</span>
        <button
          type="button"
          aria-label="Next month"
          onClick={() => shift(1)}
          className={cn(press, "grid size-8 place-items-center rounded-md")}
        >
          <CaretRightIcon className="size-3.5" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-muted-foreground">
        {WEEKDAYS.map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: lead }, (_, i) => addDays(first, i - lead)).map((d) => (
          <span key={d} />
        ))}
        {Array.from({ length }, (_, i) => addDays(first, i)).map((d) => {
          const past = d < today;
          const isTaken = !past && !!taken?.(d);
          const ends = d === selected?.start || d === selected?.end || d === draft;
          const between = inRange(d) && !ends;
          return (
            <button
              key={d}
              type="button"
              disabled={past}
              aria-pressed={ends || between}
              aria-label={`${formatDate(d)}${isTaken ? ", booked" : ""}`}
              onClick={() => onPick(d)}
              className={cn(
                press,
                "h-10 rounded-md border font-mono text-[13px] tabular disabled:cursor-not-allowed disabled:opacity-30",
                ends
                  ? "border-primary bg-primary text-primary-foreground"
                  : between
                    ? "border-primary/30 bg-primary/15"
                    : isTaken
                      ? "text-muted-foreground line-through"
                      : "hover:border-foreground/30",
                d === today && !ends && "border-foreground/40",
              )}
            >
              {Number(d.slice(8))}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Whole-day bookings (stays, rentals): tap check-in, then check-out, on a month calendar with taken nights. */
function StayCalendar({
  slug,
  viewId,
  resourceId,
  value,
  error,
  preview,
  onChange,
}: Parameters<typeof BookingPicker>[0]) {
  const picked = pickedRange(value);
  const [draft, setDraft] = useState<string | null>(null);
  const [days, setDays] = useState<DayFree[]>([]);
  useEffect(() => {
    if (!resourceId || preview) return setDays([]);
    let live = true;
    fetch(
      `/api/public/${slug}/${viewId}/days?resource=${encodeURIComponent(resourceId)}&from=${todayKey()}&count=92`,
      {
        cache: "no-store",
      },
    )
      .then((r) => r.json())
      .then((b: { ok: boolean; days?: DayFree[] }) => live && setDays(b.ok ? (b.days ?? []) : []))
      .catch(() => live && setDays([]));
    return () => {
      live = false;
    };
  }, [slug, viewId, resourceId, preview]);
  const taken = (d: string) => days.find((x) => x.day === d)?.free === false;
  const pick = (d: string) => {
    const next = nextStay(draft ? { start: draft, end: "" } : null, d, days);
    if (!next) {
      setDraft(null);
      return onChange(null);
    }
    if (!next.end) {
      setDraft(next.start);
      return onChange(null);
    }
    setDraft(null);
    onChange(next);
  };
  const nights = picked ? daysBetween(dateKey(picked.start), dateKey(picked.end)) : 0;
  return (
    <Frame title="Dates *">
      {!resourceId ? <Note>Choose what you're booking first to see open dates.</Note> : null}
      <MonthGrid
        selected={picked ? { start: dateKey(picked.start), end: dateKey(picked.end) } : null}
        draft={draft ?? undefined}
        taken={taken}
        onPick={pick}
      />
      <p className="text-[12.5px] text-muted-foreground" aria-live="polite">
        {picked ? (
          <>
            <span className="text-foreground">
              {formatDate(picked.start)} → {formatDate(picked.end)}
            </span>{" "}
            · {nights} {nights === 1 ? "night" : "nights"}
          </>
        ) : draft ? (
          `Check-in ${formatDate(draft)}. Now tap your check-out day.`
        ) : (
          "Tap your check-in day, then your check-out day. Struck-through days are taken."
        )}
      </p>
      {error ? <p className="text-[12.5px] text-destructive">{error}</p> : null}
    </Frame>
  );
}

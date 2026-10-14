"use client";

import { ArrowLeftIcon, ArrowRightIcon, CheckCircleIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { StepIndicator } from "@/components/forms/step-indicator";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { FieldValue } from "@/lib/blueprint/types";
import { formatDate, formatRange, formatTime, isTimeRange } from "@/lib/format";
import type { PublicField, PublicForm } from "@/lib/public/resolve";
import type { Slot } from "@/lib/public/slots";
import { addDays, at, dateKey, todayKey } from "@/lib/time";
import { cn } from "@/lib/utils";

type Done = { reference: string; title: string; summary: { name: string; text: string }[] };

const selectClass =
  "h-9 w-full rounded-md border bg-transparent px-2.5 text-[14px] outline-none focus-visible:ring-2 focus-visible:ring-ring/50 aria-invalid:border-destructive";

/** A public form: what a visitor fills in to book or send a request. Booking forms pick a free slot. */
export function PublicFormView({
  form,
  slug,
  preview,
}: {
  form: PublicForm;
  slug: string;
  preview?: boolean;
}) {
  const [values, setValues] = useState<Record<string, FieldValue>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const [website, setWebsite] = useState("");
  const [step, setStep] = useState(0);
  const set = (id: string, v: FieldValue) => {
    setValues((s) => ({ ...s, [id]: v }));
    setErrors((e) => ({ ...e, [id]: "" }));
  };
  const booking = form.booking;
  const steps = form.steps;
  const titles = steps ? [...steps.map((s) => s.title), ...(form.review ? ["Review"] : [])] : [];
  const reviewing = !!steps && step === steps.length;
  const last = !steps || step === titles.length - 1;
  const shown = steps && !reviewing ? new Set(steps[step].fieldIds) : null;
  const missingOf = (ids?: Set<string>) =>
    Object.fromEntries(
      form.fields
        .filter((f) => (!ids || ids.has(f.id)) && f.required && isEmpty(values[f.id]))
        .map((f) => [
          f.id,
          booking && f.id === booking.timeFieldId ? "Pick a time" : `${f.name} is required`,
        ]),
    );
  const stepOf = (fieldId: string) => steps?.findIndex((s) => s.fieldIds.includes(fieldId)) ?? -1;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (steps && !last) {
      const missing = shown ? missingOf(shown) : {};
      if (Object.keys(missing).length) {
        setErrors(missing);
        setMessage("Fill in the highlighted fields.");
        return;
      }
      setMessage(null);
      setStep((s) => s + 1);
      return;
    }
    if (preview) return setMessage("This is a preview. Open the public page to try the form.");
    const missing = missingOf();
    if (Object.keys(missing).length) {
      setErrors(missing);
      setMessage("Fill in the highlighted fields.");
      const at = stepOf(Object.keys(missing)[0]);
      if (at >= 0) setStep(at);
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/public/${slug}/${form.viewId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ values, website }),
      });
      const body = (await res.json().catch(() => null)) as
        | ({ ok: true } & Done)
        | { ok: false; message: string; fieldErrors?: { fieldId?: string; message: string }[] }
        | null;
      if (body?.ok) setDone(body);
      else {
        setMessage(body?.message ?? "Something went wrong. Try again.");
        const fieldErrors = (body?.fieldErrors ?? []).filter((e) => e.fieldId);
        setErrors(Object.fromEntries(fieldErrors.map((e) => [e.fieldId, e.message])));
        const at = fieldErrors[0]?.fieldId ? stepOf(fieldErrors[0].fieldId) : -1;
        if (at >= 0) setStep(at);
      }
    } catch {
      setMessage("You seem to be offline. Try again when you're connected.");
    } finally {
      setBusy(false);
    }
  };

  if (done)
    return (
      <div className="flex animate-rise flex-col items-center gap-3 rounded-xl border bg-card px-6 py-10 text-center">
        <CheckCircleIcon weight="fill" className="size-9 text-primary" />
        <h2 className="text-[18px] font-semibold">Thank you! We got it.</h2>
        <p className="text-[13.5px] text-muted-foreground">
          Reference <span className="font-mono text-foreground">{done.reference}</span>
        </p>
        {done.summary.length ? (
          <dl className="mt-1 grid w-full max-w-[360px] gap-1.5 text-[13.5px]">
            {done.summary.map((s) => (
              <div key={s.name} className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{s.name}</dt>
                <dd className="text-right">{s.text}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        <Button
          variant="outline"
          className="mt-2"
          onClick={() => {
            setDone(null);
            setValues({});
            setStep(0);
          }}
        >
          Make another
        </Button>
      </div>
    );

  return (
    <form onSubmit={submit} className="flex flex-col gap-5 rounded-xl border bg-card p-5 md:p-6" noValidate>
      {form.intro ? <p className="text-[14px] text-muted-foreground">{form.intro}</p> : null}
      {steps ? (
        <StepIndicator steps={titles} current={step} onSelect={(i) => i < step && setStep(i)} />
      ) : null}
      {steps && !reviewing ? (
        <div className={cn("flex flex-col gap-0.5", !steps[step].description && "sm:hidden")}>
          <h3 className="text-[15px] font-medium sm:hidden">{steps[step].title}</h3>
          {steps[step].description ? (
            <p className="text-[12.5px] text-muted-foreground">{steps[step].description}</p>
          ) : null}
        </div>
      ) : null}
      {reviewing && steps ? (
        <dl className="flex flex-col divide-y rounded-lg border text-[13.5px]">
          {steps.flatMap((s, si) =>
            s.fieldIds.flatMap((id) => {
              const f = form.fields.find((x) => x.id === id);
              if (!f) return [];
              return [
                <div key={id} className="flex items-center justify-between gap-4 px-3.5 py-2.5">
                  <dt className="text-muted-foreground">
                    {booking && id === booking.timeFieldId ? "Day and time" : f.name}
                  </dt>
                  <dd className="flex min-w-0 items-center gap-3 text-right">
                    <span className="truncate">{summaryText(f, values[id], form.choices[id]) || "—"}</span>
                    <button
                      type="button"
                      onClick={() => setStep(si)}
                      className="rounded-sm text-[12.5px] text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
                    >
                      Edit
                    </button>
                  </dd>
                </div>,
              ];
            }),
          )}
        </dl>
      ) : null}
      {form.fields.map((f) => {
        if (reviewing || (shown && !shown.has(f.id))) return null;
        if (booking && f.id === booking.timeFieldId) return null;
        const error = errors[f.id];
        const id = `pf-${form.viewId}-${f.id}`;
        return (
          <div key={f.id} className="flex flex-col gap-1.5">
            {f.type === "checkbox" ? null : (
              <label htmlFor={id} className="text-[13.5px] font-medium">
                {f.name}
                {f.required ? <span className="text-muted-foreground"> *</span> : null}
              </label>
            )}
            <PublicInput
              id={id}
              field={f}
              value={values[f.id]}
              choices={form.choices[f.id]}
              invalid={!!error}
              onChange={(v) => set(f.id, v)}
            />
            {f.description ? <p className="text-[12px] text-muted-foreground">{f.description}</p> : null}
            {error ? <p className="text-[12.5px] text-destructive">{error}</p> : null}
            {booking && f.id === booking.resourceFieldId ? (
              <SlotPicker
                slug={slug}
                viewId={form.viewId}
                resourceId={typeof values[f.id] === "string" ? (values[f.id] as string) : ""}
                value={values[booking.timeFieldId]}
                error={errors[booking.timeFieldId]}
                preview={preview}
                onChange={(v) => set(booking.timeFieldId, v)}
              />
            ) : null}
          </div>
        );
      })}
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        value={website}
        onChange={(e) => setWebsite(e.target.value)}
        className="absolute left-[-9999px] h-0 w-0 opacity-0"
      />
      {message ? (
        <p role="alert" className="text-[13px] text-destructive">
          {message}
        </p>
      ) : null}
      <div className="flex items-center gap-2">
        {steps && step > 0 ? (
          <Button type="button" variant="outline" size="lg" onClick={() => setStep((s) => s - 1)}>
            <ArrowLeftIcon data-icon="inline-start" />
            Back
          </Button>
        ) : null}
        <Button type="submit" size="lg" disabled={busy} className={steps ? "ml-auto" : undefined}>
          {busy ? (
            "Sending…"
          ) : last ? (
            form.submitLabel
          ) : (
            <>
              Next
              <ArrowRightIcon data-icon="inline-end" />
            </>
          )}
        </Button>
      </div>
    </form>
  );
}

const isEmpty = (v: FieldValue | undefined) =>
  v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

/** A visitor's answer as text for the review step. */
function summaryText(
  field: PublicField,
  value: FieldValue | undefined,
  choices?: { id: string; title: string }[],
) {
  if (isEmpty(value)) return "";
  if (isTimeRange(value ?? null)) {
    const range = value as { start: string; end: string };
    return field.range === "dates"
      ? formatRange(range)
      : `${formatDate(range.start)} · ${formatRange(range)}`;
  }
  if (Array.isArray(value))
    return value.map((v) => field.options?.find((o) => o.id === v)?.label ?? v).join(", ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  const text = String(value);
  return (
    field.options?.find((o) => o.id === text)?.label ?? choices?.find((c) => c.id === text)?.title ?? text
  );
}

function PublicInput({
  id,
  field,
  value,
  choices,
  invalid,
  onChange,
}: {
  id: string;
  field: PublicField;
  value: FieldValue | undefined;
  choices?: { id: string; title: string }[];
  invalid: boolean;
  onChange: (v: FieldValue) => void;
}) {
  const common = { id, "aria-invalid": invalid || undefined, "aria-required": field.required || undefined };
  switch (field.type) {
    case "long_text":
      return (
        <Textarea
          {...common}
          rows={4}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "number":
    case "money":
    case "percent":
      return (
        <Input
          {...common}
          type="number"
          inputMode="decimal"
          value={value === undefined || value === null ? "" : String(value)}
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        />
      );
    case "date":
      return (
        <Input
          {...common}
          type="date"
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "datetime":
      return (
        <Input
          {...common}
          type="datetime-local"
          onChange={(e) =>
            onChange(e.target.value ? new Date(`${e.target.value}:00+08:00`).toISOString() : null)
          }
        />
      );
    case "checkbox":
      return (
        <label htmlFor={id} className="flex items-center gap-2 text-[13.5px]">
          <Checkbox id={id} checked={value === true} onCheckedChange={(c) => onChange(c === true)} />
          {field.name}
        </label>
      );
    case "select":
    case "relation": {
      const list =
        field.type === "select"
          ? (field.options ?? []).map((o) => ({ id: o.id, title: o.label }))
          : (choices ?? []);
      return (
        <select
          {...common}
          className={selectClass}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value || null)}
        >
          <option value="">Choose…</option>
          {list.map((o) => (
            <option key={o.id} value={o.id}>
              {o.title}
            </option>
          ))}
        </select>
      );
    }
    case "multi_select": {
      const picked = Array.isArray(value) ? value : [];
      return (
        <div className="flex flex-wrap gap-2">
          {(field.options ?? []).map((o) => {
            const on = picked.includes(o.id);
            return (
              <button
                key={o.id}
                type="button"
                aria-pressed={on}
                onClick={() => onChange(on ? picked.filter((x) => x !== o.id) : [...picked, o.id])}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50",
                  on
                    ? "border-primary bg-primary/15 text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      );
    }
    case "time_range":
      return <RangeFields id={id} field={field} onChange={onChange} />;
    default:
      return (
        <Input
          {...common}
          type={/email/i.test(field.name) ? "email" : /phone|mobile/i.test(field.name) ? "tel" : "text"}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}

/** A time range that isn't a booking slot: two dates, or a date with start and end times. */
function RangeFields({
  id,
  field,
  onChange,
}: {
  id: string;
  field: PublicField;
  onChange: (v: FieldValue) => void;
}) {
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [day, setDay] = useState("");
  const emit = (nextA: string, nextB: string, nextDay: string) => {
    setA(nextA);
    setB(nextB);
    setDay(nextDay);
    if (field.range === "dates") onChange(nextA && nextB ? { start: nextA, end: nextB } : null);
    else onChange(nextDay && nextA && nextB ? { start: at(nextDay, nextA), end: at(nextDay, nextB) } : null);
  };
  return field.range === "dates" ? (
    <div className="grid grid-cols-2 gap-2">
      <Input id={id} aria-label="From" type="date" value={a} onChange={(e) => emit(e.target.value, b, day)} />
      <Input aria-label="To" type="date" value={b} min={a} onChange={(e) => emit(a, e.target.value, day)} />
    </div>
  ) : (
    <div className="grid grid-cols-[1.4fr_1fr_1fr] gap-2">
      <Input id={id} aria-label="Date" type="date" value={day} onChange={(e) => emit(a, b, e.target.value)} />
      <Input
        aria-label="Starts"
        type="time"
        step={900}
        value={a}
        onChange={(e) => emit(e.target.value, b, day)}
      />
      <Input
        aria-label="Ends"
        type="time"
        step={900}
        value={b}
        onChange={(e) => emit(a, e.target.value, day)}
      />
    </div>
  );
}

/** Pick a day, then a free slot. Taken and past slots are shown but can't be chosen. */
function SlotPicker({
  slug,
  viewId,
  resourceId,
  value,
  error,
  preview,
  onChange,
}: {
  slug: string;
  viewId: string;
  resourceId: string;
  value: FieldValue | undefined;
  error?: string;
  preview?: boolean;
  onChange: (v: FieldValue) => void;
}) {
  const today = todayKey();
  const [day, setDay] = useState(today);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [loading, setLoading] = useState(false);
  const picked =
    value && typeof value === "object" && !Array.isArray(value) ? (value as { start: string }).start : null;

  useEffect(() => {
    if (!resourceId || preview) return setSlots(null);
    let live = true;
    setLoading(true);
    fetch(`/api/public/${slug}/${viewId}/slots?resource=${encodeURIComponent(resourceId)}&date=${day}`, {
      cache: "no-store",
    })
      .then((r) => r.json())
      .then((b: { ok: boolean; slots?: Slot[] }) => live && setSlots(b.ok ? (b.slots ?? []) : []))
      .catch(() => live && setSlots([]))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [slug, viewId, resourceId, day, preview]);

  const days = Array.from({ length: 14 }, (_, i) => addDays(today, i));
  return (
    <div className="mt-2 flex flex-col gap-3 rounded-lg border p-3">
      <span className="text-[13px] font-medium">Day and time *</span>
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {days.map((d) => {
          const date = new Date(`${d}T12:00:00+08:00`);
          return (
            <button
              key={d}
              type="button"
              aria-pressed={d === day}
              onClick={() => {
                setDay(d);
                onChange(null);
              }}
              className={cn(
                "flex w-14 shrink-0 flex-col items-center rounded-md border py-1.5 text-[12px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50",
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
      {!resourceId ? (
        <p className="text-[12.5px] text-muted-foreground">Choose a court first to see open times.</p>
      ) : preview ? (
        <p className="text-[12.5px] text-muted-foreground">Open times show on the public page.</p>
      ) : loading && !slots ? (
        <p className="text-[12.5px] text-muted-foreground">Checking open times…</p>
      ) : slots?.some((s) => s.free) ? (
        <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
          {(slots ?? []).map((s) => (
            <button
              key={s.start}
              type="button"
              disabled={!s.free}
              aria-pressed={picked === s.start}
              onClick={() => onChange({ start: s.start, end: s.end })}
              className={cn(
                "rounded-md border px-2 py-2 font-mono text-[12.5px] tabular outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-35 disabled:line-through",
                picked === s.start
                  ? "border-primary bg-primary text-primary-foreground"
                  : "hover:border-foreground/30",
              )}
            >
              {formatTime(s.start)}
            </button>
          ))}
        </div>
      ) : (
        <p className="text-[12.5px] text-muted-foreground">
          No open times on {dateKey(day) === today ? "today" : "this day"}. Try another day.
        </p>
      )}
      {error ? <p className="text-[12.5px] text-destructive">{error}</p> : null}
    </div>
  );
}

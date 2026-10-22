"use client";

import { ArrowLeftIcon, ArrowRightIcon, CheckCircleIcon, UploadSimpleIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { ExtrasPicker } from "@/components/forms/extras-picker";
import { StepIndicator } from "@/components/forms/step-indicator";
import { BookingPicker } from "@/components/public/booking-pickers";
import { SignaturePad } from "@/components/records/signature-pad";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SIGNATURE_FILE } from "@/lib/blueprint/contact";
import type { FieldValue } from "@/lib/blueprint/types";
import { formatDate, formatDateTime, formatRange, isTimeRange } from "@/lib/format";
import { isHeic, MAX_SOURCE_BYTES, prepareImage } from "@/lib/prepare-image";
import type { PublicField, PublicForm, ResolvedBlock } from "@/lib/public/resolve";
import { at, dateKey } from "@/lib/time";
import { cn } from "@/lib/utils";

type Done = { reference: string; title: string; summary: { name: string; text: string }[]; manage?: string };

const selectClass =
  "h-9 w-full rounded-md border bg-transparent px-2.5 text-[14px] outline-none focus-visible:ring-2 focus-visible:ring-ring/50 aria-invalid:border-destructive";

/** A public form: what a visitor fills in to book or send a request. Booking forms pick a free slot. */
export function PublicFormView({
  form,
  slug,
  preview,
  renderBlocks,
}: {
  form: PublicForm;
  slug: string;
  preview?: boolean;
  /** Draws the blocks a step shows (payment methods on the payment step); passed in to avoid a module cycle. */
  renderBlocks?: (blocks: ResolvedBlock[]) => React.ReactNode;
}) {
  const [values, setValues] = useState<Record<string, FieldValue>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const [website, setWebsite] = useState("");
  const [step, setStep] = useState(0);
  const [extras, setExtras] = useState<Record<string, number>>({});
  const [quote, setQuote] = useState<{ name: string; text: string }[] | null>(null);
  const set = (id: string, v: FieldValue) => {
    setValues((s) => ({ ...s, [id]: v }));
    setErrors((e) => ({ ...e, [id]: "" }));
  };
  const booking = form.booking;
  // The booking's own date field follows the picked slot; it isn't asked.
  const derived = new Set([...(booking?.dayFieldIds ?? []), ...(booking?.endDayFieldIds ?? [])]);
  const pickSlot = (v: FieldValue) => {
    if (!booking) return;
    const range = isTimeRange(v) ? (v as { start: string; end: string }) : null;
    const first = range ? dateKey(range.start) : null;
    const last = range ? dateKey(booking.dates ? range.end : new Date(Date.parse(range.end) - 1)) : null;
    setValues((s) => ({
      ...s,
      [booking.timeFieldId]: v,
      ...Object.fromEntries(booking.dayFieldIds.map((id) => [id, first])),
      ...Object.fromEntries(booking.endDayFieldIds.map((id) => [id, last])),
    }));
    setErrors((e) => ({ ...e, [booking.timeFieldId]: "" }));
  };
  const steps = form.steps;
  const titles = steps ? [...steps.map((s) => s.title), ...(form.review ? ["Review"] : [])] : [];
  const reviewing = !!steps && step === steps.length;
  const last = !steps || step === titles.length - 1;
  const shown = steps && !reviewing ? new Set(steps[step].fieldIds) : null;
  // Add-ons show on their step, or with the fields when the form has no steps.
  const showExtras = !!form.extras && !reviewing && (steps ? !!steps[step]?.extras : true);
  const picked = (form.extras?.items ?? []).filter((i) => (extras[i.id] ?? 0) > 0);
  const missingOf = (ids?: Set<string>) =>
    Object.fromEntries(
      form.fields
        .filter((f) => (!ids || ids.has(f.id)) && !derived.has(f.id) && f.required && isEmpty(values[f.id]))
        .map((f) => [
          f.id,
          booking && f.id === booking.timeFieldId ? "Pick a time" : `${f.name} is required`,
        ]),
    );
  const stepOf = (fieldId: string) => steps?.findIndex((s) => s.fieldIds.includes(fieldId)) ?? -1;

  // A list with a single choice (the only payment method, the only court) is already chosen.
  useEffect(() => {
    const only = form.fields.filter(
      (f) => f.type === "relation" && form.choices[f.id]?.length === 1 && isEmpty(values[f.id]),
    );
    if (only.length)
      setValues((s) => ({ ...s, ...Object.fromEntries(only.map((f) => [f.id, form.choices[f.id][0].id])) }));
  }, [form, values]);

  // What it comes to, on the payment step and the review (or under a one-page form): worked out by the server from
  // the answers so far, the same way a real booking is, and never saved.
  const priced = !!booking || !!form.extras;
  const wantsQuote =
    priced && !preview && (!steps || reviewing || /pay/i.test(steps[step]?.title ?? "") || last);
  useEffect(() => {
    if (!wantsQuote) return setQuote(null);
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/public/${slug}/${form.viewId}/quote`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ values, extras }),
        signal: controller.signal,
      })
        .then((res) => res.json())
        .then((body: { ok: boolean; lines?: { name: string; text: string }[] }) =>
          setQuote(body.ok && body.lines?.length ? body.lines : null),
        )
        .catch(() => {});
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [wantsQuote, slug, form.viewId, values, extras]);

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
        body: JSON.stringify({ values, extras, website }),
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
        {done.manage ? (
          <a
            href={done.manage}
            className="mt-1 text-[13.5px] font-medium text-primary underline-offset-2 hover:underline"
          >
            View or update your booking
          </a>
        ) : null}
        <Button
          variant="outline"
          className="mt-2"
          onClick={() => {
            setDone(null);
            setValues({});
            setExtras({});
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
      {steps && !reviewing && steps[step].blocks?.length && renderBlocks ? (
        quote ? (
          <AmountDue lines={quote} />
        ) : null
      ) : null}
      {steps && !reviewing && steps[step].blocks?.length && renderBlocks ? (
        <div className="flex flex-col gap-6">{renderBlocks(steps[step].blocks ?? [])}</div>
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
          {picked.length && form.extras ? (
            <div className="flex items-center justify-between gap-4 px-3.5 py-2.5">
              <dt className="text-muted-foreground">{form.extras.title}</dt>
              <dd className="text-right">{picked.map((i) => `${i.title} × ${extras[i.id]}`).join(", ")}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      {quote && (reviewing || !steps || !steps[step]?.blocks?.length) ? <AmountDue lines={quote} /> : null}
      {form.fields.map((f) => {
        if (reviewing || (shown && !shown.has(f.id))) return null;
        if (booking && (f.id === booking.timeFieldId || derived.has(f.id))) return null;
        const error = errors[f.id];
        const id = `pf-${form.viewId}-${f.id}`;
        const picker =
          booking && f.id === booking.resourceFieldId ? (
            <BookingPicker
              slug={slug}
              viewId={form.viewId}
              booking={booking}
              resourceId={typeof values[f.id] === "string" ? (values[f.id] as string) : ""}
              value={values[booking.timeFieldId]}
              error={errors[booking.timeFieldId] || (booking.layout === "grid" ? error : undefined)}
              preview={preview}
              onChange={pickSlot}
              onResource={(r) => set(f.id, r)}
            />
          ) : null;
        // The grid picks the court with the time: each court is a column, so there's no separate list to choose from.
        if (picker && booking?.layout === "grid" && !booking.dates)
          return (
            <div key={f.id} className="flex flex-col gap-1.5">
              {picker}
            </div>
          );
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
              upload={{ slug, viewId: form.viewId, preview }}
              onChange={(v) => set(f.id, v)}
            />
            {f.description ? <p className="text-[12px] text-muted-foreground">{f.description}</p> : null}
            {error ? <p className="text-[12.5px] text-destructive">{error}</p> : null}
            {picker}
          </div>
        );
      })}
      {showExtras && form.extras ? (
        <ExtrasPicker
          title={form.extras.title}
          items={form.extras.items}
          value={extras}
          onChange={(id, n) => setExtras((s) => ({ ...s, [id]: n }))}
        />
      ) : null}
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
      {form.submitNote && last ? (
        <p className="rounded-lg border bg-muted/40 px-3.5 py-2.5 text-[13px] text-muted-foreground [overflow-wrap:anywhere]">
          {form.submitNote}
        </p>
      ) : null}
      <div className="flex items-center gap-2">
        {steps && step > 0 ? (
          <Button type="button" variant="outline" size="lg" onClick={() => setStep((s) => s - 1)}>
            <ArrowLeftIcon data-icon="inline-start" />
            Back
          </Button>
        ) : null}
        <Button
          type="submit"
          size="lg"
          disabled={busy}
          className={cn(
            "h-auto min-h-10 max-w-full py-2 text-left whitespace-normal [overflow-wrap:anywhere]",
            steps && "ml-auto",
          )}
        >
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

/** The money lines of a booking before it's sent; the last one is what's due. */
function AmountDue({ lines }: { lines: { name: string; text: string }[] }) {
  return (
    <dl className="flex flex-col gap-1 rounded-lg border bg-muted/30 px-3.5 py-3 text-[13.5px]">
      {lines.map((l, i) => (
        <div
          key={l.name}
          className={cn(
            "flex justify-between gap-4",
            i === lines.length - 1 && lines.length > 1 && "mt-1 border-t pt-2 font-medium",
          )}
        >
          <dt className={cn(i === lines.length - 1 ? "text-foreground" : "text-muted-foreground")}>
            {i === lines.length - 1 ? `Amount due · ${l.name}` : l.name}
          </dt>
          <dd className="font-mono tabular">{l.text}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A visitor's answer as text for the review step. */
function summaryText(
  field: PublicField,
  value: FieldValue | undefined,
  choices?: { id: string; title: string }[],
) {
  if (isEmpty(value)) return "";
  if (field.type === "image") return "Attached";
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
  // A pickup time reads "Tue, Oct 20, 10:00 AM", never 2026-10-20T02:00:00.000Z.
  if (field.type === "datetime") return formatDateTime(text);
  if (field.type === "date") return formatDate(text, { withYear: true });
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
  upload,
  onChange,
}: {
  id: string;
  field: PublicField;
  value: FieldValue | undefined;
  choices?: { id: string; title: string }[];
  invalid: boolean;
  /** Where a picture the field asks for is uploaded; previews don't upload. */
  upload: { slug: string; viewId: string; preview?: boolean };
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
    case "image":
      return (
        <PublicImageInput
          id={id}
          invalid={invalid}
          value={typeof value === "string" ? value : ""}
          upload={upload}
          onChange={onChange}
        />
      );
    case "signature":
      return (
        <PublicSignatureInput id={id} field={field} invalid={invalid} upload={upload} onChange={onChange} />
      );
    default:
      return (
        <Input
          {...common}
          type={
            field.type === "email" || /email/i.test(field.name)
              ? "email"
              : field.type === "phone" || /phone|mobile/i.test(field.name)
                ? "tel"
                : field.type === "url"
                  ? "url"
                  : "text"
          }
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

/** A picture a public form asks for (a proof of payment): picked, shrunk if large, then uploaded right away. */
/**
 * A visitor signs on the pad; the drawing goes to the workspace's private documents (they can't read it back, so the
 * pad keeps showing what they drew). Previews keep it in the page.
 */
function PublicSignatureInput({
  id,
  field,
  invalid,
  upload,
  onChange,
}: {
  id: string;
  field: PublicField;
  invalid: boolean;
  upload: { slug: string; viewId: string; preview?: boolean };
  onChange: (v: FieldValue) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const signed = async (png: Blob | null) => {
    setProblem(null);
    setSaved(false);
    if (!png) return onChange(null);
    // Previews keep the drawing in the page; nothing is uploaded.
    if (upload.preview)
      return onChange(
        await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.readAsDataURL(png);
        }),
      );
    setBusy(true);
    try {
      const body = new FormData();
      body.set("file", new File([png], SIGNATURE_FILE, { type: "image/png" }));
      const res = await fetch(`/api/public/${upload.slug}/${upload.viewId}/upload`, { method: "POST", body });
      const json = (await res.json().catch(() => null)) as {
        ok: boolean;
        url?: string;
        message?: string;
      } | null;
      if (!json?.ok || !json.url)
        throw new Error(json?.message ?? "Couldn't save your signature. Sign again.");
      onChange(json.url);
      setSaved(true);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "Couldn't save your signature. Sign again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-1">
      <SignaturePad
        id={id}
        value={null}
        label={field.name}
        invalid={invalid}
        busy={busy}
        saved={saved}
        onSigned={signed}
      />
      {problem ? <p className="text-[12px] text-destructive">{problem}</p> : null}
    </div>
  );
}

function PublicImageInput({
  id,
  invalid,
  value,
  upload,
  onChange,
}: {
  id: string;
  invalid: boolean;
  value: string;
  upload: { slug: string; viewId: string; preview?: boolean };
  onChange: (v: FieldValue) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [name, setName] = useState("");
  const pick = async (file: File) => {
    setProblem(null);
    if (upload.preview) return setProblem("Uploads work on the public page.");
    if (!file.type.startsWith("image/") && !isHeic(file))
      return setProblem("Choose a photo or screenshot (PNG, JPG, WebP or GIF).");
    if (file.size > MAX_SOURCE_BYTES) return setProblem("That photo is over 40 MB.");
    setBusy(true);
    try {
      const body = new FormData();
      body.set("file", await prepareImage(file));
      const res = await fetch(`/api/public/${upload.slug}/${upload.viewId}/upload`, { method: "POST", body });
      const json = (await res.json().catch(() => null)) as {
        ok: boolean;
        url?: string;
        message?: string;
      } | null;
      if (!json?.ok || !json.url) throw new Error(json?.message ?? "Couldn't upload that. Try again.");
      setName(file.name);
      onChange(json.url);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "Couldn't upload that. Try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-1.5">
      {value ? (
        <div className="flex items-center gap-3 rounded-lg border p-2">
          {/* biome-ignore lint/performance/noImgElement: a small preview of the upload */}
          <img src={value} alt="" className="size-14 shrink-0 rounded-md object-cover" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13.5px]">{name || "Picture attached"}</p>
            <p className="text-[12px] text-muted-foreground">Uploaded</p>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
            Remove
          </Button>
        </div>
      ) : (
        <label
          htmlFor={id}
          className={cn(
            "flex cursor-pointer flex-col items-center gap-1 rounded-lg border border-dashed px-4 py-5 text-center text-[12.5px] text-muted-foreground transition-colors hover:border-foreground/30 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50",
            invalid && "border-destructive",
            busy && "cursor-progress",
          )}
        >
          <UploadSimpleIcon className="size-5" />
          <span className="text-[13.5px] text-foreground">
            {busy ? "Uploading…" : "Choose a photo or screenshot"}
          </span>
          <span>PNG, JPG or iPhone photo, up to 5 MB</span>
          <input
            id={id}
            type="file"
            accept="image/*,.heic,.heif"
            className="sr-only"
            disabled={busy}
            aria-invalid={invalid || undefined}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void pick(file);
            }}
          />
        </label>
      )}
      {problem ? <p className="text-[12.5px] text-destructive">{problem}</p> : null}
    </div>
  );
}

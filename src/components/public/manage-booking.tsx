"use client";

import { CheckCircleIcon, LinkSimpleIcon, UploadSimpleIcon } from "@phosphor-icons/react";
import { useRef, useState } from "react";
import { StatusBadge } from "@/components/records/status-badge";
import { Button } from "@/components/ui/button";
import type { Tone } from "@/lib/blueprint/types";
import { cn } from "@/lib/utils";

type Booking = {
  site: string;
  title: string;
  reference: string;
  status?: { label: string; tone: Tone };
  summary: { name: string; text: string }[];
  attach: { fieldId: string; name: string; added: boolean }[];
};

/** The visitor's booking: reference, status and details, and the pictures they can still add (a proof of payment). */
export function ManageBooking({ token, initial }: { token: string; initial: Booking | null }) {
  const [booking, setBooking] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; good: boolean } | null>(null);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});

  const add = async (fieldId: string, file: File | undefined) => {
    if (!file) return;
    setBusy(fieldId);
    setMessage(null);
    try {
      const body = new FormData();
      body.set("fieldId", fieldId);
      body.set("file", file);
      const res = await fetch(`/api/public/booking/${encodeURIComponent(token)}`, { method: "POST", body });
      const result = (await res.json().catch(() => null)) as {
        ok: boolean;
        booking?: Booking;
        message?: string;
      } | null;
      if (result?.ok && result.booking) {
        setBooking(result.booking);
        setMessage({ text: "Got it. The team can see it now.", good: true });
      } else setMessage({ text: result?.message ?? "That didn't upload. Try again.", good: false });
    } catch {
      setMessage({ text: "You seem to be offline. Try again when you're connected.", good: false });
    } finally {
      setBusy(null);
      const el = inputs.current[fieldId];
      if (el) el.value = "";
    }
  };

  return (
    <div className="flex min-h-dvh flex-col bg-shell">
      <header className="border-b">
        <div className="mx-auto flex h-16 w-full max-w-[640px] items-center gap-2.5 px-5 text-[15px] font-semibold">
          <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-[13px] font-bold text-primary-foreground">
            {(booking?.site ?? "E").slice(0, 1).toUpperCase()}
          </span>
          {booking?.site ?? "EveryOps"}
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-[640px] flex-1 flex-col gap-5 px-5 py-10">
        {!booking ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border bg-card px-6 py-12 text-center">
            <LinkSimpleIcon className="size-8 text-muted-foreground" />
            <h1 className="text-[18px] font-semibold">This booking link doesn't work any more</h1>
            <p className="text-[13.5px] text-muted-foreground">
              It may have expired. Contact the business with your reference number.
            </p>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-1">
              <p className="text-[13px] text-muted-foreground">Your booking</p>
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-[24px] font-semibold tracking-[-0.02em]">{booking.title}</h1>
                {booking.status ? (
                  <StatusBadge label={booking.status.label} tone={booking.status.tone} />
                ) : null}
              </div>
              <p className="text-[13.5px] text-muted-foreground">
                Reference <span className="font-mono text-foreground">{booking.reference}</span>
              </p>
            </div>
            {booking.summary.length ? (
              <dl className="grid gap-2 rounded-xl border bg-card p-5 text-[14px]">
                {booking.summary.map((s) => (
                  <div key={s.name} className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">{s.name}</dt>
                    <dd className="text-right">{s.text}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
            {booking.attach.map((a) => (
              <div
                key={a.fieldId}
                className="flex flex-col gap-3 rounded-xl border bg-card p-5 sm:flex-row sm:items-center"
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  {a.added ? (
                    <CheckCircleIcon weight="fill" className="size-6 shrink-0 text-primary" />
                  ) : (
                    <UploadSimpleIcon className="size-6 shrink-0 text-muted-foreground" />
                  )}
                  <div className="flex flex-col">
                    <span className="text-[14px] font-medium">{a.name}</span>
                    <span className="text-[12.5px] text-muted-foreground">
                      {a.added
                        ? "Received. Upload again to replace it."
                        : "Not sent yet. A photo or screenshot works."}
                    </span>
                  </div>
                </div>
                <input
                  ref={(el) => {
                    inputs.current[a.fieldId] = el;
                  }}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  className="sr-only"
                  aria-label={a.name}
                  onChange={(e) => void add(a.fieldId, e.target.files?.[0])}
                />
                <Button
                  variant={a.added ? "outline" : "default"}
                  disabled={busy !== null}
                  onClick={() => inputs.current[a.fieldId]?.click()}
                >
                  <UploadSimpleIcon data-icon="inline-start" />
                  {busy === a.fieldId ? "Uploading…" : a.added ? "Replace" : `Add ${a.name.toLowerCase()}`}
                </Button>
              </div>
            ))}
            {message ? (
              <output
                className={cn("block text-[13.5px]", message.good ? "text-primary" : "text-destructive")}
              >
                {message.text}
              </output>
            ) : null}
            <p className="text-[12.5px] text-muted-foreground">
              Keep this link to check your booking later. Anyone with it can see this booking.
            </p>
          </>
        )}
      </main>
    </div>
  );
}

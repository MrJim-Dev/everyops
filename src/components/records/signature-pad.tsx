"use client";

import { ArrowCounterClockwiseIcon, PenNibIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * A pad to sign on with a finger, pen or mouse: dark ink on white, sharp on high-density screens. Each time a stroke
 * ends the drawing so far is handed over as a PNG, and Clear hands over null. A
 * signature already saved shows as its picture with Sign again.
 */
export function SignaturePad({
  id,
  value,
  label,
  invalid,
  busy,
  saved,
  onSigned,
}: {
  id?: string;
  /** The saved signature's picture, if there is one. */
  value: string | null;
  label: string;
  invalid?: boolean;
  /** Shown under the pad while the drawing is being saved. */
  busy?: boolean;
  /** The drawing is saved, so the pad can say Signed. */
  saved?: boolean;
  onSigned: (png: Blob | null) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [inked, setInked] = useState(false);
  const [redo, setRedo] = useState(!value);

  // The canvas matches its box in device pixels, so lines stay crisp on phones and retina screens.
  useEffect(() => {
    if (!redo) return;
    const c = canvas.current;
    if (!c) return;
    const ratio = window.devicePixelRatio || 1;
    const box = c.getBoundingClientRect();
    c.width = Math.round(box.width * ratio);
    c.height = Math.round(box.height * ratio);
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#111";
  }, [redo]);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - box.left, y: e.clientY - box.top };
  };

  const finish = () => {
    if (!drawing.current) return;
    drawing.current = false;
    last.current = null;
    const c = canvas.current;
    if (c) c.toBlob((blob) => blob && onSigned(blob), "image/png");
  };

  const clear = () => {
    const c = canvas.current;
    c?.getContext("2d")?.clearRect(0, 0, c.width, c.height);
    setInked(false);
    onSigned(null);
  };

  if (!redo && value)
    return (
      <div id={id} className="flex flex-col gap-2">
        {/* biome-ignore lint/performance/noImgElement: a private upload served to the team, not an optimizable asset */}
        <img
          src={value}
          alt={`${label} (signed)`}
          className="h-24 w-full max-w-[360px] rounded-md border bg-white object-contain p-1"
        />
        <Button type="button" size="sm" variant="ghost" className="self-start" onClick={() => setRedo(true)}>
          <PenNibIcon data-icon="inline-start" />
          Sign again
        </Button>
      </div>
    );

  return (
    <div className="flex flex-col gap-1.5">
      <div
        className={cn(
          "relative h-36 w-full max-w-[420px] overflow-hidden rounded-md border bg-white",
          invalid && "border-destructive ring-3 ring-destructive/20",
        )}
      >
        <canvas
          id={id}
          ref={canvas}
          role="img"
          aria-label={`Signature pad for ${label}. Draw your signature with a finger, pen or mouse.`}
          className="absolute inset-0 size-full cursor-crosshair touch-none"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            drawing.current = true;
            last.current = point(e);
            setInked(true);
          }}
          onPointerMove={(e) => {
            if (!drawing.current || !last.current) return;
            const ctx = canvas.current?.getContext("2d");
            const next = point(e);
            if (!ctx) return;
            ctx.beginPath();
            ctx.moveTo(last.current.x, last.current.y);
            ctx.lineTo(next.x, next.y);
            ctx.stroke();
            last.current = next;
          }}
          onPointerUp={finish}
          onPointerCancel={finish}
          onPointerLeave={finish}
        />
        <span className="pointer-events-none absolute inset-x-4 bottom-7 border-b border-neutral-300" />
        {!inked ? (
          <span className="pointer-events-none absolute inset-x-0 bottom-2 text-center text-[11.5px] text-neutral-400">
            Sign above the line
          </span>
        ) : null}
      </div>
      <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
        <Button type="button" size="sm" variant="ghost" onClick={clear} disabled={!inked}>
          <ArrowCounterClockwiseIcon data-icon="inline-start" />
          Clear
        </Button>
        <span aria-live="polite">{busy ? "Saving signature…" : inked && saved ? "Signed" : ""}</span>
      </div>
    </div>
  );
}

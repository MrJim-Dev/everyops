"use client";

import { type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { lastInputWasKeyboard } from "@/lib/motion/input-modality";
import { cn } from "@/lib/utils";

export type SegmentOption = { value: string; label: ReactNode };

type Rect = { x: number; y: number; w: number; h: number };

/**
 * Native radio buttons styled as a segmented control. The selection indicator
 * slides to the chosen option so the eye follows the change. Arrow keys (native
 * radio behaviour) snap instantly: keyboard changes repeat too often to animate.
 */
export function SegmentedControl({
  value,
  onValueChange,
  options,
  label,
  variant = "pills",
  className,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: SegmentOption[];
  label: string;
  variant?: "pills" | "boxed";
  className?: string;
}) {
  const name = useId();
  const containerRef = useRef<HTMLFieldSetElement>(null);
  const itemRefs = useRef(new Map<string, HTMLLabelElement>());
  const [rect, setRect] = useState<Rect | null>(null);
  const [animate, setAnimate] = useState(false);
  const [ready, setReady] = useState(false);

  const valueRef = useRef(value);
  valueRef.current = value;

  const measure = (withMotion: boolean) => {
    const el = itemRefs.current.get(valueRef.current);
    if (!el) return setRect(null);
    setAnimate(withMotion);
    setRect({ x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight });
  };

  // Selection changed: slide, unless it came from the keyboard.
  // biome-ignore lint/correctness/useExhaustiveDependencies: measure reads the latest value through a ref
  useLayoutEffect(() => {
    measure(!lastInputWasKeyboard());
  }, [value]);

  // Layout changed (resize, wrapping): reposition without animating. ResizeObserver
  // fires once on observe; skip that so it doesn't cancel the first slide.
  // biome-ignore lint/correctness/useExhaustiveDependencies: observer is created once
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let initial = true;
    const observer = new ResizeObserver(() => {
      if (initial) {
        initial = false;
        return;
      }
      measure(false);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // The first placement should not slide in from the left edge.
  useEffect(() => {
    const frame = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <fieldset
      ref={containerRef}
      className={cn(
        "relative isolate m-0 flex min-w-0 flex-wrap items-center border-0 p-0",
        variant === "pills" ? "gap-1" : "rounded-lg border p-0.5",
        className,
      )}
    >
      <legend className="sr-only">{label}</legend>
      {rect ? (
        <span
          aria-hidden="true"
          className={cn(
            "absolute top-0 left-0 -z-10 rounded-md",
            variant === "pills" ? "bg-secondary" : "border border-primary/50 bg-primary/12",
            ready &&
              animate &&
              "transition-[transform,width,height] duration-[220ms] ease-(--ease-out-strong)",
          )}
          style={{ transform: `translate(${rect.x}px, ${rect.y}px)`, width: rect.w, height: rect.h }}
        />
      ) : null}
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <label
            key={option.value}
            ref={(el) => {
              if (el) itemRefs.current.set(option.value, el);
              else itemRefs.current.delete(option.value);
            }}
            className={cn(
              "relative inline-flex h-7 cursor-pointer items-center justify-center rounded-md px-2.5 text-[13px] font-medium whitespace-nowrap transition-[color,transform] duration-150 select-none active:scale-[0.97]",
              "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50",
              selected ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              variant === "boxed" && "h-9 flex-1",
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={selected}
              onChange={() => onValueChange(option.value)}
              className="sr-only"
            />
            {option.label}
          </label>
        );
      })}
    </fieldset>
  );
}

"use client";

import { StarIcon } from "@phosphor-icons/react";
import { useId } from "react";
import { RATING_MAX } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Stars to pick a rating from 1 to 5: real radio buttons under the stars, so arrow keys move between them and screen
 * readers say "3 of 5". Picking the current rating again clears it.
 */
export function RatingInput({
  id,
  value,
  onChange,
  invalid,
  label,
}: {
  id?: string;
  value: number | null;
  onChange: (value: number | null) => void;
  invalid?: boolean;
  label?: string;
}) {
  const name = useId();
  const current = typeof value === "number" ? value : 0;
  return (
    <fieldset id={id} aria-invalid={invalid || undefined} className="flex h-9 items-center gap-0.5">
      {label ? <legend className="sr-only">{label}</legend> : null}
      {Array.from({ length: RATING_MAX }, (_, i) => {
        const n = i + 1;
        const on = n <= current;
        return (
          <label
            key={n}
            className={cn(
              "flex size-8 cursor-pointer items-center justify-center rounded-md transition-[transform,color] duration-150 hover:bg-secondary/60 active:scale-[0.97] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50",
              on ? "text-warning" : "text-muted-foreground/50",
            )}
          >
            <input
              type="radio"
              name={name}
              value={n}
              className="sr-only"
              checked={n === current}
              aria-label={`${n} of ${RATING_MAX}`}
              onChange={() => onChange(n)}
              onClick={() => n === current && onChange(null)}
            />
            <StarIcon weight={on ? "fill" : "regular"} className="size-5" aria-hidden />
          </label>
        );
      })}
    </fieldset>
  );
}

/** A rating as stars, for tables and panels. */
export function RatingStars({ value, className }: { value: number; className?: string }) {
  const n = Math.max(0, Math.min(RATING_MAX, Math.round(value)));
  return (
    <span
      role="img"
      aria-label={`${n} of ${RATING_MAX}`}
      className={cn("inline-flex items-center gap-px text-warning", className)}
    >
      {Array.from({ length: RATING_MAX }, (_, i) => (
        <StarIcon
          // biome-ignore lint/suspicious/noArrayIndexKey: five fixed stars
          key={i}
          weight={i < n ? "fill" : "regular"}
          className={cn("size-3.5", i >= n && "text-muted-foreground/40")}
          aria-hidden
        />
      ))}
    </span>
  );
}

"use client";

import { CaretLeftIcon, CaretRightIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";

/** Today + previous/next + a label. Used by the schedule and the calendar. */
export function DateStepper({
  label,
  onPrev,
  onNext,
  onToday,
  isToday,
}: {
  label: string;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  isToday: boolean;
}) {
  return (
    <div className="flex items-center gap-1">
      <Button variant="outline" size="sm" onClick={onToday} disabled={isToday}>
        Today
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="Previous" onClick={onPrev}>
        <CaretLeftIcon />
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="Next" onClick={onNext}>
        <CaretRightIcon />
      </Button>
      <span className="ml-1 text-[13px] font-medium tabular" aria-live="polite">
        {label}
      </span>
    </div>
  );
}

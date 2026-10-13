"use client";

import { setViewPref, useViewPref, type ViewPref } from "@/lib/store/view-prefs";
import { cn } from "@/lib/utils";

/** A small labelled switch in a view's toolbar for a personal view preference. */
export function ViewPrefToggle({ pref, label }: { pref: ViewPref; label: string }) {
  const on = useViewPref(pref);
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => setViewPref(pref, !on)}
      className="inline-flex h-7 cursor-pointer items-center gap-2 rounded-md px-2 text-[12px] text-muted-foreground outline-none transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <span
        aria-hidden="true"
        className={cn(
          "relative h-3.5 w-6 shrink-0 rounded-full transition-colors duration-200 ease-out",
          on ? "bg-primary" : "bg-muted-foreground/30",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 left-0.5 size-2.5 rounded-full bg-background shadow-sm transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none",
            on && "translate-x-2.5",
          )}
        />
      </span>
      {label}
    </button>
  );
}

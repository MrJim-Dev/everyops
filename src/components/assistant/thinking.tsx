"use client";

import { useEffect, useState } from "react";
import { LogoMarkThinking } from "@/components/brand/logo";
import { cn } from "@/lib/utils";

/**
 * What the AI is doing while a request is out: the EveryOps mark drawing itself, and one plain label with a
 * soft highlight sweeping across it. Only real steps get a label; after a while it counts seconds instead.
 */
export function Thinking({
  label,
  since,
  slowLabel = "Still thinking",
  slowAfter = 8,
  hint,
  avatar,
}: {
  label: string;
  /** When this step started (ms), for the seconds counter. Defaults to when this appeared. */
  since?: number;
  slowLabel?: string;
  slowAfter?: number;
  /** A short note beside the label, e.g. how long this usually takes. */
  hint?: string;
  /** Put the mark in the same box answers use, so the reply lands exactly where it was thinking. */
  avatar?: "square" | "round";
}) {
  const [now, setNow] = useState(() => Date.now());
  const [mounted] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const seconds = Math.max(0, Math.floor((now - (since ?? mounted)) / 1000));
  const slow = seconds >= slowAfter;
  const shown = slow ? slowLabel : label;

  return (
    <div className={cn("enter-up flex items-center text-[13.5px]", avatar ? "gap-3" : "gap-2.5")}>
      {avatar ? (
        <span
          className={cn(
            "flex size-7 shrink-0 items-center justify-center border bg-card text-primary",
            avatar === "square" ? "rounded-lg" : "rounded-full",
          )}
        >
          <LogoMarkThinking className="size-3.5" />
        </span>
      ) : (
        <LogoMarkThinking className="size-3.5 text-primary" />
      )}
      <output aria-live="polite" className="flex flex-wrap items-baseline gap-x-2">
        <span
          key={shown}
          className="shimmer-text animate-shimmer bg-clip-text font-medium text-transparent motion-reduce:animate-none"
        >
          {shown}
        </span>
        {slow ? (
          <span className="font-mono text-[11.5px] text-muted-foreground tabular">{seconds}s</span>
        ) : null}
        {hint ? <span className="text-[12px] text-muted-foreground">{hint}</span> : null}
      </output>
    </div>
  );
}

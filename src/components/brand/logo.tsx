import { useId } from "react";
import { cn } from "@/lib/utils";

/*
 * EveryOps mark: a stacked "E" of three pill bars with a shorter middle bar, lit top to bottom in the brand's
 * green (mint into teal). Matches public/brand/everyops-mark.svg.
 */
const BARS = [
  { y: 0, width: 92 },
  { y: 37, width: 60 },
  { y: 74, width: 92 },
] as const;
const H = 26;

/** The brand green, top to bottom. Kept in one place so the app, icons and brand files match. */
export const MARK_STOPS = [
  ["0", "#7ef0d2"],
  ["0.5", "#34c3a6"],
  ["1", "#14a08a"],
] as const;

export function LogoMark({ className, mono = false }: { className?: string; mono?: boolean }) {
  // Each mark has its own gradient id, so a hidden copy elsewhere on the page can't break it.
  const id = `eo-mark-${useId().replace(/:/g, "")}`;
  return (
    <svg
      viewBox="0 0 92 100"
      fill={mono ? "currentColor" : `url(#${id})`}
      aria-hidden="true"
      className={cn("size-4 shrink-0", className)}
    >
      {mono ? null : (
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="100" gradientUnits="userSpaceOnUse">
            {MARK_STOPS.map(([offset, color]) => (
              <stop key={offset} offset={offset} stopColor={color} />
            ))}
          </linearGradient>
        </defs>
      )}
      {BARS.map((b) => (
        <rect key={b.y} x="0" y={b.y} width={b.width} height={H} rx={H / 2} />
      ))}
    </svg>
  );
}

/**
 * The mark while the AI works, in white: each bar draws in toward the left edge and back, top to bottom, like the
 * "E" is being written. A loop, so it runs on CSS (off the main thread). Reduced motion shows the plain mark.
 */
export function LogoMarkThinking({ className }: { className?: string }) {
  const bar = "origin-left animate-mark [transform-box:fill-box] motion-reduce:animate-none";
  return (
    <svg
      viewBox="0 0 92 100"
      fill="currentColor"
      aria-hidden="true"
      className={cn("size-4 shrink-0 text-white", className)}
    >
      {BARS.map((b, i) => (
        <rect
          key={b.y}
          className={bar}
          style={i ? { animationDelay: `${i * 140}ms` } : undefined}
          x="0"
          y={b.y}
          width={b.width}
          height={H}
          rx={H / 2}
        />
      ))}
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 text-[15px] font-semibold tracking-tight text-foreground",
        className,
      )}
    >
      <LogoMark className="size-[16px]" />
      EveryOps
    </span>
  );
}

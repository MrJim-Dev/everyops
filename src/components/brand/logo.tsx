import { cn } from "@/lib/utils";

/**
 * EveryOps mark: a stacked "E" of three rounded bars with a shorter middle bar.
 * Drawn in the current text color so it follows the theme. Matches public/brand/everyops-mark.svg.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 92 100"
      fill="currentColor"
      aria-hidden="true"
      className={cn("size-4 shrink-0", className)}
    >
      <rect x="0" y="0" width="92" height="26" rx="11" />
      <rect x="0" y="37" width="60" height="26" rx="11" />
      <rect x="0" y="74" width="92" height="26" rx="11" />
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

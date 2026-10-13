import type { Tone } from "@/lib/blueprint/types";
import { cn } from "@/lib/utils";

const DOT: Record<Tone, string> = {
  neutral: "bg-muted-foreground/60",
  accent: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
};

const TEXT: Record<Tone, string> = {
  neutral: "text-muted-foreground",
  accent: "text-foreground",
  success: "text-foreground",
  warning: "text-warning",
  danger: "text-destructive",
};

/** Status as a dot plus words, so meaning never depends on colour alone. */
export function StatusBadge({ label, tone, className }: { label: string; tone: Tone; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap text-[13px] transition-colors duration-200",
        TEXT[tone],
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn("size-1.5 shrink-0 rounded-full transition-colors duration-200", DOT[tone])}
      />
      {label}
    </span>
  );
}

/** Status in a record header. Keyed by label so a change (Unpaid → Paid) pops in. */
export function StatusPill({ label, tone }: { label: string; tone: Tone }) {
  return (
    <span key={label} className="inline-flex h-6 animate-pop items-center rounded-full border px-2.5">
      <StatusBadge label={label} tone={tone} className="text-[12px]" />
    </span>
  );
}

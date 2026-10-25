import { isUnlimited } from "@/lib/billing/plans";
import { cn } from "@/lib/utils";

/**
 * One limit as a bar: what's used of what the plan allows. Amber from 80%, red when it's full, and a quiet
 * "Not included" or "Unlimited" when there's nothing to fill, so the eye goes to the limits that are close.
 */
export function Meter({
  label,
  used,
  limit,
  unlimited = isUnlimited(limit),
  show = (n) => n.toLocaleString("en-US"),
  hint,
}: {
  label: string;
  used: number;
  limit: number;
  /** Pass when the limit is in other units than isUnlimited expects (storage in bytes). */
  unlimited?: boolean;
  show?: (n: number) => string;
  hint?: string;
}) {
  const excluded = !unlimited && limit <= 0;
  const pct = unlimited || excluded ? 0 : Math.min(100, (used / limit) * 100);
  const tone = excluded || unlimited ? "none" : pct >= 100 ? "full" : pct >= 80 ? "near" : "ok";
  return (
    <div className="flex min-w-0 flex-col gap-1.5" data-tone={tone}>
      <div className="flex items-baseline justify-between gap-3 text-[13px]">
        <span className="truncate text-muted-foreground">{label}</span>
        {excluded ? (
          <span className="shrink-0 text-[12.5px] text-muted-foreground">Not included</span>
        ) : (
          <span className="shrink-0 font-mono text-[12.5px] tabular-nums">
            <span className={cn(tone === "full" && "text-destructive", tone === "near" && "text-amber-400")}>
              {show(used)}
            </span>
            <span className="text-muted-foreground"> / {unlimited ? "Unlimited" : show(limit)}</span>
          </span>
        )}
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-foreground/[0.07]" aria-hidden="true">
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-500 ease-out",
            tone === "full" ? "bg-destructive" : tone === "near" ? "bg-amber-400" : "bg-primary",
          )}
          style={{ width: `${Math.max(pct, used > 0 && tone !== "none" ? 2 : 0)}%` }}
        />
      </div>
      {hint ? <span className="truncate text-[12px] text-muted-foreground">{hint}</span> : null}
    </div>
  );
}

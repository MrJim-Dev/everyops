import { cn } from "@/lib/utils";

/** Hulma mark: an outlined rounded square with a horizontal notch. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" className={cn("size-4 shrink-0", className)}>
      <rect x="1.75" y="1.75" width="12.5" height="12.5" rx="3.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5.25 8h5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
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
      <LogoMark className="size-[18px]" />
      Hulma
    </span>
  );
}

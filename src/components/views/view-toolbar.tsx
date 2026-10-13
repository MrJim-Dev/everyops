import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Thin row under the view tabs for filters, dates and counts. */
export function ViewToolbar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-h-11 shrink-0 flex-wrap items-center gap-2 border-b px-5 py-2", className)}>
      {children}
    </div>
  );
}

export function ToolbarSummary({ children }: { children: ReactNode }) {
  return (
    <span className="ml-auto whitespace-nowrap text-[12px] text-muted-foreground tabular">{children}</span>
  );
}

"use client";

import { LogoMarkThinking } from "@/components/brand/logo";
import { Skeleton } from "@/components/ui/skeleton";
import { useMounted } from "@/hooks/use-mounted";

export function ShellSkeleton() {
  // Arriving from the home prompt (CreatePrompt marks the page): no skeleton flash between the two screens, just
  // the quiet mark until the setup chat rises in.
  const fromPrompt = useMounted() && "eoLeaving" in document.documentElement.dataset;
  if (fromPrompt)
    return (
      <div className="flex h-dvh items-center justify-center bg-shell" aria-busy="true">
        <span className="flex items-center gap-2.5 text-[13.5px] text-muted-foreground">
          <LogoMarkThinking className="size-3.5" />
          Starting your workspace
        </span>
      </div>
    );
  return (
    <div className="flex h-dvh bg-shell" aria-busy="true">
      <span className="sr-only">Loading workspace</span>
      <div className="hidden w-[232px] shrink-0 flex-col gap-3 p-3 md:flex">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="mt-4 h-6 w-32" />
        <Skeleton className="h-6 w-28" />
        <Skeleton className="mt-4 h-6 w-36" />
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-6 w-24" />
      </div>
      <div className="flex flex-1 p-2 md:pl-0">
        <div className="flex flex-1 flex-col gap-4 rounded-lg border bg-background p-5">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-72" />
          <div className="mt-4 flex flex-col gap-2">
            {Array.from({ length: 8 }, (_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

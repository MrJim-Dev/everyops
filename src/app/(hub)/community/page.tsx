import type { Metadata } from "next";
import { Suspense } from "react";
import { CommunityBrowser } from "@/components/community/community-browser";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Community systems" };

function BrowserSkeleton() {
  return (
    <div className="flex flex-col gap-12" aria-busy="true">
      <span className="sr-only">Loading systems</span>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-[320px] rounded-2xl" />
        ))}
      </div>
    </div>
  );
}

export default function CommunityPage() {
  return (
    <div className="relative flex flex-col gap-10 pt-14">
      <div
        aria-hidden="true"
        className="bg-grid pointer-events-none absolute inset-x-[-20vw] top-0 h-[420px]"
      />
      <div className="relative flex max-w-[620px] flex-col gap-3">
        <h1 className="animate-rise text-[34px] font-semibold leading-[1.08] tracking-[-0.03em] sm:text-[42px]">
          Community systems
        </h1>
        <p
          className="animate-rise stagger text-[15.5px] leading-relaxed text-muted-foreground"
          style={{ "--i": 1 } as React.CSSProperties}
        >
          Open-source systems built and run by real businesses. Preview any of them with sample data, then
          copy one into your workspace and change it by asking.
        </p>
      </div>
      <Suspense fallback={<BrowserSkeleton />}>
        <CommunityBrowser />
      </Suspense>
    </div>
  );
}

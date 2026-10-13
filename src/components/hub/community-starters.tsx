"use client";

import { ArrowRightIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SystemCard } from "@/components/community/system-card";
import { useCatalog } from "@/lib/community/use-catalog";

export function CommunityStarters() {
  const router = useRouter();
  const catalog = useCatalog();
  return (
    <section className="flex flex-col gap-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-[17px] font-semibold tracking-[-0.01em]">Start with a community system</h2>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Open-source systems you can use as-is or make your own.
          </p>
        </div>
        <Link
          href="/community"
          className="group inline-flex shrink-0 items-center gap-1 rounded-sm text-[13px] text-primary outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          Browse all systems
          <ArrowRightIcon className="size-3.5 transition-transform duration-150 group-hover:translate-x-0.5" />
        </Link>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {catalog.map((system, i) => (
          <SystemCard
            key={system.id}
            index={i + 5}
            system={system}
            onSelect={() => router.push(`/community?system=${system.id}`)}
          />
        ))}
      </div>
    </section>
  );
}

"use client";

import { ArrowRightIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SystemCard } from "@/components/community/system-card";
import { CATALOG } from "@/lib/catalog";

export function CommunityStarters() {
  const router = useRouter();
  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-semibold">Start with a community system</h2>
        <Link
          href="/community"
          className="inline-flex items-center gap-1 rounded-sm text-[13px] text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          Browse all
          <ArrowRightIcon className="size-3.5" />
        </Link>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {CATALOG.slice(0, 3).map((system) => (
          <SystemCard key={system.id} system={system} onSelect={() => router.push(`/preview/${system.id}`)} />
        ))}
      </div>
    </section>
  );
}

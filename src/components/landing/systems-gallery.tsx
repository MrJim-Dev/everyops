"use client";

import { ArrowUpRightIcon, UsersIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { formatUses } from "@/components/community/system-card";
import { SystemThumbnail } from "@/components/community/system-thumbnail";
import { SystemIcon } from "@/components/system-icon";
import { CATALOG, CATEGORIES, type CatalogSystem } from "@/lib/catalog";

const categoryLabel = (system: CatalogSystem) => CATEGORIES.find((c) => c.id === system.category)?.label;

/**
 * Community systems on a track that slides sideways while the section stays pinned.
 * On small screens, or without scroll-driven animation support, it's a swipeable row.
 */
export function SystemsGallery() {
  return (
    <section id="systems" aria-labelledby="systems-title" className="gallery relative scroll-mt-0">
      <div className="gallery-stage py-20 md:py-0">
        <div className="mx-auto mb-10 flex w-full max-w-[1120px] flex-col justify-between gap-6 px-5 sm:flex-row sm:items-end">
          <div className="max-w-[560px]">
            <h2
              id="systems-title"
              className="text-balance text-[32px] font-semibold leading-[1.1] tracking-[-0.025em] sm:text-[40px]"
            >
              Every kind of business, one workspace.
            </h2>
            <p className="mt-4 text-[16px] leading-relaxed text-muted-foreground">
              Start from a system someone already runs their business on, preview it with sample data, then
              make it yours.
            </p>
          </div>
          <Link
            href="/community"
            className="inline-flex h-10 shrink-0 items-center self-start rounded-xl border px-4 text-[13.5px] font-medium outline-none transition-[border-color,background-color] duration-150 hover:border-foreground/25 hover:bg-card focus-visible:ring-2 focus-visible:ring-ring/50 sm:self-auto"
          >
            Browse all systems
          </Link>
        </div>
        <ul className="gallery-track flex snap-x snap-mandatory scroll-px-5 gap-5 overflow-x-auto px-5 pb-4 [scrollbar-width:none] md:px-[max(1.25rem,calc((100vw-1120px)/2+1.25rem))]">
          {CATALOG.map((system) => (
            <li key={system.id} className="w-[82vw] shrink-0 snap-start sm:w-[440px] lg:w-[500px]">
              <GalleryCard system={system} />
            </li>
          ))}
        </ul>
        <div className="mx-auto mt-8 hidden w-full max-w-[1120px] px-5 md:block">
          <div className="h-px w-full bg-border">
            <span aria-hidden="true" className="gallery-progress h-px w-full bg-primary" />
          </div>
        </div>
      </div>
    </section>
  );
}

function GalleryCard({ system }: { system: CatalogSystem }) {
  return (
    <Link
      href={`/preview/${system.id}`}
      className="group flex flex-col gap-4 rounded-2xl border border-foreground/[0.08] bg-card/60 p-3 outline-none transition-[border-color,background-color] duration-200 hover:border-foreground/20 hover:bg-card focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <div className="overflow-hidden rounded-xl">
        <SystemThumbnail
          system={system}
          className="rounded-xl transition-transform duration-300 ease-[var(--ease-out-strong)] group-hover:scale-[1.02]"
        />
      </div>
      <div className="flex items-start gap-3 px-1 pb-1">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <SystemIcon name={system.icon} className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-[15px] font-medium">
            {system.name}
            <span className="rounded-full border px-2 text-[11px] font-normal leading-5 text-muted-foreground">
              {categoryLabel(system)}
            </span>
          </p>
          <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-muted-foreground">
            {system.summary}
          </p>
          <p className="mt-3 flex items-center gap-1.5 text-[12px] text-muted-foreground tabular">
            <UsersIcon className="size-3.5" />
            {formatUses(system.uses)} businesses use it
          </p>
        </div>
        <ArrowUpRightIcon className="size-4 shrink-0 text-muted-foreground transition-[color,transform] duration-150 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-foreground" />
      </div>
    </Link>
  );
}

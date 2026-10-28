"use client";

import { ArrowUpRightIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { useMemo } from "react";
import { SegmentedControl } from "@/components/motion/segmented-control";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { SearchInput } from "@/components/views/search-input";
import { ViewEmpty } from "@/components/views/view-empty";
import { useCurrentUser } from "@/lib/auth/client";
import { CATEGORIES } from "@/lib/catalog";
import { byUsage, usageBadges, usageOf } from "@/lib/community/usage";
import { useCatalog, useCatalogLoaded } from "@/lib/community/use-catalog";
import { SystemCard } from "./system-card";
import { SystemDetail } from "./system-detail";
import { SOURCES, type Sort, type Source, sourceOf, useCommunityFilters } from "./use-community-filters";

const SORTS: Record<Sort, string> = { uses: "Most used", newest: "Newest", name: "Name" };

function Count({ n }: { n: number }) {
  return <span className="ml-1.5 text-[12px] font-normal text-muted-foreground tabular">{n}</span>;
}

export function CommunityBrowser() {
  const catalog = useCatalog();
  const loaded = useCatalogLoaded();
  const user = useCurrentUser();
  const f = useCommunityFilters();

  const { systems, counts } = useMemo(() => {
    const q = f.query.trim().toLowerCase();
    // Counts ignore the category itself, so each tab shows what picking it would bring.
    const pool = catalog
      .filter((s) => !q || `${s.name} ${s.summary} ${s.author}`.toLowerCase().includes(q))
      .filter((s) => f.source === "all" || sourceOf(s, user?.id) === f.source);
    const counts: Record<string, number> = { all: pool.length };
    for (const s of pool) counts[s.category] = (counts[s.category] ?? 0) + 1;
    const systems = pool
      .filter((s) => f.category === "all" || s.category === f.category)
      .sort((a, b) =>
        f.sort === "name"
          ? a.name.localeCompare(b.name)
          : f.sort === "newest"
            ? (b.publishedAt ?? "").localeCompare(a.publishedAt ?? "")
            : byUsage(usageOf(a), usageOf(b)),
      );
    return { systems, counts };
  }, [catalog, f.query, f.source, f.category, f.sort, user?.id]);
  // Marks are worked out across all of Community, so filtering never turns a quiet system into the most used one.
  const badges = useMemo(
    () => usageBadges(catalog.map((s) => ({ id: s.id, publishedAt: s.publishedAt, ...usageOf(s) }))),
    [catalog],
  );

  const selected = f.selectedId ? catalog.find((s) => s.id === f.selectedId) : undefined;
  const sources = (Object.keys(SOURCES) as Source[]).filter((s) => s !== "yours" || user);

  // Community systems come from the database: show a skeleton while they load, and say so if they can't.
  if (catalog.length === 0) {
    return loaded ? (
      <ViewEmpty title="Community systems aren't available" description="Reload the page to try again." />
    ) : (
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex flex-col gap-3 p-1.5">
            <Skeleton className="aspect-[16/10] rounded-xl" />
            <Skeleton className="h-4 w-2/5" />
            <Skeleton className="h-4 w-4/5" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-4 border-b pb-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="-mx-5 overflow-x-auto px-5 [scrollbar-width:none] xl:mx-0 xl:px-0">
          <SegmentedControl
            label="Category"
            value={f.category}
            onValueChange={f.setCategory}
            className="flex-nowrap"
            options={[
              {
                value: "all",
                label: (
                  <>
                    All
                    <Count n={counts.all ?? 0} />
                  </>
                ),
              },
              ...CATEGORIES.map((c) => ({
                value: c.id,
                label: (
                  <>
                    {c.label}
                    <Count n={counts[c.id] ?? 0} />
                  </>
                ),
              })),
            ]}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-[180px] flex-1 xl:w-[240px] xl:flex-none [&>div]:max-w-none">
            <SearchInput value={f.query} onChange={f.setQuery} placeholder="Search systems" />
          </div>
          <Select value={f.source} onValueChange={(v) => f.setSource(v as Source)} items={SOURCES}>
            <SelectTrigger size="sm" className="w-[168px]" aria-label="Source">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectGroup>
                {sources.map((s) => (
                  <SelectItem key={s} value={s}>
                    {SOURCES[s]}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Select value={f.sort} onValueChange={(v) => f.setSort(v as Sort)} items={SORTS}>
            <SelectTrigger size="sm" className="w-[124px]" aria-label="Sort">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectGroup>
                {Object.entries(SORTS).map(([id, label]) => (
                  <SelectItem key={id} value={id}>
                    {label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      </div>
      <p className="sr-only" aria-live="polite">
        {systems.length === 1 ? "1 system" : `${systems.length} systems`}
      </p>
      {systems.length === 0 ? (
        <ViewEmpty
          title={f.source === "yours" ? "You haven't published anything yet" : "No systems match"}
          description={
            f.source === "yours"
              ? "Make one of your workspaces public from the Workspaces page."
              : "Try another category or a different word."
          }
          actionLabel={f.active ? "Show all systems" : undefined}
          onAction={f.active ? () => f.clear() : undefined}
        />
      ) : (
        <div className="grid grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2 xl:grid-cols-3">
          {systems.map((s, i) => (
            <SystemCard
              key={s.id}
              index={i}
              system={s}
              badge={badges.get(s.id)}
              selected={s.id === selected?.id}
              onSelect={() => f.open(s.id)}
            />
          ))}
        </div>
      )}
      {user ? (
        <Link
          href="/workspaces"
          className="group flex items-center justify-between gap-4 rounded-2xl border border-dashed px-5 py-4 outline-none transition-[border-color,background-color] duration-150 hover:border-primary/40 hover:bg-primary/[0.03] focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <span>
            <span className="block text-[14px] font-medium">Share a system you built</span>
            <span className="mt-0.5 block text-[13px] text-muted-foreground">
              Make any workspace public. Only its design is shared; your records stay private.
            </span>
          </span>
          <ArrowUpRightIcon className="size-4 shrink-0 text-muted-foreground transition-transform duration-150 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
        </Link>
      ) : null}
      <Sheet open={!!selected} onOpenChange={(open) => !open && f.close()}>
        <SheetContent className="w-full gap-0 overflow-y-auto p-0 sm:max-w-[480px]">
          {selected ? (
            <>
              <SheetTitle className="sr-only">{selected.name}</SheetTitle>
              <SystemDetail system={selected} />
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

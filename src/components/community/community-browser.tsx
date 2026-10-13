"use client";

import { FunnelSimpleIcon } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
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
import { useCatalog, useCatalogLoaded } from "@/lib/community/use-catalog";
import { CommunityFilters } from "./community-filters";
import { SystemCard } from "./system-card";
import { SystemDetail } from "./system-detail";
import { type Sort, sourceOf, useCommunityFilters } from "./use-community-filters";

const SORTS: Record<Sort, string> = { uses: "Most used", name: "Name" };

function countBy<T>(items: T[], key: (item: T) => string) {
  const counts: Record<string, number> = {};
  for (const item of items) counts[key(item)] = (counts[key(item)] ?? 0) + 1;
  return counts;
}

export function CommunityBrowser() {
  const catalog = useCatalog();
  const loaded = useCatalogLoaded();
  const user = useCurrentUser();
  const f = useCommunityFilters();
  const [filtersOpen, setFiltersOpen] = useState(false);

  const { systems, categoryCounts, sourceCounts } = useMemo(() => {
    const q = f.query.trim().toLowerCase();
    const matchesQuery = catalog.filter(
      (s) => !q || `${s.name} ${s.summary} ${s.author}`.toLowerCase().includes(q),
    );
    const bySource = matchesQuery.filter(
      (s) => !f.sources.length || f.sources.includes(sourceOf(s, user?.id)),
    );
    const byCategory = matchesQuery.filter((s) => !f.categories.length || f.categories.includes(s.category));
    return {
      // Facet counts ignore their own facet, so you can see what adding an option would bring.
      categoryCounts: countBy(bySource, (s) => s.category),
      sourceCounts: countBy(byCategory, (s) => sourceOf(s, user?.id)),
      systems: bySource
        .filter((s) => !f.categories.length || f.categories.includes(s.category))
        .sort((a, b) => (f.sort === "uses" ? b.uses - a.uses : a.name.localeCompare(b.name))),
    };
  }, [catalog, f.query, f.sources, f.categories, f.sort, user?.id]);

  const selected = f.selectedId ? catalog.find((s) => s.id === f.selectedId) : undefined;
  const filterPanel = (
    <CommunityFilters
      categories={f.categories}
      sources={f.sources}
      categoryCounts={categoryCounts}
      sourceCounts={sourceCounts}
      onToggleCategory={f.toggleCategory}
      onToggleSource={f.toggleSource}
      onClear={f.clear}
      active={f.categories.length + f.sources.length > 0}
    />
  );

  // Community systems come from the database: show a skeleton while they load, and say so if they can't.
  if (catalog.length === 0) {
    return loaded ? (
      <ViewEmpty title="Community systems aren't available" description="Reload the page to try again." />
    ) : (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-56 rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-12">
      <div className="grid gap-10 lg:grid-cols-[208px_minmax(0,1fr)]">
        <aside aria-label="Filters" className="hidden lg:block">
          <div className="sticky top-20">{filterPanel}</div>
        </aside>
        <div className="flex min-w-0 flex-col gap-5">
          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-[200px] flex-1 [&>div]:h-9 [&>div]:max-w-none">
              <SearchInput value={f.query} onChange={f.setQuery} placeholder="Search systems, authors…" />
            </div>
            <Button variant="outline" className="h-9 lg:hidden" onClick={() => setFiltersOpen(true)}>
              <FunnelSimpleIcon data-icon="inline-start" />
              Filters
            </Button>
            <Select value={f.sort} onValueChange={(v) => f.setSort(v as Sort)} items={SORTS}>
              <SelectTrigger className="h-9 w-[140px]" aria-label="Sort">
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
          <p className="text-[13px] text-muted-foreground" aria-live="polite">
            {systems.length === 1 ? "1 system" : `${systems.length} systems`}
          </p>
          {systems.length === 0 ? (
            <ViewEmpty
              title="No systems match"
              description="Try fewer filters or a different word."
              actionLabel={f.active ? "Clear filters" : undefined}
              onAction={f.active ? () => f.clear() : undefined}
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {systems.map((s, i) => (
                <SystemCard
                  key={s.id}
                  index={i}
                  system={s}
                  selected={s.id === selected?.id}
                  onSelect={() => f.open(s.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
      <Sheet open={!!selected} onOpenChange={(open) => !open && f.close()}>
        <SheetContent className="w-full gap-0 overflow-y-auto p-0 sm:max-w-[460px]">
          {selected ? (
            <>
              <SheetTitle className="sr-only">{selected.name}</SheetTitle>
              <SystemDetail system={selected} />
            </>
          ) : null}
        </SheetContent>
      </Sheet>
      <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
        <SheetContent side="left" className="w-[300px] p-5">
          <SheetTitle className="sr-only">Filters</SheetTitle>
          {filterPanel}
        </SheetContent>
      </Sheet>
    </div>
  );
}

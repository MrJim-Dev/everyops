"use client";

import { useMemo, useState } from "react";
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
import { useCatalog, useCatalogLoaded } from "@/lib/community/use-catalog";
import { SystemCard } from "./system-card";
import { SystemDetail } from "./system-detail";

const SORTS = { uses: "Most used", name: "Name" } as const;

export function CommunityBrowser() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [sort, setSort] = useState<keyof typeof SORTS>("uses");
  const catalog = useCatalog();
  const loaded = useCatalogLoaded();
  const user = useCurrentUser();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  const systems = useMemo(() => {
    const q = query.trim().toLowerCase();
    return catalog
      .filter((s) =>
        category === "mine"
          ? !!user && s.authorId === user.id
          : category === "all" || s.category === category,
      )
      .filter((s) => !q || `${s.name} ${s.summary} ${s.author}`.toLowerCase().includes(q))
      .sort((a, b) => (sort === "uses" ? b.uses - a.uses : a.name.localeCompare(b.name)));
  }, [catalog, query, category, sort, user]);
  const selected = catalog.find((s) => s.id === selectedId) ?? systems[0] ?? catalog[0];

  if (!selected) {
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
    <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
      <div className="flex min-w-0 flex-col gap-5">
        <div className="flex flex-wrap items-center gap-3">
          <SearchInput value={query} onChange={setQuery} placeholder="Find a system" />
          <SegmentedControl
            label="Category"
            value={category}
            onValueChange={setCategory}
            options={[
              { value: "all", label: "All" },
              ...CATEGORIES.map((c) => ({ value: c.id, label: c.label })),
              ...(user && catalog.some((s) => s.authorId === user.id)
                ? [{ value: "mine", label: "Yours" }]
                : []),
            ]}
          />
          <Select value={sort} onValueChange={(v) => setSort(v as keyof typeof SORTS)} items={SORTS}>
            <SelectTrigger size="sm" className="ml-auto w-[132px]" aria-label="Sort">
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
        {systems.length === 0 ? (
          <ViewEmpty title="No systems match" description="Try another word or category." />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {systems.map((s, i) => (
              <SystemCard
                key={s.id}
                index={i}
                system={s}
                selected={s.id === selected.id}
                onSelect={() => {
                  setSelectedId(s.id);
                  if (window.matchMedia("(max-width: 1023px)").matches) setMobileOpen(true);
                }}
              />
            ))}
          </div>
        )}
      </div>
      <aside aria-label="Selected system" className="hidden lg:block">
        <div className="sticky top-6 rounded-xl border bg-card/40 p-4">
          <SystemDetail system={selected} />
        </div>
      </aside>
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent className="w-full overflow-y-auto p-5 sm:max-w-[400px]">
          <SheetTitle className="sr-only">{selected.name}</SheetTitle>
          <SystemDetail system={selected} />
        </SheetContent>
      </Sheet>
    </div>
  );
}

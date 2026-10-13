"use client";

import { CheckIcon } from "@phosphor-icons/react";
import { CATEGORIES, type CatalogCategory } from "@/lib/catalog";
import { cn } from "@/lib/utils";
import { SOURCES, type Source } from "./use-community-filters";

type Props = {
  categories: CatalogCategory[];
  sources: Source[];
  categoryCounts: Record<string, number>;
  sourceCounts: Record<string, number>;
  onToggleCategory: (c: CatalogCategory) => void;
  onToggleSource: (s: Source) => void;
  onClear: () => void;
  active: boolean;
};

/** Faceted filters, Vercel-template style: checkboxes with counts, a clear action when anything is set. */
export function CommunityFilters(props: Props) {
  return (
    <div className="flex flex-col gap-7">
      <div className="flex h-6 items-center justify-between">
        <p className="text-[13px] font-medium">Filter systems</p>
        <button
          type="button"
          onClick={props.onClear}
          className={cn(
            "rounded-sm text-[12.5px] text-muted-foreground outline-none transition-opacity duration-150 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
            !props.active && "pointer-events-none opacity-0",
          )}
          tabIndex={props.active ? 0 : -1}
        >
          Clear
        </button>
      </div>
      <FilterGroup title="Category">
        {CATEGORIES.map((c) => (
          <FilterOption
            key={c.id}
            label={c.label}
            count={props.categoryCounts[c.id] ?? 0}
            checked={props.categories.includes(c.id)}
            onChange={() => props.onToggleCategory(c.id)}
          />
        ))}
      </FilterGroup>
      <FilterGroup title="Source">
        {SOURCES.filter((s) => s.id !== "yours" || props.sourceCounts.yours).map((s) => (
          <FilterOption
            key={s.id}
            label={s.label}
            count={props.sourceCounts[s.id] ?? 0}
            checked={props.sources.includes(s.id)}
            onChange={() => props.onToggleSource(s.id)}
          />
        ))}
      </FilterGroup>
    </div>
  );
}

function FilterGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-0.5">
      <legend className="mb-2 text-[12px] text-muted-foreground">{title}</legend>
      {children}
    </fieldset>
  );
}

function FilterOption({
  label,
  count,
  checked,
  onChange,
}: {
  label: string;
  count: number;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label
      className={cn(
        "flex h-8 cursor-pointer items-center gap-2.5 rounded-md px-2 text-[13px] transition-colors duration-150 hover:bg-muted has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50",
        count === 0 && !checked && "opacity-50",
      )}
    >
      <input type="checkbox" checked={checked} onChange={onChange} className="sr-only" />
      <span
        aria-hidden="true"
        className={cn(
          "flex size-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors duration-150",
          checked ? "border-primary bg-primary text-primary-foreground" : "border-input bg-input/30",
        )}
      >
        {checked ? <CheckIcon weight="bold" className="size-3 animate-pop" /> : null}
      </span>
      <span className={cn("flex-1", checked ? "text-foreground" : "text-muted-foreground")}>{label}</span>
      <span className="text-[12px] text-muted-foreground tabular">{count}</span>
    </label>
  );
}

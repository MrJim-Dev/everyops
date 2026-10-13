"use client";

import { ArrowUpRightIcon, SealCheckIcon, UsersIcon } from "@phosphor-icons/react";
import type { CatalogSystem } from "@/lib/catalog";
import { formatNumber, initials } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SystemShot } from "./system-shot";

export function formatUses(uses: number) {
  return uses >= 1000 ? `${formatNumber(Math.round(uses / 100) / 10)}K` : formatNumber(uses);
}

/** Template-gallery card: the screenshot carries the card, the text stays quiet underneath. */
export function SystemCard({
  system,
  selected,
  onSelect,
  index,
}: {
  system: CatalogSystem;
  selected?: boolean;
  onSelect: () => void;
  /** Position in a grid; staggers the first-load entrance. */
  index?: number;
}) {
  const official = !system.authorId;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      style={index === undefined ? undefined : ({ "--i": index } as React.CSSProperties)}
      className={cn(
        "group flex h-full flex-col rounded-2xl p-1.5 text-left outline-none transition-[background-color,transform] duration-200 hover:bg-card/60 focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.99]",
        index !== undefined && "animate-rise stagger",
        selected && "bg-card/60",
      )}
    >
      <div
        className={cn(
          "overflow-hidden rounded-xl border border-foreground/[0.08] shadow-[0_18px_40px_-28px_rgba(0,0,0,0.9)] transition-[border-color] duration-200 group-hover:border-foreground/20",
          selected && "border-primary/60 group-hover:border-primary/60",
        )}
      >
        <SystemShot
          system={system}
          className="transition-transform duration-300 ease-(--ease-out-strong) group-hover:scale-[1.015]"
        />
      </div>
      <div className="flex flex-1 flex-col px-1.5 pt-3.5 pb-1.5">
        <div className="flex items-center gap-2">
          <p className="truncate text-[14.5px] font-medium tracking-[-0.01em]">{system.name}</p>
          {official ? (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary">
              <SealCheckIcon weight="fill" className="size-3" />
              Official
            </span>
          ) : null}
          <ArrowUpRightIcon className="ml-auto size-4 shrink-0 text-muted-foreground opacity-0 transition-[opacity,transform] duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:opacity-100 group-focus-visible:opacity-100" />
        </div>
        <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-muted-foreground">
          {system.summary}
        </p>
        <div className="mt-auto flex items-center justify-between gap-3 pt-3.5 text-[12px] text-muted-foreground">
          <span className="flex min-w-0 items-center gap-2">
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-secondary text-[9px] font-medium text-foreground">
              {initials(system.author)}
            </span>
            <span className="truncate">{system.author}</span>
          </span>
          <span className="flex shrink-0 items-center gap-1 tabular">
            <UsersIcon className="size-3.5" />
            {system.uses ? formatUses(system.uses) : "New"}
          </span>
        </div>
      </div>
    </button>
  );
}

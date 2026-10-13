"use client";

import { UsersIcon } from "@phosphor-icons/react";
import { SystemIcon } from "@/components/system-icon";
import type { CatalogSystem } from "@/lib/catalog";
import { formatNumber, initials } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SystemThumbnail } from "./system-thumbnail";

export function formatUses(uses: number) {
  return uses >= 1000 ? `${formatNumber(Math.round(uses / 100) / 10)}K` : formatNumber(uses);
}

/** Moves the card's spotlight to the pointer. Only fine pointers see it (see .spotlight). */
function trackPointer(e: React.PointerEvent<HTMLElement>) {
  const el = e.currentTarget;
  const rect = el.getBoundingClientRect();
  el.style.setProperty("--x", `${e.clientX - rect.left}px`);
  el.style.setProperty("--y", `${e.clientY - rect.top}px`);
}

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
  return (
    <button
      type="button"
      onClick={onSelect}
      onPointerMove={trackPointer}
      aria-pressed={selected}
      style={index === undefined ? undefined : ({ "--i": index } as React.CSSProperties)}
      className={cn(
        "spotlight group relative flex h-full flex-col rounded-2xl border border-foreground/[0.07] bg-card/50 text-left outline-none transition-[border-color,background-color,transform] duration-200",
        "hover:border-foreground/15 hover:bg-card focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.99]",
        index !== undefined && "animate-rise stagger",
        selected && "border-primary/60 bg-primary/[0.04]",
      )}
    >
      <div className="relative m-1.5 mb-0 overflow-hidden rounded-xl border border-foreground/[0.06] bg-shell px-4 pt-4">
        <div aria-hidden="true" className="bg-grid absolute inset-0 opacity-70" />
        <SystemThumbnail
          system={system}
          className="relative translate-y-1.5 rounded-b-none border-b-0 shadow-[0_-10px_40px_-12px_rgba(0,0,0,0.8)] transition-transform duration-300 ease-(--ease-out-strong) group-hover:translate-y-0"
        />
      </div>
      <div className="relative flex flex-1 flex-col gap-4 p-4">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/15">
            <SystemIcon name={system.icon} className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-[14.5px] font-medium tracking-[-0.01em]">{system.name}</p>
            <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-relaxed text-muted-foreground">
              {system.summary}
            </p>
          </div>
        </div>
        <div className="mt-auto flex items-center justify-between gap-3 text-[12px] text-muted-foreground">
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

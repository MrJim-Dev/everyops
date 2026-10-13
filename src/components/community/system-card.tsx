"use client";

import { UsersIcon } from "@phosphor-icons/react";
import type { CatalogSystem } from "@/lib/catalog";
import { formatNumber, initials } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SystemThumbnail } from "./system-thumbnail";

export function formatUses(uses: number) {
  return uses >= 1000 ? `${formatNumber(Math.round(uses / 100) / 10)}K` : formatNumber(uses);
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
      aria-pressed={selected}
      style={index === undefined ? undefined : ({ "--i": index } as React.CSSProperties)}
      className={cn(
        "flex flex-col gap-3 rounded-lg border p-2 pb-3 text-left outline-none transition-[border-color,background-color,transform] duration-150",
        "hover:border-foreground/20 focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.99]",
        index !== undefined && "animate-rise stagger",
        selected && "border-primary/70 bg-primary/[0.04]",
      )}
    >
      <SystemThumbnail system={system} />
      <div className="flex items-start gap-2.5 px-1">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary text-[10px] font-medium">
          {initials(system.author)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] font-medium">{system.name}</p>
          <p className="truncate text-[12px] text-muted-foreground">
            {system.author} · {system.license} · v{system.version}
          </p>
        </div>
        <span className="flex shrink-0 items-center gap-1 text-[12px] text-muted-foreground tabular">
          <UsersIcon className="size-3.5" />
          {formatUses(system.uses)}
        </span>
      </div>
    </button>
  );
}

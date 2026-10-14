"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { RailTip } from "./rail-tip";

/** Labels fade as the sidebar narrows; icons never move, so the rail keeps their positions. */
/** Items narrow to their icon with the frame, so highlights stay rounded instead of cut off. */
export const RAIL_ITEM =
  "transition-[width,background-color,color] duration-[260ms] ease-(--ease-drawer) group-data-[instant=true]/shell:duration-0";
export const railWidth = (rail: boolean) => (rail ? "w-8" : "w-full");

export const RAIL_LABEL =
  "transition-opacity duration-150 ease-(--ease-out-strong) group-data-[rail=true]/sidebar:opacity-0 group-data-[rail=false]/sidebar:delay-75";

/**
 * The current page: a faint teal tint at the item's left edge that fades out across it, and a teal icon. No border.
 * It sweeps in from the left when the item becomes current (a page change, tens of times a day, so it's short);
 * reduced motion skips the sweep. Set data-active on the item.
 */
export const ACTIVE_ITEM = cn(
  "relative isolate",
  "before:pointer-events-none before:absolute before:inset-0 before:-z-10 before:rounded-[inherit]",
  "before:bg-[linear-gradient(90deg,color-mix(in_oklab,var(--primary)_13%,transparent),color-mix(in_oklab,var(--primary)_3%,transparent)_60%,transparent)]",
  "before:origin-left before:scale-x-[0.35] before:opacity-0",
  "before:transition-[transform,opacity] before:duration-[280ms] before:ease-(--ease-out-strong)",
  "data-[active=true]:before:scale-x-100 data-[active=true]:before:opacity-100",
  "data-[active=true]:text-foreground",
  "data-[active=true]:[&_svg]:text-primary",
  "[&_svg]:transition-colors [&_svg]:duration-200",
);

export function SidebarLink({
  href,
  active,
  icon,
  children,
  trailing,
  onNavigate,
  rail = false,
}: {
  href: string;
  active?: boolean;
  icon: ReactNode;
  children: ReactNode;
  trailing?: ReactNode;
  onNavigate?: () => void;
  rail?: boolean;
}) {
  return (
    <RailTip rail={rail} label={children}>
      <Link
        href={href}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        data-active={!!active}
        aria-label={rail && typeof children === "string" ? children : undefined}
        className={cn(
          "group/link flex h-8 items-center gap-2.5 overflow-hidden rounded-md px-2 text-[13px] whitespace-nowrap text-sidebar-foreground outline-none",
          RAIL_ITEM,
          railWidth(rail),
          ACTIVE_ITEM,
          "hover:bg-sidebar-accent/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
          "data-[active=true]:hover:bg-transparent",
          "[&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground",
          "hover:[&_svg]:text-foreground",
        )}
      >
        {icon}
        <span className={cn("flex-1 truncate", RAIL_LABEL)}>{children}</span>
        {trailing}
      </Link>
    </RailTip>
  );
}

export function SidebarSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-px">
      <div
        className={cn(
          "px-2 pt-4 pb-1 text-[11px] font-medium whitespace-nowrap text-muted-foreground",
          RAIL_LABEL,
        )}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

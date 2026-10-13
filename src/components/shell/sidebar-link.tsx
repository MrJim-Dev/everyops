"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function SidebarLink({
  href,
  active,
  icon,
  children,
  trailing,
  onNavigate,
}: {
  href: string;
  active?: boolean;
  icon: ReactNode;
  children: ReactNode;
  trailing?: ReactNode;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group/link flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] text-sidebar-foreground outline-none transition-colors",
        "hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
        "[&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground",
        active && "bg-sidebar-accent text-foreground [&_svg]:text-foreground",
      )}
    >
      {icon}
      <span className="flex-1 truncate">{children}</span>
      {trailing}
    </Link>
  );
}

export function SidebarSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-px">
      <div className="px-2 pb-1 pt-4 text-[11px] font-medium text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}

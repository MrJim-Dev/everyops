"use client";

import {
  BrainIcon,
  ChartBarIcon,
  ClockCounterClockwiseIcon,
  GearSixIcon,
  GlobeHemisphereWestIcon,
  GlobeSimpleIcon,
  LightningIcon,
  PlugsConnectedIcon,
  UsersThreeIcon,
  WebhooksLogoIcon,
} from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { canManage } from "@/lib/store/workspaces";
import { cn } from "@/lib/utils";

/** Workspace settings: a section nav on the left (a scrollable row on small screens) and cards on the right. */
export function SettingsLayout({ children }: { children: ReactNode }) {
  const ws = useWorkspace();
  const pathname = usePathname();
  const base = `${ws.basePath}/settings`;
  const items = [
    { id: "general", href: base, label: "General", icon: GearSixIcon },
    { id: "team", href: `${base}/team`, label: "Team", icon: UsersThreeIcon },
    { id: "assistant", href: `${base}/assistant`, label: "Assistant", icon: BrainIcon },
    { id: "ai-usage", href: `${base}/ai-usage`, label: "AI use", icon: ChartBarIcon },
    { id: "automations", href: `${base}/automations`, label: "Automations", icon: LightningIcon },
    ...(canManage(ws.role)
      ? [
          { id: "publish", href: `${base}/publish`, label: "Publish", icon: GlobeHemisphereWestIcon },
          { id: "domains", href: `${base}/domains`, label: "Domains", icon: GlobeSimpleIcon },
          { id: "connections", href: `${base}/connections`, label: "Connections", icon: PlugsConnectedIcon },
          { id: "webhooks", href: `${base}/webhooks`, label: "Webhooks", icon: WebhooksLogoIcon },
          { id: "activity", href: `${base}/activity`, label: "Activity", icon: ClockCounterClockwiseIcon },
        ]
      : []),
  ];
  const active = items.find((t) => t.id !== "general" && pathname.startsWith(t.href))?.id ?? "general";

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <header className="w-full px-5 pt-6 pb-5 sm:px-6">
        <h1 className="animate-rise text-[24px] font-semibold tracking-[-0.02em]">Settings</h1>
        <p
          className="animate-rise stagger mt-1 text-[13.5px] text-muted-foreground"
          style={{ "--i": 1 } as React.CSSProperties}
        >
          Manage {ws.name}: its details, team, assistant and how it's shared.
        </p>
      </header>
      <div className="flex w-full flex-col gap-5 px-5 sm:px-6 lg:flex-row lg:gap-8">
        <nav
          aria-label="Settings sections"
          className="-mx-5 flex shrink-0 gap-1 overflow-x-auto border-b px-5 pb-2 [scrollbar-width:none] sm:-mx-6 sm:px-6 lg:sticky lg:top-6 lg:mx-0 lg:w-[168px] lg:flex-col lg:self-start lg:overflow-visible lg:border-b-0 lg:px-0 lg:pb-0"
        >
          {items.map(({ id, href, label, icon: Icon }) => (
            <Link
              key={id}
              href={href}
              aria-current={active === id ? "page" : undefined}
              className={cn(
                "flex h-8 shrink-0 items-center gap-2.5 rounded-md px-2.5 text-[13px] outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring/50",
                active === id
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
              )}
            >
              <Icon className="size-4" />
              {label}
            </Link>
          ))}
        </nav>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}

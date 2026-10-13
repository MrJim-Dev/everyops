"use client";

import {
  ArrowLeftIcon,
  ClockCounterClockwiseIcon,
  GearSixIcon,
  MagnifyingGlassIcon,
  SparkleIcon,
} from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserMenu } from "@/components/auth/user-menu";
import { LogoMark } from "@/components/brand/logo";
import { UseSystemButton } from "@/components/community/use-system-dialog";
import { SystemIcon } from "@/components/system-icon";
import { Kbd } from "@/components/ui/kbd";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { canManage } from "@/lib/store/workspaces";
import { useCommandMenu } from "./command-menu";
import { SidebarLink, SidebarSection } from "./sidebar-link";
import { WorkspaceSwitcher } from "./workspace-switcher";

export function WorkspaceSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const ws = useWorkspace();
  const pathname = usePathname();
  const { setOpen } = useCommandMenu();
  const manager = canManage(ws.role);
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <nav aria-label="Workspace" className="flex h-full flex-col gap-1 px-2.5 py-2.5">
      <div className="flex items-center gap-1">
        {ws.mode === "live" ? (
          <WorkspaceSwitcher />
        ) : (
          <Link
            href="/community"
            className="flex h-9 flex-1 items-center gap-2 rounded-md px-1.5 text-[13px] text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
          >
            <ArrowLeftIcon className="size-3.5" />
            Community systems
          </Link>
        )}
      </div>

      <div className="mt-1 flex flex-col gap-px">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] text-sidebar-foreground outline-none transition-colors hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <MagnifyingGlassIcon className="size-4 text-muted-foreground" />
          <span className="flex-1 text-left">Search</span>
          <Kbd>⌘K</Kbd>
        </button>
        {ws.mode === "live" ? (
          <>
            {manager ? (
              <SidebarLink
                href={`${ws.basePath}/ask`}
                active={isActive(`${ws.basePath}/ask`)}
                icon={<SparkleIcon />}
                onNavigate={onNavigate}
              >
                Ask EveryOps
              </SidebarLink>
            ) : null}
            <SidebarLink
              href={`${ws.basePath}/history`}
              active={isActive(`${ws.basePath}/history`)}
              icon={<ClockCounterClockwiseIcon />}
              onNavigate={onNavigate}
            >
              History
            </SidebarLink>
            <SidebarLink
              href={`${ws.basePath}/settings`}
              active={isActive(`${ws.basePath}/settings`)}
              icon={<GearSixIcon />}
              onNavigate={onNavigate}
            >
              Settings
            </SidebarLink>
          </>
        ) : null}
      </div>

      <SidebarSection label="Systems">
        {ws.blueprint.systems.length === 0 ? (
          <p className="px-2 py-1 text-[12px] leading-relaxed text-muted-foreground">
            Your systems will appear here once EveryOps sets them up.
          </p>
        ) : (
          ws.blueprint.systems.map((system) => {
            const href = `${ws.basePath}/${system.id}`;
            return (
              <SidebarLink
                key={system.id}
                href={href}
                active={isActive(href)}
                icon={<SystemIcon name={system.icon} />}
                onNavigate={onNavigate}
              >
                {system.name}
              </SidebarLink>
            );
          })
        )}
      </SidebarSection>

      <div className="mt-auto flex flex-col gap-2 pt-4">
        {ws.mode === "preview" ? (
          <div className="flex flex-col gap-2 rounded-lg border border-sidebar-border p-3">
            <p className="text-[12px] leading-relaxed text-muted-foreground">
              {ws.records.length
                ? `You're previewing ${ws.name} with sample data. Changes here aren't saved.`
                : `You're previewing ${ws.name}. It starts empty, and changes here aren't saved.`}
            </p>
            <UseSystemButton systemId={ws.id} />
          </div>
        ) : null}
        <div className="flex items-center justify-between gap-2">
          <UserMenu variant="sidebar" />
          <Link
            href="/"
            aria-label="EveryOps home"
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
          >
            <LogoMark />
          </Link>
        </div>
      </div>
    </nav>
  );
}

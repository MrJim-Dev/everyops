"use client";

import {
  ArrowLeftIcon,
  ChatsCircleIcon,
  ClockCounterClockwiseIcon,
  GearSixIcon,
  MagnifyingGlassIcon,
  SidebarSimpleIcon,
  SparkleIcon,
} from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserMenu } from "@/components/auth/user-menu";
import { UseSystemButton } from "@/components/community/use-system-dialog";
import { SystemIcon } from "@/components/system-icon";
import { Kbd } from "@/components/ui/kbd";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { useAssistant } from "@/lib/assistant/panel-store";
import { useSidebar } from "@/lib/store/sidebar";
import { canManage } from "@/lib/store/workspaces";
import { cn } from "@/lib/utils";
import { useCommandMenu } from "./command-menu";
import { RailTip } from "./rail-tip";
import { RAIL_ITEM, RAIL_LABEL, railWidth, SidebarLink, SidebarSection } from "./sidebar-link";
import { WorkspaceSwitcher } from "./workspace-switcher";

/**
 * The workspace sidebar. Its content is laid out at full width and never reflows: collapsing narrows
 * the frame around it (see WorkspaceShell), labels fade, and icons stay exactly where they were.
 * `rail` is false in the mobile sheet, where there's nothing to collapse.
 */
export function WorkspaceSidebar({ onNavigate, rail = false }: { onNavigate?: () => void; rail?: boolean }) {
  const ws = useWorkspace();
  const pathname = usePathname();
  const { setOpen } = useCommandMenu();
  const assistantOpen = useAssistant((s) => s.open);
  const toggleAssistant = useAssistant((s) => s.toggle);
  const manager = canManage(ws.role);
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const toggleSidebar = useSidebar((s) => s.toggle);
  const collapsible = onNavigate === undefined;

  return (
    <nav
      aria-label="Workspace"
      data-rail={rail}
      className={cn(
        "group/sidebar flex h-full flex-col gap-1 px-2.5 py-2.5",
        collapsible ? "w-[232px]" : "w-full",
      )}
    >
      <div className="flex items-center gap-1">
        {ws.mode === "live" ? (
          <div className={cn("flex overflow-clip rounded-md", RAIL_ITEM, rail ? "w-8" : "w-full")}>
            <WorkspaceSwitcher />
          </div>
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
        <RailTip rail={rail} label="Search">
          <button
            type="button"
            aria-label={rail ? "Search" : undefined}
            onClick={() => setOpen(true)}
            className={cn(
              "flex h-8 items-center gap-2.5 overflow-hidden rounded-md px-2 text-[13px] whitespace-nowrap text-sidebar-foreground outline-none hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
              RAIL_ITEM,
              railWidth(rail),
            )}
          >
            <MagnifyingGlassIcon className="size-4 shrink-0 text-muted-foreground" />
            <span className={cn("flex-1 text-left", RAIL_LABEL)}>Search</span>
            <Kbd className={RAIL_LABEL}>⌘K</Kbd>
          </button>
        </RailTip>
        {ws.mode === "live" ? (
          <>
            <RailTip rail={rail} label="Assistant">
              <button
                type="button"
                aria-label={rail ? "Assistant" : undefined}
                aria-pressed={assistantOpen}
                onClick={() => {
                  toggleAssistant();
                  onNavigate?.();
                }}
                className={cn(
                  "flex h-8 items-center gap-2.5 overflow-hidden rounded-md px-2 text-[13px] whitespace-nowrap text-sidebar-foreground outline-none hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 aria-pressed:bg-sidebar-accent aria-pressed:text-foreground",
                  RAIL_ITEM,
                  railWidth(rail),
                )}
              >
                <ChatsCircleIcon className="size-4 shrink-0 text-muted-foreground" />
                <span className={cn("flex-1 text-left", RAIL_LABEL)}>Assistant</span>
                <Kbd className={RAIL_LABEL}>⌘J</Kbd>
              </button>
            </RailTip>
            {manager ? (
              <SidebarLink
                href={`${ws.basePath}/ask`}
                active={isActive(`${ws.basePath}/ask`)}
                icon={<SparkleIcon />}
                onNavigate={onNavigate}
                rail={rail}
              >
                Ask EveryOps
              </SidebarLink>
            ) : null}
            <SidebarLink
              href={`${ws.basePath}/history`}
              active={isActive(`${ws.basePath}/history`)}
              icon={<ClockCounterClockwiseIcon />}
              onNavigate={onNavigate}
              rail={rail}
            >
              History
            </SidebarLink>
            <SidebarLink
              href={`${ws.basePath}/settings`}
              active={isActive(`${ws.basePath}/settings`)}
              icon={<GearSixIcon />}
              onNavigate={onNavigate}
              rail={rail}
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
                rail={rail}
              >
                {system.name}
              </SidebarLink>
            );
          })
        )}
      </SidebarSection>

      <div className={cn("mt-auto flex flex-col gap-2", rail ? "pt-[52px]" : "pt-4")}>
        {ws.mode === "preview" ? (
          <div
            className={cn(
              "flex flex-col gap-2 rounded-lg border border-sidebar-border p-3",
              RAIL_LABEL,
              rail && "pointer-events-none",
            )}
            aria-hidden={rail || undefined}
          >
            <p className="text-[12px] leading-relaxed text-muted-foreground">
              {ws.records.length
                ? `You're previewing ${ws.name} with sample data. Changes here aren't saved.`
                : `You're previewing ${ws.name}. It starts empty, and changes here aren't saved.`}
            </p>
            <UseSystemButton systemId={ws.id} />
          </div>
        ) : null}
        <div className="flex items-center justify-between gap-2">
          <div className={cn("flex min-w-0 overflow-clip rounded-md", RAIL_ITEM, rail ? "w-8" : "flex-1")}>
            <UserMenu variant="sidebar" />
          </div>
          {collapsible ? (
            <RailTip
              rail={rail}
              label={
                <>
                  Expand sidebar <Kbd>⌘B</Kbd>
                </>
              }
            >
              <button
                type="button"
                aria-label={rail ? "Expand sidebar" : "Collapse sidebar"}
                aria-expanded={!rail}
                title={rail ? undefined : "Collapse sidebar (⌘B)"}
                onClick={() => toggleSidebar(rail)}
                className={cn(
                  // In the rail the button glides to the column above your avatar, along with the frame.
                  "flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-[transform,color,background-color] duration-[260ms] ease-(--ease-drawer) hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 group-data-[instant=true]/shell:duration-0",
                  rail && "-translate-x-[182px] -translate-y-10",
                )}
              >
                <SidebarSimpleIcon className="size-4" />
              </button>
            </RailTip>
          ) : null}
        </div>
      </div>
    </nav>
  );
}
